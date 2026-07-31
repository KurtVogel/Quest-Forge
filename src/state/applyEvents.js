/**
 * applyEvents — the transaction policy that turns a normalized DM event object
 * (see llm/eventChannels.js) into reducer dispatches.
 *
 * This is STATE-layer code, not parsing: it owns the setup-phase mutation
 * deferral, the combat lockout, premise starting-item reconciliation, the
 * purchase/loose-coin double-charge suppression, loot-source claiming, and the
 * low-level-solo death rerouting. It lived inside responseParser.js for
 * historical reasons until 2026-07-30 — moving it here keeps parsing (text →
 * JSON), normalization (JSON → events), and application (events → dispatches)
 * as three separately testable stages.
 */

import { CLASSES } from '../data/classes.js';
import { normalizeItem } from '../data/items.js';

/**
 * Apply parsed events to dispatch game state changes.
 * @param {object} events - Normalized events from parseResponse/normalizeEvents
 * @param {function} dispatch - Game state dispatch function
 */
export function applyEvents(events, dispatch, getState = null, opts = {}) {
    if (!events) return;

    // A roll-setup turn (the player's action that triggered dice) only declares the
    // structural state the dice need — combat starting. Every *outcome* mutation is
    // deferred to the post-roll narration. This stops the DM from double-applying state
    // when it (mis)emits the same fields in both the withheld setup response and the
    // outcome response — the root cause of duplicate resources_used, and the latent
    // double-counting of gold, items, XP, and conditions.
    if (opts.setupPhase) {
        if (events.combatStart) {
            dispatch({
                type: 'START_COMBAT',
                payload: {
                    enemies: events.combatStart.enemies || [],
                    playerInitiative: events.combatStart.player_initiative,
                    surprise: events.combatStart.surprise,
                    queuedExchange: events.combatExchange,
                },
            });
        }
        return;
    }

    // During engine-owned combat, a response without combat_exchange is either a question,
    // clarification, or narration. It has no authority to mutate mechanics. Completed
    // exchanges are committed by APPLY_COMBAT_EXCHANGE and their narration is parsed with
    // narrationOnly, so dropping inline events here cannot discard a legitimate combat turn.
    if (getState?.()?.combat?.active) {
        console.warn('[applyEvents] Ignored non-exchange events during active engine-owned combat.');
        return;
    }

    const state = getState?.();
    const resources = state?.character?.classResources || {};
    const classResourceDefs = CLASSES[state?.character?.class]?.resources || {};
    const uiOwnedResources = events.resourcesUsed.filter(resourceKey => classResourceDefs[resourceKey]);
    const unavailableResources = events.resourcesUsed.filter(resourceKey => {
        const res = resources[resourceKey];
        return res && res.used >= res.max;
    });
    const suppressResourceHealing = (unavailableResources.length > 0 || uiOwnedResources.length > 0) && events.healing > 0;

    // Premise reconciliation has distinct semantics from ordinary loot: starting
    // belongings must not duplicate class gear or each other. Normalize through the
    // catalog first so aliases such as "massive warhammer" share the catalog identity.
    const itemIdentityTokens = item => {
        const normalized = normalizeItem(typeof item === 'string' ? { name: item } : item);
        return [normalized.itemKey, normalized.name]
            .filter(Boolean)
            .map(value => String(value).toLowerCase().replace(/[^a-z0-9]/g, ''));
    };
    const startingInventoryTokens = new Set((state?.inventory || []).flatMap(itemIdentityTokens));
    for (const item of events.startingItems || []) {
        const normalized = normalizeItem(item);
        const tokens = itemIdentityTokens(normalized);
        if (tokens.some(token => startingInventoryTokens.has(token))) {
            console.warn(`[applyEvents] Ignored duplicate premise starting item "${normalized.name}".`);
            continue;
        }
        // ADD_ITEM strips a raw `equipped` at the reducer boundary; premise items
        // that begin worn/wielded are the one sanctioned equip-on-add channel and
        // declare that intent explicitly.
        const { equipped: premiseEquipped, ...payload } = normalized;
        dispatch({ type: 'ADD_ITEM', payload: { ...payload, ...(premiseEquipped === true && { equipOnAdd: true }) } });
        tokens.forEach(token => startingInventoryTokens.add(token));
    }

    // Player abilities/consumables are activated through the game UI now, which marks
    // them spent and applies any dice-backed effect. If the DM emits a known player
    // resource anyway, skip the spend and any paired healing so it cannot bypass the UI.
    // If it emits a resource already spent, skip it silently — never fire a contradictory
    // "unavailable" notice for a correct use.
    for (const resourceKey of events.resourcesUsed) {
        if (uiOwnedResources.includes(resourceKey)) continue;
        const res = resources[resourceKey];
        if (res && res.used >= res.max) continue;
        dispatch({ type: 'USE_RESOURCE', payload: resourceKey });
    }

    if (events.damageTaken > 0) {
        dispatch({ type: 'TAKE_DAMAGE', payload: events.damageTaken });
    }

    // One owner per effect: when this same response carries an engine-owned recovery
    // transaction (a rest, or a spell the engine rolls healing for), a loose `healing`
    // delta is the DM narrating that transaction's effect — applying both healed twice.
    // The prompt already forbids the pairing; enforce it here like the purchase/coin
    // guard below. This holds even when the rest/cast itself gets replay-suppressed:
    // an echoed rest must not sneak its healing in through the loose channel either.
    const restOwnsHealing = (events.restTaken === 'short' || events.restTaken === 'long') && events.healing > 0;
    const spellOwnsHealing = (events.spellCasts || []).length > 0 && events.healing > 0;
    if (restOwnsHealing) {
        console.warn('[applyEvents] Ignored loose healing emitted alongside rest_taken — the rest already owns recovery.');
    } else if (spellOwnsHealing) {
        console.warn('[applyEvents] Ignored loose healing emitted alongside spell_cast — the engine rolls spell healing itself.');
    }

    if (events.healing > 0 && !suppressResourceHealing && !restOwnsHealing && !spellOwnsHealing) {
        dispatch({ type: 'HEAL', payload: events.healing });
    }

    // A `purchase`/`sell` already adds/removes the traded item atomically. If the DM ALSO
    // lists that same item in items_found/items_lost (the prompt forbids it), the item gets
    // duplicated or removed twice. Drop found/lost entries that match a traded item by
    // normalized key or name — the item-side twin of the coin guard below.
    const normToken = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const itemKeyOf = (it) => (typeof it === 'string' ? '' : (it.itemKey || it.key || ''));
    const itemNameOf = (it) => (typeof it === 'string' ? it : (it.name || ''));
    const tradedTokenSet = (entries, getKey, getName) => {
        const set = new Set();
        for (const e of entries) {
            if (getKey(e)) set.add(normToken(getKey(e)));
            if (getName(e)) set.add(normToken(getName(e)));
        }
        return set;
    };
    const dropMatching = (entries, tokens, action) => {
        if (tokens.size === 0) return entries;
        return entries.filter((it) => {
            const k = itemKeyOf(it);
            const n = itemNameOf(it);
            const dup = (k && tokens.has(normToken(k))) || (n && tokens.has(normToken(n)));
            if (dup) console.warn(`[applyEvents] Ignored a found/lost "${n || k}" already handled by the atomic ${action}.`);
            return !dup;
        });
    };
    const purchasedTokens = tradedTokenSet(events.purchases, (p) => p.itemKey || p.item?.itemKey || p.key, (p) => p.name || p.item?.name);
    const soldTokens = tradedTokenSet(events.sells, (s) => s.itemKey || s.key, (s) => s.name);
    const itemsFound = dropMatching(events.itemsFound, purchasedTokens, 'purchase');
    const itemsLost = dropMatching(events.itemsLost, soldTokens, 'sale');

    // Loot deduplication guard — prevent the same message from granting gold/items twice
    // (e.g. from a re-render, state restore, or DM re-narrating already-applied loot).
    const lootSourceId = opts?.lootSourceId;
    const hasLoot = itemsFound.length > 0
        || (events.goldFound ?? 0) > 0 || (events.silverFound ?? 0) > 0 || (events.copperFound ?? 0) > 0;
    let lootAlreadyClaimed = false;
    if (lootSourceId && hasLoot) {
        if ((getState?.()?.appliedLootSourceIds || []).includes(lootSourceId)) {
            lootAlreadyClaimed = true;
            console.warn(`[applyEvents] Loot from source ${lootSourceId} already applied; skipping items and gold.`);
        } else {
            dispatch({ type: 'CLAIM_LOOT_SOURCE', payload: lootSourceId });
        }
    }

    for (const item of itemsFound) {
        if (lootAlreadyClaimed) break;
        const itemData = typeof item === 'string'
            // Let ADD_ITEM recognize catalog strings before falling back to generic gear.
            ? { name: item }
            : {
                // Let normalizeItem (in ADD_ITEM) fill name/type/weight from the catalog
                // when an itemKey or recognizable name matches — only override when the DM
                // actually specified them. Forcing type:'gear' here hid catalog consumables
                // (e.g. a Potion of Healing granted by itemKey), so their Use button never
                // appeared and they displayed as a generic "Unknown item".
                ...(item.name && { name: item.name }),
                ...(item.type && { type: item.type }),
                ...(Number.isFinite(item.weight) && { weight: item.weight }),
                // Preserve mechanical item properties from LLM/catalog references.
                ...(item.itemKey && { itemKey: item.itemKey }),
                ...(item.key && { itemKey: item.key }),
                ...(item.category && { category: item.category }),
                ...(item.valueCp !== undefined && { valueCp: item.valueCp }),
                ...(item.priceCp !== undefined && { priceCp: item.priceCp }),
                ...(item.rarity && { rarity: item.rarity }),
                ...(item.description && { description: item.description }),
                ...(item.baseAC !== undefined && { baseAC: item.baseAC }),
                ...(item.armorType && { armorType: item.armorType }),
                ...(item.acBonus !== undefined && { acBonus: item.acBonus }),
                ...(item.magicBonus !== undefined && { magicBonus: item.magicBonus }),
                ...(item.isShield && { isShield: true, type: 'shield' }),
                ...(item.shieldAC !== undefined && { shieldAC: item.shieldAC }),
                ...(item.damage && { damage: item.damage }),
                ...(item.damageVersatile && { damageVersatile: item.damageVersatile }),
                ...(item.damageType && { damageType: item.damageType }),
                ...(item.attackBonus !== undefined && { attackBonus: item.attackBonus }),
                ...(item.damageBonus !== undefined && { damageBonus: item.damageBonus }),
                ...(item.ranged !== undefined && { ranged: !!item.ranged }),
                ...(item.finesse !== undefined && { finesse: !!item.finesse }),
                ...(item.thrown !== undefined && { thrown: !!item.thrown }),
                ...(item.twoHanded !== undefined && { twoHanded: !!item.twoHanded }),
                ...(item.versatile !== undefined && { versatile: !!item.versatile }),
                ...(item.consumableType && { consumableType: item.consumableType }),
                ...(item.healing && { healing: item.healing }),
                ...(item.quantity && { quantity: item.quantity }),
            };
        dispatch({ type: 'ADD_ITEM', payload: itemData });
    }

    const transactionMeta = {
        ...(lootSourceId && { sourceId: lootSourceId }),
        ...(opts?.playerMessage && { playerMessage: opts.playerMessage }),
    };
    const withTransactionMeta = (entry) => {
        if (Object.keys(transactionMeta).length === 0) return entry;
        return entry && typeof entry === 'object' && !Array.isArray(entry)
            ? { ...entry, _meta: transactionMeta }
            : { name: String(entry || ''), _meta: transactionMeta };
    };

    for (const purchase of events.purchases) {
        dispatch({ type: 'PURCHASE_ITEM', payload: withTransactionMeta(purchase) });
    }

    for (const sale of events.sells) {
        dispatch({ type: 'SELL_ITEM', payload: withTransactionMeta(sale) });
    }

    for (const itemName of itemsLost) {
        const lostName = typeof itemName === 'string' ? itemName : itemName.name || '';
        if (!lostName) continue;
        dispatch({ type: 'REMOVE_ITEM_BY_NAME', payload: lostName });
    }

    for (const change of events.equipmentChanges) {
        dispatch({
            type: change.action === 'equip' ? 'EQUIP_ITEM_BY_REF' : 'UNEQUIP_ITEM_BY_REF',
            payload: change,
        });
    }

    // An atomic `purchase` already validates funds and deducts payment; a `sell` already
    // credits the proceeds. The DM is told not to ALSO emit loose coin deltas for the same
    // transaction, but it sometimes does — double-charging (or double-paying) the player.
    // Enforce the contract: a purchase suppresses loose coin LOSSES this turn, a sale
    // suppresses loose coin GAINS. This is the root of "the system reduced my coins after
    // I already paid." (A genuinely separate gain/loss is far rarer than this LLM slip,
    // and the prompt already forbids mixing the two.)
    let { goldFound, goldLost, silverFound, silverLost, copperFound, copperLost } = events;
    if (events.purchases.length > 0 && (goldLost > 0 || silverLost > 0 || copperLost > 0)) {
        console.warn('[applyEvents] Ignored loose coin loss emitted alongside an atomic purchase — the purchase already paid.');
        goldLost = silverLost = copperLost = 0;
    }
    if (events.sells.length > 0 && (goldFound > 0 || silverFound > 0 || copperFound > 0)) {
        console.warn('[applyEvents] Ignored loose coin gain emitted alongside an atomic sale — the sale already paid out.');
        goldFound = silverFound = copperFound = 0;
    }

    // Coin gains travel as ONE replay-guarded grant: the recentCoinGrants ledger in the
    // reducer suppresses an identical grant re-emitted within a few messages (a reward
    // narrated again while the pouch is counted/split must not pay twice).
    if (!lootAlreadyClaimed && (goldFound > 0 || silverFound > 0 || copperFound > 0)) {
        dispatch({
            type: 'ADD_COIN_GRANT',
            payload: {
                gold: goldFound,
                silver: silverFound,
                copper: copperFound,
                _meta: transactionMeta,
            },
        });
    }
    // Coin losses travel the same way, as ONE replay-guarded unit: the recentCoinLosses
    // ledger suppresses a payment the DM re-emits on a later turn while recapping money
    // already taken (the rest_taken/coin-grant echo pattern on the spend side).
    if (goldLost > 0 || silverLost > 0 || copperLost > 0) {
        dispatch({
            type: 'APPLY_COIN_LOSS',
            payload: {
                gold: goldLost,
                silver: silverLost,
                copper: copperLost,
                _meta: transactionMeta,
            },
        });
    }

    if (events.levelUp) {
        // Explicit level-up from the DM — skip ADD_EXP to avoid double-leveling
        // if the awarded XP would also cross the threshold. Any bonus XP carries
        // over as progress toward the next level.
        dispatch({ type: 'LEVEL_UP', payload: { bonusExp: events.expAwarded || 0, reason: 'milestone' } });
    } else if (events.expAwarded > 0) {
        dispatch({ type: 'ADD_EXP', payload: events.expAwarded });
    }

    if (events.restTaken === 'short' || events.restTaken === 'long') {
        // source: 'dm' arms the reducer's rest replay guard — the DM tends to keep
        // re-emitting rest_taken while the rest's narration is still in its window.
        dispatch({ type: 'TAKE_REST', payload: events.restTaken, meta: { source: 'dm', ...transactionMeta } });
    }

    for (const cast of events.spellCasts || []) {
        dispatch({ type: 'CAST_SPELL', payload: withTransactionMeta(cast) });
    }

    for (const condition of events.conditionsGained) {
        dispatch({ type: 'ADD_CONDITION', payload: condition });
    }
    for (const condition of events.conditionsRemoved) {
        dispatch({ type: 'REMOVE_CONDITION', payload: condition });
    }

    for (const quest of events.questUpdates) {
        // Every branch requires an identity — a malformed update with neither id nor
        // name would otherwise create a permanent nameless "ghost" quest row.
        if (!quest || (!quest.id && !String(quest.name || '').trim())) continue;
        if (quest.status === 'new' || quest.status === 'updated') {
            // ADD_QUEST upserts by id/name, so "updated" refreshes the existing entry
            // (or self-heals into a new one if the DM never opened it).
            dispatch({ type: 'ADD_QUEST', payload: { ...(quest.id && { id: quest.id }), name: quest.name, description: quest.description } });
        } else if (quest.status === 'completed' && (quest.id || quest.name)) {
            dispatch({ type: 'COMPLETE_QUEST', payload: { id: quest.id, name: quest.name, description: quest.description } });
        } else if (quest.status === 'failed' && (quest.id || quest.name)) {
            dispatch({ type: 'FAIL_QUEST', payload: { id: quest.id, name: quest.name, description: quest.description } });
        }
    }

    if (events.combatStart) {
        dispatch({
            type: 'START_COMBAT',
            payload: {
                enemies: events.combatStart.enemies || [],
                playerInitiative: events.combatStart.player_initiative,
                surprise: events.combatStart.surprise,
            },
        });
    }

    if (events.combatEnd) {
        // Pass whether the LLM awarded XP so the reducer can apply a fallback
        dispatch({ type: 'END_COMBAT', payload: { llmAwardedXp: events.expAwarded > 0 } });
    }

    for (const eu of events.enemyUpdates) {
        dispatch({ type: 'UPDATE_ENEMY', payload: eu });
    }

    for (const comp of events.addCompanions) {
        dispatch({ type: 'ADD_COMPANION', payload: comp });
    }
    for (const comp of events.updateCompanions) {
        dispatch({ type: 'UPDATE_COMPANION', payload: comp });
    }
    for (const compName of events.removeCompanions) {
        dispatch({ type: 'REMOVE_COMPANION', payload: { name: compName } });
    }

    if (events.worldFacts.length > 0) {
        dispatch({ type: 'ADD_WORLD_FACTS', payload: events.worldFacts });
    }

    for (const npc of events.npcUpdates) {
        dispatch({ type: 'UPDATE_NPC', payload: npc });
    }

    for (const front of events.frontUpdates) {
        dispatch({ type: 'UPDATE_FRONT', payload: front });
    }

    for (const memory of events.memoryUpdates) {
        dispatch({ type: 'UPDATE_STORY_MEMORY', payload: memory });
    }

    if (events.playerDeath) {
        const character = state?.character;
        const lowLevelSolo = character && (character.level ?? 1) <= 2 && (!state?.party || state.party.length === 0);
        if (lowLevelSolo) {
            dispatch({
                type: 'PLAYER_DEFEAT',
                payload: { description: events.playerDeath.description },
            });
            return;
        }

        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `**${events.playerDeath.description}**\n\nYour story is not over. Describe what happens next — does your spirit linger, possess a body nearby, or does fate have other plans?`,
                isDeathEvent: true,
            },
        });
        dispatch({ type: 'UPDATE_CHARACTER', payload: { currentHP: 0, isDead: true, dying: false } });
    }
}
