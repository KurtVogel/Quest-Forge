/**
 * World Journal — auto-summarization engine for long-term session memory.
 * Periodically summarizes recent messages into journal entries, updates the
 * NPC tracker and world facts, then marks those messages as summarized so they
 * are excluded from future LLM history (sliding window pruning).
 *
 * Runs on the Gemini machinery model (MACHINERY_MODEL in llm/machinery.js,
 * via getBackgroundConfig) for cost-efficiency — summarization is a simple
 * extraction task that doesn't need the full DM model.
 */

import { JOURNAL_SUMMARY_MAX, LOCATION_NAME_MAX } from '../config/contentLimits.js';
import { sendMessage } from '../llm/adapter.js';
import { getBackgroundConfig } from '../llm/machinery.js';
import { parseJsonObjectLoose } from '../llm/utils/jsonExtractor.js';
import { dispatchClassifiedNpcUpdate } from './npcRoster.js';
// The four prompt blocks the journal feeds (the place line, SESSION HISTORY,
// LOCATION TRANSITION HISTORY, KNOWN NPCs) and the bond composer live in
// llm/journalBlocks.js since 2026-10-14 (memory-journal Lap-4 P2) — the
// cadence engine keeps the cadence. Re-exported for the readers that import
// them from here.
export {
    buildJournalBlocks,
    buildJournalContext,
    describeBondForPrompt,
    KNOWN_NPC_NOTES_MAX,
    SESSION_HISTORY_CONSEQUENCES,
    SESSION_HISTORY_CONSEQUENCE_CHARS,
} from '../llm/journalBlocks.js';
import { hasCommitments, snapshotCommitments, verifyCommitmentsAfterCadence } from './commitmentVerifier.js';
import { gameReducer } from '../state/gameReducer.js';
import { campaignStamp } from '../state/handlers/shared.js';
import { runNpcFrontReflection } from '../llm/scribe.js';
import { collectNarrativeEntries } from '../llm/narrativeMessages.js';
import { sanitizeExtractedLocation } from './locationRegistry.js';
import { normalizeJournalEntry } from './journalEntry.js';
import { cadenceIdFor } from './fronts.js';

export function normalizeLocationName(loc) {
    if (!loc) return '';
    return loc.trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/^the\s+/, '')
        .replace(/[^\w\s]/g, '');
}

// Summarize every N new NARRATIVE-ELIGIBLE messages (2026-09-06 P2 — the last
// raw-index window in the memory layer: a dice turn burns ~5 raw rows, so
// counting raw rows journaled roll-heavy play every ~2 turns and aged
// low-salience cards out in ~6 turns through DORMANCY_JOURNAL_CYCLES).
export const SUMMARIZE_EVERY = 10;

/**
 * The newest player/DM rows a cadence never summarizes (2026-10-01 P1). The
 * batch used to end at `messages.length`, so every cadence flagged the whole
 * transcript and EMPTIED the DM's window: the call after it carried the
 * player's new line and a 2–3-sentence summary — the merchant's exact offer
 * two exchanges back, the companion's last line, gone. `MESSAGE_WINDOW` 20 was
 * a ceiling the history saw-toothed under (1 → ~11 → 1 every ~5 turns). The
 * cadence now fires once SUMMARIZE_EVERY narrative rows lie BEFORE the tail and
 * summarizes only those; six rows = the last three exchanges stay verbatim.
 * Engine lines among the tail (roll results, receipts) stay with it.
 */
export const KEEP_TAIL = 6;

// A stalled cadence must not grow its payload without bound: one summarize call
// covers at most MAX_BATCH_MESSAGES (a backlog drains cap-by-cap across turns),
// and one bloated message cannot dominate the payload (MAX_MESSAGE_CHARS).
const MAX_BATCH_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 2000;

/**
 * Combat-exchange dice lines are weightless to the cadence (2026-09-23
 * combat-exchange P1): they are not narrative (THE predicate excludes them)
 * and they are not backlog either — a 9-exchange fight mints ~64 of them, so
 * counting them as raw rows tripped the MAX_BATCH_MESSAGES escape and cut
 * the fight into two batches (two Flash calls, two journal entries for one
 * fight). The batch still archives them behind its boundary like any
 * excluded row; they simply never consume the backlog cap or trigger it.
 */
