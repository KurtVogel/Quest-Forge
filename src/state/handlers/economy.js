/**
 * Coin and trade: every movement is judged against the one transaction log
 * (state/handlers/ledger.js — the judge; engine/transactionLedger.js — the
 * log) before anything moves: coin grants and losses, the Scribe payment
 * audit, atomic purchases and sales, and the player's "Narrated, not
 * recorded" confirmations.
 */
import { MAX_ITEM_QUANTITY, normalizeItem, normalizeItemKey, toFiniteNumber } from '../../data/items.js';
import { addCurrency, characterCurrencyToCopper, formatCurrency, spendCurrency } from '../../engine/currency.js';
import { MAX_COIN_EVENT } from '../../config/contentLimits.js';
import { shouldAutoEquip } from '../../engine/equipment.js';
import {
    addOrStackItem,
    consumeItem,
    stackOverflow,
    resolveInventoryItemRef,
    mintOwnedItem,
    systemMessage,
    withInventoryAndAC,
} from './shared.js';
import { judgeAuditPayment, judgeCoinIn, judgeCoinOut, judgePurchase, judgeSale, ledgerContext, logMovement } from './ledger.js';
import { handlers as inventoryHandlers } from './inventory.js';

export { playerMessageNamesAmount } from './ledger.js';

// One transaction event is bounded like coin grants are: quantity so a flat priceCp
// cannot mint an arbitrary stack, sale proceeds to the same 10,000 gp ceiling as
// clampCoinAmount — a hallucinated "motivated buyer" must not inject a fortune.
const MAX_PURCHASE_QUANTITY = 100;
const MAX_SALE_PROCEEDS_CP = 1000000;

function buildPurchaseTransaction(payload = {}) {
    const root = payload && typeof payload === 'object'
        ? payload
        : { name: String(payload || '') };
    const rawWithMeta = root.item && typeof root.item === 'object'
        ? { ...root.item }
        : root.item
            ? { name: String(root.item) }
            : { ...root };
    const { _meta: _rawMeta, ...raw } = rawWithMeta;
    const textOrNull = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    const itemKeyRef = textOrNull(raw.itemKey) || textOrNull(root.itemKey) || textOrNull(raw.key) || textOrNull(root.key);
    const nameRef = textOrNull(raw.name) || textOrNull(root.name);
    const item = normalizeItem({
        ...raw,
        itemKey: itemKeyRef || undefined,
        name: nameRef || undefined,
        quantity: root.quantity || raw.quantity || 1,
    });
    // priceCp is a flat total the DM supplies, independent of quantity — an unbounded
    // quantity would mint an arbitrary stack for a trivial fixed price. Negative or
    // fractional prices are hostile input on the same boundary. Numeric strings
    // coerce like the coin clamp (2026-09-12 P2: `priceCp: "50"` bought at
    // catalog price, the DM's own price silently dropped).
    const quantity = Math.max(1, Math.min(MAX_PURCHASE_QUANTITY, Math.trunc(item.quantity || 1)));
    const rootPriceCp = toFiniteNumber(root.priceCp);
    const rawPriceCp = rootPriceCp !== null
        ? rootPriceCp
        : Number.isFinite(item.valueCp)
            ? item.valueCp * quantity
            : 0;
    const priceCp = Math.max(0, Math.trunc(rawPriceCp));
    // An itemKey the catalog does not know, after every fuzzy rung (the
    // inverted-word-order typo now resolves). With no name beside it the DM
    // named nothing the engine can sell back or the player can use — refused
    // visibly, naming the key, so the DM re-emits with a name or a real key
    // (2026-09-25 inventory-economy P2: three of six purchases in one measured
    // response bought "Unknown item", two of them for 100 gp).
    const unknownKey = itemKeyRef && !normalizeItemKey(itemKeyRef) ? itemKeyRef.slice(0, 60) : null;
    // An off-catalog row bought at a stated price remembers its unit price
    // (grand playtest 2026-10-02): without it SELL_ITEM valued the row at
    // half of nothing — "Claw Hammer" bought for coin sold back for 0 cp
    // while the DM narrated four silver changing hands.
    const pricedItem = (!Number.isFinite(item.valueCp) || item.valueCp <= 0) && priceCp > 0
        ? { ...item, valueCp: Math.floor(priceCp / quantity) }
        : item;
    return {
        item: pricedItem,
        quantity,
        priceCp,
        // A purchase with no item name or key (`item: []` spread to `{}`) used
        // to buy "Unknown item" for the stated price — refused visibly instead.
        nameless: (!itemKeyRef || !!unknownKey) && !nameRef,
        unknownKey,
    };
}


