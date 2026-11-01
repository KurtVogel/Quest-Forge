/**
 * THE TRANSACTION LOG (2026-11-01) — one record of every coin and item
 * movement the engine judged, and the window rules every replay judgment
 * reads. It replaces five per-channel ledgers (recentCoinGrants,
 * recentCoinLosses, recentPurchases, recentSales, recentItemGrants) whose
 * guards each consulted their own slice of the purse: every "cross-channel
 * cover" of the last four months (a purchase recapped as loose coin, a sale
 * recapped as found gold, a bought item recapped as found) was a patch for
 * one pair of slices that could not see each other. One log sees everything
 * by construction; the judge (state/handlers/ledger.js) reads it.
 *
 * An entry is one judged movement:
 *   kind     coin | purchase | sale | item | handoff
 *   lane     dm | audit | player | engine — who asked
 *   status   applied | ignored (an ignored entry keeps its CLAIM, so a
 *            re-emission of a re-emission is still a replay)
 *   cp       the signed coin CLAIMED (+ in, − out)
 *   movedCp  the signed coin that actually moved
 *   itemsIn / itemsOut   the items claimed; itemsMoved — whether they moved
 *   party    who the movement was with (the DM's coin_from / coin_to /
 *            seller / buyer / from / to, the Scribe's from / to, a companion)
 *
 * The counterparty is what the old ledgers never knew, and it decides the
 * window: two movements with two different known people are never one
 * movement retold (the 10-31 "two silver to Jethro" after "two silver to the
 * net-mender"), and a movement with the SAME person is a recap far longer
 * than twelve messages (the reward named at the handover and re-emitted at
 * the report-back) — unless a long rest (a new day) lies between them.
 */
import { conversationalDistance, describeTurnsAgo } from './replayLedger.js';
import { itemIdentityMatches } from './textMatch.js';
import { namesMatch, resolveNpcRef } from './npcRoster.js';
import { formatCurrency } from './currency.js';
import { normalizeItemKey } from '../data/items.js';

export const LEDGER_LIMIT = 60;
/** The window for a movement with an unknown counterparty — the old one. */
export const SHORT_WINDOW = 12;
/** The window for a movement with the SAME counterparty, inside one day. */
export const LONG_WINDOW = 40;
/** How many rows the DM's RECENT TRANSACTIONS block shows. */
export const LEDGER_PROMPT_ROWS = 8;

const KINDS = new Set(['coin', 'purchase', 'sale', 'item', 'handoff']);
const LANES = new Set(['dm', 'audit', 'player', 'engine']);
const PARTY_MAX = 60;

const clampText = (value, max) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const toInt = (value) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);

function sanitizeItemRef(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = clampText(raw.name, 160);
    const itemKey = clampText(raw.itemKey, 100);
    if (!name && !itemKey) return null;
    return { name, itemKey, quantity: Math.max(1, Math.min(9999, toInt(raw.quantity) || 1)) };
}

const itemList = (list) => (Array.isArray(list) ? list.map(sanitizeItemRef).filter(Boolean).slice(0, 6) : []);

/** A counterparty as the log stores it: a short trimmed name, never a sentence. */
export function cleanParty(value) {
    return clampText(value, PARTY_MAX).replace(/[.!?;:,]+$/, '');
}

export function normalizeLedgerEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = KINDS.has(raw.kind) ? raw.kind : null;
    if (!kind) return null;
    const cp = Math.max(-100000000, Math.min(100000000, toInt(raw.cp)));
    const itemsIn = itemList(raw.itemsIn);
    const itemsOut = itemList(raw.itemsOut);
    if (cp === 0 && itemsIn.length === 0 && itemsOut.length === 0) return null;
    const status = raw.status === 'ignored' ? 'ignored' : 'applied';
    const movedCp = status === 'ignored' ? 0 : Math.max(-100000000, Math.min(100000000, toInt(raw.movedCp ?? raw.cp)));
    return {
        seq: Math.max(0, toInt(raw.seq)),
        sourceId: clampText(raw.sourceId, 160),
        lane: LANES.has(raw.lane) ? raw.lane : 'dm',
        kind,
        status,
        atMessage: Math.max(0, toInt(raw.atMessage)),
        timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : 0,
        cp,
        movedCp,
        itemsIn,
        itemsOut,
        itemsMoved: status === 'applied' && raw.itemsMoved !== false,
        party: cleanParty(raw.party),
        partyId: clampText(raw.partyId, 80),
    };
}