const isWeightlessRow = m => m?.exchangeLine === true;

/** Rows in [`fromIndex`, `toIndex`) that count toward the raw backlog escape. */
function countWeightedRows(messages, fromIndex, toIndex = messages.length) {
    let count = 0;
    for (let i = fromIndex; i < toIndex; i++) {
        if (!isWeightlessRow(messages[i])) count += 1;
    }
    return count;
}

const isConversationalRow = m => m?.role === 'user' || m?.role === 'assistant';

/**
 * The raw index the kept tail starts at: the KEEP_TAIL-th newest
 * narrative-eligible player/DM row of the unsummarized stretch. With fewer
 * than KEEP_TAIL such rows, all of them are tail (only what precedes the
 * oldest can be archived); with none, there is nothing to keep.
 *
 * The tail opens on the PLAYER's line: when its oldest row is the DM's, the
 * player line that prompted it joins the tail, so neither the window nor the
 * batch ever holds half an exchange (an action summarized without its
 * outcome). That is the shape the cadence usually sees — the orchestrator's
 * state can be one committed DM row behind the transcript.
 */
function tailBoundary(messages, entries) {
    let boundary = messages.length;
    let oldestKept = null;
    let kept = 0;
    let i = entries.length - 1;
    for (; i >= 0 && kept < KEEP_TAIL; i--) {
        if (!isConversationalRow(entries[i].message)) continue;
        oldestKept = entries[i];
        boundary = oldestKept.index;
        kept += 1;
    }
    if (oldestKept?.message.role === 'assistant') {
        for (; i >= 0; i--) {
            if (!isConversationalRow(entries[i].message)) continue;
            if (entries[i].message.role === 'user') boundary = entries[i].index;
            break;
        }
    }
    return boundary;
}

// A fight's dice-line groups sit at most this many player/DM rows apart (the
// beat's narration + the next action, one row of slack).
const FIGHT_GAP_ROWS = 3;

/**
 * A finished fight is journaled WHOLE. The tail's cut can land between two
 * rounds of a fight that just ended; the batch before it would then carry
 * mid-fight state with no outcome — the durable "Mara at 1/12 HP" history
 * the 2026-08-09 no-mid-fight rule exists to prevent. When dice lines sit on
 * both sides of the cut within one fight, the cut moves back to the fight's
 * first dice line: the fight waits in the tail and is summarized in one
 * batch once the tail has moved past it.
 */
function fightSafeCut(messages, fromIndex, cut) {
    let after = -1;
    for (let i = cut; i < messages.length; i++) {
        if (isWeightlessRow(messages[i])) { after = i; break; }
    }
    if (after === -1) return cut;
    let start = -1;
    let gap = 0;
    for (let i = after - 1; i >= fromIndex; i--) {
        const m = messages[i];
        if (isWeightlessRow(m)) {
            start = i;
            gap = 0;
        } else if (isConversationalRow(m) && !m.hidden && !m.deleted) {
            gap += 1;
            if (gap > FIGHT_GAP_ROWS) break;
        }
    }
    return start === -1 ? cut : start;
}

/**
 * The raw index the next batch ends at: past the MAX_BATCH_MESSAGES-th
 * weighted row after `fromIndex`, or the end of the transcript.
 */
function batchBoundary(messages, fromIndex) {
    let weighted = 0;
    for (let i = fromIndex; i < messages.length; i++) {
        if (isWeightlessRow(messages[i])) continue;
        weighted += 1;
        if (weighted === MAX_BATCH_MESSAGES) return i + 1;
    }
    return messages.length;
}
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