// Every coin/trade line this module posts is a purse receipt the DM must see:
// tagged dmVisible so buildMessageWindow keeps it in the LLM history (2026-08-31
// P1 — the DM was structurally blind to engine coin accounting, so a reward the
// victory audit banked invisibly got re-emitted at quest completion and paid
// twice).
function coinLine(content) {
    return systemMessage(content, { dmVisible: true });
}

function clampCoinAmount(value) {
    return Number.isFinite(value) ? Math.max(0, Math.min(MAX_COIN_EVENT, Math.trunc(value))) : 0;
}

/** The one ceiling of a coin EVENT, in copper: MAX_COIN_EVENT gold. */
const MAX_COIN_EVENT_CP = MAX_COIN_EVENT * 100;

/**
 * The three clamped denominations of a coin payload, and whether they move
 * anything. The ceiling is on the EVENT, not on each denomination (2026-10-20
 * inventory-economy P2): three maxed denominations used to pay 11,100 gp
 * against the documented 10,000. Over the ceiling the event is reduced to
 * exactly MAX_COIN_EVENT gold — the clamp lands on the gold column, the
 * smaller coins are dropped with it (the signature is by value anyway).
 */
function coinAmounts(payload) {
    const gold = clampCoinAmount(payload?.gold);
    const silver = clampCoinAmount(payload?.silver);
    const copper = clampCoinAmount(payload?.copper);
    const totalCp = gold * 100 + silver * 10 + copper;
    if (totalCp > MAX_COIN_EVENT_CP) {
        return { gold: MAX_COIN_EVENT, silver: 0, copper: 0, totalCp: MAX_COIN_EVENT_CP };
    }
    return { gold, silver, copper, totalCp };
}

/**
 * A bought shield or armor fills an empty slot like a found one (2026-10-20
 * inventory-economy P2): ADD_ITEM and the load heal shared the one auto-equip
 * since 10-07 while PURCHASE_ITEM minted unequipped, so the hero's AC after
 * buying a shield depended on whether they had reloaded since (11 until the
 * next Continue, 13 after). Three writers, one rule.
 */
function autoEquipped(inventory, newItem) {
    return shouldAutoEquip(inventory, newItem) ? { ...newItem, equipped: true } : newItem;
}

const isEmptyCoin = ({ gold, silver, copper }) => gold <= 0 && silver <= 0 && copper <= 0;
const coinsOf = (cp) => ({ gold: 0, silver: 0, copper: cp, totalCp: cp });

/** Purse total after a movement, so every coin line is self-reconciling. */
function purseLine(character) {
    return formatCurrency(characterCurrencyToCopper(character));
}

const itemRef = (item, quantity) => ({ name: item.name, itemKey: item.itemKey, quantity });
const withParty = (twin, word) => (twin?.party ? ` ${word} ${twin.party}` : '');
const itemsOf = (entry) => (entry?.itemsOut?.length ? entry.itemsOut : entry?.itemsIn || []).map(item => item.name).join(', ');

/**
 * The one suppression return: the CLAIM enters the log as `ignored` (so a
 * re-emission of the re-emission is still a replay) and the reason is posted
 * as a purse receipt the DM reads.
 */
function ignore(state, ctx, fields, line) {
    return {
        ...state,
        ledger: logMovement(state, ctx, { ...fields, status: 'ignored' }),
        messages: [...state.messages, coinLine(line)],
    };
}

const GRANT_LINES = {
    duplicate: (name, twin) => `Duplicate coin grant ignored — ${name} was already received${withParty(twin, 'from')} moments ago.`,
    cover: (name) => `Duplicate coin grant ignored — ${name} repeats rewards already received moments ago.`,
    echo: (name) => `Coin recovery ignored — ${name} matches a payment you just made; treated as the same handover retold.`,
    sameSale: (name, twin) => `Duplicate coin grant ignored — ${name} is the payout of the sale in this same turn (${itemsOf(twin) || 'sold goods'}).`,
    saleCover: (name, twin) => `Duplicate coin grant ignored — ${name} was already paid out when you sold ${itemsOf(twin) || 'that'}.`,
};

