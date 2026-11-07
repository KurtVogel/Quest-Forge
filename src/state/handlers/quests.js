/**
 * Quest tracking: upsert-by-id/name, terminal completion/failure (including
 * arcs opened and resolved in one response), and removal. Completing a tracked
 * quest pays engine-owned XP (rpg-balance-master ruling 2026-08-22) — the
 * quest's own prior status is the one-shot guard, so a DM re-emitting the same
 * completion on a later turn is a no-op (a DIFFERENT terminal status on a
 * finished row is refused with a ⚖ line — 2026-10-23 quests P2: a late
 * `failed` used to flip a paid completion into a failure and re-stamp its
 * close) and never pays twice.
 *
 * Only the DM channel pays (2026-09-04 audit P1): applyEvents always sends an
 * OBJECT ref, while the Quests panel's ✓ button sends the bare row id. A
 * bare-string completion is bookkeeping only — the panel's + then ✓ was an
 * unbounded self-service XP mine (8 click-cycles = a level at any level).
 */
import { foldExperience, getQuestCompletionXp, isHeroDown, QUEST_INSTANT_XP } from '../../engine/progression.js';
import { cleanText } from '../../engine/text.js';
import { conversationalGap } from '../../engine/replayLedger.js';
import { findNpcByRef } from '../../engine/npcRoster.js';
import { gameReducer } from '../gameReducer.js';
import { normalizeRefToken, systemMessage } from './shared.js';

/**
 * A quest's identity is an id the DM echoes, else an exact (normalized) name
 * — nothing else (identity by reference, lane 3, 2026-11-07; DECISIONS.md
 * 2026-11-05: no word rule decides whether two LLM strings mean the same
 * thing). The fuzzy `questNameMatcher` (2026-08-26; symmetric token
 * containment over stopword-stripped names) that sat under both lanes is
 * gone: it folded "Deliver letter 2" into "Deliver letter 1" (a one-character
 * token was not identity), and ACTIVE QUESTS has printed `[id: …]` on every
 * row since 11-06, so a re-worded name is the DM's to avoid, not the engine's
 * to guess. The defaults are stated per lane below: a `new` with no exact
 * match mints a row (a twin is visible and removable, never a silent fold);
 * a close with no id and no exact name closes nothing and posts one ⚖ line
 * so the DM can send the id next turn.
 */

// Same caps as the parser boundary (normalizeQuestUpdate): the Quests panel's
// add form used to dispatch raw input, and a pasted multi-KB name persisted
// into the save and rode the system prompt every turn (2026-09-04 audit).
export const QUEST_NAME_MAX_LENGTH = 160;
export const QUEST_DESCRIPTION_MAX_LENGTH = 800;
// The sworn record (WOW 2026-11-04, quests-and-rewards): who asked, what was
// promised, how it went — three wire fields the DM may fill, typed here and
// at the parser boundary alike. The AGREEMENT is the first description,
// frozen; every later `updated` APPENDS a stage instead of overwriting it.
export const QUEST_PATRON_MAX_LENGTH = 80;
export const QUEST_PROMISED_MAX_LENGTH = 120;
export const QUEST_OUTCOME_MAX_LENGTH = 200;
export const QUEST_STAGE_MAX_LENGTH = 200;
export const QUEST_STAGES_CAP = 6;
/** An arc that lived this many conversational rows is a chapter: its close offers the Chronicle nudge and its card carries salience 4. */
export const QUEST_LONG_ARC_ROWS = 40;

