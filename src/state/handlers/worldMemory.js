/**
 * Long-term memory: world facts (near-duplicate rejection), story-memory
 * cards, journal entries/summarization marks, and the campaign chronicle.
 */
import { normalizeJournalEntry } from '../../engine/journalEntry.js';
import { planWorldFactAdditions } from '../../engine/worldFacts.js';
import {
    applyStoryMemoryDormancy,
    bornStoryMemoryCard,
    findStoryMemoryMatch,
    normalizeStoryMemoryCard,
    normalizeStoryMemoryUpdate,
    pickMergedCardText,
    stripStoryMemoryEngineStamps,
} from '../../engine/storyMemory.js';
import { gameReducer } from '../gameReducer.js';
import { isStaleCampaignAction, normalizeChronicleChapter, stampNpcRelationshipArcs, systemMessage } from './shared.js';
import { rollHeroTellBeat } from './heroTells.js';
import { rollDie } from '../../engine/dice.ts';
import {
    WONDER_TIMING_DIE_SIDES,
    WONDER_WINDOW_MESSAGES,
    buildWonderResidueCard,
    mintPendingWonder,
    normalizeWonderHooks,
    sanitizePendingWonder,
    pickWonderIndex,
    selectWonder,
    shouldRequestWonder,
} from '../../engine/wonder.js';
import {
    BEAT_COOLDOWN_MESSAGES,
    BEAT_TIMING_DIE_SIDES,
    isRelationshipBeatExpired,
    mintRelationshipBeat,
    sanitizeRelationshipBeat,
    selectRelationshipBeatCandidate,
} from '../../engine/relationshipArc.js';

/**
 * The journal cadence's NPC-initiative tick (2026-09-13 overhaul). Selection
 * is pure (selectRelationshipBeatCandidate); the delay is an engine-rolled
 * crypto die of 0–4 scenes, the world-tempo rule ("arc reasoning decides
 * what, dice decide when"). A pending unexpired beat blocks a new mint; so
 * does the cooldown since the last mint. Session-only state: the DM sees
 * the cue only while the window is open (buildRelationshipBeatBlock).
 */
export function rollRelationshipBeat(state, { roll = () => rollDie(BEAT_TIMING_DIE_SIDES) - 1 } = {}) {
    let session = state.session || {};
    const messages = state.messages || [];
    const messageCount = messages.length;
    const current = sanitizeRelationshipBeat(session.relationshipBeat);
    if (current && !isRelationshipBeatExpired(current, messageCount)) return session;
    // A malformed stored beat is junk: drop it rather than carry it.
    if (!current && session.relationshipBeat) session = { ...session, relationshipBeat: null };
    const last = Number.isFinite(session.lastRelationshipBeatMessage) ? session.lastRelationshipBeatMessage : null;
    if (last !== null && messageCount - last < BEAT_COOLDOWN_MESSAGES) {
        return current ? { ...session, relationshipBeat: null } : session;
    }
    const candidate = selectRelationshipBeatCandidate(state.npcs, state.storyMemory, { messages, messageCount });
    if (!candidate) return current ? { ...session, relationshipBeat: null } : session;
    const beat = mintRelationshipBeat(candidate, { messageCount, delayScenes: roll() });
    if (!beat) return session;
    return { ...session, relationshipBeat: beat, lastRelationshipBeatMessage: messageCount };
}

/**
 * The wonder die's request tick (WOW 2026-09-18): on the journal cadence (and
 * on the player's own OOC ask), if the campaign has gone eventless past the
 * pace dial's lull threshold and every guard in shouldRequestWonder holds,
 * raise the one-shot `session.pendingWonder` marker the background director
 * answers. The engine decides WHEN; the director decides WHAT.
 */
export function rollWonderRequest(state, { onDemand = false } = {}) {
    const session = state.session || {};
    if (!shouldRequestWonder(state, { onDemand })) return session;
    return { ...session, pendingWonder: mintPendingWonder(state, { onDemand }) };
}

// The world-fact dedupe and the polarity-aware supersession ledger live in
// engine/worldFacts.js (2026-09-29): a near-duplicate restatement is rejected,
// a near-duplicate whose NEGATION differs is a FLIP — stored, superseding the
// older truth, which drops out of every live reader and stays on the record.

