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
import { containment, tokenSet } from '../../engine/textMatch.js';
import { cleanText } from '../../engine/text.js';
import { conversationalGap } from '../../engine/replayLedger.js';
import { resolveNpcRef } from '../../engine/npcRoster.js';
import { gameReducer } from '../gameReducer.js';
import { normalizeRefToken, systemMessage } from './shared.js';

// Quest-name stopwords: articles/fillers that survive normalizeRefToken but
// carry no identity ("The Cellar Rats" ≈ "Clear the Cellar Rats").
const QUEST_NAME_STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'and']);
const questTokens = (name) => tokenSet(String(name || ''), {
    stopWords: QUEST_NAME_STOP_WORDS,
    minLength: 2,
    foldPossessives: true,
});

/**
 * Fuzzy quest-name identity (rpg-balance-master ruling follow-up, 2026-08-26;
 * the 2026-08-22 Terra playtest P3): a re-phrased completion ("The Relic" for
 * "Find the Relic") used to miss the exact-token match and mint a phantom
 * SECOND completed row via the fallback insert. Same shared textMatch core as
 * the loot audits: symmetric token containment over stopword-stripped names.
 */
function questNameMatcher(refName) {
    // The REF side is tokenized ONCE per dispatch (2026-09-27 audit nit): both
    // `.filter` fallbacks used to re-tokenize it for every row.
    const setB = questTokens(refName);
    return (name) => {
        const setA = questTokens(name);
        if (setA.size === 0 || setB.size === 0 || containment(setA, setB) < 0.99) return false;
        // Near-equality, not bare subset: "The Relic of Kel" is "Find the Relic of
        // Kel" (one dropped verb), but "The Cellar Rats" must NOT swallow "Rats in
        // the Cellar Shrine" — a name twice as long is a different quest.
        return Math.min(setA.size, setB.size) / Math.max(setA.size, setB.size) > 0.5;
    };
}

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
 * The patron is a PERSON on the roster when the name resolves (exact, the
 * roster's own short / long fold, or the one namesMatch candidate — the
 * 10-13 `resolveNpcRef` shape; an ambiguous name is kept as text, never a
 * guess). The record keeps the roster's full name and the id, so the Journal
 * and the prompt can tie the job to the person who gave it.
 */
