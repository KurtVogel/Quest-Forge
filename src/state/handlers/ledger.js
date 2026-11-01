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
 *       the same direction) inside its counterparty window — books nothing;
 *       one from an EARLIER message is a question, not an answer: it goes
 *       to the repeat judge (llm/repeatJudge.js), which reads the two turns
 *       and books it if this one shows a new movement (2026-11-01 night);
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
 * No rule here reads the DM lane's words to decide new-or-retold: word
 * lists ("another", "I buy", "the next pelt") never held — players and
 * the DM say it every way, with typos (run 6, 2026-11-01). The rules read
 * only structure: source, reply, counterparty, value, window. What they
 * cannot settle, the judge reads.
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
import { currentMessageIndex } from './shared.js';
import { formatCurrency } from '../../engine/currency.js';

const LANES = new Set(['dm', 'audit', 'player', 'engine', 'judge']);

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
        // A counterparty logged before the roster knew them (an NPC registered
        // later the same turn) is resolved at judging time (2026-11-01 run 6:
        // the dockmaster's 1 sp, logged without an id, was stripped out of the
        // gambler's 4 sp pot as "the same reward").
        resolveParty: memoResolver(state),
    };
}

function memoResolver(state) {
    const cache = new Map();
    return (name) => {
        const key = cleanParty(name);
        if (!key) return '';
        if (!cache.has(key)) cache.set(key, resolvePartyId(state, key));
        return cache.get(key);
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
// The player's own decision (a card, a gear handoff) and the repeat judge's
// verdict are logged, never second-guessed except as an exact replay.
const decided = (ctx) => ctx.lane === 'player' || ctx.lane === 'judge';

// ── "Recorded once" — the judgment the log cannot settle ────────────────

/** The movements a "Recorded once" card may re-run, and the payload keys each keeps. */
const REPEAT_REPLAYS = {
    ADD_COIN_GRANT: ['copper'],
    APPLY_COIN_LOSS: ['copper'],
    PURCHASE_ITEM: ['name', 'itemKey', 'quantity', 'priceCp'],
    SELL_ITEM: ['itemId', 'name', 'itemKey', 'quantity', 'priceCp'],
    ADD_ITEM: ['name', 'itemKey', 'quantity', 'type', 'description', 'valueCp'],
    REMOVE_ITEM_BY_NAME: ['name', 'quantity'],
};

/** A replay payload projected to its movement's known keys, every value clamped (a save is input too). */
export function projectRepeatReplay(replay) {
    const keys = REPEAT_REPLAYS[replay?.type];
    if (!keys) return null;
    const source = replay.payload && typeof replay.payload === 'object' ? replay.payload : {};
    const payload = {};
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim()) payload[key] = value.trim().slice(0, 160);
        else if (Number.isFinite(value)) payload[key] = Math.max(0, Math.min(10_000_000, Math.trunc(value)));
    }
    return { type: replay.type, payload };
}

/** One logged movement in plain words, for the repeat judge's prompt. */
export function describeEntry(entry) {
    if (!entry) return '';
    const coin = (cp) => formatCurrency(Math.abs(cp));
    const items = (list) => (list || []).map(item => `${item.quantity > 1 ? `${item.quantity}x ` : ''}${item.name}`).join(', ');
    const party = entry.party ? ` (${entry.party})` : '';
    if (entry.kind === 'purchase') return `the hero bought ${items(entry.itemsIn)} for ${coin(entry.cp)}${party}`;
    if (entry.kind === 'sale') return `the hero sold ${items(entry.itemsOut)} for ${coin(entry.cp)}${party}`;
    if (entry.kind === 'coin') return `${entry.cp >= 0 ? 'the hero received' : 'the hero paid'} ${coin(entry.cp)}${party}`;
    if (entry.itemsIn?.length) return `${items(entry.itemsIn)} entered the hero's pack${party}`;
    if (entry.itemsOut?.length) return `${items(entry.itemsOut)} left the hero's pack${party}`;
    return `a ${entry.kind} movement${party}`;
}

