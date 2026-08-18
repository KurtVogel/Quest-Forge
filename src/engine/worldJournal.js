/**
 * World Journal — auto-summarization engine for long-term session memory.
 * Periodically summarizes recent messages into journal entries, updates the
 * NPC tracker and world facts, then marks those messages as summarized so they
 * are excluded from future LLM history (sliding window pruning).
 *
 * Uses Gemini 2.5 Flash for cost-efficiency — summarization is a simple
 * extraction task that doesn't need the full DM model.
 */

import { sendMessage } from '../llm/adapter.js';
import { getBackgroundConfig } from '../llm/machinery.js';
import { parseJsonObjectLoose } from '../llm/utils/jsonExtractor.js';
import {
    briefNpcFieldForPrompt,
    classifyNpcCandidate,
    curateNpcsForPrompt,
} from './npcRoster.js';
import { runNpcFrontReflection } from '../llm/scribe.js';
import { sanitizeExtractedLocation } from './locationRegistry.js';

export function normalizeLocationName(loc) {
    if (!loc) return '';
    return loc.trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/^the\s+/, '')
        .replace(/[^\w\s]/g, '');
}

const SUMMARIZE_EVERY = 10; // Summarize every N new messages

// A stalled cadence must not grow its payload without bound: one summarize call
// covers at most MAX_BATCH_MESSAGES (a backlog drains cap-by-cap across turns),
// and one bloated message cannot dominate the payload (MAX_MESSAGE_CHARS).
const MAX_BATCH_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 2000;
// Escape hatch for a poison batch (realistic case: a provider safety block on
// re-sent raw narration). Without it the same failing batch retries on EVERY
// turn forever — recurring per-turn cost — while messages past the DM's window
// age out unsummarized: permanent memory rot (2026-08-18 audit P1). After this
// many consecutive failures on the same batch start, the batch is archived
// behind a local fallback entry so the cadence always eventually advances.
const MAX_BATCH_FAILURES = 3;

let failedBatchKey = '';
let failedBatchFailures = 0;

/** Test hook: module-level failure state must not leak between tests. */
export function resetSummarizeFailureTracker() {
    failedBatchKey = '';
    failedBatchFailures = 0;
}

