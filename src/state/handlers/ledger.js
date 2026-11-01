/**
 * THE JUDGE (2026-11-01) — every coin and item movement any lane asks for is
 * judged here against the one transaction log (engine/transactionLedger.js)
 * before a reducer moves anything. It replaces 41 guards spread across five
 * ledgers, each of which could see only its own channel. The rules, in order:
 *
 *   R0  an exact-source replay (the same message asking again) moves nothing;
 *   R1  one accountant per narration — the audits are reconciled against
 *       their own narration in scribeAudits, so their twins are CROSS-message;
 *   R2  a twin — the same component (coin of the same value, the same item,
 *       the same direction) inside its counterparty window — is the same
 *       movement retold, unless the player's own words ask for it again;
 *   R3  a direction echo — an audit's coin that equals a movement the other
 *       way — is the same handover read backwards;
 *   R4  an audit's coin AT MOST a recent movement is that movement retold;
 *   R5  a bundle that swallows recent movements whole pays only the rest.
 *
 * A twin is judged PER COMPONENT, which is what closes the mixed cases: a
 * purchase whose price was already paid as loose coin delivers the goods
 * free; one whose item was already granted as loot charges without a second
 * item; a sale whose proceeds were already paid as found coin takes the item
 * and pays nothing more. The player lane (a "Narrated, not recorded" card the
 * player confirmed, a gear handoff from the Inventory panel) is the player's
 * own decision: it is logged, never second-guessed, except as an exact replay.
 *
 * The player-phrasing bypasses live here too: the repeat a player asks for in
 * their own words always pays.
 */
import {
    baseOf,
    cleanParty,
    findTwin,
    lastLongRestAt,
    movedIn,
    movedItems,
    movedOut,
    normalizeLedger,
    recordEntry,
    resolvePartyId,
    sameItem,
    withinWindow,
} from '../../engine/transactionLedger.js';
import {
    currentMessageIndex,
    playerMessageSupportsRepeatTransaction,
    repeatIntentNearNoun,
} from './shared.js';

const LANES = new Set(['dm', 'audit', 'player', 'engine']);

/** Who asked, when, with whom — the context every judgment and every log entry reads. */
export function ledgerContext(state, meta = {}, party = '') {
    const sourceId = String(meta?.sourceId || '').slice(0, 160);
    const lane = LANES.has(meta?.lane)
        ? meta.lane
        : (meta?.audit === true || meta?.announce === 'audit' ? 'audit' : 'dm');
    const cleaned = cleanParty(party || meta?.party || '');
    return {
        sourceId,
        base: baseOf(sourceId),
        lane,
        atMessage: currentMessageIndex(state),
        messages: state.messages || [],
        party: cleaned,
        partyId: resolvePartyId(state, cleaned),
        restAt: lastLongRestAt(state),
        playerMessage: lane === 'dm' || lane === 'audit' ? meta?.playerMessage : '',
    };
}

/** Log one judged movement with the context's source, lane, time and counterparty. */
export function logMovement(state, ctx, fields) {
    return recordEntry(state.ledger, {
        sourceId: ctx.sourceId,
        lane: ctx.lane,
        atMessage: ctx.atMessage,
        party: ctx.party,
        partyId: ctx.partyId,
        ...fields,
    });
}

const isExact = (twin, ctx) => !!ctx.sourceId && twin?.sourceId === ctx.sourceId;

// ── The player's own words ──────────────────────────────────────────────

const COIN_WORD_RE = /\b(gold|silver|copper|coins?|gp|sp|cp|payment|reward|wages?|bounty|purse)\b/i;
// Bare alternation for proximity tests (COIN_WORD_RE keeps its own \b anchors).
const COIN_NOUN_SRC = /(?:gold|silver|copper|coins?|gp|sp|cp|payment|reward|wages?|bounty|purse|money)/;
// "the rest of my payment", "pay me again/more/the rest" — repeat-grant intent
// phrased without a quantifier-noun pair.
const OWED_REMAINDER_RE = /\b(?:the\s+)?rest of (?:my|the|our) (?:payment|reward|wages?|bounty|coin|money|pay|share)\b|\bpay (?:me|us) (?:again|more|the rest)\b/i;

