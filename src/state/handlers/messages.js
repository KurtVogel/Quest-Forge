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
import { planRetraction } from '../../engine/retraction.js';
import { consumeInterlude } from '../../engine/interlude.js';
import { isTableTalkMessage } from '../../engine/tableTalkIntent.js';
import { gameReducer } from '../gameReducer.js';

/** Is the DM row being added the answer to an OOC table-talk line (the newest player row)? */
function isTableTalkReply(messages) {
    for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (!m || m.hidden || m.deleted) continue;
        if (m.role === 'user') return typeof m.content === 'string' && isTableTalkMessage(m.content);
        if (m.role === 'assistant') return false;
    }
    return false;
}

export const handlers = {
    ADD_MESSAGE(state, action) {
        const now = Date.now();
        const role = action.payload?.role;
        const next = {
            ...state,
            messages: [...state.messages, {
                id: action.payload.id || `msg-${now}-${Math.random().toString(36).slice(2, 7)}`,
                timestamp: now,
                ...action.payload,
            }],
            // The return card (2026-09-16): every committed TURN stamps when the
            // campaign was last played — a player line or a DM line, never an
            // engine system line. Was written once at creation and never again,
            // so the app could not tell a ten-minute break from a ten-day one.
            ...(role === 'user' || role === 'assistant'
                ? { session: { ...(state.session || {}), lastPlayedAt: now } }
                : {}),
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
        // The doom's close ticks on the player's row (WOW 2026-10-22): a
        // window that has shut is stamped here and prevails on the next
        // row, after the DM's one ordinary turn. The guard is cheap — only
        // a front carrying a window asks the question.
        if (role === 'user' && !action.payload?.hidden
            && (next.fronts || []).some(front => Number.isFinite(front?.doomAtMessage) && (front.status || 'active') === 'active')) {
            return gameReducer(next, { type: 'SETTLE_DOOMS' });
        }
        // The interlude is spent by the narrative DM row that could carry it
        // (WOW 2026-10-26): never by a table-talk reply (the OOC request for
        // one is answered at the table; the wide shot opens the NEXT turn),
        // a hidden row, or a combat row (the block never renders in a fight).
        // …and never one minted AFTER the player's line this reply answers
        // (2026-10-28, measured on the healed megacampaign): a background
        // director that lands while the reply streams mints the shot into a
        // turn whose prompt was already built, and that reply used to spend
        // it unseen. It waits for the next reply, whose prompt carries it.
        const lastPlayerRow = (state.messages || []).findLastIndex(m => m?.role === 'user');
        const mintedThisTurn = Number.isFinite(next.session?.interlude?.mintedAtMessage)
            && next.session.interlude.mintedAtMessage > lastPlayerRow;
        if (role === 'assistant' && next.session?.interlude && !action.payload?.hidden && !next.combat?.active
            && !mintedThisTurn && !isTableTalkReply(state.messages)) {
            const session = consumeInterlude(next.session, { messageCount: state.messages.length, messages: state.messages });
            if (session !== next.session) next.session = session;
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
            // A re-proposal (challenge ruling, chained follow-up) carries the
            // superseded proposal's id so the same moment is counted once.
            recentChecks: appendRecentCheck(
                state.recentChecks,
                buildRecentCheckEntry(pendingRoleplayCheck, (state.messages || []).length),
                pendingRoleplayCheck.supersedesId,
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
        let messages = state.messages.map(msg => {
            if (msg.id !== messageId || msg.deleted) return msg;
            deleted = true;
            return { ...msg, deleted: true };
        });
        if (!deleted) return state;
        // Source-stamped retraction (memory-research M0, 2026-09-30): the
        // message removal was built to scrub a refusal, but the refusal's
        // canon — the facts, cards and unconfirmed impressions the Scribe
        // read from it — stayed live and re-primed the next turn. A fact
        // minted from this message leaves the LIVE set (`retractedAtMessage`;
        // never deleted — the record lane shows it tagged), an active card
        // goes dormant, an impression is dropped. The RAG rows leave the
        // store in ChatPanel (the reducer cannot reach IndexedDB).
        // Retraction follows the LAST WITNESS (memory-research M0, 2026-10-28):
        // a fact / card the fiction restated from a later message is KEPT —
        // its source moves to the newest surviving witness — and only a record
        // nothing later said is retracted. `planRetraction` is the one
        // judgement; ChatPanel reads the same plan for the RAG store.
        const plan = planRetraction(state, messageId);
        const worldFacts = plan.worldFacts;
        const storyMemory = plan.storyMemory;
        const facts = plan.retractedFacts.length;
        const cards = plan.retractedCards.length;
        const keptFacts = plan.keptFacts.length;
        const keptCards = plan.keptCards.length;
        let impressions = 0;
        const npcs = (state.npcs || []).map(npc => {
            if (!npc || !Array.isArray(npc.recentImpressions)) return npc;
            const kept = npc.recentImpressions.filter(entry => entry?.sourceMessage !== messageId);
            if (kept.length === npc.recentImpressions.length) return npc;
            impressions += npc.recentImpressions.length - kept.length;
            if (kept.length > 0) return { ...npc, recentImpressions: kept };
            const { recentImpressions: _dropped, ...rest } = npc;
            return rest;
        });
        const retracted = facts + cards + impressions;
        const kept = keptFacts + keptCards;
        const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
        const parts = [
            facts > 0 && count(facts, 'world fact'),
            cards > 0 && count(cards, 'story card'),
            impressions > 0 && count(impressions, 'unconfirmed impression'),
        ].filter(Boolean).join(', ');
        const keptParts = [
            keptFacts > 0 && count(keptFacts, 'world fact'),
            keptCards > 0 && count(keptCards, 'story card'),
        ].filter(Boolean).join(', ');
        // An infrastructure line (kind: 'error'): never retold as saga. One
        // line names what left the record and what stayed because a later
        // message said it too.
        if (retracted > 0 && kept > 0) {
            messages = [...messages, systemMessage(`✕ Message removed — and what it had put on the record is retracted with it: ${parts}. Kept — restated later: ${keptParts}. The DM no longer sees what was retracted; nothing else changed.`, { kind: 'error' })];
        } else if (retracted > 0) {
            messages = [...messages, systemMessage(`✕ Message removed — and what it had put on the record is retracted with it: ${parts}. The DM no longer sees them; nothing else changed.`, { kind: 'error' })];
        } else if (kept > 0) {
            messages = [...messages, systemMessage(`✕ Message removed — what it had put on the record is kept — restated later: ${keptParts}. Nothing else changed.`, { kind: 'error' })];
        }
        return {
            ...state,
            messages,
            ...(plan.factsChanged && { worldFacts }),
            ...(plan.cardsChanged && { storyMemory }),
            ...(impressions > 0 && { npcs }),
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
            rollHistory: appendRollHistory(state, action.payload),
        };
    },
};
