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
import { appendRollHistory, reviveCharacter, systemMessage } from './shared.js';

export const handlers = {
    ADD_MESSAGE(state, action) {
        const next = {
            ...state,
            messages: [...state.messages, {
                id: action.payload.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                timestamp: Date.now(),
                ...action.payload,
            }],
        };
        // Post-defeat stabilization (live playtest #8): a non-lethal low-level
        // defeat left the hero at 0 HP + Unconscious through a whole capture arc —
        // the DM narrated her awake, talking, and rolling checks while the sheet
        // said unconscious, and a stale lowLevelDefeat flag makes any NEW fight an
        // instant defeat in combatExchange. The player's next in-fiction action
        // after the lost fight IS the story moving past the knockout: come to at
        // 1 HP (the 5e stable-wake analog), keep every other condition (rope is
        // rope), and clear the defeat flag. Healing/rests still clear it too.
        if (action.payload?.role === 'user'
            && next.character?.lowLevelDefeat
            && (next.character.currentHP ?? 0) <= 0
            && !next.combat?.active) {
            next.character = { ...reviveCharacter(next.character), currentHP: 1 };
            next.messages = [
                ...next.messages,
                systemMessage(`**You come to** — battered and barely standing at 1/${next.character.maxHP} HP.`),
            ];
        }
        return next;
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

    // Soft-delete a chat message (2026-08-28, refusal-scrub affordance): the
    // record stays in the array so every stored messageIndex (replay ledgers,
    // quest openedAtMessage, journal messageRange) keeps pointing at the right
    // slot, but the message leaves the render, the DM window, journal batches,
    // director contexts, and conversational-distance counting. Built for
    // scrubbing model refusals — a "sorry, I can't continue" line in the window
    // is the strongest known predictor of the NEXT refusal — but works on any
    // message. Deliberately NOT reversible from the UI: the flag persists.
    DELETE_MESSAGE(state, action) {
        const messageId = typeof action.payload === 'object' ? action.payload?.id : action.payload;
        if (!messageId) return state;
        let deleted = false;
        const messages = state.messages.map(msg => {
            if (msg.id !== messageId || msg.deleted) return msg;
            deleted = true;
            return { ...msg, deleted: true };
        });
        return deleted ? { ...state, messages } : state;
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
