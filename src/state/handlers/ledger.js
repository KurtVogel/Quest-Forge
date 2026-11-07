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
    // The transcript measures the log's long-window bound (2026-11-05 strengthening P2).
    return recordEntry(state.ledger, {
        sourceId: ctx.sourceId,
        lane: ctx.lane,
        atMessage: ctx.atMessage,
        party: ctx.party,
        partyId: ctx.partyId,
        ...fields,
    }, { messages: state.messages });
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
    // The three lanes that kept their own replay ledgers and a phrase rule
    // over the player's words (identity by reference, lane 11, 2026-11-08):
    // a same-value XP award, the same spell on the same people, a rest of
    // the same kind inside the window now ask the judge like a coin twin.
    ADD_EXP: ['amount'],
    CAST_SPELL: ['spell', 'target', 'targets', 'slotLevel'],
    TAKE_REST: ['rest'],
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
        else if (Array.isArray(value)) {
            // A group cast's recipients: names only, clamped, at most six.
            const list = value.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim().slice(0, 160)).slice(0, 6);
            if (list.length > 0) payload[key] = list;
        }
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
        case 'ADD_EXP': return `+${Number(p.amount) || 0} XP`;
        case 'CAST_SPELL': return `${p.spell || 'a spell'} cast${castTargets(p)}`;
        case 'TAKE_REST': return `a ${p.rest ? `${p.rest} ` : ''}rest`;
        default: return 'a movement';
    }
}

/** " on Mika, Jorun" for a cast's recipients, or nothing. */
export function castTargets(p) {
    const names = Array.isArray(p?.targets) && p.targets.length > 0 ? p.targets : (p?.target ? [p.target] : []);
    return names.length > 0 ? ` on ${names.join(', ')}` : '';
}

/**
 * The judge's context for a lane that keeps its own replay ledger instead of
 * the transaction log (XP, casts, rests — lane 11, 2026-11-08): the DM lane,
 * the emitting message, no counterparty.
 */
export function repeatContext(meta = {}) {
    const sourceId = String(meta?.sourceId || '').slice(0, 160);
    return { lane: 'dm', sourceId, base: baseOf(sourceId), party: '', partyId: '', playerMessage: '' };
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
 * those are certain. `loose` marks a twin found by the word shortlist alone
 * (2026-11-07): words may only ask, so that pair reaches the judge from the
 * same reply too. `audit` admits the payment audit's own twin (lane 11,
 * 2026-11-08: its player-phrase exception is gone, so the judge reads it);
 * `earlier` names the recorded event for a lane whose twin is not a log
 * entry (an XP award, a cast, a rest).
 */
export function repeatCard(state, ctx, twin, line, replay, { loose = false, audit = false, earlier = '' } = {}) {
    if (!twin || !(ctx.lane === 'dm' || (audit && ctx.lane === 'audit'))) return null;
    if (!loose && (isExact(twin, ctx) || (ctx.base && baseOf(twin.sourceId) === ctx.base))) return null;
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
            judge: { sourceId: ctx.sourceId, twinSourceId: twin.sourceId || '', earlier: (earlier || describeEntry(twin)).slice(0, 240) },
        },
    };
}

