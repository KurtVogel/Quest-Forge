/**
 * Inventory: add/remove items, consumable use (engine-rolled healing), and
 * equip/unequip including the by-ref resolution used by DM equipment_changes.
 */
import { normalizeItem, normalizeItemKey } from '../../data/items.js';
import { isEquippableItem, normalizeEquippedSlots } from '../../engine/equipment.js';
import { itemIdentityMatches } from '../../engine/textMatch.js';
import { rollNotation } from '../../engine/dice.ts';
import { gameReducer } from '../gameReducer.js';
import {
    companionStatus,
    consumeItem,
    appendRollHistory,
    currentMessageIndex,
    findInventoryItemByRef,
    findRecentTransactionDuplicate,
    isPlayerCombatTurn,
    mintOwnedItem,
    normalizeCompanion,
    normalizeRefToken,
    playerMessageSupportsRepeatTransaction,
    rememberTransaction,
    reviveCharacter,
    systemMessage,
    withInventoryAndAC,
} from './shared.js';

// Cross-message replay ledger for DM items_found (the one-shot mechanics
// invariant, DECISIONS.md 2026-07-21 — this channel was its missing sibling):
// live playtest #7 watched the DM grant the same healing potion on three
// separate messages (the find, the counting recap, and a later scene recap) and
// every one applied, because only same-message CLAIM_LOOT_SOURCE idempotency
// existed. Same tight window as coin grants — the failure mode is the recap on
// the very next turns, and two identical legitimate finds further apart stay
// untouched.
const RECENT_ITEM_GRANT_MESSAGE_WINDOW = 4;
// Verbs that show the player's own message re-acquiring an item this turn —
// broader than the coin-loss commerce set on purpose: "I take/grab/pick up
// another torch" is a genuine second acquisition.
const ITEM_ACQUIRE_VERB_RE = /\b(buy|buys|buying|bought|purchase|purchases|purchasing|purchased|take|takes|taking|took|grab|grabs|grabbing|grabbed|pick|picks|picking|picked|pocket|pockets|pocketing|pocketed|loot|loots|looting|looted|collect|collects|collecting|collected|claim|claims|claiming|claimed)\b/i;

function isBonusActionConsumable(item) {
    return item?.actionType === 'bonus' || item?.consumableType === 'healing';
}

// findInventoryItemByRef moved to shared.js (2026-08-28): the same resolution
// ladder now serves equip/unequip, name-referenced removal, and SELL_ITEM.

