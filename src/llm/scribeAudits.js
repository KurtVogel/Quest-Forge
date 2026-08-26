/**
 * The Scribe audit family (split from scribe.js 2026-08-24 audit P2): the
 * loot/payment/loss/gear-handoff/cast persistence audits — pure OBSERVATION
 * reconciled deterministically against the events the engine already applied
 * for the same narration (DECISIONS.md 2026-07-31 and onward). scribe.js
 * injects the *_AUDIT_RULES into the extraction prompt and hands the parsed
 * report to runNarrationAudits.
 */
import { conversationalDistance } from '../engine/replayLedger.js';
import { containment, tokenSet } from '../engine/textMatch.js';
import { isSpellcaster, resolveSpellForCharacter } from '../engine/spellcasting.js';
import { MAX_COIN_EVENT, NPC_DOSSIER_FIELD_MAX } from '../config/contentLimits.js';
export const LOOT_AUDIT_RULES = `

ADDITIONAL TASK — LOOT & PAYMENT PERSISTENCE AUDIT:
The game engine persists coins and items ONLY from structured events; anything narrated but not emitted as an event silently vanishes. Your task here is pure OBSERVATION: report what THIS DM narrative shows changing hands, at the full narrated amounts. The engine deterministically reconciles your report against the events it already applied — NEVER do that subtraction yourself, and never omit a coin movement just because EVENTS ALREADY APPLIED lists it.
Report the coins and items the narrative shows the hero ACQUIRING, as one extra top-level field:
"narrated_loot": { "gold": 0, "silver": 0, "copper": 0, "items": [{ "name": "exact item name from the narrative", "quantity": 1 }] }
Also report the coins the narrative shows the hero PAYING OUT, as another top-level field:
"narrated_payment": { "gold": 0, "silver": 0, "copper": 0 }

DIRECTION DECIDES THE LANE — check who holds the coins at the END before anything else:
- narrated_loot is ONLY what flows TO the hero: coins or items the HERO ends up holding.
- narrated_payment is ONLY coins flowing AWAY FROM the hero to someone or something else.
- The final holder decides, never the verb. "He counts out twenty silver and presses them into your hand" is the HERO receiving — that is narrated_loot. A reward, wage, bounty, refund, or purse an NPC hands, counts, tosses, or pays TO the hero goes in narrated_loot and must NEVER appear in narrated_payment, no matter that words like "pays", "counts out", or "hands over" describe it. One coin movement goes in exactly one lane.

Loot rules:
- Report ONLY acquisitions the DM NARRATIVE explicitly completes for the hero: taken, pocketed, looted, claimed, received, or handed over TO the hero. The player's own message is never sufficient evidence — the DM narrative must confirm the acquisition happened.
- Never report offers, prices, rewards merely promised, goods only seen or described, another character's possessions, or attempts/intentions.
- Never report coins or items the narrative merely recalls, recounts, splits, or admires from an EARLIER scene — only acquisitions completed for the first time in THIS narrative. A reward being counted, divided, or mentioned again was already granted when it was first handed over.
- Hospitality consumed on the spot is not an acquisition: a poured drink, a served meal, food and ale enjoyed at the table never become inventory. Report provisions only when the narrative has the hero pack, pocket, or carry them away.
- Exact amounts only. If the narrative gives no specific number ("a handful of coins"), omit that coin field entirely — never estimate.
- Denominations are sacred: report coins in the EXACT denomination the narrative names and NEVER convert between them — "thirty silver pieces" is "silver": 30 (never "gold": 30), "fifty silver" is "silver": 50, "two gold crowns" is "gold": 2. This applies to narrated_payment identically.
- Purchases and sales are engine transactions handled elsewhere; never report coins or goods exchanged in a purchase or sale — in either direction.
- Change returned from the hero's own payment is never an acquisition: when the hero pays with a larger coin and gets change back, report nothing in narrated_loot for the change.
- The HERO'S CURRENT INVENTORY line lists what the hero already owns. Using, drawing, lighting, striking, wearing, or retrieving an owned item is NOT an acquisition — "she takes out her flint and steel and strikes a spark" grants nothing. Report an item the hero already owns ONLY when the narrative explicitly completes acquiring an ADDITIONAL copy (a second rope, another potion).
- Identifying, appraising, examining, or recognizing an item the hero ALREADY carries is NOT an acquisition — realizing the corked vial in her pack is a healing potion, or that the old ring is silver, changes what the item IS, never what the hero HAS. Report nothing for it, under either name.

Payment rules:
- Report a payment ONLY when the DM narrative explicitly completes it: the HERO counts out, hands over, or drops THEIR OWN coins and the other party takes them. Coins moving in the opposite direction — into the hero's hands — are never a payment (see DIRECTION above). Intentions, promises, IOUs, haggling, and prices merely quoted are never payments.
- Involuntary coin losses count as paying out: coins the narrative shows being confiscated, seized, stolen, extorted, or robbed from the hero report here at the exact narrated amount. Threats and demands not yet carried out report nothing.
- Copy narrated amounts digit-exactly; spelled-out numbers convert exactly ("six silver" is "silver": 6, "a dozen coppers" is "copper": 12). Never round, estimate, or infer an amount the narrative does not state.
- Change-making: when the hero pays with a larger coin and receives change (hands over a gold piece for a 2-silver fare and gets 8 silver back), report the NET price actually paid — "silver": 2 — never the gross coin handed over, and never add the fare on top of the coin.
- Never re-report a payment the narrative merely recalls, confirms, defends, or references from an EARLIER scene — only payments completed for the first time in THIS narrative. "You already paid the six silver" is a recollection, not a new payment.
- Exact amounts only; never estimate. A wrongly reported coin is worse than a missed one — certainty is required.
- When in doubt, omit. Omit "narrated_loot" and "narrated_payment" entirely when this narrative moves no coins or items.

Also report gear the narrative shows the hero handing to a COMPANION that the companion accepts and takes up, when the engine applied no matching companion update, as another top-level field:
"missing_gear_handoffs": [{ "companion": "exact companion name", "item": "exact item name", "kind": "weapon" }]

Gear handoff rules:
- Report ONLY handoffs the DM narrative completes: the companion accepts and takes up the item (straps it on, sheathes it, dons it, tucks it away). Offers, refusals, loans for a single moment, and mere suggestions are never handoffs.
- "kind" is "weapon" for weapons, "armor" or "shield" for protection the companion now wears, "keepsake" for a sentimental item with no combat use.
- PARTY COMPANIONS' CURRENT GEAR lists what each companion already carries — an item already listed there is NOT a new handoff, and narration merely referencing or admiring their existing gear reports nothing.
- Anything under EVENTS ALREADY APPLIED (companion gear or keepsake updates, items lost by the hero) is NOT missing.
- Copy the companion's and the item's names exactly as the narrative writes them.
- When in doubt, omit — an invented handoff is worse than a missed one. Omit "missing_gear_handoffs" entirely when nothing is missing.

Also report the ITEMS the narrative shows LEAVING the hero's possession, as another top-level field:
"narrated_losses": { "items": [{ "name": "exact item name as the hero's inventory would know it" }] }

Loss rules:
- Report ONLY losses the DM NARRATIVE completes in this scene: confiscated, seized, stolen, taken, dropped and left behind, destroyed, handed over and kept by the other party. Threats, demands, attempts, and items merely set down within reach report nothing.
- The HERO'S CURRENT INVENTORY line lists what the hero owns — report a loss only for an item on that list, under its listed name (the narrative's "your blade" is the inventory's actual weapon name).
- A pack, purse, or bag "emptied" or "taken" loses its narrated CONTENTS: report each named item individually; coins seized with it report under narrated_payment, never here.
- Gear handed to a party COMPANION is a handoff (missing_gear_handoffs), never a loss. An item merely used, shown, worn, or lent for a moment and returned reports nothing.
- Never re-report a loss the narrative merely recalls, confirms, or laments from an EARLIER scene — only losses completed for the first time in THIS narrative. "Your sword is still gone" reports nothing.
- When in doubt, omit — a wrongly removed item is worse than a missed loss. Omit "narrated_losses" entirely when the hero loses nothing.`;