/** A replayable movement as the player reads it: "3 cp from Mirja", "River-fox fur sold to Tuomas for 6 sp". */
export function movementLabel(replay, party = '') {
    const p = replay?.payload || {};
    const coin = formatCurrency(Number(p.copper ?? p.priceCp) || 0);
    const items = `${p.quantity > 1 ? `${p.quantity}x ` : ''}${p.name || 'an item'}`;
    const to = (word) => (party ? ` ${word} ${party}` : '');
    switch (replay?.type) {
        case 'ADD_COIN_GRANT': return party ? `${coin} from ${party}` : `${coin} received`;
        case 'APPLY_COIN_LOSS': return party ? `${coin} to ${party}` : `${coin} paid`;
        case 'PURCHASE_ITEM': return `${items} bought${to('from')} for ${coin}`;
        case 'SELL_ITEM': return `${items} sold${to('to')} for ${coin}`;
        case 'ADD_ITEM': return `${items} added to your pack`;
        case 'REMOVE_ITEM_BY_NAME': return `${items} taken from your pack`;
        default: return 'a movement';
    }
}

/**
 * A twin from an EARLIER message, on the DM lane, is the one judgment the
 * log cannot settle: a second crate's wage and the first one's retold read
 * alike to any rule over words (2026-11-01 run 6 — every phrase rule written
 * for it was escaped by the next line, and Vesa: "things can be said in so
 * many ways, typos etc."). The engine books nothing — a double stays
 * impossible — and posts a card the repeat judge (llm/repeatJudge.js) reads
 * the two turns for: a "new" verdict books exactly this movement on the
 * judge lane, with an Undo; anything else leaves the player's "Record it
 * again". An exact-source replay and a same-reply twin stay plain notes:
 * those are certain.
 */
export function repeatCard(state, ctx, twin, line, replay) {
    if (ctx.lane !== 'dm' || !twin || isExact(twin, ctx)) return null;
    if (ctx.base && baseOf(twin.sourceId) === ctx.base) return null;
    const projected = projectRepeatReplay(replay);
    if (!projected) return null;
    return {
        id: `${ctx.sourceId || 'msg'}:repeat:${(state.messages || []).length}`,
        timestamp: Date.now(),
        role: 'system',
        kind: 'recovery',
        // The DM reads it like the note it replaces: its re-emission was not booked.
        dmVisible: true,
        content: `**Recorded once:** ${line} If this was a new one, record it.`,
        recovery: {
            status: 'judging',
            mode: 'repeat',
            replay: projected,
            party: ctx.party || '',
            what: movementLabel(projected, ctx.party || '').slice(0, 200),
            judge: { sourceId: ctx.sourceId, twinSourceId: twin.sourceId || '', earlier: describeEntry(twin).slice(0, 240) },
        },
    };
}

// ── The player's own words (the audit lane and the bundle only) ─────────

// A message RECAPPING or DISPUTING an earlier payment ("I already paid you",
// "didn't I pay for this?", "you took my gold twice") is the opposite of a
// new payment (2026-08-25 report).
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
 * The payment AUDIT's one exception — the DM lane's repeats go to the judge.
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
 * something else already was: the untouched exact-total case is R2's, which
 * asks the repeat judge — the bundle must not answer for it.
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
    if (decided(ctx)) return { bundled: null };
    const isAudit = ctx.lane === 'audit';
    const ledger = state.ledger;
    const duplicate = findTwin(ledger, ctx, entry => entry.kind === 'coin' && entry.cp === total, { crossBase: isAudit });
    if (duplicate) return { suppress: 'duplicate', twin: duplicate };
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
    if (saleCover) return { suppress: 'saleCover', twin: saleCover };
    const pool = newestFirst(state, ctx, entry => entry.kind === 'coin' && movedIn(entry) && !(isAudit && sameBase(entry, ctx)))
        .map(entry => entry.movedCp);
    return { bundled: stripBundle(pool, amounts, ctx.playerMessage) };
}