export function playerMessageSupportsRepeatCoinGrant(playerMessage) {
    const text = String(playerMessage || '');
    if (!text.trim()) return false;
    // "another 20 gold", "the rest of my payment" — the repeat intent must attach
    // to the coin words. Mere co-occurrence ("Another time, Odo… three silver out
    // of my purse") authorized a live replayed reward on 2026-08-22.
    return repeatIntentNearNoun(text, COIN_NOUN_SRC) || OWED_REMAINDER_RE.test(text);
}

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

// A message RECAPPING or DISPUTING an earlier payment ("I already paid you",
// "didn't I pay for this?", "you took my gold twice") is the opposite of repeat
// intent — yet it contains a payment verb, so the bypass used to fire on
// precisely the turns a player was objecting to being charged twice
// (2026-08-25 report). Deliberately does NOT include "again"/"another": those
// are genuine repeat quantifiers the bypass exists to honor.
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

export function playerMessageSupportsRepeatCoinLoss(playerMessage) {
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

const AMOUNT_WORDS = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};
const AMOUNT_MENTION_RE = /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\s+(gold|gp|silver|sp|copper|cp)\b/gi;
const DENOMINATION_CP = { gold: 100, gp: 100, silver: 10, sp: 10, copper: 1, cp: 1 };

/**
 * The player's own line NAMES this payment (2026-10-31, the Opus playtest:
 * "I count out two silver" to Jethro was ignored as a duplicate of the two
 * silver paid the net-mender two turns earlier). One "<amount> <coin>"
 * mention whose value equals the charge, in a line that is not a recap.
 */
export function playerMessageNamesAmount(playerMessage, costCp) {
    const text = String(playerMessage || '');
    if (!text.trim() || PAYMENT_RECAP_RE.test(text)) return false;
    for (const match of text.matchAll(AMOUNT_MENTION_RE)) {
        const raw = match[1].toLowerCase();
        const count = /^\d+$/.test(raw) ? Number(raw) : AMOUNT_WORDS[raw];
        if (count * DENOMINATION_CP[match[2].toLowerCase()] === costCp) return true;
    }
    return false;
}

export const PURCHASE_VERB_RE = /\b(buy|buys|buying|bought|purchase|purchases|purchasing|purchased|pay|pays|paying|paid|order|orders|ordering|ordered|take|takes|taking|grab|grabs|grabbing|get|gets|getting)\b/i;
export const SALE_VERB_RE = /\b(sell|sells|selling|sold|pawn|pawns|pawning|pawned|trade|trades|trading|traded|offer|offers|offering|offered|unload|unloads|unloading|fence|fences|fencing|fenced)\b/i;
// Verbs that show the player's own message re-acquiring an item this turn —
// broader than the coin-loss commerce set on purpose: "I take/grab/pick up
// another torch" is a genuine second acquisition.
export const ITEM_ACQUIRE_VERB_RE = /\b(buy|buys|buying|bought|purchase|purchases|purchasing|purchased|take|takes|taking|took|grab|grabs|grabbing|grabbed|pick|picks|picking|picked|pocket|pockets|pocketing|pocketed|loot|loots|looting|looted|collect|collects|collecting|collected|claim|claims|claiming|claimed)\b/i;
// Verbs that show the player's own message spending an item this turn.
const ITEM_SPEND_VERB_RE = /\b(use|uses|using|used|light|lights|lighting|lit|eat|eats|eating|ate|drink|drinks|drinking|drank|burn|burns|burning|burned|throw|throws|throwing|threw|give|gives|giving|gave|hand|hands|handing|handed|drop|drops|dropping|dropped|leave|leaves|leaving|left|offer|offers|offering|offered|spend|spends|spending|spent|break|breaks|breaking|broke)\b/i;