export const CAST_AUDIT_RULES = `

ADDITIONAL TASK — NARRATED SPELLCAST AUDIT:
The engine spends spell slots and applies spell effects ONLY from structured events; a cast the DM narrates without its event mechanically never happened — no slot spent, no ward, no healing (a hero once fought a whole battle at base AC under a lovingly narrated Mage Armor). Pure OBSERVATION again: report the spells THIS DM narrative shows the HERO successfully completing, as one extra top-level field:
"narrated_casts": [{ "spell": "exact spell name from HERO'S KNOWN SPELLS", "target": "self, or the exact companion name the spell lands on" }]

Cast rules:
- Report ONLY casts the DM NARRATIVE completes for the HERO in this scene: the ward settles, the wounds knit, the light blooms. Attempts, intentions, preparations, interrupted or failed magic, and spells cast by ANY other character report nothing.
- HERO'S KNOWN SPELLS lists every spell that mechanically exists for the hero — report a cast only under its exact listed name. Magic that matches no listed spell reports nothing.
- ENGINE CASTS ALREADY APPLIED lists casts the engine already handled for this narrative — never re-report those.
- An effect merely CONTINUING from an earlier cast (an active ward glinting, an ongoing magical light) is not a new cast; only magic completed for the first time in THIS narrative counts.
- When in doubt, omit. Omit "narrated_casts" entirely when the hero completes no cast.`;