/** Coin OUT of the purse on the DM lane (a payment, toll, fine, theft). */
export function judgeCoinOut(state, ctx, amounts) {
    const total = amounts.totalCp;
    if (decided(ctx)) {
        const replay = findTwin(state.ledger, ctx, entry => entry.kind === 'coin' && entry.cp === -total);
        return isExact(replay, ctx) ? { suppress: 'duplicate', twin: replay } : {};
    }
    const duplicate = findTwin(state.ledger, ctx, entry => entry.kind === 'coin' && entry.cp === -total);
    if (duplicate) return { suppress: 'duplicate', twin: duplicate };
    // The price already left through an atomic purchase, retold as loose coin.
    const purchase = findTwin(state.ledger, ctx, entry => entry.kind === 'purchase' && movedOut(entry) && -entry.movedCp === total, { crossBase: true, exactSource: false });
    if (purchase) return { suppress: 'purchaseCover', twin: purchase };
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
    return twin ? { suppress: 'duplicate', twin } : {};
}

/** An item OUT of the pack (items_lost, an audit's loss). `{ suppress, twin }` or `{}`. */
export function judgeItemOut(state, ctx, item) {
    const claim = entry => carriesOut(entry) && entry.itemsOut.some(held => sameItem(held, item));
    if (decided(ctx)) {
        const replay = findTwin(state.ledger, ctx, claim);
        return isExact(replay, ctx) ? { suppress: 'duplicate', twin: replay } : {};
    }
    const isAudit = ctx.lane === 'audit';
    const twin = findTwin(state.ledger, ctx, claim, { crossBase: isAudit })
        || findTwin(state.ledger, ctx, entry => movedItems(entry, 'out').some(held => sameItem(held, item, { fuzzy: true })), { crossBase: isAudit, exactSource: false });
    return twin ? { suppress: 'duplicate', twin } : {};
}

// ── Trades ──────────────────────────────────────────────────────────────

/**
 * An atomic purchase. `{ suppress, twin }` for a replay; otherwise the twin
 * of each COMPONENT: `coinTwin` (the price already left as loose coin) and
 * `itemTwin` (the goods already arrived as loot).
 */
export function judgePurchase(state, ctx, transaction) {
    const { item, quantity, priceCp } = transaction;
    const duplicate = findTwin(state.ledger, ctx, entry => entry.kind === 'purchase'
        && entry.cp === -priceCp
        && entry.itemsIn.some(held => sameItem(held, item) && held.quantity === quantity));
    // A decided lane (a confirmed card, the judge) is never second-guessed but as an exact replay.
    if (duplicate && (isExact(duplicate, ctx) || !decided(ctx))) return { suppress: 'duplicate', twin: duplicate };
    if (decided(ctx)) return { coinTwin: null, itemTwin: null };
    const coinTwin = priceCp > 0
        ? findTwin(state.ledger, ctx, entry => entry.kind === 'coin' && movedOut(entry) && -entry.movedCp === priceCp, { crossBase: true, exactSource: false })
        : null;
    const itemTwin = findTwin(state.ledger, ctx, entry => entry.kind === 'item' && movedItems(entry, 'in').some(held => sameItem(held, item, { fuzzy: true })), { crossBase: true, exactSource: false });
    return { coinTwin, itemTwin };
}

/** An atomic sale. `{ suppress, twin }` for a replay; otherwise `coinTwin` (proceeds already paid as found coin). */
export function judgeSale(state, ctx, item, quantity, proceedsCp) {
    const duplicate = findTwin(state.ledger, ctx, entry => entry.kind === 'sale'
        && entry.cp === proceedsCp
        && entry.itemsOut.some(held => sameItem(held, item) && held.quantity === quantity));
    if (duplicate && (isExact(duplicate, ctx) || !decided(ctx))) return { suppress: 'duplicate', twin: duplicate };
    if (decided(ctx) || !(proceedsCp > 0)) return { coinTwin: null };
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
