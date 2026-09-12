/**
 * NPC roster promotion — separates durable characters from combat fodder.
 * Legacy saves grandfather every existing NPC as a character so long-running
 * campaigns keep early antagonists (e.g. a starting-town captain).
 */

import { NPC_DOSSIER_FIELD_MAX, NPC_GENDER_MAX, NPC_SPECIES_MAX } from '../config/contentLimits.js';
import { sanitizePortraitUrl } from './portraitUrl.js';
import { conversationalDistance } from './replayLedger.js';
import { coverage, tokenSet } from './textMatch.js';

export const NPC_ROSTER_TIERS = new Set(['character', 'archived_creature']);
export const NPC_KINDS = new Set(['character', 'creature', 'ephemeral']);

const GENERIC_SPECIES = new Set([
    'goblin', 'goblinoid', 'hobgoblin', 'bugbear', 'orc', 'half-orc', 'bandit', 'thug',
    'guard', 'soldier', 'sentry', 'zombie', 'skeleton', 'wolf', 'warg', 'rat', 'spider',
    'cultist', 'acolyte', 'imp', 'demon', 'fiend', 'beast', 'monster', 'enemy', 'foe',
    'raider', 'marauder', 'brigand', 'scout', 'archer', 'warrior', 'fighter', 'mage',
    'wizard', 'cleric', 'priest', 'druid', 'knight', 'peasant', 'villager', 'farmer',
    'troll', 'ogre', 'gnoll', 'kobold', 'gnome', 'drow',
]);

const GENERIC_EPITHETS = new Set([
    'runt', 'grunt', 'minion', 'lackey', 'henchman', 'fodder', 'skirmisher', 'crawler',
    'stalker', 'shaman', 'berserker', 'brute', 'snarl', 'fang', 'claw', 'young', 'elder',
    'cave', 'forest', 'swamp', 'mountain', 'tunnel', 'patrol', 'wounded', 'snarling',
    'angry', 'hostile', 'sneaky', 'sneak', 'lone', 'pack', 'alpha', 'beta', 'gamma',
    'scout', 'archer', 'warrior', 'fighter', 'sentry', 'raider', 'marauder', 'brigand',
    'chieftain', 'chief', 'boss', 'king', 'queen', 'captain', 'lieutenant', 'adept',
    'acolyte', 'cultist', 'priest', 'shaman', 'berserker', 'hunter', 'stabber', 'slasher',
    'spearman', 'swordsman', 'axeman', 'bowman',
]);

const DISAMBIGUATOR = /^(?:[a-z]|\d{1,3}|i{1,3}|iv|v|vi{0,3}|ix|x|one|two|three|four|five)$/i;

// Mirror of characterVault's sanitizeImageUrl allowlist, kept local so this
// module stays dependency-free. A loaded save is untrusted input: only the two
// sources portraits can legitimately come from survive normalization.

const COMBAT_ONLY_NOTE = /\b(attack|fought|slain|killed|defeated|stabbed|shot|arrow|spear|sword|combat|battle|ambush|patrol)\b/i;

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

/** Journal dossier fields — full depth for player review and Scribe context.
 * Canonical value lives in config/contentLimits.js; re-exported here for the
 * roster's own consumers (npcEnrichment, tests). */
export { NPC_DOSSIER_FIELD_MAX };
/** Compact excerpts injected into the live DM prompt. */
export const NPC_PROMPT_FIELD_MAX = 180;
export const NPC_HOOK_FIELD_MAX = 200;
export const NPC_PLACE_FIELD_MAX = 120;

/** One recorded personal beat between the hero and an NPC. */
export const NPC_BOND_MOMENT_MAX = 220;
/** Storage cap (evicted by salience, see trimBondMoments); prompt and card
 * injection are bounded separately through splitBondMoments. */
export const MAX_NPC_BOND_MOMENTS = 10;

const BOND_STOP_WORDS = new Set([
    'the', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'was', 'were', 'and', 'or',
    'that', 'this', 'it', 'its', 'their', 'his', 'her', 'has', 'have', 'had',
    'by', 'for', 'with', 'at', 'on', 'as', 'be', 'been', 'from', 'now', 'not', 'no',
    'hero', 'player',
]);

function meaningfulTokens(text) {
    return tokenSet(text, { stopWords: BOND_STOP_WORDS });
}

/** True when `container` holds at least `threshold` of `contained`'s meaningful tokens. */
function coversTokens(container, contained, threshold) {
    if (contained.size === 0) return true;
    if (container.size === 0) return false;
    return coverage(contained, container) >= threshold;
}

/** Same containment heuristic as the world-fact dedupe: a text whose meaningful
 * tokens are ~all inside an existing one is a restatement, not new material.
 * Exported for capped append-only lists elsewhere (companion keepsakes). */
export function isNearDuplicateText(candidate, existingText) {
    const tokens = meaningfulTokens(candidate);
    const existing = meaningfulTokens(existingText);
    if (tokens.size === 0) return true;
    if (existing.size === 0) return false;
    const small = tokens.size <= existing.size ? tokens : existing;
    const large = tokens.size <= existing.size ? existing : tokens;
    return coversTokens(large, small, 0.9);
}

/**
 * Bond-moment KINDS (2026-09-12, tiered character cards). Coarse on purpose:
 * the scene-collapse rule keys on them — four positions in one night are ONE
 * `intimacy` moment — so a kind must be broad enough that a scene's repeated
 * beats share it and distinct enough that a kiss and a confession the same
 * night stay two moments. `other` never collapses (an ungraded beat could be
 * anything). Unknown kinds normalize to null (legacy rows carry none).
 */
export const BOND_MOMENT_KINDS = new Set([
    'meeting', 'flirtation', 'intimacy', 'confession', 'promise', 'gift', 'rescue',
    'shared_danger', 'betrayal', 'quarrel', 'reconciliation', 'farewell', 'other',
]);
/** Salience 1..5: 5 redefines the relationship, 4 a beat both would recall
 * years later, 3 memorable (the ungraded default), 2 texture, 1 trivial. */
export const BOND_SALIENCE_DEFAULT = 3;
/** A moment at or above this salience is a KEY moment of the bond. */
export const BOND_KEY_SALIENCE = 4;
/** Same-kind moments this close (raw message rows — a dice turn burns ~5)
 * are one scene's beat; the same window separates "observed again in a
 * LATER scene" from "restated in the same scene" for impressions. */
export const BOND_SCENE_WINDOW_MESSAGES = 16;
/** How many key moments a card and the DM prompt lead with. */
export const MAX_KEY_BOND_MOMENTS = 5;

export function normalizeBondMomentKind(value) {
    const kind = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
    return BOND_MOMENT_KINDS.has(kind) ? kind : null;
}

export function normalizeBondSalience(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(1, Math.min(5, Math.round(n)));
}

function bondSalience(moment) {
    return normalizeBondSalience(moment?.salience) ?? BOND_SALIENCE_DEFAULT;
}

/** Human label for a kind chip ("shared_danger" → "shared danger"). */
export function bondKindLabel(kind) {
    const normalized = normalizeBondMomentKind(kind);
    return normalized && normalized !== 'other' ? normalized.replace(/_/g, ' ') : '';
}

/** Typed row: `{ text, at }` plus OPTIONAL `kind` / `salience` / `atMessage`
 * — only carried when valid, so a legacy `{ text, at }` row round-trips
 * byte-identical and the grading stays honest (absent ≠ default). */