/** Compact owned-inventory summary so the audit can tell "using" from "acquiring".
 * Live Grok finding 2026-07-09: "takes out her flint and steel" read as a completed
 * take and re-granted gear the hero already owned. */
export function describeOwnedInventory(state) {
    const summary = (state?.inventory || [])
        .map(item => {
            const name = String(item?.name || '').trim();
            if (!name) return null;
            const qty = Number.isFinite(item?.quantity) && item.quantity > 1 ? ` x${item.quantity}` : '';
            return `${name}${qty}`;
        })
        .filter(Boolean)
        .join('; ');
    return summary ? summary.slice(0, 800) : null;
}

/** Compact human-readable summary of the loot-relevant events the engine applied. */
export function describeAppliedLoot(events) {
    if (!events) return 'None. No structured events were applied for this narrative.';
    const parts = [];
    if (events.goldFound > 0) parts.push(`gold +${events.goldFound}`);
    if (events.silverFound > 0) parts.push(`silver +${events.silverFound}`);
    if (events.copperFound > 0) parts.push(`copper +${events.copperFound}`);
    if (events.goldLost > 0) parts.push(`gold -${events.goldLost}`);
    if (events.silverLost > 0) parts.push(`silver -${events.silverLost}`);
    if (events.copperLost > 0) parts.push(`copper -${events.copperLost}`);
    for (const item of events.itemsFound || []) {
        parts.push(`item: ${typeof item === 'string' ? item : item?.name || item?.itemKey || 'unknown'}`);
    }
    for (const item of events.itemsLost || []) {
        parts.push(`item lost by hero: ${typeof item === 'string' ? item : item?.name || 'unknown'}`);
    }
    for (const update of events.updateCompanions || []) {
        const gearBits = [];
        if (update?.weapon) gearBits.push(`weapon ${update.weapon}`);
        if (update?.ac !== undefined) gearBits.push(`AC ${update.ac}`);
        if (update?.keepsake) gearBits.push(`keepsake ${update.keepsake}`);
        if (gearBits.length > 0) parts.push(`companion gear update (${update?.name || update?.id || 'companion'}): ${gearBits.join(', ')}`);
    }
    for (const purchase of events.purchases || []) parts.push(`purchase: ${purchase?.itemKey || purchase?.name || purchase?.item?.name || 'item'}`);
    for (const sale of events.sells || []) parts.push(`sale: ${sale?.itemKey || sale?.name || 'item'}`);
    for (const item of events.startingItems || []) parts.push(`starting item: ${item?.name || item?.itemKey || 'unknown'}`);
    return parts.length ? parts.join('; ') : 'None. No coins or items were applied for this narrative.';
}

function coerceLootAmount(value, max = MAX_COIN_EVENT) {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(max, Math.trunc(num)));
}

/** Compact companion-gear summary so the gear-handoff audit can tell "already
 * carries" from "just received". */
export function describePartyGear(state) {
    const lines = (state?.party || [])
        .map(companion => {
            const name = String(companion?.name || '').trim();
            if (!name) return null;
            const bits = [`weapon: ${companion.weapon || 'Unarmed'}`, `AC ${companion.ac ?? '?'}`];
            const keepsakes = (companion.keepsakes || []).filter(Boolean);
            if (keepsakes.length > 0) bits.push(`keepsakes: ${keepsakes.join(', ')}`);
            return `${name} — ${bits.join(', ')}`;
        })
        .filter(Boolean)
        .join('; ');
    return lines ? lines.slice(0, NPC_DOSSIER_FIELD_MAX) : null;
}


