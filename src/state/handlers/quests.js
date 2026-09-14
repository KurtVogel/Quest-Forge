/**
 * Quest tracking: upsert-by-id/name, terminal completion/failure (including
 * arcs opened and resolved in one response), and removal. Completing a tracked
 * quest pays engine-owned XP (rpg-balance-master ruling 2026-08-22) — the
 * quest's own prior status is the one-shot guard, so a DM re-emitting the same
 * completion on a later turn re-writes a terminal status harmlessly and never
 * pays twice.
 *
 * Only the DM channel pays (2026-09-04 audit P1): applyEvents always sends an
 * OBJECT ref, while the Quests panel's ✓ button sends the bare row id. A
 * bare-string completion is bookkeeping only — the panel's + then ✓ was an
 * unbounded self-service XP mine (8 click-cycles = a level at any level).
 */
import { awardExperience, getQuestCompletionXp, QUEST_INSTANT_XP } from '../../engine/progression.js';
import { containment, tokenSet } from '../../engine/textMatch.js';
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
function questNamesFuzzyMatch(a, b) {
    const setA = questTokens(a);
    const setB = questTokens(b);
    if (setA.size === 0 || setB.size === 0 || containment(setA, setB) < 0.99) return false;
    // Near-equality, not bare subset: "The Relic of Kel" is "Find the Relic of
    // Kel" (one dropped verb), but "The Cellar Rats" must NOT swallow "Rats in
    // the Cellar Shrine" — a name twice as long is a different quest.
    return Math.min(setA.size, setB.size) / Math.max(setA.size, setB.size) > 0.5;
}

// Same caps as the parser boundary (normalizeQuestUpdate): the Quests panel's
// add form used to dispatch raw input, and a pasted multi-KB name persisted
// into the save and rode the system prompt every turn (2026-09-04 audit).
export const QUEST_NAME_MAX_LENGTH = 160;
export const QUEST_DESCRIPTION_MAX_LENGTH = 800;
const clampQuestText = (value, max) => String(value ?? '').trim().slice(0, max);

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
 */