// ── The bundle (R5) ─────────────────────────────────────────────────────

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
 * movement it already evented on a recent turn INTO a new event, producing a
 * novel total the value twin cannot match. Every recent movement in `pool`
 * (newest first) that fits entirely inside the incoming amounts is stripped
 * once — a split grant (2 gp then 28 gp) recapped as one 30 gp bundle pays
 * nothing (live playtest #7) — unless the player's own line names a
 * denomination of the stripped part (an intentional repeat names its coin).
 * An entry equal to the WHOLE incoming amount is only strippable after
 * something else already was: the untouched exact-total case is R2's, whose
 * player-phrasing bypass must not be silently overridden here.
 */
function stripBundle(poolValues, amounts, playerMessage) {
    const text = String(playerMessage || '');
    let remainder = { gold: amounts.gold, silver: amounts.silver, copper: amounts.copper };
    let strippedCp = 0;
    for (const valueCp of poolValues) {
        const remainderCp = remainder.gold * 100 + remainder.silver * 10 + remainder.copper;
        if (remainderCp <= 0) break;
        if (!(valueCp > 0)) continue;
        if (strippedCp === 0 ? valueCp >= remainderCp : valueCp > remainderCp) continue;
        const component = decomposeWithin(valueCp, remainder);
        if (!component) continue;
        if (['gold', 'silver', 'copper'].some(denom => component[denom] > 0 && DENOMINATION_WORD_RE[denom].test(text))) continue;
        remainder = {
            gold: remainder.gold - component.gold,
            silver: remainder.silver - component.silver,
            copper: remainder.copper - component.copper,
        };
        strippedCp += valueCp;
    }
    return strippedCp > 0 ? { strippedCp, remainder } : null;
}

const newestFirst = (state, ctx, predicate) => normalizeLedger(state.ledger)
    .filter(entry => predicate(entry) && withinWindow(entry, ctx))
    .reverse();

const sameBase = (entry, ctx) => !!ctx.base && baseOf(entry.sourceId) === ctx.base;

// ── Coins ───────────────────────────────────────────────────────────────

/**
 * Coin INTO the purse (a found / received grant, DM or audit lane). Returns
 * `{ suppress, twin }` or `{ bundled }` (null when nothing was stripped).
 */
export function judgeCoinIn(state, ctx, amounts) {
    const total = amounts.totalCp;
    if (ctx.lane === 'player') return { bundled: null };
    const isAudit = ctx.lane === 'audit';
    const bypass = !isAudit && playerMessageSupportsRepeatCoinGrant(ctx.playerMessage);
    const ledger = state.ledger;
    const duplicate = findTwin(ledger, ctx, entry => entry.kind === 'coin' && entry.cp === total, { crossBase: isAudit });
    if (duplicate && (isExact(duplicate, ctx) || isAudit || !bypass)) return { suppress: 'duplicate', twin: duplicate };
    if (isAudit) {
        // R4: a recap may drift low — a recent reward at least this large is it.
        const cover = findTwin(ledger, ctx, entry => movedIn(entry) && entry.movedCp >= total, { crossBase: true, exactSource: false });
        if (cover) return { suppress: 'cover', twin: cover };
        // R3: the hero HANDING these coins over, read as receiving them.
        const echo = findTwin(ledger, ctx, entry => movedOut(entry) && -entry.movedCp === total, { exactSource: false });
        if (echo) return { suppress: 'echo', twin: echo };
    }
    // The same reply's sale already paid these proceeds (one sale, or all of
    // them together); a different value is a separate payment riding the reply.
    if (!isAudit && ctx.base) {
        const sales = normalizeLedger(ledger).filter(entry => entry.kind === 'sale' && movedIn(entry) && sameBase(entry, ctx));
        const soldCp = sales.reduce((sum, entry) => sum + entry.movedCp, 0);
        const sameSale = sales.find(entry => entry.movedCp === total) || (sales.length > 1 && soldCp === total ? sales[0] : null);
        if (sameSale) return { suppress: 'sameSale', twin: sameSale };
    }
    const saleCover = findTwin(ledger, ctx, entry => entry.kind === 'sale' && movedIn(entry) && entry.movedCp === total, { crossBase: true, exactSource: false });
    if (saleCover && (isAudit || !bypass)) return { suppress: 'saleCover', twin: saleCover };
    const pool = newestFirst(state, ctx, entry => entry.kind === 'coin' && movedIn(entry) && !(isAudit && sameBase(entry, ctx)))
        .map(entry => entry.movedCp);
    return { bundled: stripBundle(pool, amounts, ctx.playerMessage) };
}

/** Coin OUT of the purse on the DM lane (a payment, toll, fine, theft). */
export function judgeCoinOut(state, ctx, amounts) {
    const total = amounts.totalCp;
    if (ctx.lane === 'player') {
        const replay = findTwin(state.ledger, ctx, entry => entry.kind === 'coin' && entry.cp === -total);
        return isExact(replay, ctx) ? { suppress: 'duplicate', twin: replay } : {};
    }
    const bypass = playerMessageSupportsRepeatCoinLoss(ctx.playerMessage);
    const duplicate = findTwin(state.ledger, ctx, entry => entry.kind === 'coin' && entry.cp === -total);
    if (duplicate && (isExact(duplicate, ctx) || !bypass)) return { suppress: 'duplicate', twin: duplicate };
    // The price already left through an atomic purchase, retold as loose coin.
    const purchase = findTwin(state.ledger, ctx, entry => entry.kind === 'purchase' && movedOut(entry) && -entry.movedCp === total, { crossBase: true, exactSource: false });
    if (purchase && !bypass) return { suppress: 'purchaseCover', twin: purchase };
    // NO bundle strip on the DM's spend lane (Vesa, 2026-10-12 — DECISIONS.md):
    // the class playtest measured its false positive at 6 of 6 openings (pay
    // 1 gp for room + stew, then buy rope + lantern for 6 gp, charged 5).
    return {};
}

/**
 * Coin OUT of the purse on the audit lane (a payment the narration completed
 * and no event charged). Returns `{ suppress, twin }` or `{ bundled }`.
 */
export function judgeAuditPayment(state, ctx, amounts) {
    const total = amounts.totalCp;
    // The player's own line naming THIS amount is a new payment, not a recap
    // of another message's (2026-10-31) — but only against a charge from
    // BEFORE that line: a charge that answered the same line (the 07-31 "gave
    // 1 gp, charged twice" turn) is still this payment.
    const named = playerMessageNamesAmount(ctx.playerMessage, total);
    const lastPlayerLine = (state.messages || []).findLastIndex(message => message?.role === 'user' && !message.hidden && !message.deleted);
    const paysAfter = (entry) => named && !!entry && entry.atMessage < lastPlayerLine;
    const ledger = state.ledger;
    const duplicate = findTwin(ledger, ctx, entry => entry.kind === 'coin' && entry.cp === -total, { crossBase: true });
    if (duplicate && !paysAfter(duplicate)) return { suppress: 'duplicate', twin: duplicate };
    const cover = findTwin(ledger, ctx, entry => entry.kind === 'coin' && movedOut(entry) && -entry.movedCp >= total, { crossBase: true, exactSource: false });
    if (cover && !paysAfter(cover)) return { suppress: 'cover', twin: cover };
    const purchase = findTwin(ledger, ctx, entry => entry.kind === 'purchase' && movedOut(entry) && -entry.movedCp >= total, { crossBase: true, exactSource: false });
    if (purchase && !paysAfter(purchase)) return { suppress: 'purchaseCover', twin: purchase };
    const echo = findTwin(ledger, ctx, entry => movedIn(entry) && entry.movedCp === total, { exactSource: false });
    if (echo) return { suppress: 'echo', twin: echo };
    const pool = newestFirst(state, ctx, entry => movedOut(entry) && !sameBase(entry, ctx))
        .map(entry => -entry.movedCp);
    return { bundled: stripBundle(pool, amounts, ctx.playerMessage) };
}

// ── Items ───────────────────────────────────────────────────────────────

const carriesIn = (entry) => entry.kind === 'item' || entry.kind === 'purchase';
const carriesOut = (entry) => entry.kind === 'item' || entry.kind === 'sale' || entry.kind === 'handoff';

/** An item INTO the pack (items_found, an audit's recovery). `{ suppress, twin }` or `{}`. */
export function judgeItemIn(state, ctx, item) {
    // The audit pre-filters against the log with the same identity rule
    // (scribeAudits) and announces its own recovery; the player decided.
    if (ctx.lane !== 'dm') {
        const replay = findTwin(state.ledger, ctx, entry => carriesIn(entry) && entry.itemsIn.some(held => sameItem(held, item)));
        return isExact(replay, ctx) ? { suppress: 'duplicate', twin: replay } : {};
    }
    const twin = findTwin(state.ledger, ctx, entry => carriesIn(entry) && entry.itemsIn.some(held => sameItem(held, item)))
        // A recap rarely repeats the name exactly ("the brass token" for
        // "Brass toll-token"): the audits' own identity rule counts too.
        || findTwin(state.ledger, ctx, entry => movedItems(entry, 'in').some(held => sameItem(held, item, { fuzzy: true })), { exactSource: false });
    if (twin && (isExact(twin, ctx) || !playerMessageSupportsRepeatTransaction(item, ctx.playerMessage, ITEM_ACQUIRE_VERB_RE))) {
        return { suppress: 'duplicate', twin };
    }
    return {};
}

/** An item OUT of the pack (items_lost, an audit's loss). `{ suppress, twin }` or `{}`. */
export function judgeItemOut(state, ctx, item) {
    const claim = entry => carriesOut(entry) && entry.itemsOut.some(held => sameItem(held, item));
    if (ctx.lane === 'player') {
        const replay = findTwin(state.ledger, ctx, claim);
        return isExact(replay, ctx) ? { suppress: 'duplicate', twin: replay } : {};
    }
    const isAudit = ctx.lane === 'audit';
    const twin = findTwin(state.ledger, ctx, claim, { crossBase: isAudit })
        || findTwin(state.ledger, ctx, entry => movedItems(entry, 'out').some(held => sameItem(held, item, { fuzzy: true })), { crossBase: isAudit, exactSource: false });
    if (twin && (isExact(twin, ctx) || isAudit || !playerMessageSupportsRepeatTransaction(item, ctx.playerMessage, ITEM_SPEND_VERB_RE))) {
        return { suppress: 'duplicate', twin };
    }
    return {};
}

// ── Trades ──────────────────────────────────────────────────────────────

/**
 * An atomic purchase. `{ suppress, twin }` for a replay; otherwise the twin
 * of each COMPONENT: `coinTwin` (the price already left as loose coin) and
 * `itemTwin` (the goods already arrived as loot).
 */
export function judgePurchase(state, ctx, transaction) {
    const { item, quantity, priceCp } = transaction;
    const bypass = playerMessageSupportsRepeatTransaction(item, ctx.playerMessage, PURCHASE_VERB_RE);
    const duplicate = findTwin(state.ledger, ctx, entry => entry.kind === 'purchase'
        && entry.cp === -priceCp
        && entry.itemsIn.some(held => sameItem(held, item) && held.quantity === quantity));
    if (duplicate && (isExact(duplicate, ctx) || !bypass)) return { suppress: 'duplicate', twin: duplicate };
    if (bypass || ctx.lane === 'player') return { coinTwin: null, itemTwin: null };
    const coinTwin = priceCp > 0
        ? findTwin(state.ledger, ctx, entry => entry.kind === 'coin' && movedOut(entry) && -entry.movedCp === priceCp, { crossBase: true, exactSource: false })
        : null;
    const itemTwin = findTwin(state.ledger, ctx, entry => entry.kind === 'item' && movedItems(entry, 'in').some(held => sameItem(held, item, { fuzzy: true })), { crossBase: true, exactSource: false });
    return { coinTwin, itemTwin };
}

/** An atomic sale. `{ suppress, twin }` for a replay; otherwise `coinTwin` (proceeds already paid as found coin). */
export function judgeSale(state, ctx, item, quantity, proceedsCp) {
    const bypass = playerMessageSupportsRepeatTransaction(item, ctx.playerMessage, SALE_VERB_RE);
    const duplicate = findTwin(state.ledger, ctx, entry => entry.kind === 'sale'
        && entry.cp === proceedsCp
        && entry.itemsOut.some(held => sameItem(held, item) && held.quantity === quantity));
    if (duplicate && (isExact(duplicate, ctx) || !bypass)) return { suppress: 'duplicate', twin: duplicate };
    if (bypass || !(proceedsCp > 0)) return { coinTwin: null };
    const coinTwin = findTwin(state.ledger, ctx, entry => entry.kind === 'coin' && movedIn(entry) && entry.movedCp === proceedsCp, { crossBase: true, exactSource: false });
    return { coinTwin };
}

/**
 * The items the log saw ENTER the pack inside the window — the loot audit's
 * cross-message pre-filter (a re-narrated find is not a new find), read off
 * the one log so a BOUGHT item counts too (it did not before 2026-11-01).
 */
export function recentlyArrivedItems(state, ctx) {
    return normalizeLedger(state?.ledger)
        .filter(entry => withinWindow(entry, ctx))
        .flatMap(entry => movedItems(entry, 'in'));
}
