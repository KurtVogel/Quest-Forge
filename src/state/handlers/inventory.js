/**
 * Inventory: add/remove items, consumable use (engine-rolled healing), and
 * equip/unequip including the by-ref resolution used by DM equipment_changes.
 */
import { normalizeItem, normalizeItemKey, MAX_ITEM_QUANTITY } from '../../data/items.js';
import { isEquippableItem, isSlotHeld, normalizeEquippedSlots, shouldAutoEquip } from '../../engine/equipment.js';
import { rollNotation } from '../../engine/dice.ts';
import {
    addOrStackItem,
    stackOverflow,
    companionStatus,
    consumeItem,
    appendRollHistory,
    currentMessageIndex,
    describeFaces,
    findInventoryItemByRef,
    healHero,
    findRecentTransactionDuplicate,
    isPlayerCombatTurn,
    mintOwnedItem,
    normalizeCompanion,
    normalizeRefToken,
    playerMessageSupportsRepeatTransaction,
    rememberTransaction,
    resolveInventoryItemRef,
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
// Grants riding a quest-completion response guard wider (2026-08-31 P1, item
// twin of the coin double-pay): a reward item granted at the handover gets
// re-emitted at quest completion >4 conversational messages later. Matches the
// spend side's 12; the ITEM_ACQUIRE_VERB_RE player-phrasing bypass stays intact
// so a genuine "I grab another torch" still applies.
const RECENT_ITEM_GRANT_EXTENDED_WINDOW = 12;
// Verbs that show the player's own message re-acquiring an item this turn —
// broader than the coin-loss commerce set on purpose: "I take/grab/pick up
// another torch" is a genuine second acquisition.
const ITEM_ACQUIRE_VERB_RE = /\b(buy|buys|buying|bought|purchase|purchases|purchasing|purchased|take|takes|taking|took|grab|grabs|grabbing|grabbed|pick|picks|picking|picked|pocket|pockets|pocketing|pocketed|loot|loots|looting|looted|collect|collects|collecting|collected|claim|claims|claiming|claimed)\b/i;

function isBonusActionConsumable(item) {
    return item?.actionType === 'bonus' || item?.consumableType === 'healing';
}

// resolveInventoryItemRef / findInventoryItemByRef live in shared.js
// (2026-08-28): the same resolution ladder serves equip/unequip,
// name-referenced removal, and SELL_ITEM.

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
            // Scribe-audit grants skip the reducer's duplicate check — scribeAudits
            // already pre-filtered against this same ledger with a FUZZY identity
            // match (strictly broader than the exact signature here) and announces
            // the recovery itself — but they DO enter the ledger, so a later DM
            // re-emission of an audit-granted reward is guarded (2026-08-31 P1:
            // audit grants were never ledgered, leaving the victory-loot →
            // quest-completion replay invisible to this guard).
            const isAudit = meta.audit === true;
            const grantWindow = (isAudit || meta.questCompletionAdjacent === true)
                ? RECENT_ITEM_GRANT_EXTENDED_WINDOW
                : RECENT_ITEM_GRANT_MESSAGE_WINDOW;
            const duplicate = isAudit ? null : findRecentTransactionDuplicate(
                state.recentItemGrants, transaction, sourceId, messageIndex,
                grantWindow, state.messages
            );
            const exactSourceReplay = !!duplicate && duplicate.sourceId === sourceId;
            if (duplicate && (exactSourceReplay || !playerMessageSupportsRepeatTransaction(item, meta.playerMessage, ITEM_ACQUIRE_VERB_RE))) {
                return {
                    ...state,
                    recentItemGrants: rememberTransaction(state.recentItemGrants, transaction, sourceId, messageIndex, 'ignored'),
                    messages: [
                        ...state.messages,
                        // dmVisible: the DM must learn its re-emission was suppressed
                        // (the item is already owned) or it keeps trying.
                        systemMessage(`Duplicate item grant ignored — ${item.name} was already added moments ago.`, { dmVisible: true }),
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
        const newItem = mintOwnedItem(item, { equipOnAdd: equipOnAdd && !isSlotHeld(state.inventory, item) });
        // Armor / shields fill an empty slot — the load heal's own rule.
        if (shouldAutoEquip(state.inventory, newItem)) newItem.equipped = true;
        let guarded = recentItemGrants === state.recentItemGrants ? state : { ...state, recentItemGrants };
        // The stack ceiling is visible, never silent (2026-09-25): the DM and
        // the player both learn that part of a grant did not land.
        const overflow = stackOverflow(state.inventory, newItem);
        if (overflow > 0) {
            guarded = {
                ...guarded,
                messages: [
                    ...guarded.messages,
                    systemMessage(`${newItem.name} stack is full at ${MAX_ITEM_QUANTITY} — ${overflow} could not be carried.`, { dmVisible: true }),
                ],
            };
        }
        // Same-identity non-equipment joins its existing stack (2026-09-03 P2:
        // buy 2 → buy 3 → find 1 minted three "Torch" rows, and a later loss
        // decremented whichever row resolved first).
        return withInventoryAndAC(guarded, normalizeEquippedSlots(addOrStackItem(state.inventory, newItem), newItem.equipped ? newItem.id : null));
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
        const refuse = (line) => ({ ...state, messages: [...state.messages, systemMessage(line)] });

        // Healing consumables resolve fully client-side with real dice — ONE
        // path for the hero and for a companion (2026-10-07 inventory-economy
        // P2: two ~80-line copies of dead / full / notation / roll / receipt).
        // The target decides who is healed; the gates and the dice are shared.
        if (item.consumableType === 'healing' && item.healing) {
            const companion = usePayload.targetId ? (state.party || []).find(c => c.id === usePayload.targetId) : null;
            if (usePayload.targetId && !companion) return state;
            // Administering to a companion is out-of-combat only; the hero's own
            // drink is a tracked bonus action inside a fight.
            if (companion && state.combat.active) {
                return refuse(`Administering a ${item.name} to ${companion.name} mid-fight is not supported — use healing magic in your combat turn, or wait until the fight ends.`);
            }
            const target = companion
                ? { name: companion.name, dead: companion.status === 'dead', hp: companion.hp ?? 0, maxHp: companion.maxHp || companion.hp || 1 }
                : { name: 'you', dead: !!state.character.isDead, hp: Number(state.character.currentHP) || 0, maxHp: state.character.maxHP };
            if (target.dead) return refuse(`The ${item.name} cannot help the dead.`);
            if (target.hp >= target.maxHp) {
                return refuse(companion
                    ? `${companion.name} is already at full health — you keep the ${item.name}.`
                    : `You're already at full health — you keep the ${item.name}.`);
            }
            if (!companion && usesBonusAction && state.combat.active) {
                if (!isPlayerCombatTurn(state.combat)) return refuse(`**${item.name}** is a bonus action — drink it on your turn.`);
                if (state.combat.bonusActionUsed) return refuse(`**Bonus action already used** — ${item.name} can wait until your next turn.`);
            }
            // `item.healing` is bounded at normalizeItem on every write path
            // (2026-09-12); the try is the belt for a row that predates it — a
            // malformed notation refuses visibly instead of throwing out of
            // the reducer, and nothing is consumed.
            let roll;
            try {
                roll = rollNotation(item.healing, item.name);
            } catch {
                return refuse(`**${item.name}** has an invalid healing formula (${item.healing}) and cannot be used.`);
            }
            const consumed = {
                ...state,
                inventory: consumeItem(state.inventory, item.id),
                rollHistory: appendRollHistory(state, roll),
            };
            if (companion) {
                const wasDown = target.hp <= 0;
                const healedTo = Math.min(target.maxHp, target.hp + roll.total);
                const gained = healedTo - target.hp;
                return {
                    ...consumed,
                    party: state.party.map(c => c.id === companion.id
                        ? normalizeCompanion({ hp: healedTo, status: companionStatus(healedTo, target.maxHp) }, c)
                        : c),
                    messages: [
                        ...state.messages,
                        systemMessage(
                            `You give ${companion.name} a **${item.name}** — they recover **${gained} HP** (now ${healedTo}/${target.maxHp})${wasDown ? ' and are back on their feet' : ''}. ${item.healing}: ${describeFaces(roll)}`,
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
            const { healed, gained, character: healedCharacter } = healHero(state.character, roll.total);
            return {
                ...consumed,
                character: healedCharacter,
                combat: usesBonusAction && state.combat.active
                    ? { ...state.combat, bonusActionUsed: true }
                    : state.combat,
                messages: [
                    ...state.messages,
                    systemMessage(
                        `You drink a **${item.name}**${usesBonusAction ? ' *(bonus action)*' : ''} and recover **${gained} HP** (now ${healed}/${state.character.maxHP}). ${usesBonusAction && state.combat.active ? 'Your main action is still available. ' : ''}${item.healing}: ${describeFaces(roll)}`,
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
        // Payload: a name string, or { name, quantity } — quantity a positive
        // count or "all". Quantity-aware since 2026-09-03 (P1): the ECONOMY
        // prompt asks for items_lost when an owned item is CONSUMED, so a bare
        // "Torch" against a five-torch stack used to empty the whole stack. A
        // bare name now takes ONE unit of a multi-unit stack and the whole row
        // otherwise; the DM (and the loss audit) pass a count for more.
        const payload = action.payload && typeof action.payload === 'object' ? action.payload : { name: action.payload };
        const ref = String(payload.name || '').trim();
        if (!ref) return state;
        const rawQuantity = payload.quantity;
        const removeAll = typeof rawQuantity === 'string' && /^all$/i.test(rawQuantity.trim());
        const requestedQuantity = Number.isFinite(Number(rawQuantity)) && Number(rawQuantity) > 0
            ? Math.trunc(Number(rawQuantity))
            : null;
        // Drifted DM names must still land (2026-08-28 P1: "hempen rope" left
        // "Hempen Rope (50 ft)" untouched with only a console warn, and the loss
        // audit stood down because the items_lost event HAD been emitted): the
        // shared ladder — exact name, catalog key, descriptor prefix, then the
        // audits' fuzzy token-containment, UNAMBIGUOUS only, because removal
        // takes whole stacks and must never guess between two candidates.
        const { item: matchToRemove, ambiguous } = resolveInventoryItemRef(state.inventory, ref);
        if (!matchToRemove) {
            // Visible failure — a silent console warn left the sheet and the
            // fiction disagreeing with no trace the player could dispute.
            return {
                ...state,
                messages: [...state.messages, systemMessage(ambiguous > 1
                    ? `Could not remove "${ref}" — it matches ${ambiguous} different stacks; say which one.`
                    : `Could not remove "${ref}" — nothing in the pack matches it.`)],
            };
        }
        const owned = Math.max(1, Math.trunc(matchToRemove.quantity || 1));
        const units = removeAll
            ? owned
            : requestedQuantity !== null
                ? Math.min(owned, requestedQuantity)
                : 1;
        return withInventoryAndAC(state, consumeItem(state.inventory, matchToRemove.id, units));
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
            ? handlers.EQUIP_ITEM(state, { type: 'EQUIP_ITEM', payload: item.id })
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
            ? handlers.UNEQUIP_ITEM(state, { type: 'UNEQUIP_ITEM', payload: item.id })
            : state;
    },
};