/**
 * Append chronicle chapter(s). The payload may be one chapter or an array —
 * a very long "Close chapter" span arrives as multiple parts in ONE action so
 * the flushAutoSave action-replay persists them all atomically (2026-08-29).
 */
export function appendChronicleChapter(chronicle = [], payload = {}, { maxMessageCount = Infinity } = {}) {
    const items = Array.isArray(payload) ? payload : [payload];
    let chapters = chronicle || [];
    for (const item of items) {
        // ONE composer with the load heal (2026-10-08): the write mints its own
        // id and stamp — a chapter is born here, never carried in — and only
        // the write defaults an empty title to its number.
        const chapter = normalizeChronicleChapter(
            { title: item?.title, text: item?.text, fromIndex: item?.fromIndex, toIndex: item?.toIndex },
            { maxMessageCount }
        );
        if (!chapter) continue;
        chapters = [...chapters, { ...chapter, title: chapter.title || `Chapter ${chapters.length + 1}` }];
    }
    return chapters;
}

export const handlers = {
    ADD_WORLD_FACTS(state, action) {
        // Bulk add, rejecting exact and near-duplicate restatements of known facts
        // (the Scribe tends to re-canonize the same truth with slight rewording).
        // The judgement is engine/worldFacts.js's planWorldFactAdditions — ONE
        // plan the reducer commits and the live embed lanes read (2026-10-11),
        // so a RAG row is always the record's own text. Only LIVE facts take
        // part: a flip is stored and supersedes its twin (2026-09-29), and a
        // later re-flip judges against the current truth, never the buried one.
        // Source-stamped retraction (memory-research M0, 2026-09-30): the lane
        // names the DM message it read (`meta.sourceMessage`); DELETE_MESSAGE
        // retracts what that message minted.
        const sourceMessage = typeof action.meta?.sourceMessage === 'string' && action.meta.sourceMessage ? action.meta.sourceMessage : null;
        const plan = planWorldFactAdditions(state.worldFacts, action.payload, {
            messageCount: (state.messages || []).length,
            sourceMessage,
        });
        if (!plan.changed) return state;
        return { ...state, worldFacts: plan.worldFacts };
    },

    ADD_STORY_MEMORY_CARD(state, action) {
        // A lane card never carries the engine's stamps (2026-09-16 P2) —
        // birth and merge stamp them below from the live transcript.
        const card = normalizeStoryMemoryCard(stripStoryMemoryEngineStamps(action.payload));
        if (!card) return state;
        const idx = findStoryMemoryMatch(state.storyMemory || [], card);
        const messageCount = (state.messages || []).length;
        if (idx === -1) {
            const born = bornStoryMemoryCard(card, messageCount, { sourceMessage: action.meta?.sourceMessage });
            return { ...state, storyMemory: [...(state.storyMemory || []), born] };
        }
        const existing = state.storyMemory[idx];
        // `resolved` is TERMINAL here (2026-09-06 P1, the fronts' 2026-09-01
        // ruling): a normalized incoming card always carries status 'active',
        // and the Scribe — which never sees the card pool — re-reports a
        // paid-off beat from every recap line, so the spread used to flip a
        // resolved promise back into DRAMATIC CALLBACKS a turn after the DM
        // paid it off. Only a DORMANT card revives on re-report; reopening a
        // resolved one takes an explicit status from the DM's memory_updates.
        const resolved = existing.status === 'resolved';
        const status = resolved ? 'resolved' : card.status;
        return {
            ...state,
            storyMemory: state.storyMemory.map((memory, i) => i === idx
                ? normalizeStoryMemoryCard({
                    ...existing,
                    ...card,
                    // Provenance and identity are the STORED card's (2026-10-12
                    // P2): the normalized incoming card defaults `source` to
                    // 'scribe' and mints a fresh id, so the spread re-sourced
                    // END_COMBAT's engine wound on its first Scribe mention
                    // (its six-cadence dormancy rule defeated) and churned the
                    // id the DM's memory_updates addresses.
                    id: existing.id,
                    source: existing.source,
                    status,
                    // A paid-off beat's text is frozen with its status
                    // (2026-09-16 P2 belt): an id-keyed re-report used to
                    // rewrite what the resolved card says.
                    // An ENGINE card's text is the engine's (proof playtest
                    // 2026-09-30: the Scribe rewrote END_COMBAT's wound card into
                    // its own words and the fight's particular was gone); a
                    // re-report may revive or relink it, never reword it.
                    text: resolved || existing.source === 'engine' ? existing.text : pickMergedCardText(existing.text, card.text),
                    firstSeenAt: existing.firstSeenAt,
                    lastSeenAt: Date.now(),
                    lastSeenMessage: messageCount,
                    salience: Math.max(existing.salience || 1, card.salience || 1),
                    emotionalCharge: Math.max(existing.emotionalCharge || 0, card.emotionalCharge || 0),
                    tags: [...new Set([...(existing.tags || []), ...(card.tags || [])])],
                    linkedNpcNames: [...new Set([...(existing.linkedNpcNames || []), ...(card.linkedNpcNames || [])])],
                }, existing)
                : memory),
        };
    },

    ADD_STORY_MEMORY_CARDS(state, action) {
        let next = state;
        // Plain objects only (2026-09-17 P1): a `null` element used to throw
        // mid-loop and lose every card after it plus everything the Scribe had
        // queued behind this dispatch for the turn.
        const cards = Array.isArray(action.payload)
            ? action.payload.filter(card => card && typeof card === 'object' && !Array.isArray(card))
            : [];
        for (const card of cards) {
            next = gameReducer(next, { type: 'ADD_STORY_MEMORY_CARD', payload: card, ...(action.meta && { meta: action.meta }) });
        }
        return next;
    },

    UPDATE_STORY_MEMORY(state, action) {
        const update = normalizeStoryMemoryUpdate(action.payload);
        if (!update) return state;
        const cards = state.storyMemory || [];
        // Identity resolution, strictest first: id, then subject — but a bare
        // subject shared by cards of different types is ambiguous ("Oren" could
        // mark the wrong card used/rewritten — 2026-08-06 audit), so subject
        // acts only when it names exactly ONE card. Exact text is the last
        // resort (the DM referencing a card by its wording).
        let idx = update.id ? cards.findIndex(memory => memory.id === update.id) : -1;
        if (idx === -1 && update.subject) {
            const matches = cards.reduce((acc, memory, i) => {
                if (memory.subject?.toLowerCase() === update.subject.toLowerCase()) acc.push(i);
                return acc;
            }, []);
            if (matches.length === 1) idx = matches[0];
        }
        if (idx === -1 && update.text) {
            idx = cards.findIndex(memory => memory.text?.toLowerCase() === update.text.toLowerCase());
        }
        if (idx === -1) return state;
        // Conversational twins of the wall-clock stamps: the curation cooldown
        // and recency windows read these (2026-09-06).
        const messageCount = (state.messages || []).length;
        const { used, ...fields } = update;
        const now = Date.now();
        return {
            ...state,
            storyMemory: state.storyMemory.map((memory, i) => i === idx
                ? normalizeStoryMemoryCard({
                    ...memory,
                    ...fields,
                    lastSeenAt: now,
                    lastSeenMessage: messageCount,
                    // A landing counts (WOW 2026-10-14) beside the clocks.
                    ...(used && { lastUsedAt: now, lastUsedMessage: messageCount, usedCount: (memory.usedCount || 0) + 1 }),
                    id: memory.id,
                }, memory)
                : memory),
        };
    },

    /**
     * The engine judged that the DM's reply paid off curated callbacks (WOW
     * 2026-10-14, `detectCallbackPayoff`): the cards rest (`lastUsedMessage`)
     * and count (`usedCount`) exactly as a DM-marked `used` does, and the DM
     * row carries a `↺` chip per landed card (the bondMarks pattern) so the
     * player sees the callback land. Zero calls.
     */
    MARK_CALLBACK_PAYOFF(state, action) {
        const ids = new Set((Array.isArray(action.payload?.cardIds) ? action.payload.cardIds : []).filter(id => typeof id === 'string' && id));
        const messageId = typeof action.payload?.messageId === 'string' ? action.payload.messageId : '';
        if (ids.size === 0) return state;
        const messageCount = (state.messages || []).length;
        const now = Date.now();
        const landed = [];
        const storyMemory = (state.storyMemory || []).map(card => {
            if (!card || !ids.has(card.id)) return card;
            landed.push(card);
            return normalizeStoryMemoryCard({ ...card, lastUsedAt: now, lastUsedMessage: messageCount, usedCount: (card.usedCount || 0) + 1, id: card.id }, card);
        });
        if (landed.length === 0) return state;
        const marks = landed.map(card => ({ name: card.subject || card.type, kind: 'callback', label: `callback landed: ${String(card.text || '').slice(0, 120)}` }));
        const idx = messageId ? (state.messages || []).findIndex(m => m?.id === messageId) : -1;
        const messages = idx === -1 ? state.messages : state.messages.map((m, i) => {
            if (i !== idx) return m;
            const existing = Array.isArray(m.bondMarks) ? m.bondMarks : [];
            const merged = [...existing];
            for (const mark of marks) {
                if (merged.some(known => known.name === mark.name && known.kind === mark.kind)) continue;
                merged.push(mark);
            }
            return { ...m, bondMarks: merged.slice(-6) };
        });
        return { ...state, storyMemory, messages };
    },

    // Mark a batch of messages as summarized (excluded from future LLM history)
    MARK_MESSAGES_SUMMARIZED(state, action) {
        // action.payload = index up to which messages are now summarized
        const upTo = action.payload;
        return {
            ...state,
            // Only the rows this cadence newly covers are re-minted (2026-10-01
            // P2): the old map cloned every row below the mark — 2,000 of
            // 2,000 when 10 were new — so each already-summarized row changed
            // identity per cadence and its memoized ChatMessage re-rendered.
            messages: state.messages.map((msg, idx) =>
                idx < upTo && !msg.summarized ? { ...msg, summarized: true } : msg
            ),
            session: { ...state.session, prunedMessageCount: upTo },
        };
    },

    ADD_JOURNAL_ENTRY(state, action) {
        // THE journal row (2026-10-14 memory-journal P2): known keys, the live
        // clamps, the span inside the transcript — the raw spread used to
        // persist whatever the payload carried. A row without a summary is
        // refused (the cadence never writes one).
        const entry = normalizeJournalEntry(action.payload, { maxMessageCount: (state.messages || []).length });
        if (!entry) return state;
        const journal = [...state.journal, entry];
        // The cadence's engine ticks, in order: the NPC-initiative tick
        // (2026-09-13 overhaul — if no beat is pending and the cooldown has
        // passed, the one bonded NPC with the most pull may reach out; the
        // engine rolls WHEN), the hero-tell tick (2026-09-23 — someone who
        // watched a pattern in the hero form may get a window to say so),
        // and the wonder die's request tick (2026-09-18 — a long eventless
        // stretch asks the director for something strange).
        const tells = rollHeroTellBeat({ ...state, session: rollRelationshipBeat(state) });
        return {
            ...state,
            journal,
            // The journal cadence doubles as the story-memory age-out pass:
            // low-salience cards silent for DORMANCY_JOURNAL_CYCLES cadences
            // go dormant (a Scribe re-report revives them).
            storyMemory: applyStoryMemoryDormancy(state.storyMemory, journal),
            // ...and as the relationship-arc stamp: a disposition shift enters
            // an NPC's history only if it held until this cadence (2026-08-28).
            npcs: stampNpcRelationshipArcs(state.npcs),
            heroTells: tells.heroTells,
            session: rollWonderRequest({ ...state, session: tells.session }),
        };
    },

    /** The player asked the DM for wonder out of character (the one exempt case). */
    REQUEST_WONDER(state, action) {
        const session = rollWonderRequest(state, { onDemand: action.payload?.onDemand !== false });
        return session === state.session ? state : { ...state, session };
    },

    /**
     * One-shot install of the director's hooks (the INSTALL_AFTERMATH_FRONTS
     * pattern): only the pending request's own generation may land, once.
     * The engine re-validates every hook, picks ONE with a crypto die, delays
     * its window by 0–3 scenes (at once when the player asked), stamps the
     * cooldown, and mints the residue story card so even a refused wonder is
     * remembered. Private: no system line — the player only ever feels it.
     */
    INSTALL_WONDER(state, action) {
        const payload = action.payload || {};
        const pending = sanitizePendingWonder(state.session?.pendingWonder);
        if (!pending || payload.sessionId !== state.session?.id || payload.key !== pending.key) return state;
        const messageCount = (state.messages || []).length;
        const hooks = normalizeWonderHooks(payload.hooks, { fronts: state.fronts || [] });
        const wonder = selectWonder(hooks, {
            messageCount,
            // Standalone-weighted (2026-09-30): a coin first decides whether the
            // wonder is off-plot at all when the director offered both kinds.
            pick: pickWonderIndex(hooks, { die: rollDie }),
            delayScenes: rollDie(WONDER_TIMING_DIE_SIDES) - 1,
            onDemand: pending.onDemand,
            key: pending.key,
        });
        const session = {
            ...state.session,
            pendingWonder: null,
            // An empty or all-invalid answer still spends the request: the
            // cooldown keeps a chatty lull from re-asking every cadence.
            lastWonderMessage: messageCount,
            ...(wonder && { wonder }),
        };
        const next = { ...state, session };
        const residue = wonder ? buildWonderResidueCard(wonder) : null;
        if (!residue) return next;
        const withCard = gameReducer(next, { type: 'ADD_STORY_MEMORY_CARD', payload: residue });
        // The residue must not out-run the die (live playtest 2026-09-19): a
        // salience-4 foreshadow card scores ~13 and rode the very next turn's
        // DRAMATIC CALLBACK OPPORTUNITIES, so the hook landed one to two scenes
        // BEFORE its rolled window opened — the timing die was decoration. The
        // card's callback cooldown (lastUsedMessage, an engine stamp a lane card
        // cannot carry) is set to the window's END, so the CUE alone lands the
        // wonder and the card resurfaces only afterwards, as residue.
        const holdUntil = wonder.openAtMessage + WONDER_WINDOW_MESSAGES;
        return {
            ...withCard,
            storyMemory: (withCard.storyMemory || []).map(card => (
                card && card.subject === residue.subject && Array.isArray(card.tags) && card.tags.includes('wonder')
                    ? { ...card, lastUsedMessage: holdUntil }
                    : card
            )),
        };
    },

    ADD_CHRONICLE_CHAPTER(state, action) {
        // A close started on another campaign (or an earlier load of this one)
        // never lands here (2026-09-13 audit P1): the prose would have been
        // filed as a chapter of the WRONG saga with a toIndex from a transcript
        // this campaign never played. Visible, because minutes of DM-model
        // work were paid for.
        if (isStaleCampaignAction(state, action)) {
            console.warn('[Chronicle] Dropped a chapter close that started on a different campaign or load.');
            return {
                ...state,
                messages: [...(state.messages || []), systemMessage(
                    '📜 A chapter close finished after a different campaign was loaded and was discarded. Reopen that campaign and close the chapter again.',
                    { kind: 'error' }
                )],
            };
        }
        const chronicle = appendChronicleChapter(state.chronicle, action.payload, { maxMessageCount: (state.messages || []).length });
        if (chronicle === (state.chronicle || [])) return state;
        // Writing a chapter consumes the front-resolution ceremony nudge.
        const session = state.session?.chapterCloseSuggested
            ? { ...state.session, chapterCloseSuggested: null }
            : state.session;
        return { ...state, chronicle, session };
    },

    REMOVE_CHRONICLE_CHAPTER(state, action) {
        // Only the NEWEST chapter is removable: the next "Close chapter" always
        // resumes after the last chapter's toIndex, so removing the newest one
        // re-opens exactly its span for a fresh retelling (the recovery path for
        // a bad/truncated chapter), while removing a middle chapter would leave
        // a hole no future close could ever retell. The source messages are
        // never deleted, so nothing is lost but the prose.
        const chapters = state.chronicle || [];
        const last = chapters[chapters.length - 1];
        if (!last || !action.payload?.id || last.id !== action.payload.id) return state;
        return { ...state, chronicle: chapters.slice(0, -1) };
    },
};
