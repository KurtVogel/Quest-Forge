/**
 * Quest tracking: upsert-by-id/name, terminal completion/failure (including
 * arcs opened and resolved in one response), and removal. Completing a tracked
 * quest pays engine-owned XP (rpg-balance-master ruling 2026-08-22) — the
 * quest's own prior status is the one-shot guard, so a DM re-emitting the same
 * completion on a later turn re-writes a terminal status harmlessly and never
 * pays twice.
 */
import { awardExperience, getQuestCompletionXp, QUEST_INSTANT_XP } from '../../engine/progression.js';
import { normalizeRefToken } from './shared.js';

export const handlers = {
    ADD_QUEST(state, action) {
        const payload = action.payload || {};
        const nameToken = normalizeRefToken(payload.name);
        // Dedupe matches ACTIVE quests only — deliberate (documented 2026-07-23):
        // a completed/failed quest is table history and stays closed; a new quest
        // reusing its name is a new arc ("Guard the caravan" can recur), never a
        // silent reopen that would erase how the first one ended.
        const existing = state.quests.find(quest =>
            quest.status === 'active' && (
                (payload.id && quest.id === payload.id) ||
                (nameToken && normalizeRefToken(quest.name) === nameToken)
            )
        );
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
        return {
            ...state,
            quests: [...state.quests, {
                id: payload.id || `quest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                status: 'active',
                addedAt: Date.now(),
                ...payload,
                // Stamped AFTER the payload spread so untrusted input can never
                // pre-age a quest into the full completion tier on its opening turn.
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
        const isMatch = (q) => q.id === refId || (nameToken && normalizeRefToken(q.name) === nameToken);
        const matched = state.quests.some(isMatch);
        if (matched) {
            let next = {
                ...state,
                quests: state.quests.map(q => isMatch(q) ? { ...q, status: terminalStatus } : q),
            };
            // Engine-owned completion XP. Only genuine completions pay (FAIL_QUEST
            // aliases this handler — failure pays 0, always, killing the
            // "fail cheap quests fast" exploit), and only on the transition from a
            // non-terminal status: a row already completed/failed is the one-shot
            // guard against the DM re-emitting the same completion later.
            const paying = action.type === 'COMPLETE_QUEST'
                ? state.quests.find(q => isMatch(q) && q.status !== 'completed' && q.status !== 'failed')
                : null;
            if (paying && state.character) {
                // A quest opened and closed inside the same DM response caps at the
                // flat instant tier — the turn boundary is the anti-farming lever.
                // Missing openedAtMessage (pre-ruling saves) is "definitely not
                // same-turn": the conservative, non-exploitable direction.
                const sameTurn = paying.openedAtMessage === (state.messages || []).length;
                const xp = sameTurn ? QUEST_INSTANT_XP : getQuestCompletionXp(state.character.level);
                const result = awardExperience(next.character, xp, {
                    reason: `quest completed: ${paying.name || 'quest'}`,
                });
                next = {
                    ...next,
                    character: result.character,
                    messages: [...next.messages, ...result.messages],
                };
            }
            return next;
        }
        // A quest arc opened and resolved in one DM response never existed in
        // state — record it directly in its finished status as table history
        // (playtest #14: the premise's letter delivery vanished without a trace).
        // Only named object refs qualify; a bare id string that matches nothing
        // (panel buttons, stale ids) stays a no-op.
        const newName = typeof ref === 'object' ? String(ref.name || '').trim() : '';
        if (!newName) return state;
        let next = {
            ...state,
            quests: [...state.quests, {
                id: ref.id || `quest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name: newName,
                description: String(ref.description || '').trim(),
                status: terminalStatus,
                addedAt: Date.now(),
                openedAtMessage: (state.messages || []).length,
            }],
        };
        // Never-tracked completions pay the flat instant tier only — same
        // anti-farming reasoning as the same-turn gate above.
        if (action.type === 'COMPLETE_QUEST' && state.character) {
            const result = awardExperience(next.character, QUEST_INSTANT_XP, {
                reason: `quest completed: ${newName}`,
            });
            next = {
                ...next,
                character: result.character,
                messages: [...next.messages, ...result.messages],
            };
        }
        return next;
    },

    REMOVE_QUEST(state, action) {
        return {
            ...state,
            quests: state.quests.filter(q => q.id !== action.payload),
        };
    },
};

handlers.FAIL_QUEST = handlers.COMPLETE_QUEST;