function resolvePatron(npcs, name) {
    const patron = cleanText(name, QUEST_PATRON_MAX_LENGTH);
    if (!patron) return {};
    const resolved = resolveNpcRef(npcs, { name: patron });
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
        const fuzzyMatch = nameToken ? questNameMatcher(payload.name) : () => false;
        // Dedupe matches ACTIVE quests only — deliberate (documented 2026-07-23):
        // a completed/failed quest is table history and stays closed; a new quest
        // reusing its name is a new arc ("Guard the caravan" can recur), never a
        // silent reopen that would erase how the first one ended.
        //
        // The NAME is identity; a DM-chosen id is only a hint (2026-10-10 quests
        // P2): the format example carries no id, so an id on a `new` is the
        // DM's invention, and `{ id: 'q1', name: 'Escort the caravan' }` after
        // `{ id: 'q1', name: 'Find the Relic' }` used to RENAME the relic arc in
        // place — no terminal row, no XP. An id match counts only when the
        // name agrees with the row (exact or the fuzzy near-equality).
        let existing = state.quests.find(quest =>
            quest.status === 'active' && (
                (payload.id && quest.id === payload.id && (!nameToken || sameName(quest) || fuzzyMatch(quest.name)))
                || sameName(quest)
            )
        );
        // Fuzzy fallback, unambiguous only: a re-phrased "updated" must refresh
        // the tracked arc, not mint a drifted twin beside it.
        if (!existing && nameToken) {
            const fuzzy = state.quests.filter(quest => quest.status === 'active' && fuzzyMatch(quest.name));
            if (fuzzy.length === 1) existing = fuzzy[0];
        }
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
                        // The held text survives a DRIFTED match (2026-10-23
                        // quests nit): an `updated` carrying the fuzzy short
                        // form ("The Relic of Kel") used to rename "Find the
                        // Relic of Kel" to it in the panel and the prompt.
                        // Only an exact (normalized-equal) name replaces.
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
        const fuzzyMatch = nameToken ? questNameMatcher(refName) : () => false;
        // The open lane's identity rule, on the close lane too (2026-10-23
        // quests P1): ACTIVE QUESTS prints `[id: …]` for the DM to echo, and an
        // echo that pairs one arc's name with another's id —
        // `{ id: 'q-relic', name: 'Escort the salt caravan' }` — used to close
        // BOTH arcs and pay one. With a name on the ref, the id's row counts
        // only when the name agrees with it (exact or the fuzzy near-equality);
        // an id-ONLY ref (the panel's ✓, a nameless terminal wire) keeps its
        // by-id close.
        const idGated = isObjectRef && !!nameToken;
        const byId = (q) => !!refId && q.id === refId && (!idGated || sameName(q) || fuzzyMatch(q.name));
        // Recurring quest names must never rewrite closed-arc history: when a
        // match hits BOTH an active row and a terminal row (arc 2 of a reused
        // name), the active rows alone are the target — failing arc 2 used to
        // flip arc 1's completed row to failed. A terminal-only match is the
        // one-shot guard (see below).
        const liveFirst = (rows) => rows.some(q => q.status === 'active') ? rows.filter(q => q.status === 'active') : rows;
        let targets = liveFirst(state.quests.filter(sameName));
        if (targets.length === 0) targets = liveFirst(state.quests.filter(byId));
        let ambiguous = null;
        if (targets.length === 0 && nameToken) {
            // Fuzzy fallback before the fallback INSERT: a drifted completion name
            // ("The Relic" for "Find the Relic") closes the tracked arc instead of
            // minting a phantom second terminal row. Unambiguous only — active
            // rows preferred; 2+ candidates are a shared name, and a shared name
            // is not a quest (the 10-13 `resolveNpcRef` rule): one ⚖ line names
            // them and nothing is recorded (2026-10-23 quests P2 — the old fall
            // to the insert minted a THIRD terminal row, no line, no XP).
            const pool = liveFirst(state.quests.filter(q => fuzzyMatch(q.name)));
            if (pool.length === 1) targets = pool;
            else if (pool.length > 1) ambiguous = pool;
        }
        if (ambiguous) {
            const names = ambiguous.map(q => `"${q.name}"`).join(', ');
            return {
                ...state,
                messages: [...state.messages, systemMessage(
                    `⚖ "${cleanText(refName, QUEST_NAME_MAX_LENGTH)}" matches ${ambiguous.length} tracked quests (${names}) — nothing was ${terminalStatus}. Name the one that ended exactly.`,
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
        // A quest arc opened and resolved in one DM response never existed in
        // state — record it directly in its finished status as table history
        // (playtest #14: the premise's letter delivery vanished without a trace).
        // Only named object refs qualify; a bare id string that matches nothing
        // (panel buttons, stale ids) stays a no-op.
        if (!isObjectRef) return state;
        // An id-only close whose id matches nothing (a stale or invented id)
        // used to return state untouched — the DM closed a quest, the quest
        // stayed in ACTIVE QUESTS, and nothing said it did not land
        // (2026-10-23 quests P2). One line for the DM's window.
        if (!nameToken) {
            return {
                ...state,
                messages: [...state.messages, systemMessage(
                    `⚖ No tracked quest has the id "${cleanText(refId, 80)}" — nothing was ${terminalStatus}. Name the quest to close it.`,
                    { dmVisible: true }
                )],
            };
        }
        // Never-tracked terminal inserts pay NOTHING (DECISIONS.md 2026-09-04,
        // revisiting the 2026-08-26 flat instant tier here): this path exists to
        // record table history (playtest #14 was about the record), and the
        // terminal row IS the DM-replay guard — a player ✕-ing a finished row and
        // the DM re-emitting that completion later resurrected it through this
        // insert and paid again (2026-09-04 audit P2). A DM that opens and closes
        // an arc in one response still earns the instant tier via ADD_QUEST +
        // the same-turn gate above. The one row composer refuses a nameless ref.
        const row = sanitizeQuestRecord({
            id: ref.id,
            name: ref.name,
            description: ref.description,
            ...resolvePatron(state.npcs, ref.patron),
            promised: ref.promised,
            outcome: ref.outcome,
            status: terminalStatus,
            openedAtMessage: (state.messages || []).length,
            closedAtMessage: (state.messages || []).length,
        });
        if (!row) return state;
        if (state.quests.some(quest => quest.id === row.id)) row.id = mintQuestId();
        return { ...state, quests: [...state.quests, row] };
    },

    REMOVE_QUEST(state, action) {
        return {
            ...state,
            quests: state.quests.filter(q => q.id !== action.payload),
        };
    },
};

handlers.FAIL_QUEST = handlers.COMPLETE_QUEST;
