/**
 * The durable bestiary + motif tally (WOW 2026-10-26, slice 2).
 *
 * FOE FATIGUE keyed on the enemy NAME's head noun inside a ten-fight ledger:
 * "Eyeless Scavenger" / "Blind Husk" / "Ghoul" / "Undead Thing" were four
 * families to the engine and one creature to the player, and a trope the DM
 * reached for every fourth dungeon never tripped the threshold across a long
 * campaign. The scenery half (the timber outpost, the pines) had no
 * structured source at all.
 *
 * This is the campaign-level count: a key per creature ARCHETYPE (the
 * Scribe's plain-words kind met at a hostile site, the head-noun family as
 * the fight-time fallback) and per imagery MOTIF (≤2 per place), counted
 * across DISTINCT location records and distinct fights, never pruned by a
 * window. The tempo block says it once, plainly, as a negative list — the
 * stock-name list proved a negative list moves these models.
 */
import { cleanText, isRecord } from './text.js';
import { clampMessageStamp } from './replayLedger.js';

export const MOTIF_KEY_MAX = 40;
/** The tally's ceiling; the lowest count (then the oldest) leaves first. */
export const MAX_WORLD_MOTIFS = 40;
/** A key the world has shown this often is worn. */
export const WORN_MOTIF_THRESHOLD = 3;
/** The tempo line names at most this many worn keys, highest count first. */
export const WORN_MOTIFS_LINE_CAP = 8;
/** Imagery motifs a place may carry. */
export const MAX_MOTIFS_PER_PLACE = 2;

const PLACEHOLDER_RE = /^(?:none|n\/a|null|unknown|nothing|omit|-|—)$/i;

/** Lowercase, punctuation-folded, clamped; null for junk or a placeholder. */
export function normalizeMotifKey(value) {
    if (typeof value !== 'string') return null;
    const raw = cleanText(value, MOTIF_KEY_MAX * 2).toLowerCase();
    if (!raw || PLACEHOLDER_RE.test(raw)) return null;
    const text = raw
        .replace(/[^a-z0-9'\- ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MOTIF_KEY_MAX)
        .trim();
    if (!text || text.length < 3 || PLACEHOLDER_RE.test(text)) return null;
    return text;
}

/** A scalar or list of motif texts → deduped keys, capped. */
export function normalizeMotifList(raw, cap = MAX_MOTIFS_PER_PLACE) {
    const list = Array.isArray(raw) ? raw : (raw === undefined || raw === null ? [] : [raw]);
    const out = [];
    for (const entry of list) {
        const key = normalizeMotifKey(entry);
        if (key && !out.includes(key)) out.push(key);
        if (out.length >= cap) break;
    }
    return out;
}

function entryOf(value, maxMessageCount) {
    if (!isRecord(value)) return null;
    const count = Math.floor(Number(value.count));
    if (!Number.isFinite(count) || count < 1) return null;
    const stamp = clampMessageStamp(value.lastMessage, maxMessageCount);
    return { count, lastMessage: stamp === null ? 0 : stamp };
}

function trimTally(tally) {
    const keys = Object.keys(tally);
    if (keys.length <= MAX_WORLD_MOTIFS) return tally;
    const keep = keys
        .sort((a, b) => (tally[b].count - tally[a].count) || (tally[b].lastMessage - tally[a].lastMessage))
        .slice(0, MAX_WORLD_MOTIFS);
    const out = {};
    for (const key of keep) out[key] = tally[key];
    return out;
}

/** Load twin: typed keys, typed entries, the cap. */
export function sanitizeWorldMotifs(raw, { maxMessageCount } = {}) {
    if (!isRecord(raw)) return {};
    const out = {};
    for (const [rawKey, value] of Object.entries(raw)) {
        const key = normalizeMotifKey(rawKey);
        const entry = entryOf(value, maxMessageCount);
        if (!key || !entry) continue;
        if (Object.hasOwn(out, key)) {
            out[key] = { count: out[key].count + entry.count, lastMessage: Math.max(out[key].lastMessage, entry.lastMessage) };
        } else {
            out[key] = entry;
        }
    }
    return trimTally(out);
}

/**
 * Count the keys one more time each (one sighting per key per call — a
 * fight with three ghouls is one ghoul fight). Returns the same object when
 * nothing lands.
 */
export function recordWorldMotifs(tally, keys, { atMessage = 0 } = {}) {
    const base = isRecord(tally) ? tally : {};
    const normalized = [...new Set((Array.isArray(keys) ? keys : [keys]).map(normalizeMotifKey).filter(Boolean))];
    if (normalized.length === 0) return base;
    const stamp = Number.isFinite(Number(atMessage)) ? Math.max(0, Math.floor(Number(atMessage))) : 0;
    const next = { ...base };
    for (const key of normalized) {
        const held = next[key];
        next[key] = { count: (held?.count || 0) + 1, lastMessage: Math.max(stamp, held?.lastMessage || 0) };
    }
    return trimTally(next);
}

/** The worn keys — count ≥ threshold — highest count first, capped. */
export function listWornMotifs(tally, { threshold = WORN_MOTIF_THRESHOLD, limit = WORN_MOTIFS_LINE_CAP } = {}) {
    if (!isRecord(tally)) return [];
    return Object.entries(tally)
        .filter(([, entry]) => entry?.count >= threshold)
        .sort((a, b) => (b[1].count - a[1].count) || (b[1].lastMessage - a[1].lastMessage))
        .slice(0, limit)
        .map(([key, entry]) => ({ key, count: entry.count }));
}

/**
 * The tempo block's ONE standing variety line, or '' below the threshold.
 * A negative list, said plainly: what this world has already shown, and the
 * rule that a new place or foe is none of it unless canon puts it HERE.
 */
export function describeWornMotifs(tally) {
    const worn = listWornMotifs(tally);
    if (worn.length === 0) return '';
    const list = worn.map(({ key, count }) => `${key} ×${count}`).join(', ');
    return `THIS WORLD HAS ALREADY SHOWN: ${list}. A new place, foe, or set-dressing is NONE of these unless the player hunts them or established canon puts them in THIS exact place — a different land has a different look, a different people, and its own dead and wilds: new species, new imagery, new tactics, new mood.`;
}