export const handlers = {
    ADD_ITEM(state, action) {
        // The engine mints item ids and owns equip placement. A DM/Scribe payload
        // carrying `id` could collide with an existing entry (double-delete on
        // REMOVE_ITEM), and `equipped: true` would displace the hero's active
        // weapon/armor through normalizeEquippedSlots' preferred-item path,
        // bypassing the deliberate empty-slot-only auto-equip (2026-07-28 audit).
        // Premise starting items are the one sanctioned equip-on-add channel and
        // declare it via `equipOnAdd`.
        const rawPayload = action.payload;
        const meta = (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload) && rawPayload._meta) || {};
        const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
            ? (({ _meta: _dropped, ...rest }) => rest)(rawPayload)
            : rawPayload;
        const equipOnAdd = !Array.isArray(payload) && payload?.equipOnAdd === true;
        const item = normalizeItem(payload);

        // Only DM-event dispatches carry a sourceId — manual UI adds and internal
        // grants stay unguarded (a user click is always deliberate).
        const sourceId = String(meta.sourceId || '').slice(0, 160);
        let recentItemGrants = state.recentItemGrants;
        if (sourceId) {
            const identity = normalizeItemKey(item.itemKey || item.name) || normalizeRefToken(item.name);
            const quantity = Math.max(1, Math.trunc(item.quantity || 1));
            // Identity-only signature (playtest #8): quantity drift is the item
            // twin of coin denomination drift — a "3 arrows" grant recapped as
            // "arrows" (x1) is the same find, and a quantity-bearing signature
            // let it through. A genuine second find of the same item type inside
            // the window still applies via the player-phrasing bypass, visibly.
            const transaction = {
                item: { itemKey: item.itemKey, name: item.name },
                quantity,
                priceCp: 0,
                signature: `item|${identity}`,
            };
            const messageIndex = currentMessageIndex(state);
            const duplicate = findRecentTransactionDuplicate(
                state.recentItemGrants, transaction, sourceId, messageIndex,
                RECENT_ITEM_GRANT_MESSAGE_WINDOW, state.messages
            );
            const exactSourceReplay = !!duplicate && duplicate.sourceId === sourceId;
            if (duplicate && (exactSourceReplay || !playerMessageSupportsRepeatTransaction(item, meta.playerMessage, ITEM_ACQUIRE_VERB_RE))) {
                return {
                    ...state,
                    recentItemGrants: rememberTransaction(state.recentItemGrants, transaction, sourceId, messageIndex, 'ignored'),
                    messages: [
                        ...state.messages,
                        systemMessage(`Duplicate item grant ignored — ${item.name} was already added moments ago.`),
                    ],
                };
            }
            recentItemGrants = rememberTransaction(state.recentItemGrants, transaction, sourceId, messageIndex);
        }

        // Premise equip fills EMPTY slots only (live playtest #10, 2026-08-22):
        // a "hunting knife at her belt" arriving `equipped: true` displaced the
        // class kit's Longsword as active weapon — the hero-reveal screen had
        // promised otherwise. The class kit the player confirmed wins; the
        // premise item still joins inventory and one click makes it active.
        const slotHolder = item.type === 'weapon'
            ? state.inventory.some(i => i.equipped && i.type === 'weapon')
            : item.type === 'armor' && !item.isShield
                ? state.inventory.some(i => i.equipped && i.type === 'armor' && !i.isShield)
                : (item.type === 'shield' || item.isShield)
                    ? state.inventory.some(i => i.equipped && (i.type === 'shield' || i.isShield))
                    : false;
        const newItem = mintOwnedItem(item, { equipOnAdd: equipOnAdd && !slotHolder });
        // Auto-equip armor/shields if no other of that type is currently equipped
        if (!newItem.equipped) {
            const isArmor = newItem.type === 'armor' && !newItem.isShield;
            const isShield = newItem.type === 'shield' || newItem.isShield;
            const hasEquippedTwoHandedWeapon = state.inventory.some(i => i.equipped && i.type === 'weapon' && i.twoHanded);
            if (isArmor && !state.inventory.some(i => i.equipped && i.type === 'armor' && !i.isShield)) {
                newItem.equipped = true;
            }
            if (isShield && !hasEquippedTwoHandedWeapon && !state.inventory.some(i => i.equipped && (i.type === 'shield' || i.isShield))) {
                newItem.equipped = true;
            }
        }
        const guarded = recentItemGrants === state.recentItemGrants ? state : { ...state, recentItemGrants };
        return withInventoryAndAC(guarded, normalizeEquippedSlots([...state.inventory, newItem], newItem.equipped ? newItem.id : null));
    },

    USE_ITEM(state, action) {
        // Player-initiated consumable use. The engine owns the dice and HP; the
        // resulting system message also informs the DM (it enters the LLM history),
        // so the DM narrates the act on its next turn without re-applying anything.
        // Payload is an item id, or { itemId, targetId } to administer a healing
        // consumable to a companion (out of combat only).
        const usePayload = action.payload && typeof action.payload === 'object'
            ? action.payload
            : { itemId: action.payload };
        const item = state.inventory.find(i => i.id === usePayload.itemId);
        if (!item) return state;
        const usesBonusAction = isBonusActionConsumable(item);

        // Administer a healing consumable to a companion: same engine-rolled
        // healing, revives downed (never dead) — mirrors the player path below.
        if (usePayload.targetId && item.consumableType === 'healing' && item.healing) {
            const companion = (state.party || []).find(c => c.id === usePayload.targetId);
            if (!companion) return state;
            if (state.combat.active) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`Administering a ${item.name} to ${companion.name} mid-fight is not supported — use healing magic in your combat turn, or wait until the fight ends.`)],
                };
            }
            if (companion.status === 'dead') {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`The ${item.name} cannot help the dead.`)],
                };
            }
            const companionMaxHp = companion.maxHp || companion.hp || 1;
            if ((companion.hp ?? 0) >= companionMaxHp) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`${companion.name} is already at full health — you keep the ${item.name}.`)],
                };
            }
            const wasDown = (companion.hp ?? 0) <= 0;
            // item.healing is untrusted (LLM items_found / imported hero files pass it
            // through unvalidated) — a malformed notation must reject the use visibly,
            // not throw out of the reducer. The item is kept, nothing is consumed.
            let roll;
            try {
                roll = rollNotation(item.healing, item.name);
            } catch {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`**${item.name}** has an invalid healing formula (${item.healing}) and cannot be used.`)],
                };
            }
            const healedTo = Math.min(companionMaxHp, (companion.hp || 0) + roll.total);
            const gained = healedTo - (companion.hp || 0);
            return {
                ...state,
                party: state.party.map(c => c.id === companion.id
                    ? normalizeCompanion({ hp: healedTo, status: companionStatus(healedTo, companionMaxHp) }, c)
                    : c),
                inventory: consumeItem(state.inventory, item.id),
                rollHistory: appendRollHistory(state.rollHistory, roll),
                messages: [
                    ...state.messages,
                    systemMessage(
                        `You give ${companion.name} a **${item.name}** — they recover **${gained} HP** (now ${healedTo}/${companionMaxHp})${wasDown ? ' and are back on their feet' : ''}. ${item.healing}: ${roll.rolls.join(', ')}${roll.modifier ? ` (+${roll.modifier})` : ''}`,
                        {
                            narrationCue: {
                                type: 'player_mechanic',
                                mechanic: item.name,
                                effect: `${companion.name} recovered ${gained} HP${wasDown ? ' and regained consciousness' : ''}`,
                                actionType: 'action',
                            },
                        }
                    ),
                ],
            };
        }

        // Healing consumables resolve fully client-side with real dice.
        if (item.consumableType === 'healing' && item.healing) {
            if (state.character.isDead) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`The ${item.name} cannot help the dead.`)],
                };
            }
            if (state.character.currentHP >= state.character.maxHP) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`You're already at full health — you keep the ${item.name}.`)],
                };
            }
            if (usesBonusAction && state.combat.active && !isPlayerCombatTurn(state.combat)) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`**${item.name}** is a bonus action — drink it on your turn.`)],
                };
            }
            if (usesBonusAction && state.combat.active && state.combat.bonusActionUsed) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`**Bonus action already used** — ${item.name} can wait until your next turn.`)],
                };
            }
            // Same untrusted-notation guard as the companion path above.
            let roll;
            try {
                roll = rollNotation(item.healing, item.name);
            } catch {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`**${item.name}** has an invalid healing formula (${item.healing}) and cannot be used.`)],
                };
            }
            const healed = Math.min(state.character.maxHP, state.character.currentHP + roll.total);
            const gained = healed - state.character.currentHP;
            const healedCharacter = healed > 0
                ? reviveCharacter({ ...state.character, currentHP: healed })
                : { ...state.character, currentHP: healed };
            return {
                ...state,
                character: healedCharacter,
                combat: usesBonusAction && state.combat.active
                    ? { ...state.combat, bonusActionUsed: true }
                    : state.combat,
                inventory: consumeItem(state.inventory, item.id),
                rollHistory: appendRollHistory(state.rollHistory, roll),
                messages: [
                    ...state.messages,
                    systemMessage(
                        `You drink a **${item.name}**${usesBonusAction ? ' *(bonus action)*' : ''} and recover **${gained} HP** (now ${healed}/${state.character.maxHP}). ${usesBonusAction && state.combat.active ? 'Your main action is still available. ' : ''}${item.healing}: ${roll.rolls.join(', ')}${roll.modifier ? ` (+${roll.modifier})` : ''}`,
                        {
                            narrationCue: {
                                type: 'player_mechanic',
                                mechanic: item.name,
                                effect: `recovered ${gained} HP`,
                                actionType: usesBonusAction ? 'bonus action' : 'action',
                            },
                        }
                    ),
                ],
            };
        }

        // Other consumables have narrative effects — consume one and let the DM react.
        if (item.type === 'consumable') {
            return {
                ...state,
                inventory: consumeItem(state.inventory, item.id),
                messages: [...state.messages, systemMessage(`🧴 You use a **${item.name}**.`)],
            };
        }

        return state;
    },

    REMOVE_ITEM(state, action) {
        return withInventoryAndAC(state, state.inventory.filter(item => item.id !== action.payload));
    },

    REMOVE_ITEM_BY_NAME(state, action) {
        const ref = String(action.payload || '').trim();
        if (!ref) return state;
        // Drifted DM names must still land (2026-08-28 P1: "hempen rope" left
        // "Hempen Rope (50 ft)" untouched with only a console warn, and the loss
        // audit stood down because the items_lost event HAD been emitted). Exact
        // name first, then the equip channel's ref resolver (catalog keys,
        // descriptor prefixes), then the audits' fuzzy token-containment — the
        // fuzzy tier only when it is UNAMBIGUOUS, because removal takes whole
        // stacks and must never guess between two candidates.
        let matchToRemove = state.inventory.find(i => String(i.name || '').toLowerCase() === ref.toLowerCase())
            || findInventoryItemByRef(state.inventory, ref);
        let failureNote = `Could not remove "${ref}" — nothing in the pack matches it.`;
        if (!matchToRemove) {
            const fuzzy = state.inventory.filter(i =>
                itemIdentityMatches(ref, i.name) || (i.itemKey && itemIdentityMatches(ref, i.itemKey)));
            if (fuzzy.length === 1) matchToRemove = fuzzy[0];
            else if (fuzzy.length > 1) failureNote = `Could not remove "${ref}" — it matches ${fuzzy.length} different stacks; say which one.`;
        }
        if (!matchToRemove) {
            // Visible failure — a silent console warn left the sheet and the
            // fiction disagreeing with no trace the player could dispute.
            return {
                ...state,
                messages: [...state.messages, systemMessage(failureNote)],
            };
        }
        return withInventoryAndAC(state, state.inventory.filter(i => i.id !== matchToRemove.id));
    },

    EQUIP_ITEM(state, action) {
        const itemToEquip = state.inventory.find(i => i.id === action.payload);
        if (!itemToEquip || !isEquippableItem(itemToEquip)) return state;

        const updatedInv = state.inventory.map(item => {
            if (item.id === action.payload) return { ...item, equipped: true };
            return item;
        });

        return withInventoryAndAC(state, normalizeEquippedSlots(updatedInv, action.payload));
    },

    EQUIP_ITEM_BY_REF(state, action) {
        const item = findInventoryItemByRef(state.inventory, action.payload);
        return item
            ? gameReducer(state, { type: 'EQUIP_ITEM', payload: item.id })
            : state;
    },

    UNEQUIP_ITEM(state, action) {
        const updatedInvUneq = state.inventory.map(item =>
            item.id === action.payload ? { ...item, equipped: false } : item
        );
        return withInventoryAndAC(state, updatedInvUneq);
    },

    UNEQUIP_ITEM_BY_REF(state, action) {
        const item = findInventoryItemByRef(state.inventory, action.payload, { preferEquipped: true });
        return item
            ? gameReducer(state, { type: 'UNEQUIP_ITEM', payload: item.id })
            : state;
    },
};