const QUEST_STATUSES = new Set(['active', 'completed', 'failed']);
const mintQuestId = () => `quest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * The parser whitelist's LOAD twin (2026-09-14 audit P1 + P2): validateSaveState
 * kept any object and typed no field. Name is string-or-drop (an object name
 * was "[object Object]" in the prompt and a React-child crash in the panel),
 * status lowercases + whitelists ("ACTIVE" was invisible to the panel, the
 * prompt, AND the dedupe, so the DM minted a twin), an id-less row gets one
 * (✓ sent `undefined`, ✕ removed every id-less row at once), a duplicate id
 * is re-minted, and openedAtMessage clamps to the live transcript so a
 * future stamp can never read as "same turn".
 *
 * Since 2026-10-10 (quests P2) this is also the ONE row COMPOSER: ADD_QUEST's
 * insert and COMPLETE_QUEST's never-tracked terminal insert build their row
 * through it with `{ status, openedAtMessage }` supplied, so a row written
 * live equals the same row after a reload — the two inline inserts used to
 * keep an untyped `source` and a second copy of the id mint each.
 */
export function sanitizeQuestRecord(raw, { maxMessageCount = Infinity } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const name = cleanText(raw.name, QUEST_NAME_MAX_LENGTH);
    if (!name) return null;
    const id = (typeof raw.id === 'string' && raw.id.trim()) || (typeof raw.id === 'number' && Number.isFinite(raw.id))
        ? String(raw.id).trim().slice(0, 80)
        : mintQuestId();
    const rawStatus = typeof raw.status === 'string' ? raw.status.trim().toLowerCase() : '';
    const source = typeof raw.source === 'string' ? raw.source.trim().slice(0, 40) : '';
    const addedAt = Number(raw.addedAt);
    const ceiling = Number.isFinite(maxMessageCount) ? Math.max(0, Math.trunc(maxMessageCount)) : Infinity;
    const stamp = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.min(ceiling, Math.max(0, Math.trunc(n))) : undefined;
    };
    const status = QUEST_STATUSES.has(rawStatus) ? rawStatus : 'active';
    const openedAtMessage = stamp(raw.openedAtMessage);
    // The close is stamped like the open (2026-10-14 memory-journal P1): the
    // post-journal verifier reads it to tell a completion that landed AFTER
    // its snapshot from a lost quest. Only a terminal row carries it.
    const closedAtMessage = status === 'active' ? undefined : stamp(raw.closedAtMessage);
    // The sworn record's fields (WOW 2026-11-04), typed string-or-drop: the
    // patron (and the roster id it resolved to), what was promised, the
    // frozen agreement, the staged log, and — terminal rows only — how it ended.
    const patron = cleanText(raw.patron, QUEST_PATRON_MAX_LENGTH);
    const patronId = typeof raw.patronId === 'string' && raw.patronId.trim() ? raw.patronId.trim().slice(0, 80) : '';
    const promised = cleanText(raw.promised, QUEST_PROMISED_MAX_LENGTH);
    const agreement = cleanText(raw.agreement, QUEST_DESCRIPTION_MAX_LENGTH);
    const stages = sanitizeQuestStages(raw.stages, stamp);
    const outcome = status === 'active' ? '' : cleanText(raw.outcome, QUEST_OUTCOME_MAX_LENGTH);
    return {
        id,
        name,
        description: cleanText(raw.description, QUEST_DESCRIPTION_MAX_LENGTH),
        ...(source && { source }),
        status,
        addedAt: Number.isFinite(addedAt) ? addedAt : Date.now(),
        ...(openedAtMessage !== undefined && { openedAtMessage }),
        ...(closedAtMessage !== undefined && { closedAtMessage }),
        ...(patron && { patron }),
        ...(patron && patronId && { patronId }),
        ...(promised && { promised }),
        ...(agreement && { agreement }),
        ...(stages.length > 0 && { stages }),
        ...(outcome && { outcome }),
    };
}

/** The staged log, typed: `{ text, atMessage }` rows, blank rows dropped, the newest QUEST_STAGES_CAP kept. */
function sanitizeQuestStages(list, stamp) {
    if (!Array.isArray(list)) return [];
    const rows = [];
    for (const raw of list) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const text = cleanText(raw.text, QUEST_STAGE_MAX_LENGTH);
        if (!text) continue;
        const atMessage = stamp(raw.atMessage);
        rows.push({ text, ...(atMessage !== undefined && { atMessage }) });
    }
    return rows.slice(-QUEST_STAGES_CAP);
}

/**
 * The patron is a PERSON on the roster when the name is a record's exact name
 * or alias (identity by reference, lane 6, 2026-11-08; the `namesMatch` rung
 * is gone — "Mira" beside two Miras, or a second Mira met this turn, stays
 * text). The record keeps the roster's full name and the id, so the Journal
 * and the prompt can tie the job to the person who gave it.
 */
function resolvePatron(npcs, name) {
    const patron = cleanText(name, QUEST_PATRON_MAX_LENGTH);
    if (!patron) return {};
    const resolved = findNpcByRef(npcs, { name: patron });
    if (resolved.npc && typeof resolved.npc.name === 'string' && resolved.npc.name.trim()) {
        return { patron: resolved.npc.name.trim().slice(0, QUEST_PATRON_MAX_LENGTH), patronId: String(resolved.npc.id || '') };
    }
    return { patron };
}

/** The player-facing row a quest's open or close posts — one line, DM-visible like every receipt. */
const questReceipt = (content) => systemMessage(content, { dmVisible: true });

function describeQuestTaken(row) {
    const parts = [row.patron && `for ${row.patron}`, row.promised && `promised: ${row.promised}`].filter(Boolean);
    return `◆ **Quest taken** — ${row.name}${parts.length > 0 ? ` (${parts.join(' · ')})` : ''}`;
}

function describeQuestClosed(row, terminalStatus) {
    const mark = terminalStatus === 'completed' ? '✦ **Quest done**' : '✕ **Quest failed**';
    return `${mark} — ${row.name}${row.outcome ? `: ${row.outcome}` : ''}`;
}

/**
 * The close as a MEMORY (WOW 2026-11-04 slice B, the END_COMBAT wound card's
 * pattern): one engine `quest` card — the name, how it ended, the patron
 * linked — so the callback lane, recall and the Chronicle can bring the
 * ending back as a thing someone was there for. Salience 3; 4 for an arc that
 * lived QUEST_LONG_ARC_ROWS conversational rows.
 */
function buildQuestCard(row, terminalStatus, { longArc, location }) {
    const ending = row.outcome || (terminalStatus === 'completed' ? 'done.' : 'the goal was lost.');
    const forWhom = row.patron ? ` for ${row.patron}` : '';
    const promised = row.promised ? ` (promised: ${row.promised})` : '';
    return {
        type: 'quest',
        subject: row.name.slice(0, 80),
        text: `"${row.name}"${forWhom}${promised} — ${terminalStatus}: ${ending}`,
        salience: longArc ? 4 : 3,
        emotionalCharge: terminalStatus === 'failed' ? 3 : 2,
        status: 'active',
        source: 'engine',
        tags: ['quest', terminalStatus],
        linkedNpcNames: row.patron ? [row.patron] : [],
        ...(typeof location === 'string' && location.trim() && { location: location.trim().slice(0, 120) }),
    };
}

/**
 * "Same response" = no player or DM message has been appended since the row
 * was opened; engine system lines (an XP receipt, a coin line) never end a
 * response. The old exact-count test broke on its own XP line: the first
 * instant payout appended a system message, so the next opened-and-closed
 * errand in the SAME reply stamped a different count and paid again.
 */
function isSameResponse(messages, openedAtMessage) {
    if (!Number.isInteger(openedAtMessage) || openedAtMessage < 0 || openedAtMessage > messages.length) return false;
    for (let i = openedAtMessage; i < messages.length; i++) {
        if (messages[i]?.role !== 'system') return false;
    }
    return true;
}

/** Every loaded quest row typed, with ids unique across the list. */
export function sanitizeQuestRecords(list, options = {}) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const record = sanitizeQuestRecord(raw, options);
        if (!record) continue;
        if (seen.has(record.id)) record.id = mintQuestId();
        seen.add(record.id);
        out.push(record);
    }
    return out;
}

export const handlers = {
    ADD_QUEST(state, action) {
        const raw = action.payload || {};
        const payload = {
            id: (typeof raw.id === 'string' && raw.id.trim()) || (typeof raw.id === 'number' && Number.isFinite(raw.id))
                ? String(raw.id).trim().slice(0, 80)
                : '',
            name: cleanText(raw.name, QUEST_NAME_MAX_LENGTH),
            description: cleanText(raw.description, QUEST_DESCRIPTION_MAX_LENGTH),
            source: raw.source,
            // The sworn record's wire fields (WOW 2026-11-04): the patron
            // resolves against the roster; the promise is a few words.
            ...resolvePatron(state.npcs, raw.patron),
            promised: cleanText(raw.promised, QUEST_PROMISED_MAX_LENGTH),
        };
        const nameToken = normalizeRefToken(payload.name);
        const sameName = quest => !!nameToken && normalizeRefToken(quest.name) === nameToken;
        // Dedupe matches ACTIVE quests only — deliberate (documented 2026-07-23):
        // a completed/failed quest is table history and stays closed; a new quest
        // reusing its name is a new arc ("Guard the caravan" can recur), never a
        // silent reopen that would erase how the first one ended.
        //
        // An echoed id DECIDES (2026-11-06, night; revises 2026-10-10 quests
        // P2 "the name is identity; an id is only a hint"): ACTIVE QUESTS
        // prints `[id: …]` and the format example asks for it on every
        // status but `new`, so an id that names an active row is the DM's
        // pick from the list it was shown and no name rule second-guesses
        // it. A `new` names none — an id beside it is the DM's invention and
        // is never matched (the 10-10 case: `{ id: 'q1', name: 'Escort the
        // caravan' }` after `{ id: 'q1', name: 'Find the Relic' }` opens a
        // second arc). The one refusal is an exact one: the id names one
        // tracked quest and the name is, character for character, ANOTHER —
        // the wire contradicts itself, nothing moves, and a line says so.
        const opens = raw.status === 'new';
        const active = state.quests.filter(quest => quest.status === 'active');
        const byId = !opens && payload.id ? active.find(quest => quest.id === payload.id) : null;
        const byName = active.find(sameName);
        if (byId && byName && byName.id !== byId.id) {
            return {
                ...state,
                messages: [...state.messages, systemMessage(
                    `⚖ A quest update carried the id of "${byId.name}" and the name of "${byName.name}" — nothing changed. Send the id printed beside the quest that moved.`,
                    { dmVisible: true }
                )],
            };
        }
        // No fuzzy rung (lane 3, 2026-11-07): an id or an exact name, else a
        // new row. A `new` that re-words a live arc mints a visible twin the
        // player can ✕; an `updated` the DM never opened self-heals into a
        // row (11-06). Neither is a silent fold into the wrong record.
        const existing = byId || byName;
        if (existing) {
            // An update APPENDS a stage and never overwrites the agreement
            // (WOW 2026-11-04): the first description is frozen as
            // `agreement` (back-filled on a pre-11-04 row the first time it
            // moves), a changed description joins the staged log with its
            // stamp, and the newest stays `description` for every reader.
            // Patron and promise fill once; a later wire never rewrites them.
            const changed = !!payload.description && payload.description !== existing.description;
            const stages = changed
                ? sanitizeQuestStages([
                    ...(Array.isArray(existing.stages) ? existing.stages : []),
                    { text: payload.description, atMessage: (state.messages || []).length },
                ], (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : undefined))
                : existing.stages;
            return {
                ...state,
                quests: state.quests.map(quest => quest.id === existing.id
                    ? {
                        ...quest,
                        // The held text survives an id-matched update whose
                        // name differs (2026-10-23 quests nit): only an exact
                        // (normalized-equal) name replaces the spelling.
                        name: (payload.name && sameName(quest)) ? payload.name : quest.name,
                        description: payload.description || quest.description,
                        ...(changed && !quest.agreement && quest.description && { agreement: quest.description }),
                        ...(Array.isArray(stages) && stages.length > 0 && { stages }),
                        ...(!quest.patron && payload.patron && { patron: payload.patron, ...(payload.patronId && { patronId: payload.patronId }) }),
                        ...(!quest.promised && payload.promised && { promised: payload.promised }),
                    }
                    : quest),
            };
        }
        // The one row composer (see sanitizeQuestRecord): typed fields only,
        // a nameless row is refused, and an id another row already holds is
        // re-minted — the DM's invented id must not collide with a live arc.
        const row = sanitizeQuestRecord({
            ...payload,
            agreement: payload.description,
            status: 'active',
            openedAtMessage: (state.messages || []).length,
        });
        if (!row) return state;
        if (state.quests.some(quest => quest.id === row.id)) row.id = mintQuestId();
        // The job taken is a moment (WOW 2026-11-04 slice B): one row under
        // the DM's reply says what was agreed. The panel's own + (source
        // 'player') is a note, not a job — it stays silent.
        const taken = payload.source === 'player' ? [] : [questReceipt(describeQuestTaken(row))];
        return { ...state, quests: [...state.quests, row], messages: [...state.messages, ...taken] };
    },

    COMPLETE_QUEST(state, action) {
        const terminalStatus = action.type === 'COMPLETE_QUEST' ? 'completed' : 'failed';
        const ref = action.payload || '';
        const isObjectRef = typeof ref === 'object';
        const refId = isObjectRef ? ref.id : ref;
        const refName = isObjectRef ? ref.name : ref;
        const nameToken = normalizeRefToken(refName);
        const sameName = (q) => !!nameToken && normalizeRefToken(q.name) === nameToken;
        const byId = (q) => !!refId && q.id === refId;
        // Recurring quest names must never rewrite closed-arc history: when a
        // match hits BOTH an active row and a terminal row (arc 2 of a reused
        // name), the active rows alone are the target — failing arc 2 used to
        // flip arc 1's completed row to failed. A terminal-only match is the
        // one-shot guard (see below).
        const liveFirst = (rows) => rows.some(q => q.status === 'active') ? rows.filter(q => q.status === 'active') : rows;
        const named = liveFirst(state.quests.filter(sameName));
        const pointed = liveFirst(state.quests.filter(byId));
        // An echoed id DECIDES on the close lane too (2026-11-06, night;
        // revises the 2026-10-23 quests P1 name gate): the wire's id is the
        // DM's pick from ACTIVE QUESTS and closes that arc whatever the name
        // beside it says. The 10-23 case — one arc's id with ANOTHER arc's
        // exact name, `{ id: 'q-relic', name: 'Escort the salt caravan' }`,
        // which once closed both and paid one — is the wire contradicting
        // itself: nothing closes and one line says so (an exact compare, no
        // word rule). A bare-string ref (the panel's ✓) keeps name-then-id.
        // Only an id that names a LIVE arc decides; a finished row's id beside
        // a live arc's exact name is that arc closing (the name rung, as ever).
        const pointedLive = pointed.some(q => q.status === 'active');
        if (isObjectRef && pointedLive && named.some(q => q.status === 'active' && !pointed.some(p => p.id === q.id))) {
            const other = named.find(q => q.status === 'active' && !pointed.some(p => p.id === q.id));
            return {
                ...state,
                messages: [...state.messages, systemMessage(
                    `⚖ A quest close carried the id of "${pointed[0].name}" and the name of "${other.name}" — nothing was ${terminalStatus}. Send the id printed beside the quest that ended.`,
                    { dmVisible: true }
                )],
            };
        }
        let targets = isObjectRef && pointedLive ? pointed : named;
        if (targets.length === 0) targets = pointed;
        // No fuzzy rung (lane 3, 2026-11-07; was the 2026-08-26 drifted-name
        // close and the 2026-10-23 ambiguity line): a DM close that names no
        // tracked id and no exact name closes nothing and mints nothing. The
        // engine cannot tell a re-worded live quest from a never-tracked one,
        // or from a finished arc re-closed in new words, without reading
        // words — and the old fall to a terminal insert was the phantom row
        // (a twin beside a still-open arc; a second finished copy of a closed
        // one). One ⚖ line says so; a live quest stays in ACTIVE QUESTS with
        // its id for the next turn, and a one-reply arc the DM never opened
        // is recorded by sending `new` beside its close (the instant tier).
        // The bare-string ✓ (the panel) on a stale id stays a silent no-op.
        if (targets.length === 0 && isObjectRef && nameToken) {
            return {
                ...state,
                messages: [...state.messages, systemMessage(
                    `⚖ No tracked quest is named "${cleanText(refName, QUEST_NAME_MAX_LENGTH)}" — nothing was ${terminalStatus}. Send the id printed beside it in ACTIVE QUESTS; a job that was never tracked opens with "new" in the same response as its close.`,
                    { dmVisible: true }
                )],
            };
        }
        const targetIds = new Set(targets.map(q => q.id));
        const isMatch = (q) => targetIds.has(q.id);
        if (targets.length > 0 && targets.every(q => q.status !== 'active')) {
            // Terminal-only match. The SAME status is the DM re-emitting a
            // completion it already landed: the one-shot guard, a silent no-op.
            // A DIFFERENT terminal status is refused — a `failed` carrying a
            // completed row's id used to turn `completed @2` into `failed @9`
            // (history rewritten, the XP kept, the close re-stamped where the
            // post-journal verifier reads a late settlement).
            if (targets.every(q => q.status === terminalStatus)) return state;
            const held = targets.find(q => q.status !== terminalStatus);
            return {
                ...state,
                messages: [...state.messages, systemMessage(
                    `⚖ "${held.name}" already ended as ${held.status} — a finished quest never becomes ${terminalStatus}. Nothing changed.`,
                    { dmVisible: true }
                )],
            };
        }
        const matched = targets.length > 0;
        if (matched) {
            const closedAtMessage = (state.messages || []).length;
            // How it ended (WOW 2026-11-04): the wire's `outcome`, else the
            // close's own description when it says something the row did not.
            const outcome = isObjectRef
                ? (cleanText(ref.outcome, QUEST_OUTCOME_MAX_LENGTH)
                    || (cleanText(ref.description, QUEST_OUTCOME_MAX_LENGTH) !== cleanText(targets[0]?.description, QUEST_OUTCOME_MAX_LENGTH)
                        ? cleanText(ref.description, QUEST_OUTCOME_MAX_LENGTH)
                        : ''))
                : '';
            let next = {
                ...state,
                quests: state.quests.map(q => isMatch(q)
                    ? { ...q, status: terminalStatus, closedAtMessage, ...(outcome && { outcome }) }
                    : q),
            };
            // The job done is a moment, not a receipt (WOW 2026-11-04 slice
            // B) — for the DM lane only: the panel's ✓ is bookkeeping (the
            // 09-04 rule) and posts nothing. Each tracked arc that ENDS here
            // posts its ✦ / ✕ row above the XP receipt, mints one engine
            // `quest` card (the fight-mark pattern), and — when the arc
            // lived QUEST_LONG_ARC_ROWS conversational rows — offers the
            // Chronicle a chapter close (the 07-26 offer, on the front's field).
            if (isObjectRef) {
                for (const target of targets.filter(q => q.status === 'active')) {
                    const closed = next.quests.find(q => q.id === target.id) || { ...target, outcome };
                    next = { ...next, messages: [...next.messages, questReceipt(describeQuestClosed(closed, terminalStatus))] };
                    const lived = conversationalGap(target.openedAtMessage, closedAtMessage, { messages: state.messages });
                    const longArc = Number.isFinite(lived) && lived >= QUEST_LONG_ARC_ROWS;
                    next = gameReducer(next, {
                        type: 'ADD_STORY_MEMORY_CARD',
                        payload: buildQuestCard(closed, terminalStatus, { longArc, location: state.currentLocation }),
                    });
                    if (longArc) {
                        next = {
                            ...next,
                            session: {
                                ...next.session,
                                chapterCloseSuggested: { reason: 'quest', title: closed.name.slice(0, 160), at: Date.now() },
                            },
                        };
                    }
                }
            }
            // Engine-owned completion XP. Only genuine completions pay (FAIL_QUEST
            // aliases this handler — failure pays 0, always, killing the
            // "fail cheap quests fast" exploit), only on the transition from a
            // non-terminal status (a row already completed/failed is the one-shot
            // guard against the DM re-emitting the same completion later), and
            // only for object refs — the DM channel. A bare id string is the
            // Quests panel's ✓ button: bookkeeping, never XP (see header).
            const paying = action.type === 'COMPLETE_QUEST' && typeof ref === 'object'
                ? state.quests.find(q => isMatch(q) && q.status !== 'completed' && q.status !== 'failed')
                : null;
            if (paying && state.character) {
                // A quest opened and closed inside the same DM response caps at the
                // flat instant tier — the turn boundary is the anti-farming lever.
                // Missing openedAtMessage (pre-ruling saves) is "definitely not
                // same-turn": the conservative, non-exploitable direction.
                const messages = state.messages || [];
                const sameTurn = isSameResponse(messages, paying.openedAtMessage);
                // ONE instant payout per response (DECISIONS.md 2026-09-14,
                // revisiting the 2026-08-26 flat tier): the wire cap let four
                // opened-and-closed errands in one response compound to 100 XP
                // at L1 — a level in three responses. Any OTHER row completed
                // in this same response (paid or record-only — the engine may
                // refuse to give on suspicion) spends the response's one
                // instant payout; the refusal is visible.
                const instantAlreadyPaid = sameTurn && state.quests.some(q =>
                    q.id !== paying.id && q.status === 'completed' && isSameResponse(messages, q.openedAtMessage));
                const xp = sameTurn
                    ? (instantAlreadyPaid ? 0 : QUEST_INSTANT_XP)
                    : getQuestCompletionXp(state.character.level);
                if (xp > 0) {
                    // No DM channel stands a DOWN hero up (DECISIONS 2026-10-14
                    // point 2, extended 2026-10-23 quests P1): the amount is the
                    // engine's, the TRIGGER is the DM's `quest_updates`, and a
                    // dying hero whose reply completed the errand woke "Fully
                    // healed" with the death-save clock wiped. A standing hero
                    // keeps the full level-up heal.
                    next = foldExperience(next, xp, {
                        reason: `quest completed: ${paying.name || 'quest'}`,
                        keepDowned: isHeroDown(state.character),
                    });
                } else {
                    next = {
                        ...next,
                        messages: [...next.messages, systemMessage(
                            `⚖ "${paying.name || 'quest'}" closed — the instant quest tier pays once per response.`
                        )],
                    };
                }
            }
            return next;
        }
        // Nothing matched and the ref carries no name: a bare id string that
        // matches nothing (panel buttons, stale ids) stays a no-op.
        if (!isObjectRef) return state;
        // An id-only close whose id matches nothing (a stale or invented id)
        // used to return state untouched — the DM closed a quest, the quest
        // stayed in ACTIVE QUESTS, and nothing said it did not land
        // (2026-10-23 quests P2). One line for the DM's window.
        //
        // The never-tracked terminal INSERT that followed here (2026-08,
        // playtest #14: an arc opened and resolved in one reply recorded as
        // table history, paying nothing) is gone with the fuzzy rung (lane 3,
        // 2026-11-07): the rung was what kept it from minting a finished twin
        // of an arc re-closed in new words, and with the rung removed every
        // named miss is the refusal above. A one-reply arc is recorded by
        // `new` + the close in one response, which the prompt asks for and
        // the same-turn gate pays at the instant tier.
        return {
            ...state,
            messages: [...state.messages, systemMessage(
                `⚖ No tracked quest has the id "${cleanText(refId, 80)}" — nothing was ${terminalStatus}. Name the quest to close it.`,
                { dmVisible: true }
            )],
        };
    },

    REMOVE_QUEST(state, action) {
        return {
            ...state,
            quests: state.quests.filter(q => q.id !== action.payload),
        };
    },
};

handlers.FAIL_QUEST = handlers.COMPLETE_QUEST;