/** True when an audit field arrived with actual content (they are object-shaped). */
export function hasAuditPayload(value) {
    if (!value || typeof value !== 'object') return false;
    return Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0;
}

/**
 * Shared audit-family preamble (2026-08-24 audit P2: four hand-copies with
 * suffix-only variance): claim this narration's (suffixed) source id exactly
 * once. Returns { state, sourceId } when the audit may proceed, null when it
 * already ran or no source id exists. NOTE: reconcileNarratedCasts deliberately
 * skips this — CAST_SPELL's own replay ledger is its idempotency.
 */
function claimAuditSource(lootAudit, dispatch, suffix, label) {
    const base = lootAudit?.sourceId;
    if (!base) return null;
    const sourceId = suffix ? `${base}:${suffix}` : base;
    const state = lootAudit.getState?.();
    if ((state?.appliedLootSourceIds || []).includes(sourceId)) {
        console.warn(`[Scribe] ${label} for ${sourceId} already applied; skipping.`);
        return null;
    }
    dispatch({ type: 'CLAIM_LOOT_SOURCE', payload: sourceId });
    return { state, sourceId };
}

const GEAR_HANDOFF_KINDS = new Set(['weapon', 'armor', 'shield', 'keepsake']);

function companionNameMatches(companionName, reportedName) {
    const known = String(companionName || '').trim().toLowerCase();
    const reported = String(reportedName || '').trim().toLowerCase();
    if (!known || !reported) return false;
    if (known === reported) return true;
    // First-name reporting ("Kaarina" for "Kaarina Tammi") and vice versa.
    return known.split(/\s+/)[0] === reported.split(/\s+/)[0];
}

/**
 * Scribe gear-handoff audit: narrated companion gear handoffs the DM never
 * emitted as update_companions/items_lost. Routes tracked items through
 * GIVE_GEAR_TO_COMPANION (announces + removes from the hero) and keepsakes
 * through the capped keepsake list. Conservative by design: armor with no
 * tracked inventory item has no derivable AC and is skipped. Idempotent per
 * narration via a claimed `:gear` sourceId.
 */
function applyMissingGearHandoffs(missing, lootAudit, dispatch) {
    const entries = (Array.isArray(missing) ? missing : [])
        .map(entry => {
            const companion = String(entry?.companion || '').trim().slice(0, 60);
            const item = String(entry?.item || '').trim().slice(0, 80);
            const kind = GEAR_HANDOFF_KINDS.has(entry?.kind) ? entry.kind : null;
            if (!companion || !item || !kind) return null;
            return { companion, item, kind };
        })
        .filter(Boolean)
        .slice(0, 2);
    if (entries.length === 0) return;

    const claimed = claimAuditSource(lootAudit, dispatch, 'gear', 'Gear-handoff audit');
    if (!claimed) return;
    const { state } = claimed;

    let applied = 0;
    for (const entry of entries) {
        const companion = (state?.party || []).find(c => companionNameMatches(c.name, entry.companion));
        if (!companion || companion.status === 'dead') continue;
        if (entry.kind === 'keepsake') {
            dispatch({ type: 'UPDATE_COMPANION', payload: { id: companion.id, keepsake: entry.item } });
            applied += 1;
            continue;
        }
        const owned = (state?.inventory || []).find(
            i => String(i?.name || '').trim().toLowerCase() === entry.item.toLowerCase(),
        );
        if (owned) {
            // The reducer announces, derives mechanics, and removes the item.
            dispatch({ type: 'GIVE_GEAR_TO_COMPANION', payload: { itemId: owned.id, companionId: companion.id } });
            applied += 1;
        } else if (entry.kind === 'weapon') {
            // Narrated-only weapon the engine never tracked: stats still follow
            // the fiction (UPDATE_COMPANION derives dice and announces).
            dispatch({ type: 'UPDATE_COMPANION', payload: { id: companion.id, weapon: entry.item } });
            applied += 1;
        }
    }
    if (applied > 0) console.log(`[Scribe] Gear-handoff audit applied ${applied} narrated handoff(s).`);
}

/** Coin totals (in copper) the event path already applied for this narration.
 * Purchases/sales carry an explicit priceCp only when the DM supplied one; the
 * conservative direction is to count what we can see — the audit then under-
 * corrects rather than double-charges. */