const clampText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const toStringList = (value, maxItems, maxLen) => (Array.isArray(value) ? value : [])
    .map(item => clampText(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);

/**
 * Journal entries persist into every save and feed buildSystemPrompt each turn —
 * a string-valued key_decisions/consequences from live Flash output must never
 * reach ADD_JOURNAL_ENTRY's raw spread (`.join` on it crashes the prompt build
 * every turn, and slice(-3) can never age the poisoned entry out). Typed and
 * clamped here, the sanitizeWorldFactPayload pattern. Returns null when the
 * summary carries no usable text — the batch retries next cadence.
 */
export function normalizeJournalSummary(summary) {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
    const text = clampText(summary.summary, 2000);
    if (!text) return null;
    return {
        summary: text,
        keyDecisions: toStringList(summary.key_decisions, 8, 300),
        consequences: toStringList(summary.consequences, 8, 300),
        location: sanitizeExtractedLocation(summary.location),
    };
}
// One journal batch may not flood the never-pruned world-facts store. The per-turn
// Scribe is budgeted at 3; a 10-message batch gets a slightly larger allowance.
const MAX_FACTS_PER_BATCH = 5;

const JOURNAL_SYSTEM_PROMPT = `You are a meticulous chronicler summarizing RPG game events. Given recent conversation between a player and DM, produce a JSON summary.

Your output MUST be valid JSON with this exact structure:
{
  "summary": "2-3 sentence summary of key events, decisions, and consequences",
  "npcs_encountered": [
    {
      "name": "NPC Name",
      "kind": "character|creature|ephemeral",
      "rosterEligible": true,
      "disposition": "friendly|neutral|hostile|wary|unknown",
      "notes": "brief note about interaction",
      "personality": "key personality trait(s) observed",
      "goals": "what this NPC wants, if revealed",
      "secrets": "any secrets or hidden info hinted at",
      "basedIn": "where they are currently rooted — update when fiction relocates them",
      "lastLocation": "where they were last seen this batch"
    }
  ],
  "location": "Current location name or null if unchanged",
  "key_decisions": ["Brief description of significant player choices"],
  "consequences": ["Any notable consequences that happened or were established"],
  "world_facts": [
    { "fact": "A canonical statement of something now true in the world", "category": "lore|character|location|event|relationship" }
  ]
}

Rules:
- Be concise but capture ALL important narrative beats
- Track NPCs by their EXACT name as written (never rename or paraphrase it — their record forks if the name drifts) and how they feel about the player
- Only include npcs_encountered entries worth tracking across sessions: named characters with dialogue, rivalry, debt, secrets, or recurring story weight. Use kind "creature" or "ephemeral" and rosterEligible false for nameless combat fodder (generic goblins, numbered guards, one-line minions). Combat fodder does not belong in the durable roster.
- Preserve proper nouns and numbers verbatim — never approximate or invent them
- Note location changes. basedIn is their current world anchor (can change); lastLocation is where they were seen
- World facts should be durable truths: deaths, alliances, betrayals, discoveries, established history
- Focus on what HAPPENED, not what might happen
- Output ONLY the JSON, no other text`;

/**
 * Check if we should auto-summarize and do so if needed.
 * Call this after each DM response.
 * @param {object} state - Current game state
 * @param {function} dispatch - Game state dispatch function
 * @param {number} lastSummarizedIndex - Index of last message that was summarized
 * @returns {Promise<{index: number, journalEntry: object|null}>} Updated index and new journal entry if created
 */
export async function maybeAutoSummarize(state, dispatch, lastSummarizedIndex) {
    const messageCount = state.messages.length;
    const newMessages = messageCount - lastSummarizedIndex;

    if (newMessages < SUMMARIZE_EVERY) {
        return { index: lastSummarizedIndex, journalEntry: null };
    }

    const background = getBackgroundConfig(state.settings);
    if (!background.apiKey) return { index: lastSummarizedIndex, journalEntry: null };

    const batchEnd = Math.min(messageCount, lastSummarizedIndex + MAX_BATCH_MESSAGES);
    const batchKey = `${state.session?.id || 'campaign'}:${lastSummarizedIndex}`;

    // A parse failure, an unusable summary, or a rejected call all land here.
    // Below the threshold the batch simply retries next cadence (transient
    // failures stay cheap); at the threshold the batch is archived behind an
    // honest local fallback entry so the cadence advances and the per-turn
    // retry cost stops. The raw messages are never deleted — only excluded
    // from future LLM history like any summarized stretch.
    const recordFailure = () => {
        if (failedBatchKey !== batchKey) {
            failedBatchKey = batchKey;
            failedBatchFailures = 0;
        }
        failedBatchFailures += 1;
        if (failedBatchFailures < MAX_BATCH_FAILURES) {
            return { index: lastSummarizedIndex, journalEntry: null }; // retry next cadence
        }
        resetSummarizeFailureTracker();
        const journalEntry = {
            id: `journal-${Date.now()}`,
            timestamp: Date.now(),
            summary: `(Auto-summary was unavailable for a stretch of ${batchEnd - lastSummarizedIndex} messages${state.currentLocation ? ` around ${state.currentLocation}` : ''}; the events of that stretch are archived without a summary.)`,
            keyDecisions: [],
            consequences: [],
            messageRange: [lastSummarizedIndex, batchEnd],
            location: state.currentLocation || null,
            fallback: true,
        };
        dispatch({ type: 'ADD_JOURNAL_ENTRY', payload: journalEntry });
        dispatch({ type: 'MARK_MESSAGES_SUMMARIZED', payload: batchEnd });
        console.warn(`[Journal] Gave up on messages ${lastSummarizedIndex}–${batchEnd} after ${MAX_BATCH_FAILURES} failed summarize attempts — archived behind a fallback entry`);
        return { index: batchEnd, journalEntry };
    };

    try {
        // Get the unsummarized messages (bounded batch, per-message clamp)
        const messagesToSummarize = state.messages.slice(lastSummarizedIndex, batchEnd);
        const recentMessages = messagesToSummarize
            .filter(m => !m.hidden)
            .map(m => `[${m.role.toUpperCase()}]: ${clampText(m.content, MAX_MESSAGE_CHARS)}`)
            .join('\n\n');

        // An all-hidden batch (e.g. withheld roll-setup narration) would send the LLM
        // an empty transcript and risk a hallucinated summary being written into the
        // journal permanently. Wait for visible messages; the batch retries next turn.
        // With more messages waiting past the cap, advance instead: there is nothing
        // visible in this stretch to record, and deferring would stall the backlog.
        if (!recentMessages.trim()) {
            if (batchEnd < messageCount) {
                dispatch({ type: 'MARK_MESSAGES_SUMMARIZED', payload: batchEnd });
                return { index: batchEnd, journalEntry: null };
            }
            console.warn('[Journal] Batch contains no visible messages — deferring summarization');
            return { index: lastSummarizedIndex, journalEntry: null };
        }

        const response = await sendMessage({
            ...background,
            systemPrompt: JOURNAL_SYSTEM_PROMPT,
            messageHistory: [],
            userMessage: `Summarize these recent game events:\n\n${recentMessages}`,
            temperature: 0.2, // faithful extraction — proper nouns and numbers must survive verbatim
        });

        // Shared repair-capable extractor (same path as responseParser/scribe): a
        // trailing comma or trailing prose from the Flash model must not silently
        // cost this batch its one shot at compression.
        // Anchor on quoted JSON keys — bare "summary" also appears in the model's
        // conversational prose ("Here is the summary:") and would misanchor.
        const summary = parseJsonObjectLoose(response, ['"summary"', '"npcs_encountered"']);
        if (!summary) {
            console.warn('[Journal] Could not parse summary response');
            return recordFailure();
        }

        const normalized = normalizeJournalSummary(summary);
        if (!normalized) {
            console.warn('[Journal] Summary carried no usable text');
            return recordFailure();
        }

        resetSummarizeFailureTracker();

        const journalId = `journal-${Date.now()}`;
        const journalTimestamp = Date.now();
        const journalEntry = {
            id: journalId,
            timestamp: journalTimestamp,
            summary: normalized.summary,
            keyDecisions: normalized.keyDecisions,
            consequences: normalized.consequences,
            messageRange: [lastSummarizedIndex, batchEnd],
            location: normalized.location || state.currentLocation || null,
        };

        // Add journal entry
        dispatch({
            type: 'ADD_JOURNAL_ENTRY',
            payload: journalEntry,
        });

        // Update NPCs with richer data. The reducer upserts by name — creating any the
        // per-turn Scribe hasn't recorded yet and stamping lastSeen — so we just hand it
        // each NPC the summary surfaced; no manual existing-record lookup needed.
        if (Array.isArray(summary.npcs_encountered)) {
            for (const npc of summary.npcs_encountered) {
                if (!npc.name) continue;
                const classified = classifyNpcCandidate({
                    name: npc.name,
                    kind: npc.kind,
                    rosterEligible: npc.rosterEligible ?? npc.roster_eligible,
                    disposition: npc.disposition,
                    lastNotes: npc.notes,
                    personality: npc.personality,
                    goals: npc.goals,
                    secrets: npc.secrets,
                    lastLocation: npc.lastLocation,
                    basedIn: npc.basedIn,
                });
                if (!classified.allowRoster) continue;
                dispatch({
                    type: 'UPDATE_NPC',
                    payload: {
                        name: npc.name,
                        kind: classified.kind,
                        disposition: npc.disposition,
                        lastNotes: npc.notes,
                        ...(npc.personality && { personality: npc.personality }),
                        ...(npc.goals && { goals: npc.goals }),
                        ...(npc.secrets && { secrets: npc.secrets }),
                        ...(npc.lastLocation && { lastLocation: npc.lastLocation }),
                        ...(npc.basedIn && { basedIn: npc.basedIn }),
                    },
                });
            }
        }

        // Add world facts extracted from this batch, capped like the Scribe's budget —
        // the world-facts block is never pruned, so an over-eager summary must not
        // quietly bloat every future prompt.
        if (Array.isArray(summary.world_facts) && summary.world_facts.length > 0) {
            dispatch({ type: 'ADD_WORLD_FACTS', payload: summary.world_facts.slice(0, MAX_FACTS_PER_BATCH) });
        }

        // Update location — the journal prompt itself invites a literal "null" for
        // "unchanged", so the shared filler drop-list is load-bearing here.
        // fillOnly: a batch summary is as stale as its batch — while this call was
        // in flight the hero may have traveled (live playtest #5: the summary's
        // "Weatherby" clobbered the same-turn Scribe's fen arrival, minting
        // phantom departure/arrival stamps for the living-world machinery). The
        // journal may fill an empty location or re-affirm the current one, never
        // relocate; the per-turn Scribe owns live position.
        if (normalized.location) {
            dispatch({ type: 'SET_LOCATION', payload: { name: normalized.location, fillOnly: true } });
        }

        // Mark these messages as summarized — they will be excluded from future LLM history
        dispatch({ type: 'MARK_MESSAGES_SUMMARIZED', payload: batchEnd });

        // Cadenced private reflection: keep NPC intent, relationship pressure, hidden
        // front symptoms, and future callback hooks alive without adding per-turn cost.
        runNpcFrontReflection({
            state,
            dispatch,
            cadence: {
                id: `journal-${state.session?.id || 'campaign'}-${batchEnd}`,
                journalEnd: batchEnd,
                summary: normalized.summary,
                keyDecisions: normalized.keyDecisions,
                consequences: normalized.consequences,
            },
        }).catch(() => {});

        console.log(`[Journal] Summarized messages ${lastSummarizedIndex}–${batchEnd}, extracted ${summary.world_facts?.length || 0} world facts`);
        return { index: batchEnd, journalEntry };
    } catch (e) {
        console.warn('[Journal] Auto-summarize failed:', e);
        return recordFailure();
    }
}

/**
 * Build a journal context string for injection into the system prompt.
 * Returns the last few journal entries and NPC list formatted for the DM.
 */
export function buildJournalContext(journal, npcs, currentLocation) {
    const parts = [];

    if (currentLocation) {
        parts.push(`**Current location:** ${currentLocation}`);
    }

    // Last 3 journal entries for narrative context
    if (journal.length > 0) {
        const recentEntries = journal.slice(-3);
        const entrySummaries = recentEntries.map((e, i) => {
            let entry = `Entry ${journal.length - recentEntries.length + i + 1}: ${e.summary}`;
            // Array belt for legacy entries persisted before normalizeJournalSummary —
            // a string-valued consequences here crashed the prompt build every turn.
            if (Array.isArray(e.consequences) && e.consequences.length) {
                entry += ` [Consequences: ${e.consequences.join('; ')}]`;
            }
            return entry;
        }).join('\n');
        parts.push(`\n## SESSION HISTORY (what has happened so far)\n${entrySummaries}`);
    }

    // Location transition history ledger. Bounded (2026-08-18 audit): the
    // backward scan covers only the recent journal — an infinite campaign must
    // not pay O(whole journal) regex work per prompt build when the current
    // location matches nothing — and an entry already visible in the SESSION
    // HISTORY last-3 window above is referenced, not re-printed (right after
    // travel the arrival entry IS one of the last 3, so re-printing duplicated
    // ~2-4k chars every turn). Re-printed summaries are clamped.
    const TRANSITION_SCAN_ENTRIES = 30;
    const TRANSITION_SUMMARY_CHARS = 300;
    const normCurrentLoc = normalizeLocationName(currentLocation);
    if (normCurrentLoc && journal.length > 0) {
        const scanFloor = Math.max(0, journal.length - TRANSITION_SCAN_ENTRIES);
        let transitionIdx = -1;
        let i = journal.length - 1;
        while (i >= scanFloor) {
            const entryLoc = normalizeLocationName(journal[i].location);
            if (entryLoc === normCurrentLoc) {
                transitionIdx = i;
            } else {
                if (transitionIdx !== -1) {
                    break;
                }
            }
            i--;
        }

        if (transitionIdx !== -1) {
            const shownFloor = journal.length - Math.min(journal.length, 3); // SESSION HISTORY's window
            const arrivalEntry = journal[transitionIdx];
            const prevEntry = transitionIdx > 0 ? journal[transitionIdx - 1] : null;
            const lines = [];
            if (prevEntry) {
                const prevIdx = transitionIdx - 1;
                const at = prevEntry.location ? ` at ${prevEntry.location}` : '';
                lines.push(prevIdx >= shownFloor
                    ? `- **Right before entering:** Entry ${prevIdx + 1}${at ? ` (${at.trim()})` : ''} in SESSION HISTORY above.`
                    : `- **Right before entering:** [Entry ${prevIdx + 1}${at}] ${clampText(prevEntry.summary, TRANSITION_SUMMARY_CHARS)}`);
            }
            lines.push(transitionIdx >= shownFloor
                ? `- **Arrival at ${currentLocation}:** Entry ${transitionIdx + 1} in SESSION HISTORY above.`
                : `- **Arrival at ${currentLocation}:** [Entry ${transitionIdx + 1}] ${clampText(arrivalEntry.summary, TRANSITION_SUMMARY_CHARS)}`);
            parts.push(`\n## LOCATION TRANSITION HISTORY\n${lines.join('\n')}`);
        }
    }

    // NPC tracker — curated by importance, pins, location, and tension (not recency alone)
    const rosterNpcs = (npcs || []).filter(n => n.rosterTier === 'character' || !n.rosterTier);
    if (rosterNpcs.length > 0) {
        const MAX_PROMPT_NPCS = 8;
        const shown = curateNpcsForPrompt(rosterNpcs, { location: currentLocation, limit: MAX_PROMPT_NPCS });
        const hiddenCount = Math.max(0, rosterNpcs.length - shown.length);

        const npcList = shown.map(n => {
            // Gender rides next to the name (not buried in extras): scene art and
            // pronoun consistency both depend on the DM never re-guessing it.
            const identity = [n.gender, n.disposition].filter(Boolean).join(', ');
            const disp = identity ? ` (${identity})` : '';
            const notes = n.lastNotes || n.notes || '';
            // Show the latest relationship shift so the DM keeps a changed bond
            // consistent — a friend who turned on the player should stay turned.
            // Only previous → current: the full chain burned tokens/card space
            // without adding play value (Vesa, 2026-07-23); data keeps every step.
            const arc = Array.isArray(n.relationshipHistory) && n.relationshipHistory.length > 0
                ? `relationship: ${n.relationshipHistory[n.relationshipHistory.length - 1].from} → ${n.disposition}`
                : '';
            const extras = [
                n.pinned && 'pinned',
                n.importance && `importance: ${n.importance}/5`,
                // Established looks come first: nothing breaks immersion like a
                // white-haired NPC turning brown-haired three sessions later.
                n.appearance && `looks: ${briefNpcFieldForPrompt(n.appearance)}`,
                n.personality && `personality: ${briefNpcFieldForPrompt(n.personality)}`,
                n.goals && `wants: ${briefNpcFieldForPrompt(n.goals)}`,
                n.agenda && `agenda: ${briefNpcFieldForPrompt(n.agenda)}`,
                n.secrets && `secret: ${briefNpcFieldForPrompt(n.secrets)}`,
                n.relationshipTension && `tension: ${briefNpcFieldForPrompt(n.relationshipTension)}`,
                // The personal bond with the hero — flirtation, gratitude, grudges —
                // is the beat players remember most; the DM must play it consistently.
                n.stanceToPlayer && `toward the hero: ${briefNpcFieldForPrompt(n.stanceToPlayer)}`,
                Array.isArray(n.bondMoments) && n.bondMoments.length > 0
                    && `personal history with the hero: ${briefNpcFieldForPrompt(n.bondMoments.slice(-2).map(m => m.text).join('; '), 240)}`,
                Number.isFinite(n.trust) && `trust: ${n.trust}/100`,
                n.basedIn && `based in: ${n.basedIn}`,
                n.lastLocation && `last seen: ${n.lastLocation}`,
                arc,
                Array.isArray(n.callbackHooks) && n.callbackHooks.length > 0 && `hooks: ${n.callbackHooks.slice(0, 2).join('; ')}`,
            ].filter(Boolean).join(' | ');
            return `- **${n.name}**${disp}: ${notes}${extras ? ` [${extras}]` : ''}`;
        }).join('\n');

        const overflow = hiddenCount > 0
            ? `\n*(${hiddenCount} other NPCs available via RETRIEVED MEMORIES when relevant)*`
            : '';

        parts.push(`\n## KNOWN NPCs (keep names, registered gender, and established looks EXACTLY consistent — a character's gender and pronouns NEVER change from the registered value or the fiction that introduced them, and never re-invent or launder hair, eyes, build, body proportions, scars, intimate details, or clothing that "looks:" already records. Each NPC's "secret:" and "agenda:" entries are that character's PRIVATE interior — other characters do not know them unless the fiction has shown the reveal, per rule 9)\n${npcList}${overflow}`);
    }

    return parts.join('\n');
}
