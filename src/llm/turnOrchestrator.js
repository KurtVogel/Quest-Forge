/**
 * Turn orchestrator — ChatPanel's async DM-turn pipeline as a plain module
 * (review P1-7, 2026-07-31). The multi-call turn machinery (RAG retrieval,
 * prompt assembly, streaming, parsing, roll policy, event application, the
 * missing-events nudge, and the roleplay-check accept/challenge/change flow)
 * was the app's most failure-prone code yet lived in component closures that
 * only a mounted DOM could exercise. `createTurnRunner(deps)` owns it now;
 * ChatPanel wires the deps to its React state/refs and keeps only UI concerns
 * (the rAF-coalesced streaming paint, effects, JSX).
 *
 * Dependency surface (all functions; UI callbacks default to no-ops):
 * - getState():         latest game state (the component's stateRef).
 * - dispatch(action):   reducer dispatch.
 * - streamMessage/sendMessage: the LLM adapter calls, injected so tests can
 *   script responses without a network.
 * - isMounted():        false once the owning mount died — a stream resolving
 *   after unmount/campaign switch must never dispatch into the live store.
 * - setAbortController(controller): hands the turn's AbortController to the
 *   component so Stop/unmount can abort it.
 * - onStreamChunkText(text): display text per streamed chunk, already
 *   fence-frozen; the component owns paint coalescing.
 * - clearStreamingDisplay(): drop any streamed text (and scheduled paints).
 * - setLoading(bool) / onStatus(label): the component's isLoading/status UI.
 * - resetRoleplayChallengeUi(): clear the challenge textarea state.
 */

import { isRecordEntry } from '../engine/journalEntry.js';
import { buildSystemPrompt, buildSystemPromptSplit } from './promptBuilder.js';
import { parseResponse, detectPreNarratedOutcome, displayCutIndex, normalizeEvents, detectSemanticTextRolls } from './responseParser.js';
import { applyEvents } from '../state/applyEvents.js';
import { gameReducer } from '../state/gameReducer.js';
import { handleRequestedRolls } from '../engine/rollResolver.js';
import { attackAsCheckCorrectionPrompt, playerAuthorityRollCorrectionPrompt, reviewOutsideCombatRolls } from '../engine/outOfCombatRollPolicy.js';
import { maybeAutoSummarize } from '../engine/worldJournal.js';
import { buildScribeContext, runScribe } from './scribe.js';
import { isEpilogueRequest } from './tableTalk.js';
import { factMemoryItem, flushMemoryQueue, journalMemoryItem, queueMemoryItem, retrieveRelevant, sceneMemoryItem } from '../engine/vectorMemory.js';
import { findSubjectsInText } from '../engine/textMatch.js';
import { buildPresenceText, PRESENCE_MESSAGE_COUNT } from './narrativeMessages.js';
import { describeMemoryUnavailable, dmCallConfig, getMachineryGeminiKey, PRE_COMMIT_TIMEOUT_MS } from './machinery.js';
import { curateStoryMemory, detectCallbackPayoff } from '../engine/storyMemory.js';
import { markTurn, turnFlags } from './turnFlags.js';
import { captureCallbackPayoff, captureInjection, captureProviderNote, captureUsage } from '../debug/memoryInspectorStore.js';
import { buildMessageWindow, deriveSetupVisibility, dropOrphanCombatExchange } from '../components/Chat/turnVisibility.js';
import { extractProposalLoot } from '../components/Chat/eventRouting.js';
import { buildNudgePrompt, detectMissingEventsCue, extractNudgeEventFields } from '../components/Chat/missingEventsNudge.js';
import { buildRollRulingRecord, buildRoleplayChallengePrompt, buildRoleplayCheckProposal, listRevealableSetupIds, pruneRecentRulings } from '../engine/roleplayCheck.js';
import { detectRecallIntent } from './recallIntent.js';
import { buildRecallDossier, buildRecallRecordBlock, describeRecallReceipt } from '../engine/recallDossier.js';

/** How many recent (un-summarized) messages to send as LLM history. */
export const MESSAGE_WINDOW = 20;

// The presence text and its window live in narrativeMessages.js since
// 2026-09-06 (promptBuilder needs them for KNOWN NPCs without a cycle);
// re-exported here for the existing import sites and tests.
export { buildPresenceText, PRESENCE_MESSAGE_COUNT };

/** Roster NPCs judged present in the scene, at most this many by name hit. */
export const PRESENT_NPC_CAP = 8;

/**
 * The DM call as a family of LANES (2026-10-13 chat-orchestration P2). A
 * lane is a ROW, not a flag set: `sendToLLM` used to read ten `opts` booleans
 * at K sites, nine call sites combined them nine ways, and one lane was named
 * by three readers from two different flags (the prompt projection read
 * `combatNarration`, the event discard `narrationOnly`, the usage mode one
 * and the timing log the other — a rest-cue narration logged 'narration-only'
 * while its usage row said 'standard'). Every call site names its lane once;
 * every reader inside `sendToLLM` reads the row.
 *
 * Columns:
 * - projection — the system-prompt projection (`promptBuilder` option) or null
 *   for the ordinary dynamic half. The plain `narration` lane (a rest cue, a
 *   JSON-only cast's missing prose, the authority correction) keeps the FULL
 *   prompt on purpose: it is a narrative turn minus the dice.
 * - mode — the response-mode PART the builder pushes (`RESPONSE_MODES`); the
 *   table-talk lane's mode becomes `epilogue` on the ending card's request.
 * - discardsEvents — the reply's JSON is force-nulled (the world is paused or
 *   the engine already committed the mechanics); a prose-less reply throws.
 * - wantsMemories — retrieval + callback curation + the recall dossier, when
 *   a player line rides the call.
 * - detectors — the prose roll detector and the roll arbiter run.
 * - nudge — the missing-events nudge may follow a JSON-less reply.
 * - jsonOnly — the reply is a data block by contract: no display stream, an
 *   empty narrative commits no bubble and is not a failure.
 * - openingScene — the one-time opening: `starting_items` honored, a stray
 *   roll request stripped, the nudge's opening cue.
 * - usage — the ONE mode name the usage capture and the timing log share.
 */
export const DM_LANES = Object.freeze({
    standard: Object.freeze({ projection: null, mode: null, discardsEvents: false, wantsMemories: true, detectors: true, nudge: true, jsonOnly: false, openingScene: false, usage: 'standard' }),
    opening: Object.freeze({ projection: null, mode: null, discardsEvents: false, wantsMemories: true, detectors: true, nudge: true, jsonOnly: false, openingScene: true, usage: 'standard' }),
    tableTalk: Object.freeze({ projection: null, mode: 'tableTalk', discardsEvents: true, wantsMemories: true, detectors: false, nudge: false, jsonOnly: false, openingScene: false, usage: 'table-talk' }),
    combatIntent: Object.freeze({ projection: 'intentOnly', mode: 'combatIntent', discardsEvents: false, wantsMemories: false, detectors: false, nudge: false, jsonOnly: true, openingScene: false, usage: 'combat-intent' }),
    combatNarration: Object.freeze({ projection: 'narrationOnly', mode: null, discardsEvents: true, wantsMemories: false, detectors: false, nudge: false, jsonOnly: false, openingScene: false, usage: 'combat-narration' }),
    narration: Object.freeze({ projection: null, mode: null, discardsEvents: true, wantsMemories: false, detectors: false, nudge: false, jsonOnly: false, openingScene: false, usage: 'narration' }),
});

/** The lane row for a name — an unknown name is a programming error, said at once. */
export function dmLane(name = 'standard') {
    const lane = DM_LANES[name];
    if (!lane) throw new Error(`Unknown DM lane "${name}" — one of ${Object.keys(DM_LANES).join(', ')}`);
    return lane;
}

/**
 * Retrieval on a "remember when…" turn (WOW 2026-09-18): wider and looser
 * than the ordinary scene query (8 @ 0.55), because the question is about ONE
 * specific past thing and a rank-12 row is the difference between the true
 * memory and a plausible fabrication.
 */
export const RECALL_RETRIEVAL_TOP_N = 16;
export const RECALL_RETRIEVAL_MIN_SCORE = 0.45;

/**
 * DM channels a recall answer may not move (2026-09-18): a recap of an old
 * reward ("you found fifty gold that day") re-emitted as an event would pay
 * it again — the gain ledger's 4-message window is long expired by the time
 * anyone asks. Remembering is never a mechanic.
 */
export const RECALL_STRIPPED_EVENT_KEYS = [
    'requestedRolls', 'damageTaken', 'healing', 'itemsFound', 'itemsLost', 'startingItems',
    'purchases', 'sells', 'goldFound', 'goldLost', 'silverFound', 'silverLost',
    'copperFound', 'copperLost', 'expAwarded', 'levelUp', 'restTaken', 'spellCasts',
    'combatStart', 'playerDeath',
];

/**
 * The recall intent of a player line against the campaign's known entities,
 * or null. Exposed for ChatPanel's status label and for tests.
 */