export function normalizeLedger(entries) {
    return (Array.isArray(entries) ? entries : [])
        .map(normalizeLedgerEntry)
        .filter(Boolean)
        .slice(-LEDGER_LIMIT);
}

/** One item's identity: the catalog key when one resolves, else the compact name. */
export function itemIdentity(ref) {
    const source = ref?.itemKey || ref?.name || '';
    return normalizeItemKey(source) || String(ref?.name || source).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The same item: one identity, or (fuzzy) the audits' identity rule / the same catalog key. */
export function sameItem(a, b, { fuzzy = false } = {}) {
    if (!a || !b) return false;
    const ia = itemIdentity(a);
    if (ia && ia === itemIdentity(b)) return true;
    if (!fuzzy) return false;
    if (a.itemKey && b.itemKey && a.itemKey === b.itemKey) return true;
    return !!(a.name && b.name && itemIdentityMatches(a.name, b.name));
}

/** Claim signature: one entry per (sourceId, kind, claim) — a re-record replaces. */
function claimSignature(entry) {
    const items = (list) => list.map(item => `${itemIdentity(item)}x${item.quantity}`).join(',');
    return `${entry.kind}|${entry.cp}|${items(entry.itemsIn)}|${items(entry.itemsOut)}`;
}

/** Append one judged movement (applied or ignored). The newest claim of a source wins. */
export function recordEntry(ledger, raw) {
    const current = normalizeLedger(ledger);
    const seq = (current.length > 0 ? Math.max(...current.map(entry => entry.seq)) : 0) + 1;
    const entry = normalizeLedgerEntry({ timestamp: Date.now(), ...raw, seq });
    if (!entry) return current;
    const signature = claimSignature(entry);
    const kept = entry.sourceId
        ? current.filter(prior => !(prior.sourceId === entry.sourceId && claimSignature(prior) === signature))
        : current;
    return [...kept, entry].slice(-LEDGER_LIMIT);
}

/**
 * Resolve a counterparty against the people the engine knows (the roster and
 * the party, one record per name). A name that resolves to exactly one
 * person carries their id; anything else stays a bare string.
 */
export function resolvePartyId(state, party) {
    const name = cleanParty(party);
    if (!name) return '';
    const npcs = Array.isArray(state?.npcs) ? state.npcs : [];
    const known = new Set(npcs.map(npc => String(npc?.name || '').trim().toLowerCase()));
    const companions = (Array.isArray(state?.party) ? state.party : [])
        .filter(member => member?.name && !known.has(String(member.name).trim().toLowerCase()));
    const { npc } = resolveNpcRef([...npcs, ...companions], { name });
    return npc?.id ? String(npc.id).slice(0, 80) : '';
}

const foldParty = (value) => cleanParty(value).toLowerCase().replace(/^(?:the|a|an)\s+/, '').replace(/[^a-z0-9' -]/g, '').trim();

/**
 * How two movements' counterparties relate: `same` (the same person),
 * `different` (two people the roster KNOWS apart), or `unknown`. Different is
 * deliberately narrow — "the guard" and "Sergeant Holt" may be one man, so a
 * pair the engine cannot tell apart keeps the ordinary window.
 */
export function partyRelation(a, b) {
    if (!a?.party || !b?.party) return 'unknown';
    if (a.partyId && b.partyId) return a.partyId === b.partyId ? 'same' : 'different';
    const fa = foldParty(a.party);
    const fb = foldParty(b.party);
    if (fa && fa === fb) return 'same';
    if (fa && fb && namesMatch(a.party, b.party)) return 'same';
    return 'unknown';
}

/** The message index of the newest long rest the rest ledger remembers (-1 when none). */
export function lastLongRestAt(state) {
    let newest = -1;
    for (const entry of Array.isArray(state?.recentRests) ? state.recentRests : []) {
        const parts = String(entry || '').split('|');
        if (parts[1] !== 'long') continue;
        const at = Number(parts[2]);
        if (Number.isFinite(at) && at > newest) newest = at;
    }
    return newest;
}

/**
 * The window a candidate entry is judged in, or null when it can never be a
 * twin of the movement described by `ctx` (two people the roster knows apart).
 */
export function windowFor(entry, ctx) {
    const relation = partyRelation(entry, ctx);
    if (relation === 'different') return null;
    const sameDay = !(Number.isFinite(ctx.restAt) && ctx.restAt > entry.atMessage);
    return relation === 'same' && sameDay ? LONG_WINDOW : SHORT_WINDOW;
}

export function withinWindow(entry, ctx) {
    const window = windowFor(entry, ctx);
    if (window === null) return false;
    const distance = conversationalDistance(ctx.messages, entry.atMessage, ctx.atMessage);
    return distance >= 0 && distance <= window;
}

/**
 * The newest entry matching `predicate` that may be a twin of `ctx`'s
 * movement: an exact-source match needs no window; anything else must sit
 * inside its counterparty window. `crossBase` skips the SAME narration's
 * entries (the audits are already reconciled against their own narration).
 */
export function findTwin(ledger, ctx, predicate, { crossBase = false, exactSource = true } = {}) {
    const entries = normalizeLedger(ledger);
    for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        if (!predicate(entry)) continue;
        if (exactSource && ctx.sourceId && entry.sourceId === ctx.sourceId) return entry;
        if (crossBase && ctx.base && baseOf(entry.sourceId) === ctx.base) continue;
        if (withinWindow(entry, ctx)) return entry;
    }
    return null;
}

/** Base narration-message id of a compound sourceId ("msg-1:scribe-loot:payment" → "msg-1"). */
export function baseOf(sourceId) {
    return String(sourceId || '').split(':')[0];
}

/** Coin-in / coin-out views over the CLAIM (status-blind) or the MOVEMENT (applied only). */
export const claimedIn = (entry) => entry.cp > 0;
export const claimedOut = (entry) => entry.cp < 0;
export const movedIn = (entry) => entry.status === 'applied' && entry.movedCp > 0;
export const movedOut = (entry) => entry.status === 'applied' && entry.movedCp < 0;

/** An entry's items that MOVED in the given direction. */
export function movedItems(entry, direction) {
    if (entry.status !== 'applied' || !entry.itemsMoved) return [];
    return direction === 'in' ? entry.itemsIn : entry.itemsOut;
}

// ── Migration ────────────────────────────────────────────────────────────

const LEGACY_KEYS = ['recentCoinGrants', 'recentCoinLosses', 'recentPurchases', 'recentSales', 'recentItemGrants'];
export const RETIRED_LEDGER_KEYS = LEGACY_KEYS;

/**
 * The five retired ledgers folded into one log (a save written before
 * 2026-11-01). Signatures told their kind; the counterparty was never known.
 */
export function migrateLegacyLedgers(payload) {
    const rows = [];
    const read = (key, map) => {
        for (const raw of Array.isArray(payload?.[key]) ? payload[key] : []) {
            if (!raw || typeof raw !== 'object' || !raw.signature) continue;
            const priceCp = Math.max(0, toInt(raw.priceCp));
            const item = { name: raw.name, itemKey: raw.itemKey, quantity: raw.quantity };
            rows.push({
                ...map(priceCp, item, raw),
                sourceId: raw.sourceId,
                lane: String(raw.sourceId || '').includes(':scribe') ? 'audit' : 'dm',
                status: raw.status,
                atMessage: raw.messageIndex,
                timestamp: raw.timestamp,
            });
        }
    };
    read('recentCoinGrants', (cp) => ({ kind: 'coin', cp, movedCp: cp }));
    read('recentCoinLosses', (cp) => ({ kind: 'coin', cp: -cp, movedCp: -cp }));
    read('recentPurchases', (cp, item) => ({ kind: 'purchase', cp: -cp, movedCp: -cp, itemsIn: [item] }));
    read('recentSales', (cp, item) => ({ kind: 'sale', cp, movedCp: cp, itemsOut: [item] }));
    read('recentItemGrants', (_cp, item) => ({ kind: 'item', itemsIn: [item] }));
    rows.sort((a, b) => (toInt(a.atMessage) - toInt(b.atMessage)) || ((a.timestamp || 0) - (b.timestamp || 0)));
    return normalizeLedger(rows.map((row, i) => ({ ...row, seq: i + 1 })));
}

/** The log a loaded save carries: its own, or the retired ledgers folded in. */
export function loadLedger(payload) {
    if (Array.isArray(payload?.ledger)) return normalizeLedger(payload.ledger);
    return migrateLegacyLedgers(payload);
}

// ── The DM's view ────────────────────────────────────────────────────────

const describeItems = (list) => list
    .map(item => `${item.quantity > 1 ? `${item.quantity}x ` : ''}${item.name || item.itemKey}`)
    .join(', ');

function describeEntry(entry) {
    const amount = formatCurrency(Math.abs(entry.movedCp));
    const party = entry.party;
    switch (entry.kind) {
        case 'purchase':
            return `bought ${describeItems(entry.itemsIn)}${party ? ` from ${party}` : ''}${entry.movedCp < 0 ? ` for ${amount}` : ' (its price was already paid)'}`;
        case 'sale':
            return `sold ${describeItems(entry.itemsOut)}${party ? ` to ${party}` : ''}${entry.movedCp > 0 ? ` for ${amount}` : ''}`;
        case 'handoff':
            return `handed ${describeItems(entry.itemsOut)} to ${party || 'a companion'}`;
        case 'item':
            return entry.itemsIn.length > 0
                ? `received ${describeItems(entry.itemsIn)}${party ? ` from ${party}` : ''}`
                : `gave up ${describeItems(entry.itemsOut)}${party ? ` to ${party}` : ''}`;
        default:
            return entry.movedCp > 0
                ? `received ${amount}${party ? ` from ${party}` : ''}`
                : `paid ${amount}${party ? ` to ${party}` : ''}`;
    }
}

const movedAnything = (entry) => entry.status === 'applied'
    && (entry.movedCp !== 0 || (entry.itemsMoved && (entry.itemsIn.length > 0 || entry.itemsOut.length > 0)));

/**
 * RECENT TRANSACTIONS — the last few movements the engine applied, with whom
 * and how long ago. The receipts in the transcript said the same thing one
 * line at a time and scrolled out of the DM's window; this block is the
 * ledger the DM checks before emitting a coin or item event. Empty when
 * nothing moved inside the long window.
 */
export function formatLedgerForPrompt(ledger, messages, { limit = LEDGER_PROMPT_ROWS } = {}) {
    const list = Array.isArray(messages) ? messages : [];
    const atMessage = Math.max(0, list.length - 1);
    const rows = normalizeLedger(ledger)
        .filter(movedAnything)
        .filter(entry => conversationalDistance(list, entry.atMessage, atMessage) <= LONG_WINDOW)
        .slice(-limit);
    if (rows.length === 0) return '';
    // An entry sits AT the reply that carried it: that reply's own turn is "just now".
    const lines = rows.map(entry => `- ${describeTurnsAgo(list, entry.atMessage + 1) || 'earlier'}: ${describeEntry(entry)}`.slice(0, 160));
    return `## RECENT TRANSACTIONS (the engine's ledger — every row ALREADY happened; never emit a coin or item event for any of them again)\n${lines.join('\n')}`;
}