export function sanitizeQuestRecord(raw, { maxMessageCount = Infinity } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const name = typeof raw.name === 'string' ? clampQuestText(raw.name, QUEST_NAME_MAX_LENGTH) : '';
    if (!name) return null;
    const id = (typeof raw.id === 'string' && raw.id.trim()) || (typeof raw.id === 'number' && Number.isFinite(raw.id))
        ? String(raw.id).trim().slice(0, 80)
        : mintQuestId();
    const rawStatus = typeof raw.status === 'string' ? raw.status.trim().toLowerCase() : '';
    const source = typeof raw.source === 'string' ? raw.source.trim().slice(0, 40) : '';
    const addedAt = Number(raw.addedAt);
    const opened = Number(raw.openedAtMessage);
    const ceiling = Number.isFinite(maxMessageCount) ? Math.max(0, Math.trunc(maxMessageCount)) : Infinity;
    return {
        id,
        name,
        description: typeof raw.description === 'string' ? clampQuestText(raw.description, QUEST_DESCRIPTION_MAX_LENGTH) : '',
        ...(source && { source }),
        status: QUEST_STATUSES.has(rawStatus) ? rawStatus : 'active',
        addedAt: Number.isFinite(addedAt) ? addedAt : Date.now(),
        ...(Number.isFinite(opened) && { openedAtMessage: Math.min(ceiling, Math.max(0, Math.trunc(opened))) }),
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
            ...raw,
            name: clampQuestText(raw.name, QUEST_NAME_MAX_LENGTH),
            description: clampQuestText(raw.description, QUEST_DESCRIPTION_MAX_LENGTH),
        };
        const nameToken = normalizeRefToken(payload.name);
        // Dedupe matches ACTIVE quests only — deliberate (documented 2026-07-23):
        // a completed/failed quest is table history and stays closed; a new quest
        // reusing its name is a new arc ("Guard the caravan" can recur), never a
        // silent reopen that would erase how the first one ended.
        let existing = state.quests.find(quest =>
            quest.status === 'active' && (
                (payload.id && quest.id === payload.id) ||
                (nameToken && normalizeRefToken(quest.name) === nameToken)
            )
        );
        // Fuzzy fallback, unambiguous only: a re-phrased "updated" must refresh
        // the tracked arc, not mint a drifted twin beside it.
        if (!existing && nameToken) {
            const fuzzy = state.quests.filter(quest =>
                quest.status === 'active' && questNamesFuzzyMatch(quest.name, payload.name));
            if (fuzzy.length === 1) existing = fuzzy[0];
        }
        if (existing) {
            return {
                ...state,
                quests: state.quests.map(quest => quest.id === existing.id
                    ? {
                        ...quest,
                        name: payload.name || quest.name,
                        description: payload.description || quest.description,
                    }
                    : quest),
            };
        }
        // Fields are picked explicitly — a payload spread would let untrusted
        // input override status/addedAt or ride junk keys into the save.
        return {
            ...state,
            quests: [...state.quests, {
                id: payload.id || `quest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name: payload.name,
                description: payload.description || '',
                ...(payload.source ? { source: payload.source } : {}),
                status: 'active',
                addedAt: Date.now(),
                openedAtMessage: (state.messages || []).length,
            }],
        };
    },

    COMPLETE_QUEST(state, action) {
        const terminalStatus = action.type === 'COMPLETE_QUEST' ? 'completed' : 'failed';
        const ref = action.payload || '';
        const refId = typeof ref === 'object' ? ref.id : ref;
        const refName = typeof ref === 'object' ? ref.name : ref;
        const nameToken = normalizeRefToken(refName);
        let isMatch = (q) => q.id === refId || (nameToken && normalizeRefToken(q.name) === nameToken);
        // Recurring quest names must never rewrite closed-arc history: when an
        // exact match hits BOTH an active row and a terminal row (arc 2 of a
        // reused name), scope the rewrite to the active rows only — failing arc 2
        // used to flip arc 1's completed row to failed. Terminal-only matches
        // keep the rewrite: re-writing a terminal status is harmless and is the
        // one-shot guard against the DM re-emitting a completion later.
        const exactMatches = state.quests.filter(isMatch);
        if (exactMatches.some(q => q.status === 'active')) {
            const activeIds = new Set(exactMatches.filter(q => q.status === 'active').map(q => q.id));
            isMatch = (q) => activeIds.has(q.id);
        }
        if (!state.quests.some(isMatch) && nameToken) {
            // Fuzzy fallback before the fallback INSERT: a drifted completion name
            // ("The Relic" for "Find the Relic") closes the tracked arc instead of
            // minting a phantom second terminal row. Unambiguous only — active
            // rows preferred, and 2+ candidates keep the exact-match behavior
            // (the insert), never a guess.
            const fuzzy = state.quests.filter(q => questNamesFuzzyMatch(q.name, refName));
            const pool = fuzzy.some(q => q.status === 'active')
                ? fuzzy.filter(q => q.status === 'active')
                : fuzzy;
            if (pool.length === 1) {
                const matchedId = pool[0].id;
                isMatch = (q) => q.id === matchedId;
            }
        }
        const matched = state.quests.some(isMatch);
        if (matched) {
            let next = {
                ...state,
                quests: state.quests.map(q => isMatch(q) ? { ...q, status: terminalStatus } : q),
            };
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
                    const result = awardExperience(next.character, xp, {
                        reason: `quest completed: ${paying.name || 'quest'}`,
                    });
                    next = {
                        ...next,
                        character: result.character,
                        messages: [...next.messages, ...result.messages],
                    };
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
        const newName = typeof ref === 'object' ? clampQuestText(ref.name, QUEST_NAME_MAX_LENGTH) : '';
        if (!newName) return state;
        // Never-tracked terminal inserts pay NOTHING (DECISIONS.md 2026-09-04,
        // revisiting the 2026-08-26 flat instant tier here): this path exists to
        // record table history (playtest #14 was about the record), and the
        // terminal row IS the DM-replay guard — a player ✕-ing a finished row and
        // the DM re-emitting that completion later resurrected it through this
        // insert and paid again (2026-09-04 audit P2). A DM that opens and closes
        // an arc in one response still earns the instant tier via ADD_QUEST +
        // the same-turn gate above.
        return {
            ...state,
            quests: [...state.quests, {
                id: ref.id || `quest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name: newName,
                description: clampQuestText(ref.description, QUEST_DESCRIPTION_MAX_LENGTH),
                status: terminalStatus,
                addedAt: Date.now(),
                openedAtMessage: (state.messages || []).length,
            }],
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