export function findRecallIntent(state, playerMessage) {
    if (!playerMessage || state?.combat?.active) return null;
    return detectRecallIntent(playerMessage, {
        npcNames: (Array.isArray(state?.npcs) ? state.npcs : []).map(n => n?.name),
        partyNames: (Array.isArray(state?.party) ? state.party : []).map(c => c?.name),
        locationNames: (Array.isArray(state?.locations) ? state.locations : []).flatMap(l => [l?.name, ...(Array.isArray(l?.aliases) ? l.aliases : [])]),
        questNames: (Array.isArray(state?.quests) ? state.quests : []).map(q => q?.name),
    });
}

/** Strip the mechanical channels from a recall turn's events (null-safe, non-mutating). */
export function stripRecallEvents(events) {
    if (!events || typeof events !== 'object') return events;
    const next = { ...events };
    for (const key of RECALL_STRIPPED_EVENT_KEYS) {
        if (key in next) {
            next[key] = Array.isArray(next[key]) ? [] : (typeof next[key] === 'number' ? 0 : (typeof next[key] === 'boolean' ? false : null));
        }
    }
    return next;
}

/**
 * The roster records PRESENT in the scene, for dramatic-callback curation
 * (2026-09-06 P1). Both curation call sites used to hand `scoreStoryMemory`
 * the WHOLE roster, so the "+5 linked NPC present" bonus fired for every card
 * whose person existed anywhere in the campaign and the query tokens were a
 * roster-wide soup of dispositions and notes — a smuggler two towns away
 * scored within a point of the person the hero was talking to. Presence is
 * the same judgement RAG makes: the player's line plus the last narrative
 * messages (`buildPresenceText`), matched by name through `findSubjectsInText`.
 * Party companions travel with the hero and are always present.
 */
export function findPresentNpcs(state, playerMessage = '') {
    const roster = Array.isArray(state?.npcs) ? state.npcs : [];
    if (roster.length === 0) return [];
    const names = roster.map(n => n?.name).filter(Boolean);
    const sceneText = `${playerMessage || ''} ${buildPresenceText(state?.messages || [])}`;
    const present = new Set((findSubjectsInText(sceneText, names, PRESENT_NPC_CAP) || [])
        .map(name => String(name).toLowerCase()));
    for (const companion of (Array.isArray(state?.party) ? state.party : [])) {
        if (companion?.name) present.add(String(companion.name).toLowerCase());
    }
    return roster.filter(n => present.has(String(n?.name || '').toLowerCase()));
}

const noop = () => {};

/**
 * Identity of the newest ledger entry: its id (dice.ts mints a unique one per
 * roll), or the row object itself for a legacy id-less entry. A capped
 * collection's LENGTH is not a counter.
 */
function newestRollMarker(rollHistory) {
    if (!Array.isArray(rollHistory) || rollHistory.length === 0) return null;
    const newest = rollHistory[rollHistory.length - 1];
    return typeof newest?.id === 'string' && newest.id ? newest.id : newest;
}

