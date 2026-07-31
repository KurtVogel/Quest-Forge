/**
 * Coin and trade: replay-guarded coin grants/losses, the Scribe payment audit,
 * and one-shot purchase/sale transactions.
 */
import { normalizeItem, normalizeItemKey } from '../../data/items.js';
import { addCurrency, formatCurrency, spendCurrency } from '../../engine/currency.js';
import { MAX_COIN_EVENT } from '../../config/contentLimits.js';
import { conversationalDistance } from '../../engine/replayLedger.js';
import {
    consumeItem,
    currentMessageIndex,
    mintOwnedItem,
    normalizeRecentTransactions,
    normalizeRefToken,
    RECENT_TRANSACTION_LIMIT,
    REPEAT_TRANSACTION_RE,
    sanitizeRecentTransaction,
    systemMessage,
    withInventoryAndAC,
} from './shared.js';

const RECENT_TRANSACTION_MESSAGE_WINDOW = 8;
// One transaction event is bounded like coin grants are: quantity so a flat priceCp
// cannot mint an arbitrary stack, sale proceeds to the same 10,000 gp ceiling as
// clampCoinAmount — a hallucinated "motivated buyer" must not inject a fortune.
const MAX_PURCHASE_QUANTITY = 100;
const MAX_SALE_PROCEEDS_CP = 1000000;
const PURCHASE_VERB_RE = /\b(buy|buys|buying|bought|purchase|purchases|purchasing|purchased|pay|pays|paying|paid|order|orders|ordering|ordered|take|takes|taking|grab|grabs|grabbing|get|gets|getting)\b/i;
const SALE_VERB_RE = /\b(sell|sells|selling|sold|pawn|pawns|pawning|pawned|trade|trades|trading|traded|offer|offers|offering|offered|unload|unloads|unloading|fence|fences|fencing|fenced)\b/i;

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
    const item = normalizeItem({
        ...raw,
        itemKey: raw.itemKey || root.itemKey || raw.key || root.key,
        name: raw.name || root.name,
        quantity: root.quantity || raw.quantity || 1,
    });
    // priceCp is a flat total the DM supplies, independent of quantity — an unbounded
    // quantity would mint an arbitrary stack for a trivial fixed price. Negative or
    // fractional prices are hostile input on the same boundary.
    const quantity = Math.max(1, Math.min(MAX_PURCHASE_QUANTITY, Math.trunc(item.quantity || 1)));
    const rawPriceCp = Number.isFinite(root.priceCp)
        ? root.priceCp
        : Number.isFinite(item.valueCp)
            ? item.valueCp * quantity
            : 0;
    const priceCp = Math.max(0, Math.trunc(rawPriceCp));
    const identity = normalizeItemKey(item.itemKey || item.key || item.name)
        || normalizeRefToken(item.itemKey || item.name);
    return {
        item,
        quantity,
        priceCp,
        signature: `${identity || normalizeRefToken(item.name)}|${quantity}|${Math.max(0, Math.trunc(priceCp))}`,
    };
}

/** Base narration-message id of a compound sourceId ("msg-1:scribe-loot:payment" → "msg-1"). */
function sourceBaseOf(sourceId) {
    return String(sourceId || '').split(':')[0];
}

function findRecentTransactionDuplicate(entries, transaction, sourceId, currentIndex, window = RECENT_TRANSACTION_MESSAGE_WINDOW, messages = null, { excludeSameBase = false } = {}) {
    const base = sourceBaseOf(sourceId);
    return normalizeRecentTransactions(entries)
        .slice()
        .reverse()
        .find(entry => {
            if (entry.signature !== transaction.signature) return false;
            if (sourceId && entry.sourceId === sourceId) return true;
            // Audit dispatches arrive already reconciled against their own narration
            // message's applied events (scribe.js does the subtraction in code), so a
            // same-base entry is the portion the engine already accounted for — not a
            // duplicate of this dispatch. Without this, a genuine engine-computed
            // shortfall that happens to equal the event-path amount would be eaten.
            if (excludeSameBase && base && sourceBaseOf(entry.sourceId) === base) return false;
            const distance = messages
                ? conversationalDistance(messages, entry.messageIndex, currentIndex)
                : currentIndex - entry.messageIndex;
            return distance >= 0 && distance <= window;
        }) || null;
}