export function normalizeBondMoments(list = []) {
    const rows = (Array.isArray(list) ? list : [])
        .map(entry => {
            // A text field is a TYPE assumption: an object `text` must not
            // become "[object Object]" canon.
            const source = typeof entry === 'string' ? entry : (typeof entry?.text === 'string' ? entry.text : '');
            const text = clampNpcDossierField(source, NPC_BOND_MOMENT_MAX);
            if (!text) return null;
            const at = Number.isFinite(entry?.at) ? entry.at : Date.now();
            const kind = normalizeBondMomentKind(entry?.kind);
            const salience = normalizeBondSalience(entry?.salience);
            const atMessage = Number.isFinite(entry?.atMessage) ? Math.max(0, Math.floor(entry.atMessage)) : null;
            return {
                text,
                at,
                ...(kind && { kind }),
                ...(salience !== null && { salience }),
                ...(atMessage !== null && { atMessage }),
            };
        })
        .filter(Boolean);
    return trimBondMoments(rows);
}

/** Cap by VALUE, not age: the lowest-salience moments fall off first, the
 * oldest among equals — a salience-5 first night can never be pushed out by
 * four tavern jokes. Chronological order is preserved. */
function trimBondMoments(list, cap = MAX_NPC_BOND_MOMENTS) {
    if (list.length <= cap) return list;
    const ranked = list.map((moment, index) => ({ moment, index }))
        .sort((a, b) => (bondSalience(a.moment) - bondSalience(b.moment)) || (a.index - b.index));
    const dropped = new Set(ranked.slice(0, list.length - cap).map(entry => entry.index));
    return list.filter((_, index) => !dropped.has(index));
}

function findSameSceneMoment(list, addition) {
    const kind = addition.kind;
    if (!kind || kind === 'other' || !Number.isFinite(addition.atMessage)) return -1;
    return list.findIndex(moment => moment.kind === kind
        && Number.isFinite(moment.atMessage)
        && Math.abs(addition.atMessage - moment.atMessage) <= BOND_SCENE_WINDOW_MESSAGES);
}

/**
 * Append-only merge: new beats join the record, restatements are dropped,
 * and the list never exceeds its cap. Two filters stand between a turn and
 * the record (2026-09-12): (1) SCENE COLLAPSE — a same-kind moment within
 * BOND_SCENE_WINDOW_MESSAGES of one already held is the same scene's beat,
 * so it is dropped (or, if graded MORE salient, its text replaces the held
 * one at the held moment's time) — a night together is one moment however
 * many turns it spans; (2) SALIENCE EVICTION (trimBondMoments). Additions
 * without `atMessage` are stamped with `messageCount` when given.
 */
export function appendBondMoments(existing = [], additions = [], { messageCount } = {}) {
    let next = normalizeBondMoments(existing);
    for (const raw of normalizeBondMoments(additions)) {
        const addition = (raw.atMessage === undefined && Number.isFinite(messageCount))
            ? { ...raw, atMessage: Math.max(0, Math.floor(messageCount)) }
            : raw;
        if (next.some(moment => isNearDuplicateText(addition.text, moment.text))) continue;
        const sceneIdx = findSameSceneMoment(next, addition);
        if (sceneIdx !== -1) {
            const held = next[sceneIdx];
            if (bondSalience(addition) > bondSalience(held)) {
                next = next.map((moment, i) => (i === sceneIdx
                    ? { ...held, text: addition.text, salience: addition.salience }
                    : moment));
            }
            continue;
        }
        next = [...next, addition];
    }
    return trimBondMoments(next);
}

function selectKeyFromNormalized(list, limit) {
    const seenKinds = new Set();
    const scored = [];
    list.forEach((moment, index) => {
        const explicit = normalizeBondSalience(moment.salience);
        const firstOfKind = !!moment.kind && moment.kind !== 'other' && !seenKinds.has(moment.kind);
        if (moment.kind) seenKinds.add(moment.kind);
        const qualifies = (explicit !== null && explicit >= BOND_KEY_SALIENCE) || firstOfKind;
        if (!qualifies) return;
        scored.push({ moment, index, score: bondSalience(moment) * 10 + (firstOfKind ? 5 : 0) });
    });
    return scored
        .sort((a, b) => (b.score - a.score) || (a.index - b.index))
        .slice(0, limit)
        .sort((a, b) => a.index - b.index)
        .map(entry => entry.moment);
}

/**
 * The KEY moments of a bond — the turning points a card leads with and the
 * DM plays from: salience >= BOND_KEY_SALIENCE, or the FIRST moment of an
 * explicit kind (the first kiss outranks the fourth). Chronological, capped.
 * Ungraded legacy rows never qualify — they stay on the "lately" shelf until
 * live play or Deepen memory grades them.
 */
export function selectKeyBondMoments(moments = [], limit = MAX_KEY_BOND_MOMENTS) {
    return selectKeyFromNormalized(normalizeBondMoments(moments), limit);
}