function appliedCoinCp(events) {
    const n = value => (Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);
    if (!events) return { gainCp: 0, lossCp: 0 };
    let gainCp = n(events.goldFound) * 100 + n(events.silverFound) * 10 + n(events.copperFound);
    let lossCp = n(events.goldLost) * 100 + n(events.silverLost) * 10 + n(events.copperLost);
    for (const purchase of events.purchases || []) lossCp += n(purchase?.priceCp);
    for (const sale of events.sells || []) gainCp += n(sale?.priceCp);
    return { gainCp, lossCp };
}

const auditItemToken = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const itemTokenSet = value => tokenSet(String(value || ''), { minLength: 2 });

/**
 * Item identity match for the whole audit family: exact compact-token equality
 * OR symmetric meaningful-token containment, so the narrative's "hempen rope"
 * matches the catalog's "Hempen Rope (50 ft)" and "wax candles" matches "Wax
 * Candles (x5)". Live playtest 2026-08-20: exact-only matching let a purchase
 * turn's Scribe re-report mint lowercase duplicate inventory rows the load-time
 * heal could not merge back. Under-matching mints phantom duplicates; over-
 * matching merely skips a grant — the documented safe direction for audits.
 */
function itemIdentityMatches(a, b) {
    const compactA = auditItemToken(a);
    const compactB = auditItemToken(b);
    if (compactA && compactA === compactB) return true;
    const setA = itemTokenSet(a);
    const setB = itemTokenSet(b);
    return setA.size > 0 && setB.size > 0 && containment(setA, setB) >= 0.99;
}

/** True when any identity string in the pool matches the narrated item. */
function matchesAnyItemIdentity(item, identities) {
    return identities.some(value =>
        itemIdentityMatches(item.name, value) || (item.itemKey && itemIdentityMatches(item.itemKey, value)));
}

/** Identity strings for every item the event path already granted this narration. */
function appliedItemIdentities(events) {
    const identities = [];
    const add = entry => {
        if (!entry) return;
        const values = typeof entry === 'string'
            ? [entry]
            : [entry.name, entry.itemKey, entry.key, entry.item?.name, entry.item?.itemKey];
        for (const value of values) {
            if (value && String(value).trim()) identities.push(String(value));
        }
    };
    for (const list of [events?.itemsFound, events?.startingItems, events?.purchases]) {
        (list || []).forEach(add);
    }
    return identities;
}

/**
 * Reconcile the Scribe's narrated-loot OBSERVATION against the events the engine
 * already applied for this narration. The Scribe reports full narrated totals;
 * the accounting happens HERE, in code — the old contract asked the LLM to report
 * "only the shortfall" and its arithmetic failures were a live double-grant/
 * double-charge source (2026-07-31). Coin recovery is all-or-nothing: if the
 * event path applied ANY coin gain for this narration, the DM demonstrably
 * evented the grant and owns its amount — no top-ups (the same-day playtest
 * showed change-making narrations make gross-vs-net amounts ambiguous to the
 * Scribe). Idempotent per sourceId via CLAIM_LOOT_SOURCE, clamped by the engine,
 * and announced with a visible system message so the player sees every correction.
 */