// A role-less / non-string role in the batch used to throw before any call —
// three cadences later 40 messages were archived unsummarized (2026-09-18 P2).
const roleLabel = (role) => (typeof role === 'string' && role.trim() ? role.trim().toUpperCase().slice(0, 20) : 'SYSTEM');

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
    const text = clampText(summary.summary, JOURNAL_SUMMARY_MAX);
    if (!text) return null;
    return {
        summary: text,
        keyDecisions: toStringList(summary.key_decisions, 8, 300),
        consequences: toStringList(summary.consequences, 8, 300),
        location: clampText(sanitizeExtractedLocation(summary.location), LOCATION_NAME_MAX) || null,
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
- [SYSTEM] lines are the game engine's authoritative mechanical results and always outrank narrative prose about HP, injuries, deaths, and fight outcomes. Record a fight only by its FINAL resolved outcome (who won; who died, fled, or surrendered; the hero's state after any healing) — never mid-fight snapshots: "she is down to 1 HP" or "the lookout remains conscious" from the middle of a fight is superseded by the fight's end and must not appear in the summary
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
 * @param {function} commit - Game state dispatch function (wrapped below: every
 *   write this cadence makes is campaign-stamped and recorded)
 * @param {number} lastSummarizedIndex - Index of last message that was summarized
 * @returns {Promise<{index: number, journalEntry: object|null}>} Updated index and new journal entry if created
 */