function bondTextKey(text) {
    return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * REGRADE existing bond moments (Deepen memory, 2026-09-12 follow-up): every
 * moment recorded before the tiers exists ungraded and can never become a
 * key moment on its own. A grade is `{ text, kind, salience, sameSceneAs? }`
 * where `text` must match an existing row VERBATIM (whitespace/case-folded)
 * — the engine never changes a row's text, never adds or invents a row, and
 * never regrades a row that already carries a kind or salience (live play's
 * grade stands). `sameSceneAs` names an EARLIER existing row this moment is
 * the same scene's beat of: the two fold to one ONLY when they end up the
 * same kind, keeping the more salient text (the earlier on a tie) at the
 * earlier row's time — the legacy twin of appendBondMoments' scene collapse,
 * which needs `atMessage` stamps legacy rows do not have.
 */
export function gradeBondMoments(existing = [], grades = []) {
    const rows = normalizeBondMoments(existing);
    if (rows.length === 0 || !Array.isArray(grades)) return rows;
    const indexByText = new Map(rows.map((row, index) => [bondTextKey(row.text), index]));
    let next = rows.map(row => ({ ...row }));
    const folds = [];
    for (const grade of grades) {
        if (!grade || typeof grade !== 'object') continue;
        const index = indexByText.get(bondTextKey(grade.text));
        if (index === undefined) continue;
        const row = next[index];
        if (row.kind !== undefined || row.salience !== undefined) continue;
        const kind = normalizeBondMomentKind(grade.kind);
        const salience = normalizeBondSalience(grade.salience);
        if (!kind && salience === null) continue;
        next[index] = { ...row, ...(kind && { kind }), ...(salience !== null && { salience }) };
        const earlier = indexByText.get(bondTextKey(grade.sameSceneAs));
        if (earlier !== undefined && earlier < index) folds.push([earlier, index]);
    }
    const dropped = new Set();
    for (const [earlier, later] of folds) {
        if (dropped.has(earlier) || dropped.has(later)) continue;
        const a = next[earlier];
        const b = next[later];
        if (!a.kind || a.kind === 'other' || a.kind !== b.kind) continue;
        if (bondSalience(b) > bondSalience(a)) {
            next[earlier] = { ...a, text: b.text, salience: b.salience };
        }
        dropped.add(later);
    }
    next = next.filter((_, index) => !dropped.has(index));
    return normalizeBondMoments(next);
}

/** `{ key, recent }`: the key moments (chronological) and everything else,
 * NEWEST FIRST — the two shelves every card and prompt line render from. */
export function splitBondMoments(moments = [], { keyLimit = MAX_KEY_BOND_MOMENTS } = {}) {
    const list = normalizeBondMoments(moments);
    const key = selectKeyFromNormalized(list, keyLimit);
    const keySet = new Set(key);
    return { key, recent: list.filter(moment => !keySet.has(moment)).reverse() };
}

/**
 * Durable dossier prose (personality, goals, secrets, stance toward the hero)
 * ACCUMULATES — live play showed per-turn Scribe/DM fragments ("impressed by the
 * hero's swordplay just now") wholesale replacing a rich record and erasing the
 * relationship's history every exchange. Deterministic merge policy:
 * - incoming covers the known record's tokens → a complete rewrite; replace
 * - known record covers the incoming tokens → a restatement; keep the record
 * - otherwise genuinely new material → append chronologically
 * When an append exceeds the cap, the OLDEST sentences fall off first so the
 * newest canon always survives.
 */
export const NPC_DURABLE_TEXT_FIELDS = ['personality', 'goals', 'secrets', 'stanceToPlayer'];

function dropLeadingSentence(text) {
    const match = text.match(/^[^.!?…]*[.!?…]+["')\]]*\s+/);
    if (!match || match[0].length >= text.length) return null;
    return text.slice(match[0].length).trim();
}

/** Split dossier prose into comparable clause units — sentences AND
 * semicolon-joined clauses. The Scribe writes stance fields as semicolon lists,
 * which is exactly where verbatim repeats hid from the whole-field check
 * (live 2026-08-28: "Hysterical, burning hatred." accreted four times on one
 * card, and "Deep physical intimacy and mutual desire" twice). */
function splitDossierClauses(text) {
    return String(text || '')
        .split(/(?<=[.!?…]["')\]]*)\s+|;\s*/)
        .map(clause => clause.trim())
        .filter(Boolean);
}

// A clause whose meaningful tokens are ~all inside one existing clause is a
// restatement of that clause. Lower than the whole-field 0.85: clauses are
// short, so a repeat usually covers completely or not at all.
const CLAUSE_RESTATEMENT_THRESHOLD = 0.8;

export function mergeNpcDossierText(existingText, incomingText, max = NPC_DOSSIER_FIELD_MAX) {
    const prev = clampNpcDossierField(existingText, max);
    const next = clampNpcDossierField(incomingText, max);
    if (!prev) return next;
    if (!next) return prev;

    const prevTokens = meaningfulTokens(prev);
    const nextTokens = meaningfulTokens(next);
    if (coversTokens(nextTokens, prevTokens, 0.85)) return next;
    if (coversTokens(prevTokens, nextTokens, 0.85)) return prev;

    // Clause-level novelty filter (2026-08-28): an incoming update usually
    // restates most of the known record and adds one new beat. The old
    // whole-field append kept the restated clauses too, so records accreted the
    // same sentence in slightly different costumes. Append ONLY the clauses no
    // known clause already covers; kept clauses keep their punctuation.
    const knownClauses = splitDossierClauses(prev).map(clause => meaningfulTokens(clause));
    const keptTokenSets = [];
    const novelClauses = [];
    for (const clause of splitDossierClauses(next)) {
        const tokens = meaningfulTokens(clause);
        const restates = [...knownClauses, ...keptTokenSets]
            .some(known => coversTokens(known, tokens, CLAUSE_RESTATEMENT_THRESHOLD));
        if (restates) continue;
        keptTokenSets.push(tokens);
        novelClauses.push(/[.!?…]["')\]]*$/.test(clause) ? clause : `${clause}.`);
    }
    if (novelClauses.length === 0) return prev;
    const addition = novelClauses.join(' ');

    let merged = /[.!?…]["')\]]*$/.test(prev) ? `${prev} ${addition}` : `${prev}; ${addition}`;
    while (merged.length > max) {
        const shorter = dropLeadingSentence(merged);
        if (!shorter) return clampNpcDossierField(merged, max);
        merged = shorter;
    }
    return merged;
}

/**
 * CORE dossier prose — personality and the stance toward the hero — is the
 * PERMANENT tier of a character card, and permanence is EARNED (2026-09-12,
 * DECISIONS.md tiered character cards): a fragment the Scribe observed in ONE
 * scene ("wants him again", "gruff tonight") is an impression, not a trait,
 * and used to append straight into the record until one tavern evening or
 * one night together WAS the card. Impressions wait on a "lately" shelf
 * (`recentImpressions`, per field) and graduate into the core only when the
 * fiction bears them out again in a LATER scene — a restating fragment more
 * than BOND_SCENE_WINDOW_MESSAGES later, or a complete rewrite that carries
 * them. Unconfirmed impressions expire after NPC_IMPRESSION_TTL_MESSAGES.
 * `goals` and `secrets` stay on the direct merge: they are declared canon,
 * not observed traits.
 */
export const NPC_CORE_TEXT_FIELDS = ['personality', 'stanceToPlayer'];
export const MAX_NPC_IMPRESSIONS = 6;
export const NPC_IMPRESSION_TTL_MESSAGES = 60;
export const NPC_IMPRESSION_MAX = 200;

/** Typed, deduped, expired, capped: `[{ field, text, atMessage? }]`. */
export function normalizeImpressions(list = [], { messageCount } = {}) {
    const out = [];
    for (const entry of (Array.isArray(list) ? list : [])) {
        if (!entry || typeof entry !== 'object') continue;
        if (!NPC_CORE_TEXT_FIELDS.includes(entry.field)) continue;
        if (typeof entry.text !== 'string') continue;
        const text = clampNpcDossierField(entry.text, NPC_IMPRESSION_MAX);
        if (!text) continue;
        const atMessage = Number.isFinite(entry.atMessage) ? Math.max(0, Math.floor(entry.atMessage)) : null;
        if (Number.isFinite(messageCount) && atMessage !== null
            && messageCount - atMessage > NPC_IMPRESSION_TTL_MESSAGES) continue;
        if (out.some(known => known.field === entry.field && isNearDuplicateText(text, known.text))) continue;
        out.push({ field: entry.field, text, ...(atMessage !== null && { atMessage }) });
    }
    return out.slice(-MAX_NPC_IMPRESSIONS);
}

/** The live (unexpired) impression texts for one core field, oldest first. */
export function listNpcImpressions(npc = {}, field = 'stanceToPlayer', { messageCount } = {}) {
    return normalizeImpressions(npc?.recentImpressions, { messageCount })
        .filter(entry => entry.field === field)
        .map(entry => entry.text);
}

function clauseTokensMatch(aTokens, bTokens) {
    if (aTokens.size === 0 || bTokens.size === 0) return false;
    const small = aTokens.size <= bTokens.size ? aTokens : bTokens;
    const large = aTokens.size <= bTokens.size ? bTokens : aTokens;
    return coversTokens(large, small, CLAUSE_RESTATEMENT_THRESHOLD);
}

/**
 * Merge an incoming core-field text against the record AND its pending
 * impressions → `{ text, impressions }`.
 * - no record yet → the incoming text IS the record (a first impression is
 *   all we know; later rewrites can still replace it)
 * - incoming covers the record → a complete rewrite (the Scribe merged with
 *   KNOWN context): replace; impressions the rewrite restates are absorbed
 * - record covers incoming → a restatement: keep
 * - otherwise each novel clause is judged: one that restates an impression
 *   from an EARLIER scene is CONFIRMED and merges into the core through
 *   mergeNpcDossierText; a first-time clause becomes an impression; a
 *   same-scene restatement stays pending (already recorded).
 */
export function mergeNpcCoreText(existingText, incomingText, impressions = [], { field, messageCount, max = NPC_DOSSIER_FIELD_MAX } = {}) {
    const prev = clampNpcDossierField(existingText, max);
    const next = clampNpcDossierField(incomingText, max);
    const pending = normalizeImpressions(impressions, { messageCount });
    if (!next || !NPC_CORE_TEXT_FIELDS.includes(field)) return { text: prev, impressions: pending };
    if (!prev) return { text: next, impressions: pending };

    const mine = pending.filter(entry => entry.field === field);
    const others = pending.filter(entry => entry.field !== field);
    const prevTokens = meaningfulTokens(prev);
    const nextTokens = meaningfulTokens(next);
    if (coversTokens(nextTokens, prevTokens, 0.85)) {
        const kept = mine.filter(entry => !coversTokens(nextTokens, meaningfulTokens(entry.text), CLAUSE_RESTATEMENT_THRESHOLD));
        return { text: next, impressions: [...others, ...kept] };
    }
    if (coversTokens(prevTokens, nextTokens, 0.85)) return { text: prev, impressions: pending };

    const knownClauses = splitDossierClauses(prev).map(clause => meaningfulTokens(clause));
    const confirmed = [];
    const fresh = [];
    let remaining = mine;
    for (const clause of splitDossierClauses(next)) {
        const tokens = meaningfulTokens(clause);
        if (tokens.size === 0) continue;
        if (knownClauses.some(known => coversTokens(known, tokens, CLAUSE_RESTATEMENT_THRESHOLD))) continue;
        const idx = remaining.findIndex(entry => clauseTokensMatch(meaningfulTokens(entry.text), tokens));
        if (idx !== -1) {
            const impression = remaining[idx];
            const laterScene = !Number.isFinite(messageCount) || !Number.isFinite(impression.atMessage)
                || (messageCount - impression.atMessage) > BOND_SCENE_WINDOW_MESSAGES;
            if (laterScene) {
                confirmed.push(/[.!?…]["')\]]*$/.test(clause) ? clause : `${clause}.`);
                remaining = remaining.filter((_, i) => i !== idx);
            }
            continue;
        }
        fresh.push({ field, text: clause, ...(Number.isFinite(messageCount) && { atMessage: Math.max(0, Math.floor(messageCount)) }) });
    }
    const text = confirmed.length > 0 ? mergeNpcDossierText(prev, confirmed.join(' '), max) : prev;
    return { text, impressions: normalizeImpressions([...others, ...remaining, ...fresh], { messageCount }) };
}

/** Callback hooks are a rolling shortlist, not a per-turn scratchpad: new hooks
 * join the record, restatements are dropped, and the oldest fall off at the cap. */
export const MAX_NPC_CALLBACK_HOOKS = 5;

// Words that cannot legitimately END an English phrase — a hook ending on one
// was cut (a repaired truncated JSON string, or the old render trimmer's
// leftovers). Deliberately conservative: function words with common phrase-final
// idioms stay OUT (for: "worth fighting for"; with: "reckoned with"; about:
// "won't talk about"; against: "up against"; been/was/that and the modals:
// elliptical finals) — over-trimming mutilates healthy hooks, which is how the
// old "strip any short last word" heuristic turned the stored hook "The sound
// of her blade being drawn" into the displayed stub "The sound of her blade
// being". Known cosmetic cost: a hook ending in the idiom "for the time being"
// still trims — the truncation reading is far more common in this register.
const HOOK_NEVER_FINAL_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'of', 'to', 'at', 'by',
    'from', 'into', 'onto', 'upon', 'as', 'than', 'which', 'who', 'whom',
    'whose', 'while', 'because', 'though', 'although', 'unless', 'whether',
    'toward', 'towards', 'during', 'despite', 'versus', 'via', 'per',
    'being', 'having', 'their', 'its', 'my', 'our', 'your', 'if',
]);
// Function words a mid-word cut can leave a recognizable prefix of ("abou" →
// about, "bein" → being, "becaus" → because) — includes phrase-final-capable
// ones the never-final set deliberately omits.
const HOOK_FRAGMENT_PREFIX_SOURCES = [
    ...HOOK_NEVER_FINAL_WORDS,
    'about', 'with', 'for', 'against', 'without', 'within', 'since', 'when',
    'where', 'that', 'would', 'could', 'should', 'there', 'them', 'they',
    'been', 'have', 'does', 'might', 'must', 'shall', 'will',
];
// Real words that happen to be prefixes of the sources above ("with" ⊂
// "without", "again" ⊂ "against") — never treated as fragments.
const HOOK_PREFIX_EXEMPT_WORDS = new Set(['again', 'with', 'whet', 'thou']);
// 1-2 letter tokens that are real words and may legitimately end a phrase
// ("never gave up", "how she survived it").
const HOOK_SHORT_FINAL_WORDS = new Set(['up', 'it', 'me', 'us', 'he', 'we', 'go', 'so', 'no', 'do', 'ok', 'on', 'in']);

/**
 * Normalize one callback hook, unwinding the tail a truncation leaves behind:
 * a repaired truncated JSON string stores fragments like "The sound of her
 * blade being dr", and a phrase can never end on a dangling function word.
 * A hook that terminates in sentence punctuation is complete and untouched;
 * healthy unpunctuated hooks ("Owes the hero three silver") pass verbatim —
 * unlike the pre-2026-08-28 heuristic, a short final CONTENT word ("again",
 * "drawn", "blade") is never eaten. A hook trimmed down to under three words
 * was mostly truncation — dropped, a stub is worse than no hook.
 */
export function normalizeCallbackHook(value) {
    const cleaned = clampNpcDossierField(typeof value === 'string' ? value : value?.text, NPC_HOOK_FIELD_MAX);
    if (!cleaned) return '';
    if (/[.!?…]["')\]]*$/.test(cleaned)) return cleaned;

    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return cleaned;
    const core = word => word.toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, '');

    let end = words.length;
    const last = core(words[end - 1]);
    const lastLooksCut =
        (last.length > 0 && last.length <= 2 && !/\p{N}/u.test(last)
            && !HOOK_SHORT_FINAL_WORDS.has(last) && !HOOK_NEVER_FINAL_WORDS.has(last))
        || (last.length >= 4 && !HOOK_PREFIX_EXEMPT_WORDS.has(last)
            && HOOK_FRAGMENT_PREFIX_SOURCES.some(w => w.length > last.length && w.startsWith(last)));
    if (lastLooksCut) end -= 1;
    while (end > 0 && HOOK_NEVER_FINAL_WORDS.has(core(words[end - 1]))) end -= 1;

    if (end === words.length) return cleaned;
    if (end < 3) return '';
    return words.slice(0, end).join(' ').trim();
}

export function appendCallbackHooks(existing = [], additions = []) {
    // normalizeCallbackHook runs on the EXISTING list too, so a stored
    // truncation fragment self-cleans the next time this NPC's hooks merge.
    const clean = list => (Array.isArray(list) ? list : [])
        .map(hook => normalizeCallbackHook(hook))
        .filter(Boolean);
    let next = clean(existing);
    for (const hook of clean(additions)) {
        if (next.some(existingHook => isNearDuplicateText(hook, existingHook))) continue;
        next = [...next, hook];
    }
    return next.slice(-MAX_NPC_CALLBACK_HOOKS);
}

export function clampNpcDossierField(value, max = NPC_DOSSIER_FIELD_MAX) {
    const cleaned = cleanText(value);
    if (!cleaned || cleaned.length <= max) return cleaned;

    const slice = cleaned.slice(0, max);
    const sentenceEnd = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
    );
    if (sentenceEnd >= Math.floor(max * 0.55)) {
        return slice.slice(0, sentenceEnd + 1).trim();
    }

    const space = slice.lastIndexOf(' ');
    return (space > 0 ? slice.slice(0, space) : slice).trim();
}

export function briefNpcFieldForPrompt(value, max = NPC_PROMPT_FIELD_MAX) {
    const cleaned = cleanText(value);
    if (!cleaned) return '';
    if (cleaned.length <= max) return cleaned;
    return `${cleaned.slice(0, Math.max(0, max - 1)).trim()}…`;
}

/** Loose place match — "Jewelglade" matches "Jewelglade, east gate". */
export function locationMatchesPlace(playerLocation, npcPlace) {
    const player = cleanText(playerLocation).toLowerCase().replace(/^the\s+/, '');
    const place = cleanText(npcPlace).toLowerCase().replace(/^the\s+/, '');
    if (!player || !place) return false;
    return player === place || player.includes(place) || place.includes(player);
}

function tokenizeCreatureName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .replace(/[-']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
}

function isDisambiguatorToken(token) {
    return DISAMBIGUATOR.test(cleanText(token));
}

function isGenericModifierToken(token) {
    const t = cleanText(token);
    if (!t) return false;
    return GENERIC_SPECIES.has(t)
        || GENERIC_EPITHETS.has(t)
        || isDisambiguatorToken(t)
        || t === 'with'
        || t === 'a'
        || t === 'an'
        || t === 'the';
}

export function isGenericCreatureName(name) {
    const raw = cleanText(name);
    if (!raw) return true;
    const lower = raw.toLowerCase();

    if (/^(a|an|the)\s+/.test(lower)) return true;
    if (/#\d+\b/.test(lower) || /\bnumber\s+\d+\b/.test(lower)) return true;
    if (/\bwith\s+(a\s+)?(spear|sword|axe|bow|dagger|club|mace|shield|armor)\b/.test(lower)) return true;
    if (/\bgoblin\s+runt\b/.test(lower)) return true;
    if (/\b(goblin|orc|hobgoblin|bugbear|warg|wolf|bandit|skeleton|zombie)\s+[a-z]\b/i.test(lower)) return true;

    const tokens = tokenizeCreatureName(lower);
    if (tokens.length === 0) return true;

    const speciesIndexes = tokens
        .map((token, index) => (GENERIC_SPECIES.has(token) ? index : -1))
        .filter(index => index >= 0);
    if (speciesIndexes.length === 0) return false;

    if (tokens.length === 1 && GENERIC_SPECIES.has(tokens[0])) return true;

    if (tokens.length <= 6 && tokens.every(isGenericModifierToken)) return true;

    if (tokens.length === 2 && GENERIC_SPECIES.has(tokens[1]) && GENERIC_EPITHETS.has(tokens[0])) {
        return true;
    }

    const first = tokens[0];
    if (GENERIC_SPECIES.has(first) && tokens.length <= 4) return true;

    return false;
}

/** Bulk archive should ignore disposition arcs on obvious fodder names. */
export function blocksFodderArchive(npc = {}) {
    if (npc.pinned) return true;
    if (cleanText(npc.agenda) || cleanText(npc.relationshipTension)) return true;
    if (cleanText(npc.stanceToPlayer)) return true;
    if (Array.isArray(npc.bondMoments) && npc.bondMoments.length > 0) return true;
    if (cleanText(npc.personality) || cleanText(npc.goals) || cleanText(npc.secrets)) return true;
    if (Array.isArray(npc.callbackHooks) && npc.callbackHooks.length > 0) return true;
    if (Number.isFinite(npc.trust)) return true;
    if (!isGenericCreatureName(npc.name)
        && Array.isArray(npc.relationshipHistory)
        && npc.relationshipHistory.length > 0) {
        return true;
    }
    return false;
}

export function hasNpcNarrativeWeight(npc = {}) {
    return Boolean(
        cleanText(npc.personality)
        || cleanText(npc.goals)
        || cleanText(npc.agenda)
        || cleanText(npc.secrets)
        || cleanText(npc.relationshipTension)
        || cleanText(npc.stanceToPlayer)
        || (Array.isArray(npc.bondMoments) && npc.bondMoments.length > 0)
        || cleanText(npc.privateNotes)
        || (Array.isArray(npc.callbackHooks) && npc.callbackHooks.length > 0)
        || (Array.isArray(npc.relationshipHistory) && npc.relationshipHistory.length > 0)
        || Number.isFinite(npc.trust)
        || npc.pinned
    );
}

export function isCombatOnlyNotes(npc = {}) {
    const notes = cleanText(npc.lastNotes || npc.notes);
    if (!notes) return false;
    if (hasNpcNarrativeWeight(npc)) return false;
    return COMBAT_ONLY_NOTE.test(notes) && notes.length < 140;
}

/**
 * Classify an incoming NPC candidate. Existing roster characters are never
 * downgraded by classification alone.
 */
export function classifyNpcCandidate(payload = {}, existing = null) {
    const name = cleanText(payload.name || existing?.name);
    const kind = NPC_KINDS.has(payload.kind) ? payload.kind : null;
    const rosterEligible = payload.rosterEligible === true || payload.roster_eligible === true;
    const explicitTier = NPC_ROSTER_TIERS.has(payload.rosterTier) ? payload.rosterTier : null;
    const pinned = !!(payload.pinned ?? existing?.pinned);

    if (existing?.rosterTier === 'character' || existing?.pinned || pinned) {
        return {
            allowRoster: true,
            rosterTier: 'character',
            kind: kind || existing?.kind || 'character',
            importance: computeNpcImportance({ ...existing, ...payload, rosterTier: 'character', pinned: pinned || existing?.pinned }),
        };
    }

    if (explicitTier === 'archived_creature') {
        return { allowRoster: true, rosterTier: 'archived_creature', kind: kind || 'creature', importance: 1 };
    }

    if (rosterEligible || kind === 'character' || explicitTier === 'character') {
        return {
            allowRoster: true,
            rosterTier: 'character',
            kind: 'character',
            importance: computeNpcImportance({ ...existing, ...payload, rosterTier: 'character' }),
        };
    }

    if (kind === 'creature' || kind === 'ephemeral') {
        return { allowRoster: false, rosterTier: null, kind, importance: 1 };
    }

    const candidate = { ...existing, ...payload, name };
    const genericName = isGenericCreatureName(name);
    const narrativeWeight = hasNpcNarrativeWeight(candidate);
    const combatOnly = isCombatOnlyNotes(candidate);

    if (!genericName || narrativeWeight) {
        return {
            allowRoster: true,
            rosterTier: 'character',
            kind: 'character',
            importance: computeNpcImportance({ ...candidate, rosterTier: 'character' }),
        };
    }

    if (genericName && (combatOnly || kind === 'creature' || kind === 'ephemeral')) {
        return { allowRoster: false, rosterTier: null, kind: kind || 'creature', importance: 1 };
    }

    if (genericName && !narrativeWeight) {
        return { allowRoster: false, rosterTier: null, kind: 'creature', importance: 1 };
    }

    return {
        allowRoster: true,
        rosterTier: 'character',
        kind: 'character',
        importance: computeNpcImportance({ ...candidate, rosterTier: 'character' }),
    };
}

/**
 * One classify→dispatch step shared by the per-turn Scribe (npc_updates) and
 * the journal cadence (npcs_encountered) — 2026-08-31 P2: the journal used to
 * hand-map its fields twice, once into the classifier and once into the
 * dispatch payload, so a schema addition needed two edits or silently dropped.
 * The roster-worthy candidate is dispatched wholesale with the classified
 * kind; UPDATE_NPC's own normalization is the field boundary.
 *
 * @returns {boolean} true when the update was dispatched.
 */
export function dispatchClassifiedNpcUpdate(dispatch, candidate) {
    if (!candidate || typeof candidate !== 'object') return false;
    const classified = classifyNpcCandidate(candidate);
    if (!classified.allowRoster) return false;
    dispatch({ type: 'UPDATE_NPC', payload: { ...candidate, kind: classified.kind } });
    return true;
}

/**
 * Importance (1..5) computed from the DOSSIER ONLY (2026-09-06 audit): the old
 * version seeded from the STORED value and re-added every structural bonus on
 * each update, so any named character was 5/5 at birth — the curation's
 * importance term was a constant and "importance: 5/5" printed on every KNOWN
 * NPCs line. A bare name is 1; a stance, a tension, a bond history, and an
 * agenda/hooks each add one; personality/goals/secrets and a trust reading add
 * half. Pinned is always 5 (the player's own call). The stored value is never
 * an input, so the scale means what it says and the DM lane cannot inflate it.
 */
export function computeNpcImportance(npc = {}) {
    if (npc.pinned) return 5;
    let score = 1;
    if (cleanText(npc.stanceToPlayer)) score += 1;
    if (cleanText(npc.relationshipTension)) score += 1;
    if ((Array.isArray(npc.bondMoments) && npc.bondMoments.length > 0)
        || (Array.isArray(npc.relationshipHistory) && npc.relationshipHistory.length > 0)) score += 1;
    if (cleanText(npc.agenda) || (Array.isArray(npc.callbackHooks) && npc.callbackHooks.length > 0)) score += 1;
    if (cleanText(npc.personality) || cleanText(npc.goals) || cleanText(npc.secrets)) score += 0.5;
    if (Number.isFinite(npc.trust)) score += 0.5;
    return clampImportance(score, 1);
}

function clampImportance(value, fallback = 3) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(5, Math.round(n)));
}

/**
 * Same-sitting arc noise (2026-08-28, Vesa's "+9 earlier in one tavern
 * evening" report): pre-fix records stamped a relationshipHistory transition on
 * EVERY Scribe disposition re-read, so mood flicker minted Neutral↔Friendly↔Wary
 * chains with no arc meaning. Collapse runs of entries closer than 30 minutes
 * into one first→last transition (dropped entirely when it lands back where it
 * started). Applied only to records the cadence stamper has never touched —
 * once `arcDisposition` exists, entries are cadence-grade history and stay.
 */
const ARC_SAME_SITTING_MS = 30 * 60 * 1000;

export function compactRelationshipHistory(history = []) {
    const entries = (Array.isArray(history) ? history : []).filter(e => e && e.from && e.to);
    if (entries.length <= 1) return entries;
    const compacted = [];
    let run = null;
    for (const entry of entries) {
        if (run && Number.isFinite(entry.at) && Number.isFinite(run.at) && entry.at - run.at <= ARC_SAME_SITTING_MS) {
            run = { ...run, to: entry.to, at: entry.at, note: entry.note || run.note };
        } else {
            if (run && run.from !== run.to) compacted.push(run);
            run = { ...entry };
        }
    }
    if (run && run.from !== run.to) compacted.push(run);
    return compacted;
}

/** Grandfather legacy saves: every pre-existing NPC becomes a durable character. */
export function migrateLegacyNpc(npc = {}) {
    const merged = {
        rosterTier: 'character',
        kind: 'character',
        pinned: !!npc.pinned,
        importance: computeNpcImportance({ ...npc, rosterTier: 'character' }),
        personality: '',
        goals: '',
        secrets: '',
        knownFacts: [],
        basedIn: null,
        lastLocation: null,
        relationshipHistory: [],
        agenda: '',
        relationshipTension: '',
        stanceToPlayer: '',
        bondMoments: [],
        trust: null,
        privateNotes: '',
        callbackHooks: [],
        ...npc,
    };
    // An explicit falsy rosterTier in a hand-edited/hostile save survives the
    // spread above and would leave the record "unmigrated" forever — the
    // GameContext migration effect re-dispatches on every render until it heals.
    if (!merged.rosterTier) merged.rosterTier = 'character';
    if (!merged.kind) merged.kind = 'character';
    merged.bondMoments = normalizeBondMoments(merged.bondMoments);
    // The "lately" shelf loads typed (2026-09-12) and only when present — a
    // record without impressions stays byte-identical to its pre-tier shape.
    if (merged.recentImpressions !== undefined) {
        const impressions = normalizeImpressions(merged.recentImpressions);
        if (impressions.length > 0) merged.recentImpressions = impressions;
        else delete merged.recentImpressions;
    }
    if (!merged.arcDisposition) {
        merged.relationshipHistory = compactRelationshipHistory(merged.relationshipHistory);
    }
    if (merged.portraitUrl !== undefined) {
        const safeUrl = sanitizePortraitUrl(merged.portraitUrl);
        if (safeUrl) merged.portraitUrl = safeUrl;
        else delete merged.portraitUrl;
    }
    // Identity/looks fields are string-or-absent (2026-09-09 audit P1): an
    // object `appearance`/array `gender`/numeric `species` survived here and
    // threw at composeScenePrompt's NPC line, or joined "[object Object]" into
    // the painter's prompt. upsertNpc clamps the DM/Scribe lanes; this is the
    // load boundary's twin.
    for (const [field, max] of [['appearance', NPC_DOSSIER_FIELD_MAX], ['gender', NPC_GENDER_MAX], ['species', NPC_SPECIES_MAX]]) {
        if (merged[field] === undefined) continue;
        const text = typeof merged[field] === 'string' ? merged[field].trim().slice(0, max) : '';
        if (text) merged[field] = text;
        else delete merged[field];
    }
    if (!NPC_ROSTER_TIERS.has(merged.rosterTier)) {
        merged.rosterTier = 'character';
    }
    if (!NPC_KINDS.has(merged.kind)) {
        merged.kind = merged.rosterTier === 'archived_creature' ? 'creature' : 'character';
    }
    merged.importance = computeNpcImportance(merged);
    return merged;
}

export function normalizeNpcRecord(npc = {}, { legacy = false } = {}) {
    if (legacy || !npc.rosterTier) {
        return migrateLegacyNpc(npc);
    }
    const rosterTier = NPC_ROSTER_TIERS.has(npc.rosterTier) ? npc.rosterTier : 'character';
    const kind = NPC_KINDS.has(npc.kind) ? npc.kind : (rosterTier === 'archived_creature' ? 'creature' : 'character');
    return {
        ...migrateLegacyNpc(npc),
        rosterTier,
        kind,
        pinned: !!npc.pinned,
        importance: computeNpcImportance({ ...npc, rosterTier, kind }),
    };
}

export function isPromptRosterNpc(npc = {}) {
    return npc.rosterTier !== 'archived_creature';
}

/**
 * Recency window for prompt curation, in CONVERSATIONAL messages (2026-09-06
 * audit — the term was wall-clock hours, and `lastSeen` was stamped by every
 * upsert including absence-drift installs for NPCs the hero never met). The
 * bonus decays from 8 to 0 over 8 × NPC_RECENCY_DECAY_MESSAGES (~4 journal
 * cadences). `lastSeenMessage` is stamped only by the per-turn Scribe/DM
 * lanes; records without it fall back to the wall-clock stamp.
 */
const NPC_RECENCY_DECAY_MESSAGES = 5;

function npcConversationalAge(npc, messages, messageCount) {
    if (!Number.isFinite(npc?.lastSeenMessage)) return null;
    const end = Number.isFinite(messageCount)
        ? messageCount
        : (Array.isArray(messages) ? messages.length : NaN);
    if (!Number.isFinite(end)) return null;
    if (Array.isArray(messages)) return conversationalDistance(messages, npc.lastSeenMessage - 1, end - 1);
    return Math.max(0, end - npc.lastSeenMessage);
}

export function scoreNpcForPrompt(npc = {}, { location = '', now = Date.now(), messages = null, messageCount } = {}) {
    if (!isPromptRosterNpc(npc)) return 0;

    let score = computeNpcImportance(npc) * 4;
    if (npc.pinned) score += 100;
    const age = npcConversationalAge(npc, messages, messageCount);
    if (age !== null) {
        score += Math.max(0, 8 - age / NPC_RECENCY_DECAY_MESSAGES);
    } else if (npc.lastSeen) {
        const ageHours = Math.max(0, (now - npc.lastSeen) / (1000 * 60 * 60));
        score += Math.max(0, 8 - ageHours / 12);
    }
    if (location && locationMatchesPlace(location, npc.lastLocation)) {
        score += 14;
    } else if (location && locationMatchesPlace(location, npc.basedIn)) {
        score += 8;
    } else if (cleanText(npc.basedIn)) {
        score += 2;
    }
    if (cleanText(npc.relationshipTension)) score += 6;
    if (cleanText(npc.stanceToPlayer)) score += 6;
    if (Array.isArray(npc.bondMoments) && npc.bondMoments.length > 0) score += 2;
    if (Array.isArray(npc.callbackHooks) && npc.callbackHooks.length > 0) score += 4;
    if (Array.isArray(npc.relationshipHistory) && npc.relationshipHistory.length > 0) score += 3;
    if (cleanText(npc.agenda)) score += 2;
    return score;
}

/**
 * The KNOWN NPCs cast. Slots are RESERVED before the score ranking (2026-09-06
 * P1): pinned first, then NPCs present in the scene (`presentNames` — the
 * presence text's name hits), then NPCs whose last-seen place is the hero's
 * location, and only then the rest by score. A pure ranking dropped the thin
 * ferrywoman the hero was talking to in favour of eight dossier-rich rivals
 * in the capital (44 vs 51) — and the DM narrated the dialogue without her
 * looks, gender, or stance, the fields the block exists to keep consistent.
 */
export function curateNpcsForPrompt(npcs = [], { location = '', limit = 8, now = Date.now(), presentNames = null, messages = null, messageCount } = {}) {
    const roster = (npcs || []).filter(isPromptRosterNpc);
    const ranked = roster
        .map(npc => ({ npc, score: scoreNpcForPrompt(npc, { location, now, messages, messageCount }) }))
        .sort((a, b) => b.score - a.score)
        .map(entry => entry.npc);
    const present = Array.isArray(presentNames) && presentNames.length > 0
        ? ranked.filter(npc => presentNames.some(name => namesMatch(npc.name, name)))
        : [];
    const located = location
        ? ranked.filter(npc => locationMatchesPlace(location, npc.lastLocation))
        : [];

    const chosen = [];
    const seen = new Set();
    const take = (list, unbounded = false) => {
        for (const npc of list) {
            if (!unbounded && chosen.length >= limit) break;
            const key = npc.id ?? npc;
            if (seen.has(key)) continue;
            chosen.push(npc);
            seen.add(key);
        }
    };
    take(ranked.filter(n => n.pinned), true);
    take(present);
    take(located);
    take(ranked);
    return chosen;
}

/**
 * Appearance merge belt (2026-09-06 P1). `appearance` is a plain replace by
 * design — a haircut or disguise must be able to drop details — but a
 * FRAGMENT ("a fresh scar on her cheek") arriving without merge context used
 * to wipe the whole recorded look (white hair, grey eyes, broken nose, build,
 * cloak → one scar). An incoming look that is much shorter than the record AND
 * covers few of its tokens is a fragment: it joins the record through the
 * dossier merge (novel clauses appended). Anything else is a rewrite and
 * replaces, exactly as before.
 */
const APPEARANCE_FRAGMENT_LENGTH_RATIO = 0.5;
const APPEARANCE_FRAGMENT_COVERAGE = 0.5;

export function isAppearanceFragment(existingText, incomingText) {
    const prev = cleanText(existingText);
    const next = cleanText(incomingText);
    if (!prev || !next) return false;
    if (next.length >= prev.length * APPEARANCE_FRAGMENT_LENGTH_RATIO) return false;
    const prevTokens = meaningfulTokens(prev);
    const nextTokens = meaningfulTokens(next);
    if (prevTokens.size === 0 || nextTokens.size === 0) return false;
    return coverage(prevTokens, nextTokens) < APPEARANCE_FRAGMENT_COVERAGE;
}

export function mergeNpcAppearance(existingText, incomingText, max = NPC_DOSSIER_FIELD_MAX) {
    const next = cleanText(incomingText).slice(0, max);
    if (!next) return cleanText(existingText).slice(0, max);
    return isAppearanceFragment(existingText, next)
        ? mergeNpcDossierText(existingText, next, max)
        : next;
}

export function formatNpcEmbeddingText(npc = {}) {
    const name = cleanText(npc.name);
    if (!name) return '';
    const notes = cleanText(npc.lastNotes || npc.notes);
    const tension = cleanText(npc.relationshipTension);
    const stance = cleanText(npc.stanceToPlayer);
    const agenda = cleanText(npc.agenda);
    const basedIn = cleanText(npc.basedIn);
    const lastLocation = cleanText(npc.lastLocation);
    const appearance = cleanText(npc.appearance);
    const gender = cleanText(npc.gender);
    const species = cleanText(npc.species);
    const parts = [`${name} (${[species, gender, npc.disposition || 'unknown'].filter(Boolean).join(', ')})`];
    if (appearance) parts.push(`Looks: ${appearance.slice(0, 160)}`);
    if (basedIn) parts.push(`Based in: ${basedIn}`);
    if (lastLocation) parts.push(`Last seen: ${lastLocation}`);
    if (notes) parts.push(notes);
    if (stance) parts.push(`Toward the hero: ${stance.slice(0, 160)}`);
    if (tension) parts.push(`Tension: ${tension}`);
    if (agenda) parts.push(`Agenda: ${agenda}`);
    return parts.join(' | ').slice(0, 500);
}

export function listArchivableFodder(npcs = []) {
    return (npcs || []).filter(npc => {
        if (npc.rosterTier === 'archived_creature') return false;
        if (!isGenericCreatureName(npc.name)) return false;
        if (blocksFodderArchive(npc)) return false;
        return true;
    });
}

export function buildStoryMemoryPromotion(npc = {}) {
    if (!isPromptRosterNpc(npc)) return null;
    const name = cleanText(npc.name);
    if (!name) return null;

    const tension = cleanText(npc.relationshipTension);
    const stance = cleanText(npc.stanceToPlayer);
    const hooks = Array.isArray(npc.callbackHooks) ? npc.callbackHooks.filter(Boolean) : [];
    const agenda = cleanText(npc.agenda);
    const notes = cleanText(npc.lastNotes || npc.notes);

    if (!tension && !stance && hooks.length === 0 && !agenda) return null;

    const textParts = [];
    if (stance) textParts.push(`Toward the hero: ${stance}`);
    if (tension) textParts.push(tension);
    if (agenda) textParts.push(`Agenda: ${agenda}`);
    if (hooks.length > 0) textParts.push(`Hooks: ${hooks.slice(0, 2).join('; ')}`);
    if (!textParts.length && notes) textParts.push(notes);

    const text = textParts.join(' ').slice(0, 260);
    if (!text) return null;

    const emotionalCharge = (tension || stance) ? 4 : (hooks.length > 0 ? 3 : 2);
    const salience = npc.pinned ? 5 : ((tension || stance) ? 4 : 3);

    return {
        // Stable identity (2026-08-30 P1): the promotion's type flips with the
        // dossier (agenda-only → npcAgenda, any stance/tension → relationship)
        // while every non-id match rung requires SAME type — without a stable
        // id, the flip stranded the old-type card as an immortal stale twin
        // (salience 3 is dormancy-exempt). The id rung matches across types.
        ...(npc.id && { id: `npc-bond-${npc.id}` }),
        type: (tension || stance) ? 'relationship' : (agenda ? 'npcAgenda' : 'callback'),
        text,
        subject: name,
        tags: ['npc', 'roster'],
        salience,
        emotionalCharge,
        linkedNpcNames: [name],
        location: cleanText(npc.basedIn) || cleanText(npc.lastLocation) || undefined,
        source: 'npc_roster',
    };
}

/**
 * Load-time heal for promotion cards stranded before the stable-id fix above
 * (2026-08-30 P1): a roster NPC whose dossier type flipped left one stale
 * `npc_roster` card per type transition, never matched again. Same-subject
 * roster promotions are ONE card by construction — keep the newest snapshot
 * (a promotion always replaces text wholesale, so the newest IS the current
 * dossier), drop the stranded twins, and stamp the survivor with its stable
 * `npc-bond-` id so future promotions match by the id rung. Idempotent.
 */
export function healPromotedStoryMemoryTwins(storyMemory = [], npcs = []) {
    const cards = Array.isArray(storyMemory) ? storyMemory : [];
    const groups = new Map();
    cards.forEach((card, index) => {
        if (card?.source !== 'npc_roster') return;
        const key = cleanText(card.subject).toLowerCase();
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(index);
    });

    const drop = new Set();
    const reId = new Map();
    for (const indexes of groups.values()) {
        let keep = indexes[0];
        for (const index of indexes) {
            if ((cards[index].lastSeenAt || 0) > (cards[keep].lastSeenAt || 0)) keep = index;
        }
        for (const index of indexes) {
            if (index !== keep) drop.add(index);
        }
        const npc = (Array.isArray(npcs) ? npcs : []).find(n => namesMatch(n?.name, cards[keep].subject));
        if (npc?.id) {
            const stableId = `npc-bond-${npc.id}`;
            if (cards[keep].id !== stableId) reId.set(keep, stableId);
        }
    }
    if (drop.size === 0 && reId.size === 0) return cards;
    return cards
        .map((card, index) => (reId.has(index) ? { ...card, id: reId.get(index) } : card))
        .filter((_, index) => !drop.has(index));
}

/**
 * Strips leading common titles and articles case-insensitively to get the core name.
 */
export function getCoreNpcName(name) {
    if (!name) return '';
    let core = name.trim();
    let prev;
    do {
        prev = core;
        core = core.replace(/^(?:the|a|an|high\s+priest(?:ess)?|grand\s+master|lord\s+commander|first\s+mate|confessor|brother-in-arms|sister-in-arms|brother|sister|magister|father|mother|captain|lord|lady|commander|sir|baron|king|queen|elder|magistrate|inquisitor|officer|warden|sheriff|constable|priest(?:ess)?|acolyte|abbot|cardinal|bishop|magus|archmage|archmagus|baroness|duke|duchess|prince|princess|count|countess|emperor|empress|master|mistress|doctor|general|sergeant|corporal|lieutenant|guard|sentry|innkeeper|blacksmith|merchant|saint|st\.?)\b\s*/gi, '');
    } while (core !== prev);
    return core.trim().toLowerCase();
}

const NAME_STOP_TOKENS = new Set(['the', 'a', 'an', 'of', 'von', 'van', 'de', 'da', 'la', 'le']);

function meaningfulNameTokens(name) {
    return getCoreNpcName(name)
        .split(/[^a-z0-9']+/)
        .filter(token => token.length > 1 && !NAME_STOP_TOKENS.has(token));
}

/**
 * Compares two NPC names, returning true if they are case-insensitive exact matches,
 * if their core names match after title-stripping, or if one name's meaningful
 * tokens are contained in the other's ("Saima" ⊂ "Saima Aallotar").
 *
 * The containment rule is the roster fork guard (2026-07-23 romance playtest: the DM
 * narrative alternated "Saima" / "Saima Aallotar" and the roster split one woman into
 * separate records, each holding half the relationship history). Same tradeoff the
 * location registry accepted for containment folding: two distinct same-campaign NPCs
 * sharing a first name is rarer and cheaper than every long-named NPC forking. Generic
 * creature/role names ("Guard", "a bandit") never containment-match — only proper names
 * fold, and title-only names strip to zero tokens so they cannot match anything.
 */
/**
 * ONE source for how a party companion LOOKS (2026-09-12). The Scribe records a
 * companion's appearance/gender/species on their linked ROSTER record ("one
 * system owns all bonds", DECISIONS.md 2026-07-23), while the party record
 * only ever holds what the DM's add_companions said at recruitment. Scene art
 * read the party record — so a companion whose bald head and dark skin the
 * fiction had long established was painted from a thin recruitment note, or
 * from nothing, and came back as a different person every time. The roster
 * record is the living canon and wins; the party record is the fallback.
 */
export function resolveCompanionLook(companion, npcs = []) {
    const name = String(companion?.name || '').trim();
    const dossier = name ? (Array.isArray(npcs) ? npcs : []).find(npc => namesMatch(npc?.name, name)) : null;
    const pick = field => {
        const fromRoster = typeof dossier?.[field] === 'string' ? dossier[field].trim() : '';
        const fromParty = typeof companion?.[field] === 'string' ? companion[field].trim() : '';
        return fromRoster || fromParty;
    };
    return { appearance: pick('appearance'), gender: pick('gender'), species: pick('species') };
}

export function namesMatch(name1, name2) {
    if (!name1 || !name2) return false;
    const n1 = name1.toLowerCase();
    const n2 = name2.toLowerCase();
    if (n1 === n2) return true;

    const core1 = getCoreNpcName(name1);
    const core2 = getCoreNpcName(name2);
    if (core1 && core2 && core1 === core2) return true;

    const tokens1 = meaningfulNameTokens(name1);
    const tokens2 = meaningfulNameTokens(name2);
    const [shortTokens, longTokens, shortName] = tokens1.length <= tokens2.length
        ? [tokens1, tokens2, name1]
        : [tokens2, tokens1, name2];
    if (shortTokens.length === 0) return false;
    if (isGenericCreatureName(shortName)) return false;
    const longSet = new Set(longTokens);
    return shortTokens.every(token => longSet.has(token));
}

/**
 * Fold same-person roster records that forked before the namesMatch containment
 * rule existed (LOAD_GAME heal, the dedupeLocationRecords pattern). The record
 * with the LONGER name keeps its identity; dossier prose merges through the
 * normal fragment/restatement policy, bond moments and hooks union with their
 * own dedupe, and current-state fields come from whichever record was seen last.
 */
export function dedupeNpcRoster(npcs = []) {
    const kept = [];
    for (const raw of npcs) {
        const npc = raw || {};
        const matchIdx = kept.findIndex(existing => namesMatch(existing.name, npc.name));
        if (matchIdx === -1) {
            kept.push(npc);
            continue;
        }
        const other = kept[matchIdx];
        // `newer` drives current-state fields; `base` is the other record.
        const [base, newer] = (npc.lastSeen || 0) >= (other.lastSeen || 0) ? [other, npc] : [npc, other];
        const longerName = (String(npc.name || '').length > String(other.name || '').length ? npc.name : other.name);
        const merged = {
            ...base,
            ...pruneRecordBlanks(newer),
            name: longerName,
            id: other.id || npc.id,
            firstMet: Math.min(base.firstMet || Infinity, newer.firstMet || Infinity) === Infinity
                ? undefined
                : Math.min(base.firstMet || Infinity, newer.firstMet || Infinity),
            lastSeen: Math.max(base.lastSeen || 0, newer.lastSeen || 0) || undefined,
            lastSeenMessage: Math.max(base.lastSeenMessage || 0, newer.lastSeenMessage || 0) || undefined,
            pinned: !!(base.pinned || newer.pinned),
            trust: Number.isFinite(newer.trust) ? newer.trust : base.trust,
            kind: base.kind === 'character' || newer.kind === 'character' ? 'character' : (newer.kind || base.kind),
            rosterTier: base.rosterTier === 'character' || newer.rosterTier === 'character'
                ? 'character'
                : (newer.rosterTier || base.rosterTier),
            bondMoments: appendBondMoments(base.bondMoments, newer.bondMoments),
            recentImpressions: normalizeImpressions([...(base.recentImpressions || []), ...(newer.recentImpressions || [])]),
            callbackHooks: appendCallbackHooks(base.callbackHooks, newer.callbackHooks),
            knownFacts: [...new Set([...(base.knownFacts || []), ...(newer.knownFacts || [])])],
            relationshipHistory: [...(base.relationshipHistory || []), ...(newer.relationshipHistory || [])]
                .sort((a, b) => (a.at || 0) - (b.at || 0)),
        };
        for (const field of NPC_DURABLE_TEXT_FIELDS) {
            merged[field] = mergeNpcDossierText(base[field], newer[field]);
        }
        kept[matchIdx] = normalizeNpcRecord(merged);
    }
    return kept;
}

function pruneRecordBlanks(record) {
    const out = {};
    for (const [key, value] of Object.entries(record)) {
        if (value === '' || value === null || value === undefined) continue;
        out[key] = value;
    }
    return out;
}