function reconcileNarratedLoot(narrated, lootAudit, dispatch) {
    if (!narrated || typeof narrated !== 'object') return;
    const gold = coerceLootAmount(narrated.gold);
    const silver = coerceLootAmount(narrated.silver);
    const copper = coerceLootAmount(narrated.copper);
    const items = (Array.isArray(narrated.items) ? narrated.items : [])
        .map(entry => {
            const name = String((typeof entry === 'string' ? entry : entry?.name) || '').trim().slice(0, 80);
            if (!name) return null;
            const quantity = coerceLootAmount(typeof entry === 'object' ? entry.quantity : 1, 20) || 1;
            const itemKey = typeof entry === 'object' && entry.itemKey ? String(entry.itemKey).slice(0, 60) : null;
            return { name, quantity, ...(itemKey && { itemKey }) };
        })
        .filter(Boolean)
        .slice(0, 4);
    if (gold <= 0 && silver <= 0 && copper <= 0 && items.length === 0) return;

    const claimed = claimAuditSource(lootAudit, dispatch, '', 'Loot audit');
    if (!claimed) return;
    const { state, sourceId } = claimed;
    const { appliedEvents } = lootAudit;

    const narratedCp = gold * 100 + silver * 10 + copper;
    // Stand-down rule: the coin audit acts ONLY on coin-silent narrations. Any
    // applied coin GAIN means the DM evented this grant and owns its amount —
    // recover coins only on PURE omission, in the narrated denominations. Any
    // applied coin LOSS stands the gain-side down too (live playtest 2026-08-20
    // direction bug, mirrored): on a payment-shaped turn a Scribe-reported coin
    // GAIN is change-making or the hero's own outgoing coins read backwards —
    // minting it would silently refund the payment.
    const { gainCp, lossCp } = appliedCoinCp(appliedEvents);
    const coinShortfallCp = (gainCp > 0 || lossCp > 0) ? 0 : narratedCp;
    if (narratedCp > 0 && gainCp > 0) {
        console.log(`[Scribe] Loot audit: event path already applied a ${gainCp} cp gain for this narration — standing down on coins.`);
    } else if (narratedCp > 0 && lossCp > 0) {
        console.log(`[Scribe] Loot audit: event path applied a ${lossCp} cp loss for this narration — payment-shaped turn, treating the reported coin gain as direction confusion and standing down on coins.`);
    }

    const knownIdentities = appliedItemIdentities(appliedEvents);
    // Cross-message ledger check (live playtest #8): the same-message stand-down
    // above cannot see a RE-narration — "you tuck the pages away" one turn after
    // the pages were evented re-granted them because audit ADD_ITEMs deliberately
    // carry no _meta (the announcement line must never claim more than it did).
    // So the dedupe happens HERE: an item identity the recentItemGrants ledger
    // shows applied within its window is a recount, not a missing grant. Window
    // mirrors RECENT_ITEM_GRANT_MESSAGE_WINDOW in state/handlers/inventory.js.
    const ITEM_GRANT_LEDGER_WINDOW = 4;
    const recentGrantIdentities = [];
    const currentIndex = (state?.messages || []).length;
    for (const entry of state?.recentItemGrants || []) {
        if (entry?.status !== 'applied') continue;
        const distance = conversationalDistance(state.messages, entry.messageIndex, currentIndex);
        if (!(distance >= 0 && distance <= ITEM_GRANT_LEDGER_WINDOW)) continue;
        for (const value of [entry.name, entry.itemKey]) {
            if (value && String(value).trim()) recentGrantIdentities.push(String(value));
        }
    }
    const missingItems = items.filter(item => {
        const alreadyApplied = matchesAnyItemIdentity(item, knownIdentities);
        const recentlyGranted = matchesAnyItemIdentity(item, recentGrantIdentities);
        if (alreadyApplied) console.warn(`[Scribe] Narrated item "${item.name}" already granted by the event path; skipping.`);
        else if (recentlyGranted) console.warn(`[Scribe] Narrated item "${item.name}" was already granted moments ago (ledger); skipping.`);
        return !alreadyApplied && !recentlyGranted;
    });

    // Coins route through the replay-guarded grant so a reward the DM re-narrates on a
    // later turn (already suppressed on the event path) cannot re-enter via the audit.
    // The reducer announces the recovery (or the suppression) itself. Audits never
    // carry playerMessage: the repeat-intent bypass belongs to the DM event path.
    if (coinShortfallCp > 0) {
        dispatch({
            type: 'ADD_COIN_GRANT',
            payload: {
                gold, silver, copper,
                _meta: { sourceId, announce: 'audit', audit: true },
            },
        });
    }
    for (const item of missingItems) dispatch({ type: 'ADD_ITEM', payload: item });

    if (missingItems.length > 0) {
        const parts = missingItems.map(item => (item.quantity > 1 ? `${item.quantity}x ${item.name}` : item.name));
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `**Loot recovered from narration:** ${parts.join(', ')} added to your possessions.`,
            },
        });
    }
    if (coinShortfallCp > 0 || missingItems.length > 0) {
        console.log(`[Scribe] Loot audit recovered: ${coinShortfallCp} cp shortfall, items ${missingItems.length}`);
    }
}

/**
 * Spellcast sibling of reconcileNarratedLoot (queue P1, Codex 2026-08-09): a
 * cast the DM narrates with no spell_cast event is mechanically nonexistent.
 * The audit dispatches the missed CAST_SPELL and the reducer stays the single
 * authority — it validates the spell, spends the slot, rolls healing, posts its
 * own "casts X" line, and its ledger keeps this idempotent (exact sourceId for
 * retries; the nearby-replay window suppresses later re-narrations because
 * audits deliberately carry no playerMessage, so the player-recast bypass never
 * opens for them). Out-of-combat only by design: in-fight casting is exchange
 * territory, and victory narration recaps in-fight casts (no `auditCasts` flag
 * on that path).
 */