export async function maybeAutoSummarize(state, commit, lastSummarizedIndex) {
    const messageCount = state.messages.length;
    // The cut: everything before it may be summarized, the tail after it
    // never is (KEEP_TAIL). Under the raw cap the cut also never splits a
    // fight; past the cap the backlog drains cap-by-cap as it always did.
    const entries = collectNarrativeEntries(state.messages, lastSummarizedIndex);
    const tailStart = tailBoundary(state.messages, entries);
    const cut = countWeightedRows(state.messages, lastSummarizedIndex, tailStart) < MAX_BATCH_MESSAGES
        ? fightSafeCut(state.messages, lastSummarizedIndex, tailStart)
        : tailStart;
    const newRawMessages = countWeightedRows(state.messages, lastSummarizedIndex, cut);
    const newNarrativeMessages = entries.filter(entry => entry.index < cut).length;

    // Narrative cadence, with the raw backlog cap as the escape: a stretch of
    // MAX_BATCH_MESSAGES rows with nothing narrative in it (hidden setups,
    // error lines) still has to be archived or the boundary never advances.
    if (newNarrativeMessages < SUMMARIZE_EVERY && newRawMessages < MAX_BATCH_MESSAGES) {
        return { index: lastSummarizedIndex, journalEntry: null };
    }

    // Never journal mid-fight (Codex 2026-08-09): a batch cut inside an active
    // combat records pre-resolution state ("Mara at 1/12 HP", "the lookout
    // remains conscious") as durable history that the committed mechanics
    // contradict minutes later. The cadence simply waits — the capped batch
    // drains normally once the fight resolves.
    if (state.combat?.active) {
        return { index: lastSummarizedIndex, journalEntry: null };
    }

    const background = getBackgroundConfig(state.settings);
    if (!background.apiKey) return { index: lastSummarizedIndex, journalEntry: null };

    // THE cadence's dispatch (2026-10-26 memory-journal P1 + P2). Every write
    // below — the entry, its MARK, the facts, the location, the reflection's
    // roster / card / front writes, the verifier's line — is STAMPED with the
    // campaign this cadence READ (`campaignStamp(state)`; the dispatcher drops
    // a stamp that no longer matches the live campaign — a player who ended a
    // turn and Continued another save inside this lane's Flash window used to
    // get a foreign journal entry and 35 of their rows flagged summarized
    // with nothing summarizing them, permanent and autosaved) and RECORDED,
    // so the post-journal verifier can diff the snapshot against the lane's
    // OWN writes replayed over the state it read — never against the live
    // state, where play's settles and the lane's were indistinguishable.
    const stamp = campaignStamp(state);
    const recorded = [];
    const dispatch = (action) => {
        const stamped = { ...action, meta: { ...stamp, ...(action?.meta || {}) } };
        recorded.push(stamped);
        commit(stamped);
    };

    const batchEnd = Math.min(batchBoundary(state.messages, lastSummarizedIndex), cut);
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
        const journalEntry = normalizeJournalEntry({
            summary: `(Auto-summary was unavailable for a stretch of ${batchEnd - lastSummarizedIndex} messages${state.currentLocation ? ` around ${state.currentLocation}` : ''}; the events of that stretch are archived without a summary.)`,
            messageRange: [lastSummarizedIndex, batchEnd],
            location: state.currentLocation || null,
            fallback: true,
        });
        dispatch({ type: 'ADD_JOURNAL_ENTRY', payload: journalEntry });
        dispatch({ type: 'MARK_MESSAGES_SUMMARIZED', payload: batchEnd });
        console.warn(`[Journal] Gave up on messages ${lastSummarizedIndex}–${batchEnd} after ${MAX_BATCH_FAILURES} failed summarize attempts — archived behind a fallback entry`);
        return { index: batchEnd, journalEntry };
    };

    // The post-journal verifier (memory-research M1, 2026-09-30): what the
    // DM must still find on the record after this cadence's own writes.
    const commitmentsBefore = snapshotCommitments(state);
    try {
        // The unsummarized stretch (bounded batch, per-message clamp) through
        // THE narrative-eligibility predicate (2026-09-06 P1): `kind: 'error'`
        // infrastructure lines and OOC table-talk exchanges (the player's line
        // AND the DM's at-the-table reply) used to reach the summarizer as
        // play — into the permanent tier that feeds SESSION HISTORY, the
        // journal RAG row, and the cadence reflection, while the table-talk
        // contract says the exchange is kept out of memory. Out-of-combat
        // engine roll-result system lines pass the predicate and still ride
        // the transcript; combat-exchange dice lines do not (2026-09-23) — the
        // narration prose and the END_COMBAT lines carry the fight's outcome.
        const recentMessages = entries
            .filter(entry => entry.index < batchEnd)
            .map(entry => entry.message)
            .map(m => `[${roleLabel(m.role)}]: ${clampText(m.content, MAX_MESSAGE_CHARS)}`)
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

        // THE journal row (2026-10-14): the same composer the reducer and the
        // load twin run — known keys, the live clamps, the span inside the
        // transcript.
        const journalEntry = normalizeJournalEntry({
            summary: normalized.summary,
            keyDecisions: normalized.keyDecisions,
            consequences: normalized.consequences,
            messageRange: [lastSummarizedIndex, batchEnd],
            location: normalized.location || state.currentLocation || null,
        });

        // COMMIT ORDER (2026-09-18 P1): the entry and its summarized mark land
        // together, before any secondary dispatch. The mark used to sit at the
        // end of this block, so one throw in the NPC loop (a null
        // npcs_encountered element) left a committed entry un-marked — the same
        // batch re-summarized and re-entered EVERY turn, and the failure streak
        // (reset on the parse, not the commit) could never reach its escape.
        dispatch({
            type: 'ADD_JOURNAL_ENTRY',
            payload: journalEntry,
        });
        // Mark these messages as summarized — they will be excluded from future LLM history
        dispatch({ type: 'MARK_MESSAGES_SUMMARIZED', payload: batchEnd });
        resetSummarizeFailureTracker();

        // Everything below is secondary to the committed entry: a throw in one
        // lane costs that lane only, never the entry/mark pairing.
        const secondary = (label, run) => {
            try {
                run();
            } catch (e) {
                console.warn(`[Journal] ${label} dispatch failed — entry already committed:`, e);
            }
        };

        // Update NPCs with richer data. The reducer upserts by name — creating any the
        // per-turn Scribe hasn't recorded yet and stamping lastSeen — so we just hand it
        // each NPC the summary surfaced; no manual existing-record lookup needed.
        const encountered = (Array.isArray(summary.npcs_encountered) ? summary.npcs_encountered : [])
            .filter(npc => npc && typeof npc === 'object' && !Array.isArray(npc));
        secondary('NPC', () => {
            // The batch's summary is the scene for the NPC lane (M0, 2026-10-13):
            // a shared first name resolves to the person the summary names in
            // full, or to nobody.
            // Read the TYPED summary (2026-10-14 memory-journal P2, measured): a
            // string key_decisions threw on `.join` one line after it was typed
            // for exactly that shape, the secondary() try swallowed it, and no
            // UPDATE_NPC was dispatched for the whole batch.
            const cadenceMeta = { presenceText: `${normalized.summary} ${normalized.keyDecisions.join(' ')}` };
            // The classifier gate reads the roster (2026-10-22 scribe P1) — the
            // roster from BEFORE the Flash call, by design: the per-turn Scribe
            // may have landed a record meanwhile, and `upsertNpc`'s own
            // `existing` gate (the belt) resolves against the LIVE roster at
            // the reducer, so a stale first gate costs a classification at
            // worst, never a record (2026-10-26 nit).
            const cadenceRoster = { npcs: state.npcs, messageCount: (state.messages || []).length };
            for (const npc of encountered) {
                if (!npc.name) continue;
                // Journal schema → roster schema mapped ONCE (notes → lastNotes);
                // the shared helper classifies and dispatches, so a roster-field
                // addition needs one edit here instead of two (2026-08-31 P2).
                dispatchClassifiedNpcUpdate(dispatch, {
                    name: npc.name,
                    kind: npc.kind,
                    rosterEligible: npc.rosterEligible,
                    disposition: npc.disposition,
                    lastNotes: npc.notes,
                    // A cadence re-mention of past events is not a sighting:
                    // the recency stamps belong to the per-turn lanes (2026-09-06).
                    _seen: false,
                    ...(npc.personality && { personality: npc.personality }),
                    ...(npc.goals && { goals: npc.goals }),
                    ...(npc.secrets && { secrets: npc.secrets }),
                    ...(npc.lastLocation && { lastLocation: npc.lastLocation }),
                    ...(npc.basedIn && { basedIn: npc.basedIn }),
                }, cadenceMeta, cadenceRoster);
            }
        });

        // Add world facts extracted from this batch, capped like the Scribe's budget —
        // the world-facts block is never pruned, so an over-eager summary must not
        // quietly bloat every future prompt.
        if (Array.isArray(summary.world_facts) && summary.world_facts.length > 0) {
            secondary('World-fact', () => dispatch({ type: 'ADD_WORLD_FACTS', payload: summary.world_facts.slice(0, MAX_FACTS_PER_BATCH) }));
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
            secondary('Location', () => dispatch({ type: 'SET_LOCATION', payload: { name: normalized.location, fillOnly: true } }));
        }

        // Cadenced private reflection: keep NPC intent, relationship pressure, hidden
        // front symptoms, and future callback hooks alive without adding per-turn cost.
        runNpcFrontReflection({
            state,
            dispatch,
            cadence: {
                id: cadenceIdFor(state.session?.id, batchEnd),
                journalEnd: batchEnd,
                summary: normalized.summary,
                keyDecisions: normalized.keyDecisions,
                consequences: normalized.consequences,
            },
        }).catch(() => {}).then(() => {
            // Zero tokens: the cadence's writes (summary facts, the reflection's
            // NPC / card / front dispatches) have all landed — anything the
            // record no longer carries is said out loud, once. Guarded: a throw
            // here used to be an unhandled rejection (2026-10-14 nit).
            //
            // The diff reads the LANE's writes replayed over the state the
            // cadence read (2026-10-26 P2, the 10-14 option b): the live state
            // used to be the `after`, and the settled rule that spared play's
            // settles (a quest the DM completed, a thread the Scribe closed)
            // spared the lane's own too — every cadence settle lands at or
            // after the snapshot by construction — so the verifier could no
            // longer see the lane it verifies. Nothing play did is in this
            // replay; everything the lane did is. (The replay's one
            // divergence — a reducer-minted id, a crypto die — never reaches a
            // commitment.) Skipped when the snapshot held nothing to lose.
            try {
                if (hasCommitments(commitmentsBefore)) {
                    const stateAfterLane = recorded.reduce((s, action) => gameReducer(s, action), state);
                    verifyCommitmentsAfterCadence(commitmentsBefore, stateAfterLane, dispatch);
                }
            } catch (e) {
                console.warn('[Journal] Commitment check failed:', e);
            }
        });

        console.log(`[Journal] Summarized messages ${lastSummarizedIndex}–${batchEnd}, extracted ${Math.min(Array.isArray(summary.world_facts) ? summary.world_facts.length : 0, MAX_FACTS_PER_BATCH)} world facts`);
        return { index: batchEnd, journalEntry };
    } catch (e) {
        console.warn('[Journal] Auto-summarize failed:', e);
        return recordFailure();
    }
}

