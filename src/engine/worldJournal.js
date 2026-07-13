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

export function normalizeLocationName(loc) {
    if (!loc) return '';
    return loc.trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/^the\s+/, '')
        .replace(/[^\w\s]/g, '');
}

const SUMMARIZE_EVERY = 10; // Summarize every N new messages
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

    try {
        // Get the unsummarized messages
        const messagesToSummarize = state.messages.slice(lastSummarizedIndex, messageCount);
        const recentMessages = messagesToSummarize
            .filter(m => !m.hidden)
            .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
            .join('\n\n');

        // An all-hidden batch (e.g. withheld roll-setup narration) would send the LLM
        // an empty transcript and risk a hallucinated summary being written into the
        // journal permanently. Wait for visible messages; the batch retries next turn.
        if (!recentMessages.trim()) {
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
            console.warn('[Journal] Could not parse summary response — messages NOT marked as summarized');
            return { index: lastSummarizedIndex, journalEntry: null }; // Don't advance — retry next time
        }

        const journalId = `journal-${Date.now()}`;
        const journalTimestamp = Date.now();
        const journalEntry = {
            id: journalId,
            timestamp: journalTimestamp,
            summary: summary.summary,
            keyDecisions: summary.key_decisions || [],
            consequences: summary.consequences || [],
            messageRange: [lastSummarizedIndex, messageCount],
            location: summary.location || state.currentLocation || null,
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

        // Update location
        if (summary.location) {
            dispatch({ type: 'SET_LOCATION', payload: summary.location });
        }

        // Mark these messages as summarized — they will be excluded from future LLM history
        dispatch({ type: 'MARK_MESSAGES_SUMMARIZED', payload: messageCount });

        // Cadenced private reflection: keep NPC intent, relationship pressure, hidden
        // front symptoms, and future callback hooks alive without adding per-turn cost.
        runNpcFrontReflection({
            state,
            dispatch,
            cadence: {
                id: `journal-${state.session?.id || 'campaign'}-${messageCount}`,
                journalEnd: messageCount,
                summary: summary.summary,
                keyDecisions: summary.key_decisions || [],
                consequences: summary.consequences || [],
            },
        }).catch(() => {});

        console.log(`[Journal] Summarized messages ${lastSummarizedIndex}–${messageCount}, extracted ${summary.world_facts?.length || 0} world facts`);
        return { index: messageCount, journalEntry };
    } catch (e) {
        console.warn('[Journal] Auto-summarize failed:', e);
        return { index: lastSummarizedIndex, journalEntry: null };
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
            if (e.consequences?.length) {
                entry += ` [Consequences: ${e.consequences.join('; ')}]`;
            }
            return entry;
        }).join('\n');
        parts.push(`\n## SESSION HISTORY (what has happened so far)\n${entrySummaries}`);
    }

    // Location transition history ledger
    const normCurrentLoc = normalizeLocationName(currentLocation);
    if (normCurrentLoc && journal.length > 0) {
        let transitionIdx = -1;
        let i = journal.length - 1;
        while (i >= 0) {
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
            const arrivalEntry = journal[transitionIdx];
            const prevEntry = transitionIdx > 0 ? journal[transitionIdx - 1] : null;
            const lines = [];
            if (prevEntry) {
                let prevText = `[Entry ${transitionIdx}] ${prevEntry.summary}`;
                if (prevEntry.location) {
                    prevText = `[Entry ${transitionIdx} at ${prevEntry.location}] ${prevEntry.summary}`;
                }
                lines.push(`- **Right before entering:** ${prevText}`);
            }
            lines.push(`- **Arrival at ${currentLocation}:** [Entry ${transitionIdx + 1}] ${arrivalEntry.summary}`);
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
            const disp = n.disposition ? ` (${n.disposition})` : '';
            const notes = n.lastNotes || n.notes || '';
            // Show the relationship arc so the DM keeps a shifted bond consistent — a
            // friend who turned on the player should stay turned.
            const arc = Array.isArray(n.relationshipHistory) && n.relationshipHistory.length > 0
                ? `relationship: ${[...n.relationshipHistory.map(h => h.from), n.disposition].join(' → ')}`
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

        parts.push(`\n## KNOWN NPCs (keep names and established looks EXACTLY consistent — never re-invent or launder hair, eyes, build, body proportions, scars, intimate details, or clothing that "looks:" already records)\n${npcList}${overflow}`);
    }

    return parts.join('\n');
}