function rememberTransaction(entries, transaction, sourceId, messageIndex, status = 'applied') {
    const record = sanitizeRecentTransaction({
        signature: transaction.signature,
        itemKey: transaction.item.itemKey,
        name: transaction.item.name,
        quantity: transaction.quantity,
        priceCp: transaction.priceCp,
        sourceId,
        messageIndex,
        timestamp: Date.now(),
        status,
    });
    if (!record) return normalizeRecentTransactions(entries);
    const previous = normalizeRecentTransactions(entries)
        .filter(entry => !(entry.signature === record.signature && entry.sourceId === record.sourceId));
    return [...previous, record].slice(-RECENT_TRANSACTION_LIMIT);
}

// Coin grants replay in a tighter window than purchases: the observed failure is the DM
// re-emitting a reward on the very next turn while narrating the pouch being counted or
// split. Two identical legitimate finds four+ messages apart stay untouched.
const RECENT_COIN_GRANT_MESSAGE_WINDOW = 4;
const COIN_WORD_RE = /\b(gold|silver|copper|coins?|gp|sp|cp|payment|reward|wages?|bounty|purse)\b/i;

function clampCoinAmount(value) {
    return Number.isFinite(value) ? Math.max(0, Math.min(MAX_COIN_EVENT, Math.trunc(value))) : 0;
}

function buildCoinGrantTransaction(gold, silver, copper) {
    const totalCp = gold * 100 + silver * 10 + copper;
    return {
        // Value-based signature: a re-emission with drifted denominations ("12
        // silver" recapped as "1 gold 2 silver") is the SAME grant (2026-07-22).
        signature: `coins|${totalCp}cp`,
        item: { itemKey: 'coin-grant', name: formatCurrency(totalCp) },
        quantity: 1,
        priceCp: totalCp,
    };
}

function playerMessageSupportsRepeatCoinGrant(playerMessage) {
    const text = String(playerMessage || '');
    if (!text.trim()) return false;
    // "another 20 gold", "the rest of my payment" — explicit repeat intent naming coin.
    return REPEAT_TRANSACTION_RE.test(text) && COIN_WORD_RE.test(text);
}

// Coin losses replay in the same tight window as grants: the observed failure
// (live 2026-07-21) is the DM re-emitting a payment's coin loss on the following
// turn while recapping money already taken — the rest_taken/spell_cast echo
// pattern on the spend side.
const RECENT_COIN_LOSS_MESSAGE_WINDOW = 4;
// Verbs that inherently mean handing money over — on their own they show the
// player initiating a (possibly repeat) payment this turn.
const STRONG_PAYMENT_VERB_RE = /\b(pay|pays|paying|paid|repay|repays|repaying|repaid|tip|tips|tipping|tipped|bribe|bribes|bribing|bribed|donate|donates|donating|donated)\b/i;
// Broader transfer verbs count only when the message also names coin.
const COIN_TRANSFER_VERB_RE = /\b(give|gives|giving|gave|hand|hands|handing|handed|toss|tosses|tossing|tossed|drop|drops|dropping|dropped|leave|leaves|leaving|left|slip|slips|slipping|slipped|slide|slides|sliding|slid|spend|spends|spending|spent|count|counts|counting|counted|settle|settles|settling|settled|offer|offers|offering|offered)\b/i;

function buildCoinLossTransaction(gold, silver, copper) {
    const totalCp = gold * 100 + silver * 10 + copper;
    return {
        // Value-based signature — same denomination-drift rule as coin grants.
        signature: `coin-loss|${totalCp}cp`,
        item: { itemKey: 'coin-loss', name: formatCurrency(totalCp) },
        quantity: 1,
        priceCp: totalCp,
    };
}

function playerMessageSupportsRepeatCoinLoss(playerMessage) {
    const text = String(playerMessage || '');
    if (!text.trim()) return false;
    if (STRONG_PAYMENT_VERB_RE.test(text)) return true;
    if (REPEAT_TRANSACTION_RE.test(text) && COIN_WORD_RE.test(text)) return true;
    return COIN_TRANSFER_VERB_RE.test(text) && COIN_WORD_RE.test(text);
}