export function createTurnRunner({
    getState,
    dispatch,
    streamMessage,
    sendMessage,
    isMounted = () => true,
    setAbortController = noop,
    onStreamChunkText = noop,
    clearStreamingDisplay = noop,
    setLoading = noop,
    onStatus = noop,
    resetRoleplayChallengeUi = noop,
}) {
    let summarizeInFlight = false; // One summarize pass at a time — overlapping runs would double-journal the same range

    // Journal boundary derived FRESH from state on every cadence (2026-08-31
    // P1 belt): the old runner-local mirror survived same-session loads, so an
    // earlier save left a stretch permanently unjournaled and a later/cloud
    // save re-summarized already-summarized messages. The summarized flags on
    // the live messages ARE the boundary (every advancing path in worldJournal
    // dispatches MARK_MESSAGES_SUMMARIZED); prunedMessageCount only fast-
    // forwards the scan when it agrees with the flags.
    const summarizedBoundary = (s) => {
        const messages = s?.messages || [];
        let prefix = s?.session?.prunedMessageCount || 0;
        if (!(prefix > 0 && prefix <= messages.length && messages[prefix - 1]?.summarized)) prefix = 0;
        while (prefix < messages.length && messages[prefix]?.summarized) prefix++;
        return prefix;
    };

    // Journal entries waiting for the next turn's memory batch (2026-10-01 P2).
    let carriedJournalMemories = [];

    const runAutoSummarize = async () => {
        if (summarizeInFlight) return;
        summarizeInFlight = true;
        try {
            // ONE state for the cadence (2026-10-01 P2): the transcript it
            // counts, the boundary, and the batch are the same read. The ref
            // may still be one committed row behind (the render has not
            // flushed on the sync path) — harmless since KEEP_TAIL: a
            // transcript one row short only ever keeps MORE tail.
            const cadenceState = getState();
            // The cadence stamps and records its own writes (2026-10-26): a
            // load between this read and the Flash reply drops them at the
            // dispatcher instead of landing them in the campaign Continued.
            const result = await maybeAutoSummarize(cadenceState, dispatch, summarizedBoundary(cadenceState));
            // A `fallback` entry ("Auto-summary was unavailable…") is honest
            // bookkeeping, not memory: never embed it (2026-09-06 P2 — the
            // mount seed skips it the same way).
            if (isRecordEntry(result.journalEntry) && getMachineryGeminiKey(cadenceState.settings)) {
                // Bare summary, location as metadata — the EXACT text the mount
                // seed builds. The old "[Location: X] summary" prefix never
                // matched the seed's bare text, so every journal entry was
                // re-embedded (and duplicated in retrieval) on each reload
                // (live playtest #10, 2026-08-22: 40 re-embeds on Continue).
                // Subjects tagged like the seed does, so live rows get the same
                // presence-aware retrieval treatment (2026-08-28) — from the
                // roster AFTER the cadence, whose NPC lane has just written.
                //
                // CARRIED, not embedded (2026-10-01 P2): the turn's batch
                // flushed seconds ago, so an embed here was a third request on
                // every cadence turn. The row rides the NEXT turn's batch
                // instead — SESSION HISTORY renders the entry meanwhile, and a
                // reload before then is covered by the mount seed.
                const rosterNames = (getState().npcs || []).map(n => n?.name).filter(Boolean);
                carriedJournalMemories.push(journalMemoryItem(result.journalEntry, rosterNames));
            }
        } catch (e) {
            console.error('[Journal RAG Seeding] Failed:', e);
        } finally {
            summarizeInFlight = false;
        }
    };

    /**
     * Build the system prompt from current state, with optional RAG memories injected.
     */
    /** The builder's options from the live state — one composer for the string and the split. */
    const currentPromptOptions = (s, retrievedMemories = [], storyMemory = [], recallRecord = '', projection = {}) => ({
            // The lane's projection and response mode (`narrationOnly` /
            // `intentOnly` / `nudgeOnly` / `mode`) — the builder's own options.
            ...projection,
            // The whole pool for the open-thread LOOKUP (2026-09-30 P1); the
            // curated `storyMemory` below is only what the callbacks block SHOWS.
            storyMemoryPool: s.storyMemory || [],
            recallRecord,
            character: s.character,
            inventory: s.inventory,
            quests: s.quests,
            rollHistory: s.rollHistory,
            preset: s.settings.preset,
            ruleset: s.settings.ruleset,
            customSystemPrompt: s.settings.customSystemPrompt,
            journal: s.journal,
            npcs: s.npcs,
            party: s.party,
            currentLocation: s.currentLocation,
            locations: s.locations || [],
            combat: s.combat,
            worldFacts: s.worldFacts || [],
            fronts: s.fronts || [],
            worldTempo: s.worldTempo || null,
            recentEncounters: s.recentEncounters || [],
            recentChecks: s.recentChecks || [],
            paceDial: s.settings.paceDial,
            messageCount: (s.messages || []).length,
            messages: s.messages || [],
            storyMemory,
            retrievedMemories,
            premise: s.session?.premise,
            regionalHearsay: s.session?.regionalHearsay || null,
            absenceDrift: s.session?.absenceDrift || null,
            relationshipBeat: s.session?.relationshipBeat || null,
            wonder: s.session?.wonder || null,
            heroTells: s.heroTells || [],
            heroTellBeat: s.session?.heroTellBeat || null,
            recentRulings: pruneRecentRulings(s.recentRulings, {
                messages: s.messages || [],
                location: s.currentLocation,
            }),
        });

    /**
     * Build the system prompt from current state, with optional RAG memories injected.
     */
    const buildCurrentSystemPrompt = (...args) => buildSystemPrompt(currentPromptOptions(...args));
    /** The same prompt split at the prefix boundary (memory-research M1, 2026-10-14). */
    const buildCurrentSystemPromptSplit = (...args) => buildSystemPromptSplit(currentPromptOptions(...args));

    /**
     * Build the sliding-window message history for the LLM.
     * Only sends the last MESSAGE_WINDOW un-summarized messages.
     * Older messages have been captured in journal entries and world facts.
     * `pendingUserMessage` is the transcript row this call sends as its own
     * `userMessage` — never in the window too (2026-10-01 P1).
     */
    const buildMessageHistory = (s, pendingUserMessage = null) => buildMessageWindow(s.messages, MESSAGE_WINDOW, { pendingUserMessage });

    /**
     * The assistant message the most recent sendToLLM call committed to the
     * store — id, narrative, events, hidden — recorded at dispatch time.
     *
     * This exists because reading the committed message back out of React
     * state right after sendToLLM resolves is a proven trap (live playtest
     * #6): the ADD_MESSAGE render flushes in a later macrotask, so a
     * `findLast(assistant)` in the awaited continuation deterministically
     * returns the PREVIOUS turn's message — the Scribe spent weeks extracting
     * facts, locations, and loot audits from one narrative behind the table.
     * The orchestrator already owns the authoritative values; consumers must
     * take them from here, never from a state read in the same task.
     */
    let lastCommittedTurn = null;
    const getLastCommittedTurn = () => lastCommittedTurn;

    /**
     * Send a message to the LLM and process the response.
     * Returns the parsed events (or null).
     * @param {string} userMessage
     * @param {string} [originalPlayerMessage] - The player's actual input. Gates the
     *   narrative-turn stages: memory/dramatic-callback retrieval, semantic text-roll
     *   detection, the roll arbiter, and pre-narration detection. Post-roll outcome
     *   calls pass the proposal's playerAction here too (2026-09-02 P1) — the
     *   outcome is the consequence beat and gets the full pipeline.
     * @param {object} [extras]
     * @param {string} [extras.lane] - the DM_LANES row this call runs on
     *   (default `standard`); the lane decides projection, mode, discards,
     *   memories, detectors, the nudge and the usage name.
     * @param {string} [extras.pendingUserRow] - the transcript row this call
     *   sends as its own prompt (never in the window too) when it is not
     *   `userMessage` itself (the challenge lane).
     * @param {string} [extras.playerActionContext] - the player intent carried
     *   into a follow-up call that has no player line (post-roll outcomes).
     * @param {function} [extras.onNarrative] - receives the narrative text.
     * @param {boolean} [extras.suppressHpEvents] - the engine already applied
     *   this turn's HP deltas (a post-roll outcome).
     */
    const sendToLLM = async (userMessage, originalPlayerMessage, { lane: laneName = 'standard', pendingUserRow = null, playerActionContext = '', onNarrative = null, suppressHpEvents = false, deferredLocation = null } = {}) => {
        const lane = dmLane(laneName);
        // Per-call semantics: a call that commits nothing (combat intent,
        // failure) must never leave an older turn's message readable here.
        lastCommittedTurn = null;
        // ENTRY state: the state the player acted in — pre-dispatch on the sync
        // path, so it does not carry the player's own row yet. Retrieval, the
        // recall dossier, settings, and the entry-time combat flag read it.
        const s = getState();
        const combatWasActive = !!s.combat?.active;

        // RAG: retrieve memories relevant to the current scene (machinery key —
        // embeddings are Gemini-only regardless of the DM provider).
        // Include location and combat context for better retrieval relevance.
        // Combat-intent translation skips ALL of this (2026-08-06 P1): the call is
        // JSON-only — the DM translates a committed action into a bounded
        // combat_exchange and never narrates, so retrieved memories and dramatic
        // callbacks are dead weight in its prompt, the blocking query-embed
        // round-trip delays every combat turn, and the captureInjection would
        // clobber the Memory Inspector's last real (narrative-turn) capture.
        const machineryKey = getMachineryGeminiKey(s.settings);
        const wantsMemories = lane.wantsMemories && !!originalPlayerMessage;
        let retrievedMemories = [];
        let dramaticMemories = [];
        let callbackScene = null;
        let curationQuery = originalPlayerMessage;
        // "Remember when…" (WOW 2026-09-18): a question about the past gets
        // the engine's dossier of what actually happened, wider retrieval with
        // the asked-about people counted as present, and a no-invention block.
        const recallIntent = wantsMemories ? findRecallIntent(s, originalPlayerMessage) : null;
        const recallDossier = recallIntent ? buildRecallDossier(s, recallIntent) : null;
        if (recallDossier) onStatus('Consulting the record');
        if (wantsMemories && machineryKey) {
            const sceneContext = [
                recallIntent?.subjects?.length ? `About: ${recallIntent.subjects.join(', ')}` : null,
                originalPlayerMessage,
                s.currentLocation && `Location: ${s.currentLocation}`,
                s.combat?.active && `In combat with: ${s.combat.enemies.map(e => e.name).join(', ')}`,
            ].filter(Boolean).join('. ');
            const topN = recallIntent ? RECALL_RETRIEVAL_TOP_N : 8;
            const minScore = recallIntent ? RECALL_RETRIEVAL_MIN_SCORE : 0.55;
            const presenceText = recallIntent?.subjects?.length
                ? `${buildPresenceText(s.messages)} ${recallIntent.subjects.join(' ')}`
                : buildPresenceText(s.messages);
            retrievedMemories = await retrieveRelevant(machineryKey, sceneContext, topN, minScore, {
                presenceText,
                atMessage: (s.messages || []).length,
                // A failed query embed is a memory-LESS turn, said out loud
                // (2026-09-17 vector-memory P2): infrastructure line, so the
                // chronicler never retells it and the DM window never sees it.
                // The line names the cause (2026-09-19): a key rejected after
                // a vendor switch is a standing outage with a Settings remedy;
                // a rate limit or a stall is transient.
                onUnavailable: (reason) => dispatch({
                    type: 'ADD_MESSAGE',
                    payload: { role: 'system', kind: 'error', content: describeMemoryUnavailable(reason, s.settings) },
                }),
            }).catch(() => []);
            curationQuery = sceneContext;
        }
        // PROMPT state — the ONE read after the call's only pre-stream await
        // (2026-10-01 P2, the 09-07 header-trap rule applied to the window):
        // the query embed lets React flush, so a `getState()` after it is a
        // different state than the one before it. Curation, the system prompt,
        // and the message window all read THIS capture, never the ref again.
        const promptState = getState();
        if (wantsMemories) {
            // Scene-driven curation: present NPCs only, and the live transcript
            // for the conversational cooldown/recency windows (2026-09-06).
            // The scene the cards are curated FOR, kept for the payoff judge
            // (2026-10-24 P1): a detector that follows a selector scores on
            // what the selector did not use.
            callbackScene = {
                query: curationQuery,
                location: promptState.currentLocation || '',
                npcs: findPresentNpcs(promptState, originalPlayerMessage),
                heroName: promptState.character?.name || '',
                presenceText: buildPresenceText(promptState.messages || []),
            };
            dramaticMemories = curateStoryMemory({
                memories: promptState.storyMemory || [],
                query: callbackScene.query,
                location: callbackScene.location,
                npcs: callbackScene.npcs,
                messages: promptState.messages || [],
                // The registry's fold for the place bonus (2026-10-24 P2 nit).
                locations: promptState.locations || [],
            });
        }
        if (wantsMemories || recallDossier) {
            // Scores/similarities are dropped once the prompt string is built —
            // keep the latest copy for the read-only Memory Inspector panel.
            // The recall receipt lives here too (2026-09-21): it used to post
            // as a `kind: 'record'` chat line the player had no use for.
            captureInjection({
                playerMessage: originalPlayerMessage,
                location: s.currentLocation,
                retrieved: retrievedMemories,
                curated: dramaticMemories,
                record: recallDossier ? recallDossier.lines : null,
                receipt: recallDossier ? describeRecallReceipt(recallDossier, s.messages) : null,
            });
        }

        const recallRecord = recallDossier ? buildRecallRecordBlock(recallDossier, recallIntent.question) : '';
        // The lane's projection (combat narration retells committed RESOLVED
        // EVENTS — the quest / facts / history / inventory blocks are dead
        // weight there, 2026-09-23 P2; the intent call gets the projection its
        // JSON-only job needs, 2026-09-30 P2) and its response MODE, pushed by
        // the builder as a part (2026-10-13 P2 — it used to be string-appended
        // here, unseen by the size log and the block pins). The deterministic
        // OOC contract exists because some DM providers (Grok in live play)
        // never break character on their own; the ending card's epilogue (the
        // last chapter, 2026-09-30) rides the table-talk lane with its own mode.
        const mode = lane.mode === 'tableTalk' && isEpilogueRequest(originalPlayerMessage) ? 'epilogue' : lane.mode;
        const promptSplit = buildCurrentSystemPromptSplit(promptState, retrievedMemories, dramaticMemories, recallRecord, {
            narrationOnly: lane.projection === 'narrationOnly',
            intentOnly: lane.projection === 'intentOnly',
            mode,
        });
        const systemPrompt = promptSplit.text;
        // The player's own row never rides the window beside `userMessage`
        // (the challenge lane names the row its prompt restates).
        const messageHistory = buildMessageHistory(promptState, pendingUserRow || userMessage);

        const abortController = new AbortController();
        setAbortController(abortController);
        let streamBuffer = '';
        const requestStartedAt = performance.now();
        let firstChunkAt = null;

        const fullResponse = await streamMessage({
            ...dmCallConfig(s.settings),
            systemPrompt,
            // The prefix boundary, told to the provider (memory-research M1,
            // 2026-10-14): two leading system messages on the OpenAI-compatible
            // lanes, an explicit breakpoint on OpenAI gpt-5.6+; Gemini sends the
            // one string. The bytes and their order are untouched.
            systemPromptParts: { prefix: promptSplit.prefix, dynamic: promptSplit.dynamic },
            onCacheBreakpointRejected: () => captureProviderNote(`${s.settings.llmProvider} rejected the explicit prompt-cache breakpoint — sent as one system message (implicit caching only).`),
            messageHistory,
            userMessage,
            // Cache telemetry (memory-research M2, 2026-09-30): the provider's
            // own prompt / cached-token counts per DM call, into the inspector.
            conversationId: typeof s.session?.id === 'string' ? s.session.id : undefined,
            onUsage: (usage) => captureUsage({
                ...usage,
                lane: 'dm',
                // ONE mode name (2026-10-13): the timing log below reads the same row.
                mode: lane.usage,
                provider: s.settings.llmProvider,
                model: s.settings.model,
                promptChars: systemPrompt.length,
            }),
            onHeaderRejected: (names) => captureProviderNote(`${s.settings.llmProvider} refused the ${names.join(', ')} header at the CORS preflight — sent without it (no per-server cache affinity).`),
            onChunk: (chunk) => {
                if (firstChunkAt === null) firstChunkAt = performance.now();
                streamBuffer += chunk;
                if (lane.jsonOnly) return;
                // Once we hit the events fence, freeze the display text — all
                // remaining chunks are JSON data that parseResponse handles on the
                // full text. The opener is THE parser's (`displayCutIndex`,
                // 2026-10-25 P2 — a third spelling here streamed "``` json" and
                // a bare object fence to the player). Paint coalescing stays in
                // the component; this only supplies the ready-to-display text.
                const fenceIdx = displayCutIndex(streamBuffer);
                onStreamChunkText(fenceIdx !== -1 ? streamBuffer.slice(0, fenceIdx).trimEnd() : streamBuffer);
            },
            signal: abortController.signal,
        });
        const requestFinishedAt = performance.now();
        if (!isMounted()) return null; // Response landed after unmount/campaign switch — drop it
        console.info(
            `[LLM timing] ${lane.usage}: TTFT ${firstChunkAt === null ? 'n/a' : `${Math.round(firstChunkAt - requestStartedAt)}ms`}, total ${Math.round(requestFinishedAt - requestStartedAt)}ms`
        );

        // Every dispatch of THIS turn is recorded as well as sent (2026-10-13
        // chat-orchestration P2): the post-turn extraction needs the state the
        // turn LEFT, and the ref will not show it until the render flushes.
        // Replaying the recorded actions through the pure reducer over the
        // captured prompt state is that state — see `stateAfter` below.
        const turnActions = [];
        const record = (action) => {
            turnActions.push(action);
            dispatch(action);
        };

        const parsed = parseResponse(fullResponse);
        const narrative = parsed.narrative;
        // Unrepairable JSON means the DM's mechanical events were dropped. That
        // must be VISIBLE — a silently vanished event block reads as "the DM gave
        // me nothing", and channels without a Scribe backstop (combat_start,
        // spell_cast, conditions) had no signal at all before this.
        if (parsed.eventsDropped && !lane.discardsEvents) {
            record({
                type: 'ADD_MESSAGE',
                // kind: 'error' keeps infrastructure lines out of every
                // story reader (chronicler, scene art, priming) — 2026-09-04.
                payload: { role: 'system', kind: 'error', content: 'The DM\'s mechanical events could not be read this turn (malformed data) — the story above stands, but no game state changed. If something seemed granted or started here, ask the DM to restate it.' },
            });
        }
        // An empty reply — no prose, no events, nothing dropped — is a failed
        // turn, not a turn (2026-09-06 P1): a provider refusal that resolved to
        // "" used to commit a blank assistant bubble into the chat, the save,
        // and the DM's own 20-message window with no system line. Throwing
        // routes it to the caller's error line like any other failure; the
        // combat-intent mode is JSON-only by contract and keeps its own guard.
        if (!lane.jsonOnly && !narrative.trim() && !parsed.events && !parsed.eventsDropped) {
            throw new Error('The DM returned an empty response — nothing was narrated and no game state changed. Retry, or if the model is declining, edit or remove (✕) the message it objected to.');
        }
        // Table talk pauses the world: whatever a disobedient DM appends, no events
        // exist on an OOC turn — no rolls, loot, quests, or NPC/state mutations.
        // The narration lanes discard too: the engine committed their mechanics.
        const discardsEvents = lane.discardsEvents;
        // The JSON-only hole in that guard (2026-09-07 audit P1): on the lanes
        // that DISCARD events, a reply that is only a fenced block passed the
        // `!parsed.events` test and committed a blank assistant bubble — and on
        // combat narration the caller then advanced the round with its story
        // lost and the Retry affordance gone. No prose on a prose-only lane is
        // a failed turn, whatever the block said (the documented Grok shape:
        // pattern-matching RESPONSE_FORMAT into a narration-only request).
        if (discardsEvents && !narrative.trim()) {
            throw new Error('The DM returned only a data block and no prose on a narration-only turn — nothing was narrated and no game state changed. Retry the narration.');
        }
        let events = discardsEvents ? null : parsed.events;
        // Remembering is never a mechanic: no dice, no coin, no loot, no XP
        // from an answer about the past (RECALL_STRIPPED_EVENT_KEYS).
        if (recallDossier && events) events = stripRecallEvents(events);
        onNarrative?.(narrative);

        // A combat_exchange with no live combat has no machine to resolve it; left in
        // place it hides the narration AND dead-ends in a silent plan rejection —
        // the whole response vanishes (playtest #10 finding: DM emitted a death_save
        // exchange after END_COMBAT closed the fight with the hero dying).
        if (dropOrphanCombatExchange(events, combatWasActive)) {
            console.warn('[Turn] Dropped a combat_exchange emitted outside active combat; narrating normally.');
        }
        // The opening scene has no player action to adjudicate, so a roll the
        // DM asks for there ("a chase in progress — Athletics?") has nothing to
        // stage: left in place it hid the whole opening as a withheld setup,
        // deferred the premise's starting_items/quest_updates into nothing, and
        // the priming ladder re-fired it into three hidden rows (2026-09-07
        // audit P1). Strip it; the narration stands and the player's first
        // action is where the first check can be proposed.
        if (lane.openingScene && events?.requestedRolls?.length > 0) {
            console.warn('[Turn] Dropped requested_rolls from the opening scene — there is no player action to adjudicate yet.');
            events = { ...events, requestedRolls: [] };
        }
        // The same strip, keyed on combat_start (2026-09-19 audit P1): an ambush
        // with "Perception to spot them" hid the fight's opening narration
        // FOREVER — a hidden setup, START_COMBAT, then the in-combat roll
        // rejection with no proposal and no reveal path, while the engine played
        // the opening volley against prose nobody saw. A fight has the exchange
        // machine, not dice: drop the rolls and let the narration stand.
        if (events?.combatStart && events.requestedRolls?.length > 0) {
            console.warn('[Turn] Dropped requested_rolls riding a combat_start — the fight resolves through the exchange machine.');
            events = { ...events, requestedRolls: [] };
        }

        // If no JSON events/rolls were detected, check if we should run the Scribe to semantically detect any requested rolls in text.
        // Gated on the MACHINERY key (2026-10-25 nit): the detector runs on Gemini Flash whatever the DM vendor.
        if (lane.detectors && (!events || !events.requestedRolls?.length) && !events?.combatStart && originalPlayerMessage && !combatWasActive && machineryKey) {
            const semanticRolls = await detectSemanticTextRolls(narrative, s.settings, { signal: abortController.signal });
            if (semanticRolls && semanticRolls.length > 0) {
                console.warn('[Turn] Scribe detected text-based rolls semantically:', semanticRolls);
                // Merge the detected rolls into any existing events — replacing the whole
                // object would silently drop loot/quest/NPC events the response carried.
                const detected = normalizeEvents({ requested_rolls: semanticRolls });
                if (events) {
                    events.requestedRolls = detected.requestedRolls;
                } else {
                    events = detected;
                }
                markTurn(events, { textRollDetected: true });
            }
        }

        if (lane.detectors && events?.requestedRolls?.length > 0 && originalPlayerMessage && !combatWasActive) {
            const review = await reviewOutsideCombatRolls(events.requestedRolls, originalPlayerMessage, narrative, s.settings, { signal: abortController.signal });
            events.requestedRolls = review.acceptedRolls;
            if (review.rejectedRolls.length > 0) {
                // An attack staged as a check takes the combat-correction path —
                // but only when no legitimate check survived to stage instead.
                if (review.attackAsCheck && review.acceptedRolls.length === 0) {
                    markTurn(events, { attackAsCheckRejected: true });
                    console.warn('[Turn] Rejected a check that staged the player\'s declared attack; requesting a combat_start response.');
                } else {
                    markTurn(events, { playerAuthorityRollRejected: true });
                    console.warn('[Turn] Rejected a check that overrides player-authored portrayal; requesting a no-roll roleplay response.');
                }
            }
            const preNarrated = review.preNarrated !== undefined ? review.preNarrated : detectPreNarratedOutcome(narrative);
            if (preNarrated) {
                markTurn(events, { preNarratedOutcome: true });
                console.warn('[Turn] DM pre-narrated outcome before roll — correction will be injected with roll results.');
            }
        }

        // Withheld-setup policy lives in turnVisibility.js (unit-tested): narration
        // with pending rolls is superseded by the post-roll beat and hidden, EXCEPT
        // prose-extracted proposals the player already read; setupPhase separately
        // defers outcome mutations until dice resolve.
        const { setupPhase, hideSetup } = deriveSetupVisibility(events);
        if (hideSetup) clearStreamingDisplay();
        // Pre-generate a stable message ID so applyEvents can reference it as a loot source key.
        const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        // A row is committed only for PROSE (2026-10-25 chat-orchestration P1):
        // the jsonOnly intent lane's rule, now every lane's. A block-only reply
        // with events used to commit `{ role: 'assistant', content: '' }` — a
        // blank bubble in the chat and the save, and a blank turn in the DM's
        // own window (Gemini 400s an empty text part). Events still flow to the
        // caller and through applyEvents below; `lastCommittedTurn` stays null,
        // matching "nothing narrated" — so the cast backstop's narration lane
        // row becomes the one the post-turn extraction reads. The one deferral
        // that needs the row (the hidden setup's reveal) names none.
        const commits = !!narrative.trim();
        if (events) {
            // Let callers staging a roleplay-check proposal recover this response's
            // narration (the withheld setup) and reveal/reuse it later. The ENTRY
            // combat flag rides the turn too (2026-10-13 P2): the caller routes
            // the events against the state the call READ, never against a ref
            // it re-reads after the dispatches.
            markTurn(events, { setupMessageId: commits ? msgId : null, setupHidden: hideSetup, combatWasActive });
            // In a batched combat round the client already rolled AND applied HP from the
            // inline damage, so ignore any HP deltas the DM narrated to avoid double-counting.
            // Finalized BEFORE dispatch: this object enters the reducer store, and an
            // object already in the store must never be mutated afterwards — what got
            // autosaved would depend on a race with the 2s debounce.
            if (suppressHpEvents) {
                events.damageTaken = 0;
            }
        }
        if (!isMounted()) return null; // Never commit a turn into a different campaign's store
        if (commits) {
            // The row carries NO `events` (2026-09-28 audit P2): the normalized
            // object materializes every channel key (~620 bytes for an EMPTY
            // reply), rode every assistant row into the save and the cloud
            // payload forever, and nothing read it back — both post-commit
            // readers take the in-memory lastCommittedTurn below.
            record({
                type: 'ADD_MESSAGE',
                payload: { id: msgId, role: 'assistant', content: narrative, hidden: hideSetup },
            });
        }

        // Apply game events (damage, items, etc.)
        if (events) {
            // On a withheld roll-setup turn, defer outcome mutations to the post-roll
            // narration (see applyEvents) so the DM can't double-apply state across the split.
            // playerActionContext carries the original player intent into follow-up
            // calls (post-roll outcomes) where originalPlayerMessage is deliberately
            // absent — so the transaction replay guard can still honor an explicit
            // "I buy another one" when the purchase lands after dice.
            applyEvents(events, record, getState, {
                setupPhase,
                // starting_items is the one-time opening's channel alone.
                openingScene: lane.openingScene,
                lootSourceId: msgId,
                // The DM's own facts remember this message (2026-10-11).
                sourceMessageId: msgId,
                playerMessage: originalPlayerMessage || playerActionContext,
                // The scene's text for the NPC lane (M0, 2026-10-13): a short
                // name the roster holds twice resolves to the person named
                // in full here, or to nobody.
                presenceText: `${originalPlayerMessage || playerActionContext || ''} ${narrative} ${buildPresenceText(promptState.messages || [])}`,
            });
        }
        // A reply the CALLER routes: a roll request becomes the proposal card,
        // a rejected check gets the correction. Read by the location rule and
        // the empty-reply floor below.
        const callerRoutes = events?.requestedRolls?.length > 0
            || !!turnFlags(events).attackAsCheckRejected
            || !!turnFlags(events).playerAuthorityRollRejected;
        // Where the hero IS after this reply. A fight-starting response's
        // queued exchange never blocks its location: with no live combat, an
        // exchange here always rides a combat_start (orphans were dropped
        // above), and the narration-only lane that follows cannot replay it.
        // A withheld roll SETUP's location is deferred like its other outcomes
        // (2026-10-25 nit): a travel check's stated destination used to move
        // the hero — visit count, travel link, the arrival directors — before
        // the dice, and a set-aside left them there. It rides the turn flags
        // and the proposal as `setupLocation`, comes back to the outcome call
        // as `deferredLocation`, and LANDS here — in the turn's own record,
        // so the Scribe's merge base and the scene embed see the arrival —
        // unless the outcome moved the hero itself or chained another check
        // (carried on again). A set-aside never moves anyone.
        let landedLocation = null;
        if (!combatWasActive) {
            if (events?.location) {
                if (!setupPhase || events.combatStart) landedLocation = events.location;
                else markTurn(events, { setupLocation: events.location });
            } else if (deferredLocation) {
                if (callerRoutes) markTurn(events, { setupLocation: deferredLocation });
                else landedLocation = deferredLocation;
            }
        }
        if (landedLocation) record({ type: 'SET_LOCATION', payload: landedLocation });
        // A block-only reply whose events dispatched NOTHING is an empty reply
        // (2026-10-25 P1, the floor): no prose, no row, no state change — the
        // player would see silence. The jsonOnly lane is a data block by
        // contract and its caller plans the exchange from the return; a reply
        // the caller routes is not silence either.
        if (!lane.jsonOnly && !commits && turnActions.length === 0 && !callerRoutes) {
            throw new Error('The DM returned only a data block that changed nothing — nothing was narrated and no game state changed. Retry, or if the model is declining, edit or remove (✕) the message it objected to.');
        }

        if (commits && !hideSetup && dramaticMemories.length > 0) {
            // The engine judges the payoff (WOW 2026-10-14): a curated card
            // whose meaning the reply carries LANDED, marked or not — the DM's
            // own `used` ids are stamped by applyEvents above and skipped here.
            const declared = new Set((events?.memoryUpdates || []).filter(u => u?.used && typeof u.id === 'string').map(u => u.id));
            const landed = detectCallbackPayoff(dramaticMemories, narrative, callbackScene || {});
            const unmarked = landed.filter(card => !declared.has(card.id));
            if (unmarked.length > 0) {
                record({ type: 'MARK_CALLBACK_PAYOFF', payload: { messageId: msgId, cardIds: unmarked.map(card => card.id) } });
            }
            captureCallbackPayoff({ landed: [...new Set([...landed.map(card => card.id), ...declared])] });
        }

        // Missing-events nudge (IDEAS 2026-07-11): a no-JSON response at a contract
        // moment loses quest_updates/starting_items forever — the only channels with
        // no Scribe audit backstop. Recovery is one JSON-only follow-up, whitelisted.
        // Gated on the ENTRY combat flag (2026-10-13 P2): the two ref reads
        // that stood here landed pre-turn by the render lag — the same flag,
        // by accident. A fight this very turn started has a JSON block, so the
        // cue never fires on it anyway. It runs BEFORE the turn's state is
        // replayed below (2026-10-25 P2): its dispatches ride `record`, so the
        // quest it recovers is in the Scribe's merge base this turn.
        if (lane.nudge && !combatWasActive && !(events?.requestedRolls?.length > 0)) { // a text-detected check owns this turn
            const nudgeCue = detectMissingEventsCue({
                hadEventBlock: !!parsed.events,
                openingScene: lane.openingScene,
                playerMessage: originalPlayerMessage || playerActionContext || '',
                narrative,
                combatActive: combatWasActive,
            });
            if (nudgeCue) await recoverMissingEvents(nudgeCue, { id: msgId, content: narrative }, abortController.signal, record);
        }

        // The state this turn LEFT: the captured prompt state plus every action
        // the turn dispatched, replayed through the pure reducer. The Scribe's
        // KNOWN contexts used to be built from a ref read after the dispatches
        // — PRE-TURN by the render lag, so a stance or look the DM wrote this
        // turn was absent from the merge base the Scribe is told to restate,
        // and its facts were judged for embedding against a record that
        // lacked the DM's own. The replay's one divergence: a record the
        // reducer mints an id for (a new fact) carries a different id here
        // than in the store — the Scribe reads people by name and cards
        // by id, and the one id-keyed fact lane (`supersedes` on a live
        // intent fact) cannot close a plan born in the same turn either way.
        // Reduced whether or not a row was committed (2026-10-25): the fact
        // embed below reads the record's rows from it.
        const stateAfter = turnActions.reduce(gameReducer, promptState);
        if (commits) {
            lastCommittedTurn = { id: msgId, content: narrative, events, hidden: hideSetup, recall: !!recallDossier, combatWasActive, location: landedLocation, stateAfter };
        }

        // RAG: embed any new world facts the DM emitted this turn (per response).
        // The per-turn Scribe + narrative embedding run once in handleSend on the FINAL
        // narrated outcome, so they capture results rather than withheld setup text.
        // Skip on a setup turn (pending rolls) — those facts ride on the outcome narration.
        // A fight-starting setup applied its facts already (applyEvents) — embed them too.
        if ((!setupPhase || events?.combatStart) && !combatWasActive && events?.worldFacts?.length > 0 && machineryKey) {
            // The RECORD's rows (2026-10-11 P2, and literally so since 2026-10-25
            // P2): the facts the reducer COMMITTED this turn, read off the
            // replayed state by this message's source stamp — a restatement the
            // record refused is never embedded, the text is the sanitized text
            // with the record's own secrecy tag (the seed's format, so no
            // mismatched twin on reload), the row carries this message's id for
            // retraction and the record's own `atMessage`. A second plan against
            // the ENTRY state used to stamp the row two rows early and could
            // embed a fact the record refused (an orphan the seed pruned).
            // QUEUED, not embedded (2026-09-29 P2): the turn's facts and its
            // narrative ride ONE batch request, flushed by the post-turn
            // extraction (or by the queue's own window when no extraction
            // follows — a fight-starting response).
            const committedFacts = (stateAfter.worldFacts || []).filter(f => f?.sourceMessage === msgId);
            for (const f of committedFacts) {
                queueMemoryItem(machineryKey, factMemoryItem(f, { location: landedLocation || s.currentLocation, sourceMessage: msgId })).catch(() => {});
            }
        }

        return events;
    };

    /**
     * One cheap JSON-only follow-up for a prose-only contract moment. The reply is
     * hard-whitelisted (missingEventsNudge.js) and re-shaped through the real parser
     * before applying, so nothing beyond quest_updates/starting_items can enter.
     */
    const recoverMissingEvents = async (cue, committed, signal, record = dispatch) => {
        try {
            // ONE state for the call's prompt and window. The narration rides
            // ONCE, as the history's last assistant row (2026-10-01 P2): the
            // committed row was in the window only when the render had flushed
            // AND the prompt quoted 1,500 chars of it again. Whatever the ref
            // shows, the row is taken out by id and appended explicitly.
            const s = getState();
            const history = buildMessageWindow([
                ...(s.messages || []).filter(m => m?.id !== committed.id),
                { role: 'assistant', content: committed.content },
            ], MESSAGE_WINDOW);
            // The turn's own abort signal rides along (2026-09-07 audit P2):
            // Stop used to be inert here — the nudge ran to the 90s stall guard
            // (times retries) while isLoading kept the Stop button showing.
            // The PRE-COMMIT budget (2026-10-25 P2): the narration is on
            // screen and the player waits on this call, so it gets ONE attempt
            // at 20 s like the arbiter and the detector — it used to hold the
            // turn on the background lane's 90 s × 3; its fallback is "nothing
            // recovered, the Scribe audits the rest".
            const response = await sendMessage({
                ...dmCallConfig(s.settings),
                timeoutMs: PRE_COMMIT_TIMEOUT_MS,
                maxRetries: 0,
                // The nudge's own projection (2026-10-13 P2): the character
                // line, INVENTORY and ACTIVE QUESTS over the cached prefix —
                // it used to carry the whole 82k-char dynamic half for a reply
                // whitelisted to two channels.
                systemPrompt: buildCurrentSystemPrompt(s, [], [], '', { nudgeOnly: true }),
                messageHistory: history,
                userMessage: buildNudgePrompt(cue),
                temperature: 0.2,
                signal,
            });
            const rawFields = extractNudgeEventFields(response, cue);
            if (!rawFields) return;
            const synthetic = parseResponse('```json\n' + JSON.stringify(rawFields) + '\n```');
            if (!synthetic.events) return;
            // Through the turn's `record` (2026-10-25 P2): the recovered quest
            // is in the replayed `stateAfter` the Scribe reads this turn.
            applyEvents(synthetic.events, record, getState, {
                openingScene: cue.reason === 'opening',
                lootSourceId: `${committed.id}:nudge`,
            });
            console.warn(`[Turn] Missing-events nudge recovered ${Object.keys(rawFields).join(' + ')} (${cue.reason} cue).`);
        } catch (error) {
            // Recovery is best-effort — a failed nudge must never block the turn.
            console.warn('[Turn] Missing-events nudge failed:', error.message || error);
        }
    };

    /**
     * Stage a roleplay-check proposal from a DM response. THE carry rule,
     * stated once (2026-10-13 chat-orchestration P2 — three sites assembled
     * the five carry-over options by hand):
     * - `preNarrated` is the response's own flag;
     * - the withheld SETUP is the one the caller names in `setupFrom` (a
     *   re-adjudication — the challenge — keeps the ORIGINAL scene the player
     *   never saw), else this response's narration when it was withheld;
     * - `loot` and `supersedesId` are the caller's (declared-but-unapplied
     *   loot rides until a roll-free outcome lands; the lineage id keeps the
     *   heat ledger from counting one moment twice).
     */
    const stageRoleplayCheck = (rolls, playerAction, { events = null, narrative = '', loot = null, setupFrom = null, ruling = null, supersedesId = null, challengeUsed = false } = {}) => {
        const flags = turnFlags(events);
        // A challenge's re-ruling keeps the ORIGINAL setup — and houses the hop's
        // own withheld row (2026-10-18 P2): its prose joins the re-woven setup and
        // its id rides as `rulingMessageId`, so the reveal paths restore both. It
        // used to stay hidden forever, with no row naming it.
        const rulingText = ruling?.hidden && typeof ruling.content === 'string' ? ruling.content.trim() : '';
        const setup = setupFrom
            ? {
                setupNarrative: [setupFrom.setupNarrative || '', rulingText].filter(Boolean).join('\n\n'),
                setupMessageId: setupFrom.setupMessageId || null,
                rulingMessageId: rulingText ? (ruling.id || null) : (setupFrom.rulingMessageId || null),
            }
            : { setupNarrative: flags.setupHidden ? narrative : '', setupMessageId: flags.setupHidden ? (flags.setupMessageId || null) : null };
        const proposal = buildRoleplayCheckProposal(rolls, playerAction, {
            challengeUsed,
            preNarrated: !!flags.preNarratedOutcome,
            loot,
            ...setup,
            // The deferred destination (2026-10-25 nit): this response's own
            // withheld `location` — or the one it carried on as
            // `deferredLocation` (a chained check, a correction) — else the
            // original setup's (a challenge).
            setupLocation: flags.setupLocation || setupFrom?.setupLocation || null,
            supersedesId,
        });
        if (!proposal) return false;
        dispatch({ type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal });
        resetRoleplayChallengeUi();
        return true;
    };

    /**
     * Post-turn extraction over the FINAL narrated outcome — the shared
     * Scribe + narrative-embed + loot/cast-audit pass that ordinary sends
     * (ChatPanel.handleSend) and post-roll outcomes (finalizeRoleplayTurn)
     * previously hand-maintained as near-duplicate blocks. The copies drifted:
     * the post-roll one silently lost the narrated-cast audit (2026-08-19 P1),
     * so an eventless cast narrated after dice escaped the 2026-08-09 backstop.
     *
     * Reads the committed-turn record, never React state: the outcome
     * message's render has not flushed yet, so a findLast(assistant) here
     * returns the PREVIOUS assistant message (live playtest #6 — the
     * stale-Scribe root cause). A hidden or empty commit (a withheld roll
     * setup) extracts nothing; callers own the turn-shape gating (pending
     * resolution, table talk).
     *
     * `narration` (2026-10-18 P2) names a REVEALED setup instead of the
     * committed record: a set-aside makes the withheld fiction player-visible
     * and DM-window canon, and the committed record's `hidden: true` snapshot
     * predates the reveal — so an arrival or a discovery the setup narrated
     * reached the journal cadence only, never the Scribe's facts / NPC updates
     * nor the RAG scene row. A revealed setup runs the Scribe and the embed
     * with NO loot audit: its declared loot was never granted by design (dice
     * could have denied it), and the DM's next turn owns the economy.
     *
     * @returns {boolean} true when a final narration existed and was extracted.
     */
    const runPostTurnExtraction = (playerMessage, { auditCasts = true, narration = null } = {}) => {
        const committed = getLastCommittedTurn();
        const finalNarration = narration
            || (committed && !committed.hidden && committed.content?.trim() ? committed : null);
        if (!finalNarration) return false;
        // The state the turn LEFT (2026-10-13 P2): the turn record's replayed
        // projection, never a same-task ref read — that read is PRE-TURN by
        // construction (the header trap, 2026-09-07 audit P2), so the stance,
        // look, fact or place this very turn wrote was absent from the
        // Scribe's merge base and the embed judgement. `getState` stays the
        // loot audit's: it runs after the Scribe's network call, against the
        // live store. A fight-start narration is never extracted — handleSend
        // skips the Scribe, loot audit, embed, and summarize when combat starts
        // (the fight's own narration lanes own it); the post-roll outcome path
        // reached here through finalizeRoleplayTurn and ran all four.
        if (finalNarration.events?.combatStart) return false;
        const latest = finalNarration.stateAfter || getState();
        // Where the hero IS after the turn — the DM's location event is already
        // in the projection (a travel turn used to embed the ARRIVAL prose
        // under the departure place).
        const turnLocation = latest.currentLocation;
        // A recall answer is the record read back, not new fiction (2026-09-18):
        // the Scribe gets a RECALL TURN hint (extract nothing new but a moved
        // heart), the loot/payment audit is OFF (a recounted reward is not a
        // missing grant), and the answer is not embedded as narrative memory
        // (it would rank above the original rows it paraphrases).
        const recallTurn = !!finalNarration.recall;
        runScribe({
            playerMessage,
            dmNarrative: finalNarration.content,
            settings: latest.settings,
            dispatch,
            recallTurn,
            // The message every record from this pass is stamped with (M0,
            // 2026-09-30): removing it retracts them.
            sourceMessageId: typeof finalNarration.id === 'string' ? finalNarration.id : null,
            ...buildScribeContext(latest, playerMessage, finalNarration.content),
            // The DM's own location event (already applied) outranks the async
            // Scribe for this turn: the Scribe's location downgrades to
            // confirm-or-fill so it can never relocate the hero backwards.
            // A deferred setup destination that landed with this outcome counts
            // as the DM's own event (2026-10-25).
            dmLocationEvent: finalNarration.location || finalNarration.events?.location || null,
            // Loot persistence audit: recover coins/items the narrative granted
            // but the DM's structured events missed — post-roll outcomes lose
            // them most often (the withheld setup already dropped its events by
            // design). Out-of-combat only; keyed to the narration message so
            // retries/reloads cannot double-grant. The narrated-cast backstop
            // rides these ordinary turns only — the victory-narration audit
            // (ChatPanel) recaps in-fight casts without the flag.
            lootAudit: (!latest.combat?.active && finalNarration.id && !recallTurn && !narration) ? {
                sourceId: `${finalNarration.id}:scribe-loot`,
                appliedEvents: finalNarration.events || null,
                getState,
                auditCasts,
            } : null,
        }).catch(() => {});
        const machineryKey = getMachineryGeminiKey(latest.settings);
        if (machineryKey && !recallTurn) {
            // The narrative joins the facts sendToLLM queued and the whole
            // turn embeds as ONE request (2026-09-29 P2).
            // Aged at the DM row's own index (2026-10-21): the state the turn
            // left holds the row, so its index is the count before it.
            const narrationIndex = (latest.messages || []).findIndex(m => m?.id === finalNarration.id);
            queueMemoryItem(machineryKey, sceneMemoryItem(finalNarration.content, {
                location: turnLocation,
                sourceMessage: typeof finalNarration.id === 'string' ? finalNarration.id : null,
                atMessage: narrationIndex >= 0 ? narrationIndex : (latest.messages || []).length,
            })).catch(() => {});
        }
        // The last cadence's journal entry rides this turn's batch (see
        // runAutoSummarize): one embed request, not a request of its own.
        if (machineryKey && carriedJournalMemories.length > 0) {
            for (const row of carriedJournalMemories) {
                queueMemoryItem(machineryKey, row).catch(() => {});
            }
            carriedJournalMemories = [];
        }
        flushMemoryQueue().catch(() => {});
        return true;
    };

    /**
     * A set-aside's revealed rows are canon now (2026-10-18 P2): the setup
     * (and a challenge's ruling row) just became player-visible, so the Scribe
     * and the scene embed read them once, stamped with the setup row's id —
     * ✕ on it retracts what this pass minted. The rows' text is read from the
     * store (the reveal flips a flag; the content was always there).
     */
    const extractRevealedSetup = (playerAction, revealedIds = []) => {
        const messages = getState().messages || [];
        const rows = revealedIds
            .map(id => messages.find(m => m?.id === id))
            .filter(m => m && typeof m.content === 'string' && m.content.trim());
        if (rows.length === 0) return false;
        return runPostTurnExtraction(playerAction, {
            auditCasts: false,
            narration: { id: rows[0].id, content: rows.map(m => m.content.trim()).join('\n\n') },
        });
    };

    const finalizeRoleplayTurn = (playerAction) => {
        runPostTurnExtraction(playerAction, { auditCasts: true });
        // A post-roll outcome that STARTS combat summarizes after the fight,
        // not mid-split — the same gate handleSend applies (combatStartedNow).
        if (getLastCommittedTurn()?.events?.combatStart) return;
        runAutoSummarize();
    };

    /**
     * THE re-response for a check the roll arbiter rejected — the first hop
     * (ChatPanel), a check chained off a post-roll outcome, and a challenge's
     * re-proposal all route here (the pair was written out at three sites).
     * An attack declared as a check must come back as EVENTS (combat_start +
     * the attack as a queued exchange), so it is a normal turn whose
     * playerActionContext keeps the replay guards honest; a check that
     * overrode the player's authored delivery gets a no-dice narration.
     */
    const sendRollCorrection = async ({ attackAsCheck = false, playerAction = '', setupLocation = null } = {}) => {
        let narrative = '';
        const onNarrative = text => { narrative = text; };
        // The attack correction is a NARRATIVE turn with the player's action
        // on it (2026-10-25): the arbiter and the detector run on its reply
        // like the first hop's, so a re-staged attack check is refused again
        // here and never reaches the proposal card.
        // `setupLocation` is the rejected setup's deferred destination: it lands
        // with the correction's reply or rides on to the proposal it stages.
        const events = attackAsCheck
            ? await sendToLLM(attackAsCheckCorrectionPrompt(playerAction), playerAction || null, { playerActionContext: playerAction, onNarrative, deferredLocation: setupLocation })
            : await sendToLLM(playerAuthorityRollCorrectionPrompt(), null, { lane: 'narration', onNarrative, deferredLocation: setupLocation });
        return { events, route: routeCorrectionReply(events, { playerAction, narrative }) };
    };

    /**
     * A re-response is a TURN (2026-10-25 chat-orchestration P2): all three
     * callers of `sendRollCorrection` used to drop its return, so a correction
     * answered with prose + `requested_rolls` committed its row hidden (the
     * setup policy), staged nothing, and the player saw NO reply — no
     * proposal, no reveal path. Routed like a first hop, ONCE:
     * - a roll request → a staged proposal, the hidden row riding as its setup
     *   (the first hop's own rule in stageRoleplayCheck);
     * - a check the arbiter rejected AGAIN → no second correction; the hidden
     *   prose is revealed and extracted (the set-aside's path) and stands;
     * - otherwise the reply stands — a `combat_start` + queued exchange was
     *   applied by applyEvents (START_COMBAT; ChatPanel's effects play the
     *   opening), plain prose is the scene. (A deferred destination landed or
     *   was carried on inside the call itself.)
     * @returns {'staged'|'revealed'|'combat'|'narrated'}
     */
    const routeCorrectionReply = (events, { playerAction = '', narrative = '' } = {}) => {
        const flags = turnFlags(events);
        if (events?.requestedRolls?.length > 0 && !flags.combatWasActive) {
            stageRoleplayCheck(events.requestedRolls, playerAction, {
                events,
                narrative,
                loot: extractProposalLoot(events),
            });
            return 'staged';
        }
        if (flags.attackAsCheckRejected || flags.playerAuthorityRollRejected) {
            const committed = getLastCommittedTurn();
            if (committed?.hidden && committed.content?.trim()) {
                dispatch({ type: 'REVEAL_MESSAGE', payload: { id: committed.id } });
                extractRevealedSetup(playerAction, [committed.id]);
            }
            return 'revealed';
        }
        return events?.combatStart ? 'combat' : 'narrated';
    };

    const acceptRoleplayCheck = async () => {
        const proposal = getState().pendingRoleplayCheck;
        if (!proposal) return;
        dispatch({ type: 'CLEAR_ROLEPLAY_CHECK' });
        setLoading(true);
        onStatus('Rolling accepted check');
        let stagedFollowUp = false;
        // Failure recovery must know whether dice already landed: before dice,
        // the proposal can be restored intact; after dice, restoring it would
        // reopen the exact reroll-bargaining door the proposal system closes.
        // Compared by the newest roll's IDENTITY, never the ledger's length
        // (2026-09-21 audit P1): rollHistory is capped at 50, so a full ledger
        // — the normal state after one fight — never grows, and the old
        // length probe read "no dice" forever.
        const newestRollBefore = newestRollMarker(getState().rollHistory);
        try {
            const outcome = await handleRequestedRolls(proposal.rolls, {
                getState,
                dispatch,
                sendToLLM,
                playerAction: proposal.playerAction,
                preNarrated: proposal.preNarrated,
                setupNarrative: proposal.setupNarrative,
                setupMessageId: proposal.setupMessageId,
                rulingMessageId: proposal.rulingMessageId,
                // The setup's deferred destination lands with the outcome call
                // (2026-10-25 nit) — or rides on to a chained check.
                setupLocation: proposal.setupLocation,
                onFollowUpRolls: (rolls, meta) => {
                    // The follow-up response's own events and narration: a
                    // withheld follow-up is the re-staged proposal's setup
                    // (chained checks don't erase fiction), the declared loot
                    // rides on, the lineage id keeps the heat ledger honest.
                    stagedFollowUp = stageRoleplayCheck(rolls, meta.playerAction || proposal.playerAction, {
                        events: meta.events || null,
                        narrative: meta.narrative || '',
                        loot: meta.pendingLoot || null,
                        supersedesId: proposal.id,
                    });
                },
                // The outcome call now runs the roll arbiter (2026-09-02 P1); a
                // chained check it rejects takes the same correction routes the
                // first hop gets in ChatPanel — the rejected narration was withheld.
                // The correction's reply is ROUTED (2026-10-25 P2): a staged
                // proposal is a follow-up like the chained check's.
                onFollowUpRejected: async ({ attackAsCheck }) => {
                    const correction = await sendRollCorrection({ attackAsCheck, playerAction: proposal.playerAction, setupLocation: proposal.setupLocation });
                    if (correction.route === 'staged') stagedFollowUp = true;
                },
                pendingLoot: proposal.loot,
            });
            // Every roll resolved to nothing and the withheld rows were revealed:
            // the fiction is canon, extract it (the committed record is still
            // marked hidden, so finalizeRoleplayTurn's pass would skip it).
            if (outcome?.revealedIds?.length) extractRevealedSetup(proposal.playerAction, outcome.revealedIds);
            if (!stagedFollowUp) finalizeRoleplayTurn(proposal.playerAction);
        } catch (error) {
            // Two questions, asked once each. Did dice land? That decides what
            // happens to the proposal. Was it a deliberate Stop? That decides
            // only whether a line is posted (the player chose the silence).
            const diceRolled = newestRollMarker(getState().rollHistory) !== newestRollBefore;
            const stopped = error.name === 'AbortError';
            if (diceRolled) {
                // The dice are final: restoring the proposal would reopen the
                // reroll-bargaining door. Only the outcome narration is owed —
                // point the player at the retry path instead of silence.
                if (!stopped) dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', kind: 'error', content: `The dice landed (see the roll above) but the DM's outcome response failed: ${error.message}. Say "continue" to have the DM narrate the result.` } });
            } else {
                // Nothing was rolled, so nothing was adjudicated: the staged
                // check returns to the table, and with it the hidden setup's
                // path to resolution (2026-08-31 P2). Today the resolver rolls
                // synchronously before its first await, so only a throw inside
                // it lands here; the rule is stated for any await a later
                // change puts ahead of the dice.
                if (!stopped) dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', kind: 'error', content: `Error resolving check: ${error.message}` } });
                dispatch({ type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal });
            }
        } finally {
            setLoading(false);
            clearStreamingDisplay();
            onStatus('');
        }
    };

    const challengeRoleplayCheck = async (challengeText) => {
        const proposal = getState().pendingRoleplayCheck;
        const challenge = String(challengeText || '').trim();
        if (!proposal || proposal.challengeUsed || !challenge) return;
        dispatch({ type: 'CLEAR_ROLEPLAY_CHECK' });
        const challengeRow = `**Roll challenge:** ${challenge}`;
        dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: challengeRow } });
        setLoading(true);
        onStatus('DM reconsidering the ruling');
        try {
            // The prompt restates the challenge with its ruling context — the
            // visible row must not reach the DM beside it (2026-10-01 P1).
            const events = await sendToLLM(
                buildRoleplayChallengePrompt(proposal, challenge),
                proposal.playerAction,
                // The setup's deferred destination (2026-10-25 nit): a
                // withdrawn check is the approach succeeding diceless, so it
                // lands; a re-ruling carries it on to the re-staged proposal.
                { pendingUserRow: challengeRow, deferredLocation: proposal.setupLocation },
            );
            if (events?.requestedRolls?.length > 0) {
                // Upheld/revised rulings are JSON-only responses by contract; the
                // original withheld setup is still the scene the player never saw,
                // so it carries forward (`setupFrom`), and the same moment
                // re-adjudicated is one heat entry. The hop's OWN committed row
                // (hidden whenever it carries rolls) rides as `ruling` so any
                // prose the DM did write is housed, not lost (2026-10-18 P2).
                stageRoleplayCheck(events.requestedRolls, proposal.playerAction, {
                    events,
                    loot: proposal.loot,
                    setupFrom: proposal,
                    ruling: getLastCommittedTurn(),
                    supersedesId: proposal.id,
                    challengeUsed: true,
                });
            } else {
                // The DM withdrew (or its re-proposal was policy-rejected): this
                // objective is settled without dice. Record it so the DM cannot
                // re-propose the same check from scratch a few turns later.
                const latest = getState();
                const ruling = buildRollRulingRecord(proposal, 'withdrawn', {
                    messageCount: (latest.messages || []).length,
                    location: latest.currentLocation,
                    challenge,
                });
                if (ruling) dispatch({ type: 'RECORD_ROLL_RULING', payload: ruling });
                if (turnFlags(events).playerAuthorityRollRejected) await sendRollCorrection({ setupLocation: proposal.setupLocation });
                finalizeRoleplayTurn(proposal.playerAction);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                // Stop mid-reconsideration is always pre-dice: nothing was
                // adjudicated, so the proposal returns to the table with the
                // challenge unspent — never stranding the hidden setup with no
                // staged check (2026-08-31 P2). Silent by design.
                dispatch({ type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal });
            } else {
                dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', kind: 'error', content: `Error challenging check: ${error.message}` } });
                dispatch({ type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal });
            }
        } finally {
            setLoading(false);
            clearStreamingDisplay();
            onStatus('');
        }
    };

    const changeRoleplayApproach = () => {
        // ONE state for the whole sync body (2026-10-13 P2 — it read the ref
        // four times). No dice will ever resolve this setup, so reveal it
        // instead of erasing its fiction — unless it pre-narrated an outcome
        // that never happened.
        const current = getState();
        const proposal = current.pendingRoleplayCheck;
        // The setup AND a challenge's ruling row (2026-10-18 P2), each while
        // still hidden with text — then the revealed fiction is extracted
        // (it is canon now; the committed record's hidden flag would skip it).
        const revealedIds = listRevealableSetupIds(proposal, current.messages);
        const revealSetup = revealedIds.length > 0;
        for (const id of revealedIds) dispatch({ type: 'REVEAL_MESSAGE', payload: { id } });
        if (revealSetup) extractRevealedSetup(proposal.playerAction, revealedIds);
        if (proposal) {
            // A set-aside ruling still binds the DM: an ordinary proposal must return
            // unchanged on a retry, and an upheld final ruling stays final.
            const ruling = buildRollRulingRecord(proposal, 'set_aside', {
                messageCount: (current.messages || []).length,
                location: current.currentLocation,
            });
            if (ruling) dispatch({ type: 'RECORD_ROLL_RULING', payload: ruling });
        }
        dispatch({ type: 'CLEAR_ROLEPLAY_CHECK' });
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: revealSetup
                    ? 'The proposed check is set aside; the scene above stands, but no dice were rolled. Describe a different approach.'
                    : 'The proposed check is set aside. Describe a different approach; no dice were rolled.',
            },
        });
        resetRoleplayChallengeUi();
    };

    // recoverMissingEvents stays internal (sendToLLM's nudge path is its only
    // caller); it was exposed here for a while with zero external callers.
    return {
        sendToLLM,
        getLastCommittedTurn,
        runAutoSummarize,
        runPostTurnExtraction,
        stageRoleplayCheck,
        sendRollCorrection,
        finalizeRoleplayTurn,
        acceptRoleplayCheck,
        challengeRoleplayCheck,
        changeRoleplayApproach,
    };
}