// ── The bundle (R5) ─────────────────────────────────────────────────────

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
 * nothing (live playtest #7). The player's denomination words no longer
 * rescue a stripped part (lane 11, 2026-11-08: a word rule may only ask):
 * the stripped part reaches the repeat judge on a card instead, with the
 * newest stripped movement as its twin, and a "new" verdict books it.
 * An entry equal to the WHOLE incoming amount is only strippable after
 * something else already was: the untouched exact-total case is R2's, which
 * asks the repeat judge — the bundle must not answer for it.
 * `pool` is `[{ valueCp, entry }]`, newest first.
 */
function stripBundle(pool, amounts) {
    let remainder = { gold: amounts.gold, silver: amounts.silver, copper: amounts.copper };
    let strippedCp = 0;
    let twin = null;
    for (const { valueCp, entry } of pool) {
        const remainderCp = remainder.gold * 100 + remainder.silver * 10 + remainder.copper;
        if (remainderCp <= 0) break;
        if (!(valueCp > 0)) continue;
        if (strippedCp === 0 ? valueCp >= remainderCp : valueCp > remainderCp) continue;
        const component = decomposeWithin(valueCp, remainder);
        if (!component) continue;
        remainder = {
            gold: remainder.gold - component.gold,
            silver: remainder.silver - component.silver,
            copper: remainder.copper - component.copper,
        };
        strippedCp += valueCp;
        if (!twin) twin = entry;
    }
    return strippedCp > 0 ? { strippedCp, remainder, twin } : null;
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
    const duplicate = findTwin(ledger, ctx, entry => entry.kind === 'coin' && entry.cp === total, { crossBase: isAudit, acrossPeople: true });
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
        .map(entry => ({ valueCp: entry.movedCp, entry }));
    return { bundled: stripBundle(pool, amounts) };
}

/** Coin OUT of the purse on the DM lane (a payment, toll, fine, theft). */
export function judgeCoinOut(state, ctx, amounts) {
    const total = amounts.totalCp;
    if (decided(ctx)) {
        const replay = findTwin(state.ledger, ctx, entry => entry.kind === 'coin' && entry.cp === -total);
        return isExact(replay, ctx) ? { suppress: 'duplicate', twin: replay } : {};
    }
    const duplicate = findTwin(state.ledger, ctx, entry => entry.kind === 'coin' && entry.cp === -total, { acrossPeople: true });
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
 * The one player-phrase exception this lane kept — a line that NAMED the
 * amount paid for a new payment (2026-10-31, "I count out two silver" to a
 * second payee) — is gone (lane 11, 2026-11-08): a duplicate or a cover
 * from an earlier message books nothing and goes to the repeat judge, which
 * reads both turns; the purchase cover and the same-reply echo stay notes.
 */
export function judgeAuditPayment(state, ctx, amounts) {
    const total = amounts.totalCp;
    const ledger = state.ledger;
    const duplicate = findTwin(ledger, ctx, entry => entry.kind === 'coin' && entry.cp === -total, { crossBase: true });
    if (duplicate) return { suppress: 'duplicate', twin: duplicate };
    const cover = findTwin(ledger, ctx, entry => entry.kind === 'coin' && movedOut(entry) && -entry.movedCp >= total, { crossBase: true, exactSource: false });
    if (cover) return { suppress: 'cover', twin: cover };
    const purchase = findTwin(ledger, ctx, entry => entry.kind === 'purchase' && movedOut(entry) && -entry.movedCp >= total, { crossBase: true, exactSource: false });
    if (purchase) return { suppress: 'purchaseCover', twin: purchase };
    const echo = findTwin(ledger, ctx, entry => movedIn(entry) && entry.movedCp === total, { exactSource: false });
    if (echo) return { suppress: 'echo', twin: echo };
    const pool = newestFirst(state, ctx, entry => movedOut(entry) && !sameBase(entry, ctx))
        .map(entry => ({ valueCp: -entry.movedCp, entry }));
    return { bundled: stripBundle(pool, amounts) };
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
    const twin = findTwin(state.ledger, ctx, entry => carriesIn(entry) && entry.itemsIn.some(held => sameItem(held, item)), { acrossPeople: true });
    if (twin) return { suppress: 'duplicate', twin };
    // A recap rarely repeats the name exactly ("the brass token" for "Brass
    // toll-token"). The word rule is a shortlist, never a verdict (2026-11-07):
    // what it finds books nothing and the repeat judge reads the pair.
    const loose = findTwin(state.ledger, ctx, entry => movedItems(entry, 'in').some(held => sameItem(held, item, { fuzzy: true })), { exactSource: false });
    return loose ? { suppress: 'duplicate', twin: loose, loose: true } : {};
}

/** An item OUT of the pack (items_lost, an audit's loss). `{ suppress, twin }` or `{}`. */
export function judgeItemOut(state, ctx, item) {
    const claim = entry => carriesOut(entry) && entry.itemsOut.some(held => sameItem(held, item));
    if (decided(ctx)) {
        const replay = findTwin(state.ledger, ctx, claim);
        return isExact(replay, ctx) ? { suppress: 'duplicate', twin: replay } : {};
    }
    const isAudit = ctx.lane === 'audit';
    const twin = findTwin(state.ledger, ctx, claim, { crossBase: isAudit, acrossPeople: true });
    if (twin) return { suppress: 'duplicate', twin };
    // The audit names the inventory row itself and has no judge to ask: its
    // twin is the exact one above. The DM lane's shortlist goes to the judge.
    if (isAudit) return {};
    const loose = findTwin(state.ledger, ctx, entry => movedItems(entry, 'out').some(held => sameItem(held, item, { fuzzy: true })), { exactSource: false });
    return loose ? { suppress: 'duplicate', twin: loose, loose: true } : {};
}

// ── Trades ──────────────────────────────────────────────────────────────

/**
 * An atomic purchase. `{ suppress, twin }` for a replay; otherwise the twin
 * of each COMPONENT: `coinTwin` (the price already left as loose coin) and
 * `itemTwin` (the goods already arrived as loot).
 */
export function judgePurchase(state, ctx, transaction) {
    const { item, quantity, priceCp, said } = transaction;
    const duplicate = findTwin(state.ledger, ctx, entry => entry.kind === 'purchase'
        && entry.cp === -priceCp
        && entry.itemsIn.some(held => sameItem(held, item) && held.quantity === quantity), { acrossPeople: true });
    // A decided lane (a confirmed card, the judge) is never second-guessed but as an exact replay.
    if (duplicate && (isExact(duplicate, ctx) || !decided(ctx))) return { suppress: 'duplicate', twin: duplicate };
    if (decided(ctx)) return { coinTwin: null, itemTwin: null };
    const coinTwin = priceCp > 0
        ? findTwin(state.ledger, ctx, entry => entry.kind === 'coin' && movedOut(entry) && -entry.movedCp === priceCp, { crossBase: true, exactSource: false })
        : null;
    const spoken = { ...item, said };
    const looksLikeTheGoods = entry => entry.kind === 'item' && movedItems(entry, 'in').some(held => sameItem(held, spoken, { fuzzy: true }));
    const itemTwin = findTwin(state.ledger, ctx, looksLikeTheGoods, { crossBase: true, exactSource: false });
    if (itemTwin) return { coinTwin, itemTwin };
    // applyEvents grants a reply's items_found before its purchases, so a
    // same-reply drift ("hempen rope coil" beside the bought "Hempen rope")
    // arrives here. Words may only ask (2026-11-07): the goods wait for the judge.
    const sameReply = findTwin(state.ledger, ctx, entry => sameBase(entry, ctx) && looksLikeTheGoods(entry), { exactSource: false });
    return { coinTwin, itemTwin: sameReply, itemLoose: !!sameReply };
}

/** An atomic sale. `{ suppress, twin }` for a replay; otherwise `coinTwin` (proceeds already paid as found coin). */
export function judgeSale(state, ctx, item, quantity, proceedsCp) {
    const duplicate = findTwin(state.ledger, ctx, entry => entry.kind === 'sale'
        && entry.cp === proceedsCp
        && entry.itemsOut.some(held => sameItem(held, item) && held.quantity === quantity), { acrossPeople: true });
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