function playerMessageSupportsRepeatTransaction(item, playerMessage, verbRe) {
    const text = String(playerMessage || '');
    if (!text.trim()) return false;
    if (!verbRe.test(text) && !REPEAT_TRANSACTION_RE.test(text)) return false;

    const compactText = normalizeRefToken(text);
    const tokens = [item.itemKey, item.name]
        .filter(Boolean)
        .map(normalizeRefToken)
        .filter(Boolean);
    if (tokens.some(token => compactText.includes(token))) return true;

    const nameWords = String(item.name || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
    if (nameWords.length > 0 && nameWords.every(word => text.toLowerCase().includes(word))) return true;

    return REPEAT_TRANSACTION_RE.test(text) && /\b(one|it|that|those|these|them|same)\b/i.test(text);
}

export const handlers = {
    // One narrative coin grant (found/received coins) as a single replay-guarded unit.
    // The DM sometimes re-emits an already-paid reward on a later turn while narrating
    // the pouch being counted or split — the recentCoinGrants ledger suppresses an
    // identical grant inside a short message window unless the player explicitly asked
    // for more coin. The Scribe loot audit routes its coin recoveries through here too,
    // so a re-narrated reward cannot sneak back in through the audit backstop.
    ADD_COIN_GRANT(state, action) {
        const meta = action.payload?._meta || {};
        const gold = clampCoinAmount(action.payload?.gold);
        const silver = clampCoinAmount(action.payload?.silver);
        const copper = clampCoinAmount(action.payload?.copper);
        if (gold <= 0 && silver <= 0 && copper <= 0) return state;
        const transaction = buildCoinGrantTransaction(gold, silver, copper);
        const sourceId = String(meta.sourceId || '').slice(0, 160);
        const messageIndex = currentMessageIndex(state);
        // Audit grants are engine-reconciled shortfalls: same-message entries are
        // already subtracted (skip them as duplicates), and no player-phrasing
        // bypass applies — the repeat-intent escape hatch is for the DM event path,
        // where the player explicitly asks for more coin on a later turn.
        const isAudit = meta.audit === true || meta.announce === 'audit';
        const duplicate = findRecentTransactionDuplicate(
            state.recentCoinGrants, transaction, sourceId, messageIndex, RECENT_COIN_GRANT_MESSAGE_WINDOW, state.messages,
            { excludeSameBase: isAudit }
        );
        const exactSourceReplay = !!sourceId && duplicate?.sourceId === sourceId;
        if (duplicate && (exactSourceReplay || isAudit || !playerMessageSupportsRepeatCoinGrant(meta.playerMessage))) {
            return {
                ...state,
                recentCoinGrants: rememberTransaction(state.recentCoinGrants, transaction, sourceId, messageIndex, 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`Duplicate coin grant ignored — ${transaction.item.name} was already received moments ago.`),
                ],
            };
        }
        const messages = meta.announce === 'audit'
            ? [...state.messages, systemMessage(`**Coins recovered from narration:** ${transaction.item.name} added to your purse.`)]
            : state.messages;
        return {
            ...state,
            character: addCurrency(state.character, { gold, silver, copper }),
            recentCoinGrants: rememberTransaction(state.recentCoinGrants, transaction, sourceId, messageIndex),
            messages,
        };
    },

    // The spend-side twin of ADD_COIN_GRANT: one narrative coin loss (payment, toll,
    // fine, tip, theft) as a single replay-guarded unit. The DM tends to re-emit a
    // payment's coin loss on a later turn while recapping or confirming money already
    // taken (live finding 2026-07-21: a 2-silver correction was charged again on the
    // next turn) — the recentCoinLosses ledger suppresses an identical loss inside a
    // short message window unless the player's own message initiates a payment this
    // turn. The Scribe payment audit shares this ledger, so the event path and the
    // audit backstop can never both charge the same narrated payment.
    APPLY_COIN_LOSS(state, action) {
        const meta = action.payload?._meta || {};
        const gold = clampCoinAmount(action.payload?.gold);
        const silver = clampCoinAmount(action.payload?.silver);
        const copper = clampCoinAmount(action.payload?.copper);
        if (gold <= 0 && silver <= 0 && copper <= 0) return state;
        const transaction = buildCoinLossTransaction(gold, silver, copper);
        const sourceId = String(meta.sourceId || '').slice(0, 160);
        const messageIndex = currentMessageIndex(state);
        const duplicate = findRecentTransactionDuplicate(
            state.recentCoinLosses, transaction, sourceId, messageIndex, RECENT_COIN_LOSS_MESSAGE_WINDOW, state.messages
        );
        const exactSourceReplay = !!sourceId && duplicate?.sourceId === sourceId;
        if (duplicate && (exactSourceReplay || !playerMessageSupportsRepeatCoinLoss(meta.playerMessage))) {
            return {
                ...state,
                recentCoinLosses: rememberTransaction(state.recentCoinLosses, transaction, sourceId, messageIndex, 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`Duplicate coin charge ignored — ${transaction.item.name} was already paid moments ago.`),
                ],
            };
        }
        const recentCoinLosses = rememberTransaction(state.recentCoinLosses, transaction, sourceId, messageIndex);
        const result = spendCurrency(state.character, { gold, silver, copper });
        if (!result.paid) {
            return {
                ...state,
                recentCoinLosses,
                messages: [...state.messages, systemMessage(`Not enough coin — missing ${formatCurrency(result.missingCp)}.`)],
            };
        }
        return {
            ...state,
            character: result.character,
            recentCoinLosses,
        };
    },

    // Scribe payment audit: the narrative showed the hero completing a payment that the
    // event path never fully deducted. The dispatched amount is ALREADY the engine-
    // reconciled shortfall for its own narration message (scribe.js subtracts the
    // applied losses in code), so same-base ledger entries are excluded from duplicate
    // matching. Cross-message duplicates suppress UNCONDITIONALLY — the audit is a
    // backstop, never a payer of record, and it gets no player-phrasing bypass: the
    // player's message on an audited turn is the very message that initiated the
    // already-counted payment, so the old bypass fired on exactly the turns being
    // double-charged (live 2026-07-31 "gave 1 gp, charged twice" finding).
    AUDIT_COIN_PAYMENT(state, action) {
        const meta = action.payload?._meta || {};
        const gold = clampCoinAmount(action.payload?.gold);
        const silver = clampCoinAmount(action.payload?.silver);
        const copper = clampCoinAmount(action.payload?.copper);
        const costCp = gold * 100 + silver * 10 + copper;
        if (costCp <= 0) return state;
        const transaction = buildCoinLossTransaction(gold, silver, copper);
        const sourceId = String(meta.sourceId || '').slice(0, 160);
        const messageIndex = currentMessageIndex(state);
        const duplicate = findRecentTransactionDuplicate(
            state.recentCoinLosses, transaction, sourceId, messageIndex, RECENT_COIN_LOSS_MESSAGE_WINDOW, state.messages,
            { excludeSameBase: true }
        );
        if (duplicate) {
            return {
                ...state,
                recentCoinLosses: rememberTransaction(state.recentCoinLosses, transaction, sourceId, messageIndex, 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`**Duplicate payment ignored:** ${formatCurrency(costCp)} was already deducted moments ago.`),
                ],
            };
        }
        const recentCoinLosses = rememberTransaction(state.recentCoinLosses, transaction, sourceId, messageIndex);
        const result = spendCurrency(state.character, { gold, silver, copper });
        if (result.paid) {
            return {
                ...state,
                character: result.character,
                recentCoinLosses,
                messages: [
                    ...state.messages,
                    systemMessage(`**Payment settled from narration:** ${formatCurrency(costCp)} deducted from your purse.`),
                ],
            };
        }
        const availableCp = costCp - result.missingCp;
        if (availableCp <= 0) {
            return {
                ...state,
                recentCoinLosses,
                messages: [
                    ...state.messages,
                    systemMessage(`**Payment noted from narration:** ${formatCurrency(costCp)} was owed, but your purse is empty — nothing deducted.`),
                ],
            };
        }
        const partial = spendCurrency(state.character, { copper: availableCp });
        return {
            ...state,
            character: partial.character,
            recentCoinLosses,
            messages: [
                ...state.messages,
                systemMessage(`**Payment settled from narration:** ${formatCurrency(availableCp)} deducted (purse emptied; ${formatCurrency(result.missingCp)} short of the narrated ${formatCurrency(costCp)}).`),
            ],
        };
    },

    PURCHASE_ITEM(state, action) {
        const transaction = buildPurchaseTransaction(action.payload);
        const { item, quantity, priceCp } = transaction;
        const meta = action.payload?._meta || {};
        const sourceId = String(meta.sourceId || '').slice(0, 160);
        // Pass messages so the window measures conversational distance — without
        // them the helper silently falls back to raw index distance, the exact
        // dice-turn expiry bug fixed for coins on 2026-07-22.
        const duplicate = findRecentTransactionDuplicate(state.recentPurchases, transaction, sourceId, currentMessageIndex(state), RECENT_TRANSACTION_MESSAGE_WINDOW, state.messages);
        const exactSourceReplay = !!sourceId && duplicate?.sourceId === sourceId;
        if (duplicate && (exactSourceReplay || !playerMessageSupportsRepeatTransaction(item, meta.playerMessage, PURCHASE_VERB_RE))) {
            return {
                ...state,
                recentPurchases: rememberTransaction(state.recentPurchases, transaction, sourceId, currentMessageIndex(state), 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`Duplicate purchase ignored — ${item.name} was already bought recently.`),
                ],
            };
        }
        const payment = spendCurrency(state.character, priceCp);
        if (!payment.paid) {
            return {
                ...state,
                messages: [
                    ...state.messages,
                    systemMessage(`Cannot buy ${item.name} — price is ${formatCurrency(priceCp)}, missing ${formatCurrency(payment.missingCp)}.`),
                ],
            };
        }

        const newItem = mintOwnedItem(item, { quantity });

        const nextState = {
            ...state,
            character: payment.character,
            recentPurchases: rememberTransaction(state.recentPurchases, transaction, sourceId, currentMessageIndex(state)),
            messages: [
                ...state.messages,
                systemMessage(`Bought ${quantity > 1 ? `${quantity}x ` : ''}${item.name} for ${formatCurrency(priceCp)}.`),
            ],
        };
        return withInventoryAndAC(nextState, [...state.inventory, newItem]);
    },

    SELL_ITEM(state, action) {
        // Atomic sale (DM-driven, at a merchant). Find the item, remove the sold
        // quantity, and add the proceeds. Default proceeds are half the catalog value
        // per unit; the DM may override priceCp (total) to model haggling, a stingy
        // fence, or a motivated buyer.
        const payload = action.payload || {};
        const ref = payload.itemId || payload.itemKey || payload.name || '';
        const lc = String(ref).toLowerCase();
        const item = state.inventory.find(i =>
            (payload.itemId && i.id === payload.itemId) ||
            (payload.itemKey && i.itemKey === payload.itemKey) ||
            (i.name && i.name.toLowerCase() === lc)
        );
        if (!item) {
            return {
                ...state,
                messages: [...state.messages, systemMessage(`Can't sell "${ref}" — it's not in your inventory.`)],
            };
        }

        const quantity = Math.max(1, Math.min(item.quantity || 1, payload.quantity || 1));
        // Proceeds share the coin-grant ceiling whichever path priced them: the DM's
        // override is unbounded LLM input, and legacy save items may carry an
        // unclamped valueCp.
        const proceedsCp = Math.min(MAX_SALE_PROCEEDS_CP, Number.isFinite(payload.priceCp)
            ? Math.max(0, Math.trunc(payload.priceCp))
            : Math.floor((item.valueCp || 0) / 2) * quantity);

        // Sales get the same one-shot replay protection as purchases: a re-emitted
        // sell event must not remove the item twice or pay out twice.
        const saleTransaction = {
            item: { itemKey: item.itemKey, name: item.name },
            quantity,
            priceCp: proceedsCp,
            signature: `${normalizeItemKey(item.itemKey || item.name) || normalizeRefToken(item.name)}|${quantity}|${proceedsCp}`,
        };
        const saleMeta = payload._meta || {};
        const saleSourceId = String(saleMeta.sourceId || '').slice(0, 160);
        const saleDuplicate = findRecentTransactionDuplicate(state.recentSales, saleTransaction, saleSourceId, currentMessageIndex(state), RECENT_TRANSACTION_MESSAGE_WINDOW, state.messages);
        const exactSaleReplay = !!saleSourceId && saleDuplicate?.sourceId === saleSourceId;
        if (saleDuplicate && (exactSaleReplay || !playerMessageSupportsRepeatTransaction(item, saleMeta.playerMessage, SALE_VERB_RE))) {
            return {
                ...state,
                recentSales: rememberTransaction(state.recentSales, saleTransaction, saleSourceId, currentMessageIndex(state), 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`Duplicate sale ignored — ${item.name} was already sold recently.`),
                ],
            };
        }

        const nextState = {
            ...state,
            character: addCurrency(state.character, { copper: proceedsCp }),
            recentSales: rememberTransaction(state.recentSales, saleTransaction, saleSourceId, currentMessageIndex(state)),
            messages: [
                ...state.messages,
                systemMessage(`Sold ${quantity > 1 ? `${quantity}x ` : ''}${item.name} for ${formatCurrency(proceedsCp)}.`),
            ],
        };
        return withInventoryAndAC(nextState, consumeItem(state.inventory, item.id, quantity));
    },
};
