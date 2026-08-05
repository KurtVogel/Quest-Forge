/**
 * Table flow: chat messages, dice-roll history, loot-source claims, and the
 * roleplay-check proposal/ruling/reveal machinery.
 */
import {
    appendRecentCheck,
    buildRecentCheckEntry,
    normalizeRollRuling,
    RECENT_RULING_LIMIT,
    sanitizePendingRoleplayCheck,
} from '../../engine/roleplayCheck.js';
import { appendRollHistory } from './shared.js';

export const handlers = {
    ADD_MESSAGE(state, action) {
        return {
            ...state,
            messages: [...state.messages, {
                id: action.payload.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                timestamp: Date.now(),
                ...action.payload,
            }],
        };
    },

    CLAIM_LOOT_SOURCE(state, action) {
        const sourceId = action.payload;
        if (!sourceId || (state.appliedLootSourceIds || []).includes(sourceId)) return state;
        const updated = [...(state.appliedLootSourceIds || []), sourceId];
        return { ...state, appliedLootSourceIds: updated.slice(-500) };
    },

    PROPOSE_ROLEPLAY_CHECK(state, action) {
        if (state.combat?.active) return state;
        const pendingRoleplayCheck = sanitizePendingRoleplayCheck(action.payload);
        if (!pendingRoleplayCheck) return state;
        return {
            ...state,
            pendingRoleplayCheck,
            // Heat ledger: a proposed check is engine evidence the scene has
            // opposition and stakes, whatever the player or dice do with it.
            recentChecks: appendRecentCheck(
                state.recentChecks,
                buildRecentCheckEntry(pendingRoleplayCheck, (state.messages || []).length),
            ),
        };
    },

    CLEAR_ROLEPLAY_CHECK(state) {
        return state.pendingRoleplayCheck ? { ...state, pendingRoleplayCheck: null } : state;
    },

    // Record a roleplay-check ruling that ended without dice (withdrawn after a
    // challenge, or set aside via Change Approach) so the prompt can bind the DM
    // to its own recent table history instead of re-adjudicating from scratch.
    RECORD_ROLL_RULING(state, action) {
        const ruling = normalizeRollRuling(action.payload);
        if (!ruling) return state;
        return {
            ...state,
            recentRulings: [...(state.recentRulings || []), ruling].slice(-RECENT_RULING_LIMIT),
        };
    },

    // Un-hide a withheld roll-setup narration when no dice will ever supersede it
    // (the player changed approach). Once revealed, the text is player-visible AND
    // back in the DM's history window, so its fiction stays canon.
    REVEAL_MESSAGE(state, action) {
        const messageId = action.payload?.id;
        if (!messageId) return state;
        let revealed = false;
        const messages = state.messages.map(msg => {
            if (msg.id !== messageId || !msg.hidden || !msg.content?.trim()) return msg;
            revealed = true;
            return { ...msg, hidden: false, revealedSetup: true };
        });
        return revealed ? { ...state, messages } : state;
    },

    ADD_ROLL(state, action) {
        return {
            ...state,
            rollHistory: appendRollHistory(state.rollHistory, action.payload),
        };
    },
};