const PAYMENT_LINES = {
    duplicate: (name) => `**Duplicate payment ignored:** ${name} was already deducted moments ago.`,
    cover: (name) => `**Duplicate payment ignored:** ${name} repeats payments already taken moments ago.`,
    purchaseCover: (name, twin) => `**Duplicate payment ignored:** ${name} was already paid when you bought ${itemsOf(twin) || 'that'}.`,
    echo: (name) => `**Payment report ignored:** ${name} matches coins you just received — treated as the same handover, not a new charge.`,
};

export const handlers = {
    // One coin grant (found / received coins) judged against the transaction
    // log (state/handlers/ledger.js): a reward the DM re-emits while the pouch
    // is counted, split or recapped — or the audit re-reports — pays once.
    ADD_COIN_GRANT(state, action) {
        const meta = action.payload?._meta || {};
        const amounts = coinAmounts(action.payload);
        if (isEmptyCoin(amounts)) return state;
        const ctx = ledgerContext(state, meta);
        const name = formatCurrency(amounts.totalCp);
        const verdict = judgeCoinIn(state, ctx, amounts);
        if (verdict.suppress) {
            return ignore(state, ctx, { kind: 'coin', cp: amounts.totalCp }, GRANT_LINES[verdict.suppress](name, verdict.twin));
        }
        const bundled = verdict.bundled;
        const grant = bundled ? bundled.remainder : amounts;
        // The whole bundle can be an assembly of already-paid pieces (split
        // grants recapped as one total) — then there is nothing left to grant.
        if (bundled && isEmptyCoin(grant)) {
            return ignore(state, ctx, { kind: 'coin', cp: amounts.totalCp }, GRANT_LINES.cover(name));
        }
        const grantCp = grant.gold * 100 + grant.silver * 10 + grant.copper;
        const character = addCurrency(state.character, grant);
        // Coin entering the purse announces itself too — the spend line's twin, so
        // the purse total in chat always matches the sheet.
        return {
            ...state,
            character,
            ledger: logMovement(state, ctx, { kind: 'coin', cp: grantCp }),
            messages: [
                ...state.messages,
                ...(bundled ? [coinLine(`Adjusted a bundled coin grant — ${formatCurrency(bundled.strippedCp)} of it repeats a reward already received moments ago; granted ${formatCurrency(grantCp)}.`)] : []),
                meta.announce === 'audit'
                    ? coinLine(`**Coins recovered from narration:** ${formatCurrency(grantCp)} added to your purse — purse: ${purseLine(character)}.`)
                    : coinLine(`**+${formatCurrency(grantCp)}** received — purse: ${purseLine(character)}.`),
            ],
        };
    },

    // The spend-side twin: one payment, toll, fine, tip or theft the DM evented
    // (or the player confirmed on a "Narrated, not recorded" card).
    APPLY_COIN_LOSS(state, action) {
        const meta = action.payload?._meta || {};
        const amounts = coinAmounts(action.payload);
        if (isEmptyCoin(amounts)) return state;
        const ctx = ledgerContext(state, meta);
        const name = formatCurrency(amounts.totalCp);
        const verdict = judgeCoinOut(state, ctx, amounts);
        if (verdict.suppress === 'purchaseCover') {
            return ignore(state, ctx, { kind: 'coin', cp: -amounts.totalCp },
                `Duplicate coin charge ignored — ${name} was already paid when you bought ${itemsOf(verdict.twin) || 'that'}.`);
        }
        if (verdict.suppress) {
            return ignore(state, ctx, { kind: 'coin', cp: -amounts.totalCp },
                `Duplicate coin charge ignored — ${name} was already paid${withParty(verdict.twin, 'to')} moments ago.`);
        }
        const result = spendCurrency(state.character, amounts);
        if (!result.paid) {
            // An unpayable charge is NOT logged (2026-08-28 P1): no coin moved,
            // and an "applied" spend that never happened would cover a later
            // exact-price purchase (delivered free) or suppress the re-charge.
            return { ...state, messages: [...state.messages, coinLine(`Not enough coin — missing ${formatCurrency(result.missingCp)}.`)] };
        }
        // Coin leaving the purse ALWAYS says so (D6; 2026-08-25 "this happens
        // silently"), with the resulting purse so any leak is legible.
        return {
            ...state,
            character: result.character,
            ledger: logMovement(state, ctx, { kind: 'coin', cp: -amounts.totalCp }),
            messages: [...state.messages, coinLine(`**−${name}** paid — purse: ${purseLine(result.character)}.`)],
        };
    },

    // Scribe payment audit: the narration showed the hero completing a payment
    // no event charged. The dispatched amount is ALREADY reconciled against its
    // own narration (scribeAudits stands down whenever the event path moved
    // coin), so the judge reads only OTHER messages' movements — and gives the
    // audit no player-phrasing bypass but one: a line that NAMES this amount.
    AUDIT_COIN_PAYMENT(state, action) {
        const meta = action.payload?._meta || {};
        const amounts = coinAmounts(action.payload);
        const costCp = amounts.totalCp;
        if (costCp <= 0) return state;
        const ctx = ledgerContext(state, { ...meta, lane: 'audit' });
        const name = formatCurrency(costCp);
        const verdict = judgeAuditPayment(state, ctx, amounts);
        if (verdict.suppress) {
            return ignore(state, ctx, { kind: 'coin', cp: -costCp }, PAYMENT_LINES[verdict.suppress](name, verdict.twin));
        }
        const bundled = verdict.bundled;
        const charge = bundled ? bundled.remainder : amounts;
        if (bundled && isEmptyCoin(charge)) {
            return ignore(state, ctx, { kind: 'coin', cp: -costCp }, PAYMENT_LINES.cover(name));
        }
        const chargeCp = charge.gold * 100 + charge.silver * 10 + charge.copper;
        const strippedNote = bundled
            ? [coinLine(`Adjusted an audited payment — ${formatCurrency(bundled.strippedCp)} of it repeats a payment already taken moments ago.`)]
            : [];
        const result = spendCurrency(state.character, charge);
        if (result.paid) {
            return {
                ...state,
                character: result.character,
                ledger: logMovement(state, ctx, { kind: 'coin', cp: -chargeCp }),
                messages: [...state.messages, ...strippedNote, coinLine(`**Payment settled from narration:** ${formatCurrency(chargeCp)} deducted from your purse.`)],
            };
        }
        const availableCp = chargeCp - result.missingCp;
        if (availableCp <= 0) {
            // Empty purse: nothing moved, so nothing is logged (2026-08-28 P1).
            return {
                ...state,
                messages: [...state.messages, ...strippedNote, coinLine(`**Payment noted from narration:** ${formatCurrency(chargeCp)} was owed, but your purse is empty — nothing deducted.`)],
            };
        }
        // Partial settle: the log holds the value ACTUALLY deducted.
        const partial = spendCurrency(state.character, coinsOf(availableCp));
        return {
            ...state,
            character: partial.character,
            ledger: logMovement(state, ctx, { kind: 'coin', cp: -availableCp }),
            messages: [
                ...state.messages,
                ...strippedNote,
                coinLine(`**Payment settled from narration:** ${formatCurrency(availableCp)} deducted (purse emptied; ${formatCurrency(result.missingCp)} short of the narrated ${formatCurrency(chargeCp)}).`),
            ],
        };
    },

    PURCHASE_ITEM(state, action) {
        const transaction = buildPurchaseTransaction(action.payload);
        const { item, quantity, priceCp } = transaction;
        if (transaction.nameless) {
            return {
                ...state,
                messages: [
                    ...state.messages,
                    coinLine(transaction.unknownKey
                        ? `Purchase ignored — "${transaction.unknownKey}" is not a catalog itemKey and no item name was given (${formatCurrency(priceCp)} not charged). Use a catalog key or a plain name.`
                        : `Purchase ignored — the DM named no item to buy (${formatCurrency(priceCp)} not charged).`),
                ],
            };
        }
        const meta = action.payload?._meta || {};
        const ctx = ledgerContext(state, meta);
        const claim = { kind: 'purchase', cp: -priceCp, itemsIn: [itemRef(item, quantity)] };
        const verdict = judgePurchase(state, ctx, transaction);
        if (verdict.suppress) {
            return ignore(state, ctx, claim, `Duplicate purchase ignored — ${item.name} was already bought recently.`);
        }
        const label = `${quantity > 1 ? `${quantity}x ` : ''}${item.name}`;
        // Both halves already happened as loose events (the price as a coin
        // loss, the goods as loot): this purchase is that trade retold.
        if (verdict.coinTwin && verdict.itemTwin) {
            return ignore(state, ctx, claim, `Duplicate purchase ignored — ${item.name} was already paid for and received moments ago.`);
        }
        const newItem = autoEquipped(state.inventory, mintOwnedItem(item, { quantity }));
        // The price already left as loose coin: deliver the goods WITHOUT
        // charging again — suppressing the whole event would swallow the item.
        if (verdict.coinTwin) {
            const delivered = {
                ...state,
                ledger: logMovement(state, ctx, { ...claim, movedCp: 0 }),
                messages: [...state.messages, coinLine(`${label} added — its ${formatCurrency(priceCp)} was already paid moments ago; purse unchanged at ${purseLine(state.character)}.`)],
            };
            return withInventoryAndAC(delivered, addOrStackItem(state.inventory, newItem));
        }
        // The stack ceiling (2026-09-25): a purchase none of which fits is
        // refused before any coin moves; a partial fit is bought (the DM's
        // priceCp is a flat total, not pro-rated) and the discard is visible.
        const overflow = verdict.itemTwin ? 0 : stackOverflow(state.inventory, newItem);
        if (overflow >= quantity) {
            return { ...state, messages: [...state.messages, coinLine(`Cannot buy ${item.name} — the stack is full at ${MAX_ITEM_QUANTITY}; nothing charged.`)] };
        }
        const payment = spendCurrency(state.character, priceCp);
        if (!payment.paid) {
            return { ...state, messages: [...state.messages, coinLine(`Cannot buy ${item.name} — price is ${formatCurrency(priceCp)}, missing ${formatCurrency(payment.missingCp)}.`)] };
        }
        // The goods already arrived as loot: the price is owed, the item is not
        // owed twice (a purchase retold after an items_found — 2026-11-01).
        if (verdict.itemTwin) {
            return {
                ...state,
                character: payment.character,
                ledger: logMovement(state, ctx, { ...claim, itemsMoved: false }),
                messages: [...state.messages, coinLine(`Paid ${formatCurrency(priceCp)} for ${label} — it already reached your pack moments ago, so no second one was added; purse: ${purseLine(payment.character)}.`)],
            };
        }
        // The purchase receipt carries the purse like the coin lines do
        // (2026-09-25): the DM reads what the hero has left from ONE line.
        const nextState = {
            ...state,
            character: payment.character,
            ledger: logMovement(state, ctx, claim),
            messages: [
                ...state.messages,
                coinLine(`Bought ${label} for ${formatCurrency(priceCp)} — purse: ${purseLine(payment.character)}.`),
                ...(overflow > 0 ? [coinLine(`${item.name} stack is full at ${MAX_ITEM_QUANTITY} — ${overflow} of the ${quantity} bought could not be carried.`)] : []),
            ],
        };
        return withInventoryAndAC(nextState, addOrStackItem(state.inventory, newItem));
    },

    SELL_ITEM(state, action) {
        // Atomic sale (DM-driven, at a merchant). Find the item, remove the sold
        // quantity, and add the proceeds. Default proceeds are half the catalog value
        // per unit; the DM may override priceCp (total) to model haggling, a stingy
        // fence, or a motivated buyer.
        const payload = action.payload || {};
        const ref = payload.itemId || payload.itemKey || payload.name || '';
        // Same resolution ladder as equip/remove (2026-08-28 audit), reading
        // `ambiguous` like REMOVE_ITEM_BY_NAME (2026-10-20 P2).
        const { item, ambiguous } = resolveInventoryItemRef(state.inventory, payload);
        if (!item) {
            return {
                ...state,
                messages: [...state.messages, coinLine(ambiguous > 1
                    ? `Can't sell "${ref}" — it matches ${ambiguous} different stacks; say which one.`
                    : `Can't sell "${ref}" — it's not in your inventory.`)],
            };
        }
        // Finite + trunc (2026-09-03 P2); "all" sells the whole stack (2026-09-12 P2).
        const heldQuantity = Math.max(1, Math.trunc(item.quantity || 1));
        const sellsAll = typeof payload.quantity === 'string' && payload.quantity.trim().toLowerCase() === 'all';
        const requestedQuantity = sellsAll ? heldQuantity : toFiniteNumber(payload.quantity);
        const quantity = Math.max(1, Math.min(heldQuantity, requestedQuantity !== null ? Math.trunc(requestedQuantity) : 1));
        // Proceeds share the coin-grant ceiling whichever path priced them.
        const overridePriceCp = toFiniteNumber(payload.priceCp);
        // No price the engine can see is refused, the item kept (grand
        // playtest 2026-10-02); the receipt lets the DM re-emit it priced.
        if (overridePriceCp === null && !(Number.isFinite(item.valueCp) && item.valueCp > 0)) {
            return {
                ...state,
                messages: [...state.messages, coinLine(`${item.name} not sold — the engine has no price for it (no catalog value, and the sale named none); it stays in your pack.`)],
            };
        }
        const proceedsCp = Math.min(MAX_SALE_PROCEEDS_CP, overridePriceCp !== null
            ? Math.max(0, Math.trunc(overridePriceCp))
            : Math.floor((item.valueCp || 0) / 2) * quantity);
        const ctx = ledgerContext(state, payload._meta || {});
        const claim = { kind: 'sale', cp: proceedsCp, itemsOut: [itemRef(item, quantity)] };
        const verdict = judgeSale(state, ctx, item, quantity, proceedsCp);
        if (verdict.suppress) {
            return ignore(state, ctx, claim, `Duplicate sale ignored — ${item.name} was already sold recently.`);
        }
        const label = `${quantity > 1 ? `${quantity}x ` : ''}${item.name}`;
        // The proceeds already arrived as loose found coin: the goods leave,
        // the money is not paid twice.
        if (verdict.coinTwin) {
            const settled = {
                ...state,
                ledger: logMovement(state, ctx, { ...claim, movedCp: 0 }),
                messages: [...state.messages, coinLine(`Sold ${label} — its ${formatCurrency(proceedsCp)} was already paid moments ago; purse unchanged at ${purseLine(state.character)}.`)],
            };
            return withInventoryAndAC(settled, consumeItem(state.inventory, item.id, quantity));
        }
        const character = addCurrency(state.character, { copper: proceedsCp });
        const nextState = {
            ...state,
            character,
            ledger: logMovement(state, ctx, claim),
            messages: [...state.messages, coinLine(`Sold ${label} for ${formatCurrency(proceedsCp)} — purse: ${purseLine(character)}.`)],
        };
        return withInventoryAndAC(nextState, consumeItem(state.inventory, item.id, quantity));
    },

    /**
     * "Narrated, not recorded" (2026-11-01): the Scribe saw a movement in a
     * reply the DM DID event, and one accountant per narration keeps the
     * audit from booking it on its own. The card asks the player; their
     * answer is the player lane — logged, never second-guessed. Payload:
     * { messageId, accept }.
     */
    RESOLVE_RECOVERY(state, action) {
        const { messageId, accept } = action.payload || {};
        const index = (state.messages || []).findIndex(message => message?.id === messageId && message.kind === 'recovery');
        if (index === -1) return state;
        const card = state.messages[index];
        const recovery = card.recovery || {};
        if (recovery.status !== 'open') return state;
        const marked = (base, status) => ({
            ...base,
            messages: base.messages.map((message, i) => (i === index ? { ...message, recovery: { ...recovery, status } } : message)),
        });
        if (accept !== true) return marked(state, 'dismissed');
        let next = marked(state, 'accepted');
        const meta = { lane: 'player', sourceId: `${messageId}:recovery`, party: recovery.party || '' };
        const coinCp = Math.max(0, Math.trunc(Number(recovery.coinCp) || 0));
        const items = Array.isArray(recovery.items) ? recovery.items.slice(0, 4) : [];
        if (recovery.direction === 'out') {
            if (coinCp > 0) next = handlers.APPLY_COIN_LOSS(next, { payload: { copper: coinCp, _meta: meta } });
            for (const entry of items) {
                next = inventoryHandlers.REMOVE_ITEM_BY_NAME(next, { payload: { name: entry.name, ...(entry.quantity > 1 && { quantity: entry.quantity }), _meta: meta } });
            }
        } else {
            if (coinCp > 0) next = handlers.ADD_COIN_GRANT(next, { payload: { copper: coinCp, _meta: meta } });
            for (const entry of items) {
                next = inventoryHandlers.ADD_ITEM(next, { payload: { ...entry, _meta: meta } });
            }
        }
        return next;
    },
};
