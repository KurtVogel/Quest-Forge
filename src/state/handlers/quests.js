/**
 * Quest tracking: upsert-by-id/name, terminal completion/failure (including
 * arcs opened and resolved in one response), and removal.
 */
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
            }],
        };
    },

    COMPLETE_QUEST(state, action) {
        const terminalStatus = action.type === 'COMPLETE_QUEST' ? 'completed' : 'failed';
        const ref = action.payload || '';
        const refId = typeof ref === 'object' ? ref.id : ref;
        const refName = typeof ref === 'object' ? ref.name : ref;
        const nameToken = normalizeRefToken(refName);
        const matched = state.quests.some(q =>
            q.id === refId || (nameToken && normalizeRefToken(q.name) === nameToken));
        if (matched) {
            return {
                ...state,
                quests: state.quests.map(q =>
                    q.id === refId || (nameToken && normalizeRefToken(q.name) === nameToken)
                        ? { ...q, status: terminalStatus }
                        : q
                ),
            };
        }
        // A quest arc opened and resolved in one DM response never existed in
        // state — record it directly in its finished status as table history
        // (playtest #14: the premise's letter delivery vanished without a trace).
        // Only named object refs qualify; a bare id string that matches nothing
        // (panel buttons, stale ids) stays a no-op.
        const newName = typeof ref === 'object' ? String(ref.name || '').trim() : '';
        if (!newName) return state;
        return {
            ...state,
            quests: [...state.quests, {
                id: ref.id || `quest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name: newName,
                description: String(ref.description || '').trim(),
                status: terminalStatus,
                addedAt: Date.now(),
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