function reconcileNarratedCasts(narrated, lootAudit, dispatch) {
    if (!Array.isArray(narrated) || narrated.length === 0) return;
    const { sourceId, getState, appliedEvents } = lootAudit;
    if (!sourceId) return;
    const state = getState?.();
    const character = state?.character;
    if (state?.combat?.active || !isSpellcaster(character?.class)) return;
    const appliedKeys = new Set((appliedEvents?.spellCasts || [])
        .map(cast => resolveSpellForCharacter(character, cast?.spell)?.key)
        .filter(Boolean));
    for (const entry of narrated.slice(0, 2)) {
        const name = String((typeof entry === 'string' ? entry : entry?.spell) || '').trim();
        const spell = resolveSpellForCharacter(character, name);
        if (!spell || !spell.outOfCombatAvailable) continue;
        if (appliedKeys.has(spell.key)) {
            console.warn(`[Scribe] Narrated cast "${spell.name}" already applied by the event path; skipping.`);
            continue;
        }
        const target = typeof entry === 'object' && entry?.target ? String(entry.target).slice(0, 60) : '';
        dispatch({
            type: 'CAST_SPELL',
            payload: {
                spell: spell.name,
                ...(target && { target }),
                _meta: { sourceId: `${sourceId}:cast` },
            },
        });
        console.log(`[Scribe] Cast audit: recovered narrated ${spell.name} the event path missed.`);
    }
}

/**
 * Payment twin of reconcileNarratedLoot: the Scribe reports the TOTAL coins the
 * narrative shows the hero paying out; the engine deducts them ONLY when the
 * event path applied no coin loss at all for this same narration (pure omission
 * recovery). This is what killed the live "paid once, charged twice" bug — the
 * second charge was this audit re-reporting an already-evented payment and
 * slipping past the ledger via the repeat-payment player-phrasing bypass. No
 * partial top-ups either: the 2026-07-31 playtest's ferry toll ("hand over a
 * gold piece, take 8 silver change") showed gross-vs-net payment amounts are
 * ambiguous to the Scribe, so an evented payment's amount is the DM's alone.
 * The reducer still clamps the deduction to the purse and posts a visible
 * system line; idempotency is a claimed per-message sourceId, like loot recovery.
 */
function reconcileNarratedPayment(narrated, lootAudit, dispatch) {
    if (!narrated || typeof narrated !== 'object') return;
    const gold = coerceLootAmount(narrated.gold);
    const silver = coerceLootAmount(narrated.silver);
    const copper = coerceLootAmount(narrated.copper);
    if (gold <= 0 && silver <= 0 && copper <= 0) return;

    const claimed = claimAuditSource(lootAudit, dispatch, 'payment', 'Payment audit');
    if (!claimed) return;
    const paymentSourceId = claimed.sourceId;
    const { appliedEvents } = lootAudit;

    const narratedCp = gold * 100 + silver * 10 + copper;
    const { gainCp, lossCp } = appliedCoinCp(appliedEvents);
    if (lossCp > 0) {
        console.log(`[Scribe] Payment audit: event path already applied a ${lossCp} cp loss for this narration — standing down.`);
        return;
    }
    // Direction backstop (live playtest 2026-08-20): "Twenty, like I promised" —
    // Branock counting a REWARD into the hero's hand was reported as the hero
    // paying out, and the engine deducted the coins the DM's own grant had just
    // added, netting the reward to zero. A narration whose event path applied a
    // coin GAIN is reward-shaped; a simultaneous payment report is the same
    // handover read backwards (or a change-making gross amount) — never a
    // genuine unevented charge. Coin audits act only on coin-silent narrations.
    if (gainCp > 0) {
        console.log(`[Scribe] Payment audit: event path applied a ${gainCp} cp gain for this narration — reward-shaped turn, treating the reported payment as direction confusion and standing down.`);
        return;
    }
    // The reducer checks the shared recentCoinLosses ledger for OTHER messages'
    // charges; same-message accounting already happened right here, and audits
    // get no player-phrasing bypass.
    dispatch({
        type: 'AUDIT_COIN_PAYMENT',
        payload: {
            gold, silver, copper,
            _meta: { sourceId: paymentSourceId, audit: true },
        },
    });
    console.log(`[Scribe] Payment audit settled: ${narratedCp} cp (no coin loss was evented for this narration).`);
}

