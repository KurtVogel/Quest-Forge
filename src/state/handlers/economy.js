/**
 * Coin and trade: replay-guarded coin grants/losses, the Scribe payment audit,
 * and one-shot purchase/sale transactions.
 */
import { normalizeItem, normalizeItemKey } from '../../data/items.js';
import { addCurrency, characterCurrencyToCopper, formatCurrency, spendCurrency } from '../../engine/currency.js';
import { MAX_COIN_EVENT } from '../../config/contentLimits.js';
import { conversationalDistance } from '../../engine/replayLedger.js';
import {
    consumeItem,
    currentMessageIndex,
    findRecentTransactionDuplicate,
    mintOwnedItem,
    normalizeRecentTransactions,
    normalizeRefToken,
    playerMessageSupportsRepeatTransaction,
    rememberTransaction,
    repeatIntentNearNoun,
    sourceBaseOf,
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

// Bare alternation for proximity tests (COIN_WORD_RE keeps its own \b anchors).
const COIN_NOUN_SRC = /(?:gold|silver|copper|coins?|gp|sp|cp|payment|reward|wages?|bounty|purse|money)/;
// "the rest of my payment", "pay me again/more/the rest" — repeat-grant intent
// phrased without a quantifier-noun pair.
const OWED_REMAINDER_RE = /\b(?:the\s+)?rest of (?:my|the|our) (?:payment|reward|wages?|bounty|coin|money|pay|share)\b|\bpay (?:me|us) (?:again|more|the rest)\b/i;

function playerMessageSupportsRepeatCoinGrant(playerMessage) {
    const text = String(playerMessage || '');
    if (!text.trim()) return false;
    // "another 20 gold", "the rest of my payment" — the repeat intent must attach
    // to the coin words. Mere co-occurrence ("Another time, Odo… three silver out
    // of my purse") authorized a live replayed reward on 2026-08-22.
    return repeatIntentNearNoun(text, COIN_NOUN_SRC) || OWED_REMAINDER_RE.test(text);
}

// Coin losses guard FAR wider than grants (2026-08-25 player report: "money is
// still being removed multiple turns after I've paid"). The old 4-message window
// covered barely two turns; a DM recapping a payment three turns later escaped
// it completely and the coin vanished silently. The asymmetry with the grant
// window below is the deliberate rule: **the engine may refuse to take money on
// suspicion, but never refuses to give it on suspicion.** An over-suppressed
// charge is visible ("Duplicate coin charge ignored") and favors the player, who
// can simply tell the DM to charge again; an over-suppressed reward silently
// robs them.
const RECENT_COIN_LOSS_MESSAGE_WINDOW = 12;
// Verbs that inherently mean handing money over — on their own they show the
// player initiating a (possibly repeat) payment this turn.
const STRONG_PAYMENT_VERB_RE = /\b(pay|pays|paying|paid|repay|repays|repaying|repaid|tip|tips|tipping|tipped|bribe|bribes|bribing|bribed|donate|donates|donating|donated)\b/i;
// Broader transfer verbs count only when the message also names coin.
const COIN_TRANSFER_VERB_RE = /\b(give|gives|giving|gave|hand|hands|handing|handed|toss|tosses|tossing|tossed|drop|drops|dropping|dropped|leave|leaves|leaving|left|slip|slips|slipping|slipped|slide|slides|sliding|slid|spend|spends|spending|spent|count|counts|counting|counted|settle|settles|settling|settled|offer|offers|offering|offered)\b/i;
// A message that itself initiates a purchase is a NEW spend even at a
// coincidentally identical price — live 2026-08-06: a 1 sp stew right after a
// 1 sp passage was suppressed despite "I buy a bowl of mutton stew". Narrower
// than PURCHASE_VERB_RE on purpose: take/grab/get appear in ordinary movement
// and loot prose, where a same-value DM recap really is a replay.
const COMMERCE_VERB_RE = /\b(buy|buys|buying|bought|purchase|purchases|purchasing|purchased|order|orders|ordering|ordered)\b/i;

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

// A message RECAPPING or DISPUTING an earlier payment ("I already paid you",
// "didn't I pay for this?", "you took my gold twice") is the opposite of repeat
// intent — yet it contains a payment verb, so the bypass below used to fire on
// precisely the turns a player was objecting to being charged twice, unlocking
// the very second charge they were complaining about (2026-08-25 report).
// Deliberately does NOT include "again"/"another": those are genuine repeat
// quantifiers the bypass exists to honor.
const PAYMENT_RECAP_RE = new RegExp(
    // "already paid", "just handed over", "earlier I bought"
    `\\b(?:already|just|earlier|previously|before)\\b(?:\\W+\\w+){0,3}\\W+\\b(?:paid|pay|pays|paying|gave|give|given|handed|hand|bought|buy|purchased|settled|spent|owe[ds]?)\\b`
    // "paid you already", "handed it over twice", "charged me twice"
    + `|\\b(?:paid|gave|handed|bought|purchased|settled|spent|charged|took|deducted)\\b(?:\\W+\\w+){0,4}\\W+\\b(?:already|earlier|previously|twice|before)\\b`
    // "didn't I pay", "haven't I already paid", "why did I pay again"
    // (the optional n['’]t rides inside the word: "didn't" has no boundary
    // between "did" and "n", so an anchored \b after the verb never matches it)
    + `|\\b(?:did|do|does|have|has|had|was|were|is|are)(?:n['’]?t)?\\b\\W+(?:i|we|you|it|that|this)\\b(?:\\W+\\w+){0,3}\\W+\\b(?:pay|paid|charged|deducted|taken|took|billed)\\b`,
    'i'
);

function playerMessageSupportsRepeatCoinLoss(playerMessage) {
    const text = String(playerMessage || '');
    if (!text.trim()) return false;
    // Explicit repeat intent is always honored, recap words or not: "another two
    // gold", "pay the toll again" genuinely authorize a second identical charge.
    if (repeatIntentNearNoun(text, COIN_NOUN_SRC)) return true;
    // Otherwise a recap/dispute never unlocks a repeat charge.
    if (PAYMENT_RECAP_RE.test(text)) return false;
    if (STRONG_PAYMENT_VERB_RE.test(text)) return true;
    if (COMMERCE_VERB_RE.test(text)) return true;
    return COIN_TRANSFER_VERB_RE.test(text) && COIN_WORD_RE.test(text);
}

const DENOMINATION_WORD_RE = {
    gold: /\b(gold|gp)\b/i,
    silver: /\b(silver|sp)\b/i,
    copper: /\b(copper|coppers|cp)\b/i,
};

/** Decompose `targetCp` exactly into the payload's available denominations.
 * Greedy is exact here because 100/10/1 divide each other. Returns the component
 * coins, or null when the payload's coins cannot express the value. */
function decomposeWithin(targetCp, { gold, silver, copper }) {
    const g = Math.min(gold, Math.floor(targetCp / 100));
    let rem = targetCp - g * 100;
    const s = Math.min(silver, Math.floor(rem / 10));
    rem -= s * 10;
    const c = Math.min(copper, rem);
    rem -= c;
    return rem === 0 ? { gold: g, silver: s, copper: c } : null;
}

/**
 * Recap-bundle guard (2026-07-31 playtest): the DM sometimes bundles a coin
 * movement it already evented on a recent turn INTO a new event ("gold_lost": 1
 * re-recapping the beggar's gold + "copper_lost": 3 for the fountain), producing
 * a novel total the value-signature duplicate check cannot match. When a recent
 * APPLIED ledger entry's value fits entirely inside the incoming amounts, strip
 * that component and apply only the remainder — unless the player's own message
 * names a denomination of the stripped part (an intentional repeat names its
 * coin). Player-favorable by design: a false positive under-moves coin visibly;
 * the old behavior silently double-charged.
 */
function stripBundledReplay(entries, amounts, playerMessage, currentIndex, window, messages) {
    const text = String(playerMessage || '');
    let remainder = { ...amounts };
    let strippedCp = 0;
    // Strip EVERY recent applied entry the bundle swallows, each at most once —
    // a split grant (2 gp then 28 gp) recapped as one 30 gp bundle used to match
    // only the largest piece and leak the complement on every re-emission (live
    // playtest #7: the ledger held 2 gp + 28 gp, a recap emitted 30 gp, and the
    // hero pocketed 2 gp from nothing). An entry equal to the WHOLE incoming
    // amount is only strippable after something else already was: the untouched
    // exact-total case belongs to the signature duplicate check, whose player-
    // phrasing bypass must not be silently overridden here.
    for (const entry of normalizeRecentTransactions(entries).slice().reverse()) {
        const remainderCp = remainder.gold * 100 + remainder.silver * 10 + remainder.copper;
        if (remainderCp <= 0) break;
        if (entry.status !== 'applied') continue;
        if (!(entry.priceCp > 0)) continue;
        if (strippedCp === 0 ? entry.priceCp >= remainderCp : entry.priceCp > remainderCp) continue;
        const distance = messages
            ? conversationalDistance(messages, entry.messageIndex, currentIndex)
            : currentIndex - entry.messageIndex;
        if (!(distance >= 0 && distance <= window)) continue;
        const component = decomposeWithin(entry.priceCp, remainder);
        if (!component) continue;
        const namesStrippedCoin = ['gold', 'silver', 'copper'].some(
            denom => component[denom] > 0 && DENOMINATION_WORD_RE[denom].test(text)
        );
        if (namesStrippedCoin) continue;
        remainder = {
            gold: remainder.gold - component.gold,
            silver: remainder.silver - component.silver,
            copper: remainder.copper - component.copper,
        };
        strippedCp += entry.priceCp;
    }
    return strippedCp > 0 ? { strippedCp, remainder } : null;
}

/**
 * ONE PURSE, ONE VIEW (2026-08-25). Coin leaves the hero's purse through TWO
 * channels — an atomic `purchase` and a loose `X_lost` — and arrives through two
 * more (`sell`, `X_found`), each with its own ledger. Every replay guard only
 * ever consulted its own ledger, so the commonest real-world sequence was
 * unguarded end to end: the hero BUYS something (recentPurchases, coin
 * deducted), and a turn or two later the DM recaps the handover as loose
 * `gold_lost` — a channel whose ledger has never heard of that purchase — and
 * the money goes again. "Paid for something, charged again later" was the
 * literal shape of the bug report. These views hand every guard the whole side
 * of the purse instead of one channel's slice.
 */
function spendLedgerView(state) {
    return [
        ...normalizeRecentTransactions(state.recentCoinLosses),
        ...normalizeRecentTransactions(state.recentPurchases),
    ].sort((a, b) => a.messageIndex - b.messageIndex);
}

// (No gain-side union view on purpose: the spend side unions its two channels for
// the bundle strip because an over-suppressed charge is player-favorable, while
// the gain side gets only the exact-value sale cover below. Stripping suspected
// duplicates out of a bundled REWARD would take money from the player on a guess
// — the asymmetry documented at RECENT_COIN_LOSS_MESSAGE_WINDOW.)

/**
 * Cross-channel cover: an APPLIED movement of the same value on the same side of
 * the purse, from a DIFFERENT narration, inside the window — this movement is
 * that one retold through another channel. `atLeast` is the audit's recap
 * semantics (a retelling may drift low); the DM event path demands an EXACT
 * value so a genuine smaller follow-up (buy armor, then tip the smith) still
 * settles.
 */
function findCrossChannelCover(entries, totalCp, sourceId, messageIndex, window, messages, { atLeast = false } = {}) {
    if (!(totalCp > 0)) return null;
    const base = sourceBaseOf(sourceId);
    return entries.slice().reverse().find(entry => (
        entry.status === 'applied'
        && entry.priceCp > 0
        && (atLeast ? entry.priceCp >= totalCp : entry.priceCp === totalCp)
        && (!base || sourceBaseOf(entry.sourceId) !== base)
        && conversationalDistance(messages, entry.messageIndex, messageIndex) <= window
    )) || null;
}

/** Purse total after a movement, so every coin line is self-reconciling. */
function purseLine(character) {
    return formatCurrency(characterCurrencyToCopper(character));
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
        // Audit cover rule (live playtest #8): scribe.js only stands down against
        // the SAME narration's applied events, so a next-turn re-narration with a
        // drifted value (event granted 7 gp, recap says "5 gold and 12 silver" =
        // 620 cp) reaches here as a novel signature and used to re-grant. An audit
        // is a recap by nature: when any recent applied grant from ANOTHER message
        // is at least this large, the narration is recounting that reward — suppress
        // outright. DM event grants keep #7 semantics (a genuine smaller follow-up
        // reward must not be eaten; the player-phrasing bypass covers repeats).
        if (isAudit) {
            const base = sourceBaseOf(sourceId);
            const covered = normalizeRecentTransactions(state.recentCoinGrants).some(entry =>
                entry.status === 'applied'
                && entry.priceCp >= transaction.priceCp
                && (!base || sourceBaseOf(entry.sourceId) !== base)
                && conversationalDistance(state.messages, entry.messageIndex, messageIndex) <= RECENT_COIN_GRANT_MESSAGE_WINDOW);
            if (covered) {
                return {
                    ...state,
                    recentCoinGrants: rememberTransaction(state.recentCoinGrants, transaction, sourceId, messageIndex, 'ignored'),
                    messages: [
                        ...state.messages,
                        systemMessage(`Duplicate coin grant ignored — ${transaction.item.name} repeats rewards already received moments ago.`),
                    ],
                };
            }
            // Direction cover, gain side (2026-08-20 twin of AUDIT_COIN_PAYMENT's
            // grant echo): a recap of the hero HANDING coins over can be misread
            // as the hero receiving them — the audit would silently refund a
            // payment the DM's own event already took. A recent APPLIED coin
            // LOSS of exactly this value is that payment retold, not a find.
            // DM event grants are untouched: an explicit refund is authoritative.
            const lossEcho = normalizeRecentTransactions(state.recentCoinLosses).some(entry =>
                entry.status === 'applied'
                && entry.priceCp === transaction.priceCp
                && conversationalDistance(state.messages, entry.messageIndex, messageIndex) <= RECENT_COIN_GRANT_MESSAGE_WINDOW);
            if (lossEcho) {
                return {
                    ...state,
                    recentCoinGrants: rememberTransaction(state.recentCoinGrants, transaction, sourceId, messageIndex, 'ignored'),
                    messages: [
                        ...state.messages,
                        systemMessage(`Coin recovery ignored — ${transaction.item.name} matches a payment you just made; treated as the same handover retold.`),
                    ],
                };
            }
        }
        // Cross-channel cover, gain side: the twin of the purchase cover. A sale
        // already credited these exact proceeds through the other inbound channel
        // and the DM is re-narrating the payout as loose found coin. Exact value,
        // and never against an explicit player repeat.
        const saleCover = findCrossChannelCover(
            normalizeRecentTransactions(state.recentSales), transaction.priceCp,
            sourceId, messageIndex, RECENT_COIN_GRANT_MESSAGE_WINDOW, state.messages
        );
        if (saleCover && (isAudit || !playerMessageSupportsRepeatCoinGrant(meta.playerMessage))) {
            return {
                ...state,
                recentCoinGrants: rememberTransaction(state.recentCoinGrants, transaction, sourceId, messageIndex, 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`Duplicate coin grant ignored — ${transaction.item.name} was already paid out when you sold ${saleCover.name || 'that'}.`),
                ],
            };
        }
        // Recap-bundle guard, gain side: a new grant that swallows a recent reward
        // whole ("the 10 gold reward plus 5 silver you find now") must only pay the
        // new part. Audit grants run it too (playtest #8) — a recap can bundle
        // several smaller already-paid pieces; audits carry no playerMessage, so
        // the denomination-naming bypass never blocks their strip. Same-base
        // entries stay OUT of an audit's strip pool: scribe.js already subtracted
        // that narration's applied events, and stripping them again would eat a
        // legitimately reconciled shortfall.
        const grantStripPool = isAudit
            ? normalizeRecentTransactions(state.recentCoinGrants)
                .filter(entry => !sourceBaseOf(sourceId) || sourceBaseOf(entry.sourceId) !== sourceBaseOf(sourceId))
            : state.recentCoinGrants;
        const bundled = stripBundledReplay(
            grantStripPool, { gold, silver, copper }, meta.playerMessage,
            messageIndex, RECENT_COIN_GRANT_MESSAGE_WINDOW, state.messages
        );
        const grant = bundled ? bundled.remainder : { gold, silver, copper };
        // The whole bundle can be an assembly of already-paid pieces (split
        // grants recapped as one total) — then there is nothing left to grant.
        if (bundled && grant.gold <= 0 && grant.silver <= 0 && grant.copper <= 0) {
            return {
                ...state,
                recentCoinGrants: rememberTransaction(state.recentCoinGrants, transaction, sourceId, messageIndex, 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`Duplicate coin grant ignored — ${transaction.item.name} repeats rewards already received moments ago.`),
                ],
            };
        }
        const grantTransaction = bundled
            ? buildCoinGrantTransaction(grant.gold, grant.silver, grant.copper)
            : transaction;
        const character = addCurrency(state.character, grant);
        // Coin entering the purse announces itself too — the spend line's twin, so
        // the purse total in chat always matches the sheet.
        const messages = [
            ...state.messages,
            ...(bundled ? [systemMessage(`Adjusted a bundled coin grant — ${formatCurrency(bundled.strippedCp)} of it repeats a reward already received moments ago; granted ${formatCurrency(grantTransaction.priceCp)}.`)] : []),
            meta.announce === 'audit'
                ? systemMessage(`**Coins recovered from narration:** ${grantTransaction.item.name} added to your purse — purse: ${purseLine(character)}.`)
                : systemMessage(`**+${formatCurrency(grantTransaction.priceCp)}** received — purse: ${purseLine(character)}.`),
        ];
        return {
            ...state,
            character,
            recentCoinGrants: rememberTransaction(state.recentCoinGrants, grantTransaction, sourceId, messageIndex),
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
        // Cross-channel cover: the hero already paid this exact amount through the
        // OTHER spend channel (an atomic purchase) and the DM is now re-narrating
        // that handover as loose coin. The purchase ledger is the only record of
        // it, which is why this charge sailed through every guard before
        // 2026-08-25. Exact value only — a genuine differently-priced payment
        // right after a purchase must still settle.
        const purchaseCover = findCrossChannelCover(
            normalizeRecentTransactions(state.recentPurchases), transaction.priceCp,
            sourceId, messageIndex, RECENT_COIN_LOSS_MESSAGE_WINDOW, state.messages
        );
        if (purchaseCover && !playerMessageSupportsRepeatCoinLoss(meta.playerMessage)) {
            return {
                ...state,
                recentCoinLosses: rememberTransaction(state.recentCoinLosses, transaction, sourceId, messageIndex, 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`Duplicate coin charge ignored — ${transaction.item.name} was already paid when you bought ${purchaseCover.name || 'that'}.`),
                ],
            };
        }
        // No exact duplicate — but the charge may be a recap BUNDLE that swallows a
        // recent payment whole (novel total, so the signature check can't see it).
        // Known accepted false positive (live 2026-08-22): a genuine fresh charge
        // that HAPPENS to swallow an unrelated recent payment gets that payment
        // carved out (a 3 sp ferry debt stripped from a 3 gp 6 sp shopping bill).
        // Deliberately kept: the same playtest's next turn had the DM bundle a
        // full 360 cp recap INTO a genuine 71 cp meal charge on a message that
        // also initiated commerce — no player-intent guard can tell the two
        // apart, and a visible under-charge beats a silent double-charge.
        // Strips against BOTH spend channels: a recap can bundle an atomic
        // purchase's price together with a genuinely new charge ("75 gold for the
        // mail and 5 silver for the strap").
        const bundled = stripBundledReplay(
            spendLedgerView(state), { gold, silver, copper }, meta.playerMessage,
            messageIndex, RECENT_COIN_LOSS_MESSAGE_WINDOW, state.messages
        );
        const charge = bundled ? bundled.remainder : { gold, silver, copper };
        // Spend-side twin of the grant path: a recap bundle assembled entirely
        // from already-taken payments must charge nothing at all.
        if (bundled && charge.gold <= 0 && charge.silver <= 0 && charge.copper <= 0) {
            return {
                ...state,
                recentCoinLosses: rememberTransaction(state.recentCoinLosses, transaction, sourceId, messageIndex, 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`Duplicate coin charge ignored — ${transaction.item.name} repeats payments already taken moments ago.`),
                ],
            };
        }
        const chargeTransaction = bundled
            ? buildCoinLossTransaction(charge.gold, charge.silver, charge.copper)
            : transaction;
        const bundleNote = bundled
            ? [systemMessage(`Adjusted a bundled coin charge — ${formatCurrency(bundled.strippedCp)} of it repeats a payment already taken moments ago; charged ${formatCurrency(chargeTransaction.priceCp)}.`)]
            : [];
        const recentCoinLosses = rememberTransaction(state.recentCoinLosses, chargeTransaction, sourceId, messageIndex);
        const result = spendCurrency(state.character, charge);
        if (!result.paid) {
            return {
                ...state,
                recentCoinLosses,
                messages: [...state.messages, ...bundleNote, systemMessage(`Not enough coin — missing ${formatCurrency(result.missingCp)}.`)],
            };
        }
        // Coin leaving the purse ALWAYS says so (D6, and the other half of the
        // 2026-08-25 report: "this happens silently"). Before this, the DM event
        // path was the one coin channel with no system line at all — purchases,
        // sales and audited payments all announced — so a charge that slipped a
        // guard was invisible until the player noticed a lighter purse with no
        // idea which turn took it. Every line carries the resulting purse so any
        // future leak is immediately legible and disputable.
        return {
            ...state,
            character: result.character,
            recentCoinLosses,
            messages: [
                ...state.messages,
                ...bundleNote,
                systemMessage(`**−${formatCurrency(chargeTransaction.priceCp)}** paid — purse: ${purseLine(result.character)}.`),
            ],
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
        // Cover rule, spend side (playtest #8 twin of the audit grant cover): a
        // re-narrated payment with a drifted value must not charge again when a
        // recent applied loss from another message already covers it. The audit
        // is a backstop for pure omissions, never a second payer of record.
        const base = sourceBaseOf(sourceId);
        const covered = normalizeRecentTransactions(state.recentCoinLosses).some(entry =>
            entry.status === 'applied'
            && entry.priceCp >= costCp
            && (!base || sourceBaseOf(entry.sourceId) !== base)
            && conversationalDistance(state.messages, entry.messageIndex, messageIndex) <= RECENT_COIN_LOSS_MESSAGE_WINDOW);
        if (covered) {
            return {
                ...state,
                recentCoinLosses: rememberTransaction(state.recentCoinLosses, transaction, sourceId, messageIndex, 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`**Duplicate payment ignored:** ${formatCurrency(costCp)} repeats payments already taken moments ago.`),
                ],
            };
        }
        // Cross-channel cover (2026-08-25): the narration is re-telling a handover
        // the hero already paid as an atomic purchase. scribe.js stands down on
        // the purchase's OWN narration (appliedCoinCp counts purchases), but a
        // later re-narration reaches here, where only the coin-loss ledger was
        // ever consulted. Audit semantics allow a drifted-low recap (`atLeast`).
        const purchaseCover = findCrossChannelCover(
            normalizeRecentTransactions(state.recentPurchases), costCp,
            sourceId, messageIndex, RECENT_COIN_LOSS_MESSAGE_WINDOW, state.messages,
            { atLeast: true }
        );
        if (purchaseCover) {
            return {
                ...state,
                recentCoinLosses: rememberTransaction(state.recentCoinLosses, transaction, sourceId, messageIndex, 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`**Duplicate payment ignored:** ${formatCurrency(costCp)} was already paid when you bought ${purchaseCover.name || 'that'}.`),
                ],
            };
        }
        // Direction cover (live playtest 2026-08-20): the Scribe read Branock
        // counting the hero's REWARD into her palm as the hero paying out, and
        // the loss ledger knew nothing about the grant — the audit deducted the
        // exact coins the DM's own event had just added, netting the reward to
        // zero. A recent APPLIED coin GRANT of exactly this value is that same
        // handover seen backwards, never a payment. Exact value match by
        // design: a genuine unevented smaller payment right after a windfall
        // must still settle. scribe.js stands down same-narration gains; this
        // is the cross-message belt for next-turn re-narrations.
        const grantEcho = normalizeRecentTransactions(state.recentCoinGrants).some(entry =>
            entry.status === 'applied'
            && entry.priceCp === costCp
            && conversationalDistance(state.messages, entry.messageIndex, messageIndex) <= RECENT_COIN_LOSS_MESSAGE_WINDOW);
        if (grantEcho) {
            return {
                ...state,
                recentCoinLosses: rememberTransaction(state.recentCoinLosses, transaction, sourceId, messageIndex, 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`**Payment report ignored:** ${formatCurrency(costCp)} matches coins you just received — treated as the same handover, not a new charge.`),
                ],
            };
        }
        // Bundle strip for audited payments: a recap can assemble several smaller
        // already-taken charges into one novel total. No playerMessage rides an
        // audit, so the denomination-naming bypass never blocks the strip. Same-
        // base entries stay out of the pool — scribe.js already reconciled this
        // narration's own applied losses.
        const lossStripPool = spendLedgerView(state)
            .filter(entry => !base || sourceBaseOf(entry.sourceId) !== base);
        const bundled = stripBundledReplay(
            lossStripPool, { gold, silver, copper }, meta.playerMessage,
            messageIndex, RECENT_COIN_LOSS_MESSAGE_WINDOW, state.messages
        );
        const charge = bundled ? bundled.remainder : { gold, silver, copper };
        if (bundled && charge.gold <= 0 && charge.silver <= 0 && charge.copper <= 0) {
            return {
                ...state,
                recentCoinLosses: rememberTransaction(state.recentCoinLosses, transaction, sourceId, messageIndex, 'ignored'),
                messages: [
                    ...state.messages,
                    systemMessage(`**Duplicate payment ignored:** ${formatCurrency(costCp)} repeats payments already taken moments ago.`),
                ],
            };
        }
        const chargeTransaction = bundled
            ? buildCoinLossTransaction(charge.gold, charge.silver, charge.copper)
            : transaction;
        const chargeCp = chargeTransaction.priceCp;
        const recentCoinLosses = rememberTransaction(state.recentCoinLosses, chargeTransaction, sourceId, messageIndex);
        const result = spendCurrency(state.character, charge);
        const strippedNote = bundled
            ? [systemMessage(`Adjusted an audited payment — ${formatCurrency(bundled.strippedCp)} of it repeats a payment already taken moments ago.`)]
            : [];
        if (result.paid) {
            return {
                ...state,
                character: result.character,
                recentCoinLosses,
                messages: [
                    ...state.messages,
                    ...strippedNote,
                    systemMessage(`**Payment settled from narration:** ${formatCurrency(chargeCp)} deducted from your purse.`),
                ],
            };
        }
        const availableCp = chargeCp - result.missingCp;
        if (availableCp <= 0) {
            return {
                ...state,
                recentCoinLosses,
                messages: [
                    ...state.messages,
                    ...strippedNote,
                    systemMessage(`**Payment noted from narration:** ${formatCurrency(chargeCp)} was owed, but your purse is empty — nothing deducted.`),
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
                ...strippedNote,
                systemMessage(`**Payment settled from narration:** ${formatCurrency(availableCp)} deducted (purse emptied; ${formatCurrency(result.missingCp)} short of the narrated ${formatCurrency(chargeCp)}).`),
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
        // Mirror of the coin-loss purchase cover: the DM narrated the handover as
        // loose coin on an earlier turn and only now emits the atomic purchase.
        // The price is already out of the purse, so deliver the goods WITHOUT
        // charging again — suppressing the whole event would swallow the item.
        const lossCover = findCrossChannelCover(
            normalizeRecentTransactions(state.recentCoinLosses), priceCp,
            sourceId, currentMessageIndex(state), RECENT_COIN_LOSS_MESSAGE_WINDOW, state.messages
        );
        if (lossCover && !playerMessageSupportsRepeatTransaction(item, meta.playerMessage, PURCHASE_VERB_RE)) {
            const coveredState = {
                ...state,
                recentPurchases: rememberTransaction(state.recentPurchases, transaction, sourceId, currentMessageIndex(state)),
                messages: [
                    ...state.messages,
                    systemMessage(`${quantity > 1 ? `${quantity}x ` : ''}${item.name} added — its ${formatCurrency(priceCp)} was already paid moments ago; purse unchanged at ${purseLine(state.character)}.`),
                ],
            };
            return withInventoryAndAC(coveredState, [...state.inventory, mintOwnedItem(item, { quantity })]);
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