/**
 * Loss twin of reconcileNarratedLoot (queue P2, live playtest #8): the seizure
 * decree narrated the pack "emptied onto the table" with zero items_lost events
 * and the sheet kept everything the story locked away. Observation-only like
 * the whole family: the Scribe reports the items the narrative shows LEAVING
 * the hero's possession; the engine removes each one ONLY when the event path
 * removed nothing matching for this narration AND the hero still owns it —
 * routed through REMOVE_ITEM_BY_NAME, the exact action the items_lost event
 * path uses (whole-stack semantics, AC recompute, so the audit is never more
 * powerful than the DM's own channel). Self-limiting on recaps: an item
 * already removed matches nothing and reports no shortfall. Coins seized
 * alongside ride narrated_payment (one coin-loss lane, one ledger). Idempotent
 * per narration via a claimed `:losses` sourceId; announced visibly.
 */
function reconcileNarratedLosses(narrated, lootAudit, dispatch) {
    const items = (Array.isArray(narrated?.items) ? narrated.items : [])
        .map(entry => String((typeof entry === 'string' ? entry : entry?.name) || '').trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 4);
    if (items.length === 0) return;

    const claimed = claimAuditSource(lootAudit, dispatch, 'losses', 'Loss audit');
    if (!claimed) return;
    const { state } = claimed;
    const { appliedEvents } = lootAudit;

    // Stand-down per item: a loss identity the event path already removed for
    // this narration is the DM's own accounting, not a missing removal.
    const appliedLossIdentities = (appliedEvents?.itemsLost || [])
        .map(entry => (typeof entry === 'string' ? entry : entry?.name))
        .filter(value => value && String(value).trim())
        .map(String);

    const removed = [];
    for (const name of items) {
        if (appliedLossIdentities.some(value => itemIdentityMatches(name, value))) {
            console.warn(`[Scribe] Narrated loss "${name}" already removed by the event path; skipping.`);
            continue;
        }
        // Exact name first; otherwise a fuzzy match is honored only when it is
        // UNAMBIGUOUS — REMOVE_ITEM_BY_NAME takes whole stacks, so "wax candles"
        // matching both a lowercase shadow row and "Wax Candles (x5)" must skip
        // rather than guess which stack the fiction destroyed.
        const inventory = state?.inventory || [];
        let owned = inventory.find(
            item => String(item?.name || '').trim().toLowerCase() === name.toLowerCase(),
        );
        if (!owned) {
            const fuzzy = inventory.filter(item => itemIdentityMatches(name, item?.name));
            if (fuzzy.length === 1) owned = fuzzy[0];
            else if (fuzzy.length > 1) {
                console.warn(`[Scribe] Narrated loss "${name}" matches ${fuzzy.length} owned stacks — ambiguous; skipping.`);
                continue;
            }
        }
        if (!owned) {
            console.warn(`[Scribe] Narrated loss "${name}" matches nothing the hero owns; skipping.`);
            continue;
        }
        dispatch({ type: 'REMOVE_ITEM_BY_NAME', payload: owned.name });
        removed.push(owned.name);
    }

    if (removed.length > 0) {
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `**Losses recorded from narration:** ${removed.join(', ')} removed from your possessions.`,
            },
        });
        console.log(`[Scribe] Loss audit removed ${removed.length} narrated loss(es) the event path missed.`);
    }
}

/**
 * Run the whole audit family over one parsed Scribe report. lootAudit gates
 * the family (no source id, no audits); castAudit additionally gates the
 * spellcast audit (victory narration and mid-combat prose never set it).
 */
export function runNarrationAudits(extracted, { lootAudit, castAudit } = {}, dispatch) {
    if (!lootAudit) return;
    reconcileNarratedLoot(extracted.narrated_loot, lootAudit, dispatch);
    reconcileNarratedPayment(extracted.narrated_payment, lootAudit, dispatch);
    reconcileNarratedLosses(extracted.narrated_losses, lootAudit, dispatch);
    applyMissingGearHandoffs(extracted.missing_gear_handoffs, lootAudit, dispatch);
    if (castAudit) reconcileNarratedCasts(extracted.narrated_casts, lootAudit, dispatch);
}