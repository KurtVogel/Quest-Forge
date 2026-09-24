/**
 * Hero tells (WOW 2026-09-23): the world notices the hero's MANNER, not
 * only their deeds — the pipe dug out when a conversation turns on them,
 * the joke that arrives whenever things get serious, the coin always paid
 * double, what a lover learned of their body and ways in bed. Deeds already
 * travel (hearsay, story cards, bond moments); a tell is the PATTERN a
 * character present could have watched form, and the payoff is a character
 * saying it out loud in their own register — a tease, a worry, a serious
 * question — so the player catches sight of their own habits.
 *
 * Division of labor, the usual: the Scribe REPORTS one visible sighting per
 * scene (with the names of who was there to see it); this module owns
 * whether it is a pattern yet (sightings in DIFFERENT scenes — one scene is
 * a moment, never a habit; an intimate tell is knowledge, not a pattern, so
 * one night is enough for the partner), who may voice it (only a witness —
 * the same epistemics rule that guards secrets), and WHEN a pointed remark
 * lands (an engine-rolled window on the journal cadence, the relationship-
 * beat pattern, with a cooldown so every NPC does not psychoanalyse the hero
 * every other turn). A tell is always a character's READING of the hero —
 * the DM may never state the hero's inner life as narrator fact; the player
 * owns that, and may confirm or deny.
 *
 * Lives in engine/ (not llm/) so reducer handlers never import from llm/.
 */
import { containment, tokenSet } from './textMatch.js';
import { conversationalDistance } from './replayLedger.js';
import { BOND_SCENE_WINDOW_MESSAGES, namesMatch } from './npcRoster.js';
import { BEAT_COOLDOWN_MESSAGES, BEAT_SCENE_MESSAGES, BEAT_WINDOW_MESSAGES } from './relationshipArc.js';

export const HERO_TELL_KINDS = new Set(['manner', 'habit', 'principle', 'intimate']);
export const HERO_TELL_TEXT_MAX = 160;
export const HERO_TELL_NAME_MAX = 80;
/** Records kept per campaign; the least-seen unestablished tell is evicted first. */
export const MAX_HERO_TELLS = 24;
export const MAX_HERO_TELL_WITNESSES = 8;
export const MAX_HERO_TELL_SIGHTINGS = 8;
/** Sightings closer than this (raw rows) are the same scene: one sighting. */
export const HERO_TELL_SCENE_MESSAGES = BOND_SCENE_WINDOW_MESSAGES;
/** Sightings in DIFFERENT scenes before a tell is a pattern anyone may voice. */
export const HERO_TELL_ESTABLISH_SCENES = 3;
/** An intimate tell is knowledge the partner has, not a pattern: one night is enough. */
export const HERO_TELL_INTIMATE_ESTABLISH_SCENES = 1;
/** A tell nobody has seen for this many conversational messages goes quiet (never deleted). */
export const HERO_TELL_FADE_MESSAGES = 200;
/** Reports the engine accepts from one Scribe pass. */
export const HERO_TELL_REPORT_CAP = 2;
/** Established tells the standing prompt line may carry. */
export const HERO_TELL_PROMPT_CAP = 5;
export const HERO_TELL_BEAT_COOLDOWN_MESSAGES = BEAT_COOLDOWN_MESSAGES;
/** Names on record as having said a tell aloud (the sheet's "said by"). */
export const MAX_HERO_TELL_VOICES = 6;
/** Rows between two remarks on the ABSENCE of a faded habit. */
export const HERO_TELL_ABSENCE_COOLDOWN_MESSAGES = 120;
export const HERO_TELL_BEAT_MODES = new Set(['remark', 'absence']);

const TELL_STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'when', 'whenever',
    'he', 'she', 'they', 'his', 'her', 'their', 'him', 'them', 'it', 'its', 'is', 'are', 'was',
    'were', 'be', 'has', 'have', 'had', 'does', 'do', 'did', 'that', 'this', 'as', 'by', 'from',
    'into', 'out', 'up', 'off', 'own', 'always', 'never', 'ever', 'hero', 'then', 'than', 'about',
]);

function text(value, max) {
    if (typeof value !== 'string') return '';
    const clean = value.replace(/\s+/g, ' ').trim();
    return max ? clean.slice(0, max) : clean;
}

function finiteStamp(value, maxMessageCount) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const floored = Math.max(0, Math.floor(n));
    return Number.isFinite(maxMessageCount) ? Math.min(floored, Math.max(0, Math.floor(maxMessageCount))) : floored;
}

function tellTokens(value) {
    return tokenSet(value, { stopWords: TELL_STOP_WORDS, minLength: 3, foldPossessives: true });
}

export function normalizeHeroTellKind(value) {
    const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return HERO_TELL_KINDS.has(key) ? key : 'manner';
}

export function isIntimateTell(tell) {
    return normalizeHeroTellKind(tell?.kind) === 'intimate';
}

function normalizeWitnesses(value) {
    const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
    const out = [];
    for (const raw of list) {
        const name = text(raw, HERO_TELL_NAME_MAX);
        if (!name) continue;
        if (out.some(known => known.toLowerCase() === name.toLowerCase())) continue;
        out.push(name);
        if (out.length >= MAX_HERO_TELL_WITNESSES) break;
    }
    return out;
}

/**
 * A sighting's COUNT is semantic (three scenes make a pattern), so an
 * out-of-range stamp is dropped, never clamped (2026-09-24 sweep): `[900,
 * -2]` at a 50-row transcript used to load as two scenes at 50 and 0.
 */
function normalizeSightings(value, { maxMessageCount } = {}) {
    const list = Array.isArray(value) ? value : [];
    const out = [];
    const ceiling = Number.isFinite(maxMessageCount) ? Math.max(0, Math.floor(maxMessageCount)) : Infinity;
    for (const raw of list) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > ceiling) continue;
        const stamp = Math.floor(n);
        if (out.includes(stamp)) continue;
        out.push(stamp);
    }
    out.sort((a, b) => a - b);
    return out.slice(-MAX_HERO_TELL_SIGHTINGS);
}

export function mintHeroTellId() {
    return `tell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * ONE typing boundary for a stored record (load twin included): text and
 * witnesses string-or-drop, kind whitelisted, every stamp finite and clamped
 * to the transcript, engine counters integers. Null for anything that is
 * not a plain object with a text.
 */
export function normalizeHeroTell(raw, { maxMessageCount } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const body = text(raw.text, HERO_TELL_TEXT_MAX);
    if (!body) return null;
    const sightings = normalizeSightings(raw.sightings, { maxMessageCount });
    const first = finiteStamp(raw.firstSeenMessage, maxMessageCount);
    const last = finiteStamp(raw.lastSeenMessage, maxMessageCount);
    const voiced = finiteStamp(raw.lastVoicedMessage, maxMessageCount);
    const beat = finiteStamp(raw.lastBeatMessage, maxMessageCount);
    const voicedCount = Number(raw.voicedCount);
    const absence = finiteStamp(raw.lastAbsenceRemarkMessage, maxMessageCount);
    const kind = normalizeHeroTellKind(raw.kind);
    return {
        id: text(raw.id, 80) || mintHeroTellId(),
        text: body,
        kind,
        witnesses: normalizeWitnesses(raw.witnesses),
        // Player-facing + travel flags (slices 2–4): who has SAID it aloud,
        // whether a sighting happened before bystanders (an intimate tell is
        // never public), whether the player struck it ("that's not me").
        voicedBy: normalizeWitnesses(raw.voicedBy).slice(0, MAX_HERO_TELL_VOICES),
        public: kind !== 'intimate' && raw.public === true,
        dormant: raw.dormant === true,
        lastAbsenceRemarkMessage: absence,
        sightings,
        firstSeenMessage: first ?? (sightings.length > 0 ? sightings[0] : null),
        lastSeenMessage: last ?? (sightings.length > 0 ? sightings[sightings.length - 1] : null),
        // Two stamps on two keys (2026-09-24 sweep): `lastVoicedMessage` /
        // `voicedCount` / `voicedBy` are the FICTION's — a character said it,
        // the Scribe reported it, the sheet reads them. `lastBeatMessage` is
        // the ENGINE's — the last remark window closed on this tell, whether
        // or not the DM took the cue; it rotates the next pick and runs the
        // cooldown and never reaches the sheet.
        lastVoicedMessage: voiced,
        lastBeatMessage: beat,
        voicedCount: Number.isFinite(voicedCount) ? Math.max(0, Math.floor(voicedCount)) : 0,
    };
}

/** Load-boundary twin: plain objects only, duplicate ids re-minted, capped. */
export function sanitizeHeroTells(list, { maxMessageCount } = {}) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const tell = normalizeHeroTell(raw, { maxMessageCount });
        if (!tell) continue;
        if (seen.has(tell.id)) tell.id = mintHeroTellId();
        seen.add(tell.id);
        out.push(tell);
    }
    return out.slice(-MAX_HERO_TELLS);
}

/**
 * Same kind + the same pattern under other words (meaningful-token
 * containment ≥ 0.8 — a strict bar on purpose: "jokes when things get
 * serious" and "goes quiet when things get serious" share three of four
 * tokens and are opposite manners).
 */
const SAME_TELL_CONTAINMENT = 0.8;
export function isSameTell(a, b) {
    if (!a || !b) return false;
    if (normalizeHeroTellKind(a.kind) !== normalizeHeroTellKind(b.kind)) return false;
    const ta = text(a.text).toLowerCase();
    const tb = text(b.text).toLowerCase();
    if (!ta || !tb) return false;
    if (ta === tb) return true;
    const setA = tellTokens(ta);
    const setB = tellTokens(tb);
    if (setA.size < 2 || setB.size < 2) return false;
    return containment(setA, setB) >= SAME_TELL_CONTAINMENT;
}

/**
 * An `id` on a report is the Scribe's CLAIM that this is a held tell, and
 * the KNOWN HERO TELLS line invites id reuse — so the claim is checked
 * (2026-09-24 sweep, the `findStoryMemoryMatch` same-type rule): the kinds
 * must agree, and the text must be the same pattern (the 0.8 floor) or at
 * least touch it (a shorthand re-report — "the pipe again" — shares a
 * meaningful token with the held wording; a bare reference with no
 * meaningful token is taken on the id alone). "Pays the poor double" under
 * the jokes tell's id is a NEW tell, not a fourth scene for the jokes.
 */
function idClaimHolds(held, candidate) {
    if (normalizeHeroTellKind(held?.kind) !== normalizeHeroTellKind(candidate?.kind)) return false;
    if (isSameTell(held, candidate)) return true;
    const reported = tellTokens(text(candidate?.text).toLowerCase());
    if (reported.size === 0) return true;
    return containment(tellTokens(text(held?.text).toLowerCase()), reported) > 0;
}

export function findHeroTellMatch(tells = [], candidate = {}) {
    if (!Array.isArray(tells)) return -1;
    if (candidate?.id) {
        const byId = tells.findIndex(t => t && t.id === candidate.id);
        if (byId !== -1 && idClaimHolds(tells[byId], candidate)) return byId;
    }
    return tells.findIndex(t => isSameTell(t, candidate));
}

/**
 * Merge one Scribe pass's reports into the record. A report that matches a
 * held tell adds a SIGHTING only when it comes from a different scene (more
 * than HERO_TELL_SCENE_MESSAGES rows since the last one — the same scene
 * restated three times is still one sighting), unions the witnesses, and
 * keeps the richer text (a fragment never clobbers a fuller wording). A new
 * pattern joins with its first sighting. Reports are capped per pass, and
 * the store evicts the least-established, least-seen tell past the cap.
 */
export function recordHeroTells(existing = [], reports = [], { messageCount } = {}) {
    const now = Number.isFinite(messageCount) ? Math.max(0, Math.floor(messageCount)) : 0;
    let tells = Array.isArray(existing) ? existing.filter(Boolean) : [];
    const accepted = (Array.isArray(reports) ? reports : [])
        .map(report => {
            const tell = normalizeHeroTell({
                id: report?.id,
                text: report?.text,
                kind: report?.kind,
                witnesses: report?.witnesses,
                public: report?.public,
            });
            if (!tell) return null;
            // Voiced-by-the-fiction (slice 3): a character NAMED the pattern
            // aloud this turn. That is not a sighting of the hero doing it —
            // only `sighted: true` beside it adds one. `voicedBy` is the
            // speaker; a bare `voiced: true` still stamps the time.
            const voiced = report?.voiced === true;
            const voicedBy = normalizeWitnesses(report?.voicedBy);
            return { tell, voiced, voicedBy, sighted: !voiced || report?.sighted === true };
        })
        .filter(Boolean)
        .slice(0, HERO_TELL_REPORT_CAP);
    let changed = false;
    for (const { tell: report, voiced, voicedBy, sighted } of accepted) {
        const idx = findHeroTellMatch(tells, report);
        const voiceStamp = voiced
            ? { lastVoicedMessage: now, voicedBy: normalizeWitnesses([...voicedBy]).slice(0, MAX_HERO_TELL_VOICES) }
            : {};
        if (idx === -1) {
            // A remark about a pattern nobody has recorded is still a first
            // sighting: the character saw it before the Scribe did.
            tells = [...tells, {
                ...report,
                id: mintHeroTellId(),
                sightings: [now],
                firstSeenMessage: now,
                lastSeenMessage: now,
                ...voiceStamp,
                voicedCount: voiced ? 1 : 0,
            }];
            changed = true;
            continue;
        }
        const held = tells[idx];
        const lastSeen = Number.isFinite(held.lastSeenMessage) ? held.lastSeenMessage : -Infinity;
        // A new SCENE is measured from the last accepted SIGHTING, never from
        // the last report (2026-09-24 sweep P1): `lastSeenMessage` slides
        // with every report for the fade, and judged against it a habit the
        // Scribe re-reports every turn never left scene one. The sibling
        // rule (`appendBondMoments`) measures from the held moment the same way.
        const heldSightings = Array.isArray(held.sightings) ? held.sightings : [];
        const lastSighting = heldSightings.length > 0 ? heldSightings[heldSightings.length - 1] : -Infinity;
        const newScene = sighted && now - lastSighting > HERO_TELL_SCENE_MESSAGES;
        const witnesses = normalizeWitnesses([...(held.witnesses || []), ...report.witnesses]);
        const richer = report.text.length > (held.text || '').length && containment(tellTokens(held.text), tellTokens(report.text)) >= SAME_TELL_CONTAINMENT
            ? report.text
            : held.text;
        const next = {
            ...held,
            text: richer,
            witnesses,
            public: held.public || report.public,
            sightings: newScene ? normalizeSightings([...(held.sightings || []), now]) : held.sightings,
            lastSeenMessage: sighted ? Math.max(lastSeen === -Infinity ? now : lastSeen, now) : held.lastSeenMessage,
        };
        if (voiced) {
            next.lastVoicedMessage = now;
            next.voicedCount = (held.voicedCount || 0) + 1;
            next.voicedBy = normalizeWitnesses([...(held.voicedBy || []), ...voicedBy]).slice(0, MAX_HERO_TELL_VOICES);
        }
        if (voiced || next.text !== held.text || next.witnesses.length !== (held.witnesses || []).length
            || next.public !== !!held.public || next.sightings !== held.sightings || next.lastSeenMessage !== held.lastSeenMessage) {
            tells = tells.map((t, i) => (i === idx ? next : t));
            changed = true;
        }
    }
    if (!changed) return existing;
    if (tells.length > MAX_HERO_TELLS) {
        // Evict the weakest: unestablished before established, fewer sightings
        // first, the oldest of those first.
        const ranked = tells
            .map((tell, index) => ({ tell, index, weight: (isHeroTellEstablished(tell) ? 100 : 0) + (tell.sightings?.length || 0) * 10 + (tell.lastSeenMessage || 0) / 1e6 }))
            .sort((a, b) => a.weight - b.weight);
        const drop = new Set(ranked.slice(0, tells.length - MAX_HERO_TELLS).map(r => r.index));
        tells = tells.filter((_, i) => !drop.has(i));
    }
    return tells;
}

/**
 * The reducer's preparation of one Scribe pass (2026-09-24 sweep): party
 * companions are present by the game's own rule, so they WITNESS every
 * non-intimate sighting whether or not the Scribe named them (an intimate
 * tell's witnesses stay exactly the partner(s)); whoever NAMED a pattern
 * aloud has, by the fiction, seen it, so a `voicedBy` is a witness too. A
 * report left with no witness at all is dropped — a witness-less tell
 * could never render, mint, or travel and only spent a slot.
 */
export function prepareHeroTellReports(reports = [], { partyNames = [] } = {}) {
    const party = normalizeWitnesses(partyNames);
    const out = [];
    for (const report of (Array.isArray(reports) ? reports : [])) {
        if (!report || typeof report !== 'object' || Array.isArray(report)) continue;
        const intimate = normalizeHeroTellKind(report.kind) === 'intimate';
        const witnesses = normalizeWitnesses([
            ...(Array.isArray(report.witnesses) ? report.witnesses : (typeof report.witnesses === 'string' ? [report.witnesses] : [])),
            ...(report.voiced === true ? normalizeWitnesses(report.voicedBy) : []),
            ...(intimate ? [] : party),
        ]);
        if (witnesses.length === 0) continue;
        out.push({ ...report, witnesses });
    }
    return out;
}

export function establishScenesFor(tell) {
    return isIntimateTell(tell) ? HERO_TELL_INTIMATE_ESTABLISH_SCENES : HERO_TELL_ESTABLISH_SCENES;
}

/** Enough sightings in different scenes to be a pattern someone could name. */
export function isHeroTellEstablished(tell) {
    if (!tell || typeof tell !== 'object') return false;
    return (Array.isArray(tell.sightings) ? tell.sightings.length : 0) >= establishScenesFor(tell);
}

function distanceFrom(anchor, { messages, messageCount }) {
    if (!Number.isFinite(anchor)) return null;
    const end = Number.isFinite(messageCount) ? messageCount : (Array.isArray(messages) ? messages.length : NaN);
    if (!Number.isFinite(end)) return null;
    if (Array.isArray(messages)) return conversationalDistance(messages, anchor - 1, end - 1);
    return Math.max(0, end - anchor);
}

/** Established, not struck by the player, and seen recently enough that it still reads as the hero's way. */
export function isHeroTellLive(tell, { messages = null, messageCount } = {}) {
    if (!isHeroTellEstablished(tell) || tell.dormant) return false;
    const since = distanceFrom(tell.lastSeenMessage, { messages, messageCount });
    return since === null || since < HERO_TELL_FADE_MESSAGES;
}

/** Established once, not struck, but unseen long enough that its ABSENCE is noticeable. */
export function isHeroTellFaded(tell, { messages = null, messageCount } = {}) {
    if (!isHeroTellEstablished(tell) || tell.dormant) return false;
    const since = distanceFrom(tell.lastSeenMessage, { messages, messageCount });
    return since !== null && since >= HERO_TELL_FADE_MESSAGES;
}

/** The player struck (or restored) a tell: "that's not me". Dormant tells are never voiced, never travel. */
export function setHeroTellDormant(tells = [], id, dormant = true) {
    if (!Array.isArray(tells) || !id) return tells;
    const idx = tells.findIndex(t => t && t.id === id);
    if (idx === -1 || !!tells[idx].dormant === !!dormant) return tells;
    return tells.map((t, i) => (i === idx ? { ...t, dormant: !!dormant } : t));
}

/**
 * The sheet's "How others see you" (slice 1 of the follow-ups): only tells
 * someone has actually SAID aloud — the player hears it first and reads it
 * second — with who said it. Dormant (struck) tells stay listed so the
 * player can restore them. Newest voice first.
 */
export function listVoicedTells(tells = []) {
    return (Array.isArray(tells) ? tells : [])
        .filter(t => t && typeof t === 'object' && text(t.text) && ((t.voicedCount || 0) > 0 || (Array.isArray(t.voicedBy) && t.voicedBy.length > 0)))
        .map(t => ({
            id: t.id,
            text: t.text,
            kind: normalizeHeroTellKind(t.kind),
            intimate: isIntimateTell(t),
            dormant: !!t.dormant,
            // The fiction's stamp only: a Scribe `voiced` report without a
            // speaker reads "said aloud", never a guessed witness.
            saidBy: Array.isArray(t.voicedBy) ? t.voicedBy : [],
            lastVoicedMessage: Number.isFinite(t.lastVoicedMessage) ? t.lastVoicedMessage : null,
        }))
        .sort((a, b) => (b.lastVoicedMessage || 0) - (a.lastVoicedMessage || 0));
}

/**
 * Tells that may TRAVEL as hearsay (slice 2): a non-intimate, live pattern
 * with at least one sighting before bystanders. `{ tell, age }` — age from
 * the last sighting, the regional-hearsay selector grades the distortion.
 * Intimate tells never travel: secrets never travel.
 */
export function listPublicTells(tells = [], { messages = null, messageCount } = {}) {
    const out = [];
    for (const tell of (Array.isArray(tells) ? tells : [])) {
        if (!tell || !tell.public || isIntimateTell(tell) || !isHeroTellLive(tell, { messages, messageCount })) continue;
        const age = distanceFrom(tell.lastSeenMessage, { messages, messageCount });
        out.push({ tell, age: age === null ? 0 : age });
    }
    return out;
}

export function tellWitnessedBy(tell, name) {
    if (!tell || !name) return false;
    return (Array.isArray(tell.witnesses) ? tell.witnesses : []).some(w => namesMatch(w, name));
}

/**
 * The tells the characters in THIS scene could voice: live, and witnessed
 * by someone present. `presentNames` is the scene (party companions plus
 * whoever the presence text names); an intimate tell needs its own witness
 * present, never a bystander. Each entry carries the present witnesses.
 */
export function listVoiceableTells(tells = [], { presentNames = [], messages = null, messageCount, limit = HERO_TELL_PROMPT_CAP } = {}) {
    const present = (Array.isArray(presentNames) ? presentNames : []).map(n => text(n)).filter(Boolean);
    const out = [];
    for (const tell of (Array.isArray(tells) ? tells : [])) {
        if (!isHeroTellLive(tell, { messages, messageCount })) continue;
        const witnesses = present.filter(name => tellWitnessedBy(tell, name));
        if (witnesses.length === 0) continue;
        out.push({ tell, witnesses });
    }
    out.sort((a, b) => (b.tell.sightings?.length || 0) - (a.tell.sightings?.length || 0));
    return out.slice(0, limit);
}

// ---------------------------------------------------------------------------
// The pointed remark: an engine-rolled window (the relationship-beat pattern)
// ---------------------------------------------------------------------------

/** The later of the fiction's voice and the engine's last closed window: what the rotation and the cooldown key on. */
export function lastRemarkMessage(tell) {
    const voiced = Number.isFinite(tell?.lastVoicedMessage) ? tell.lastVoicedMessage : null;
    const beat = Number.isFinite(tell?.lastBeatMessage) ? tell.lastBeatMessage : null;
    if (voiced === null) return beat;
    if (beat === null) return voiced;
    return Math.max(voiced, beat);
}

/**
 * The one tell that may become a MOMENT next: live, witnessed by someone on
 * the roster, never remarked on first (no fiction voice, no closed window),
 * then the longest since, then the most-seen. Pure selection — the reducer
 * rolls the timing.
 */
export function selectHeroTellCandidate(tells = [], npcs = [], { messages = null, messageCount } = {}) {
    const roster = (Array.isArray(npcs) ? npcs : []).filter(n => n && typeof n === 'object' && text(n.name)
        && (!n.rosterTier || n.rosterTier === 'character'));
    let best = null;
    for (const tell of (Array.isArray(tells) ? tells : [])) {
        if (!isHeroTellLive(tell, { messages, messageCount })) continue;
        const witnesses = (tell.witnesses || []).filter(w => roster.some(n => namesMatch(n.name, w)));
        if (witnesses.length === 0) continue;
        const sinceVoiced = distanceFrom(lastRemarkMessage(tell), { messages, messageCount });
        if (sinceVoiced !== null && sinceVoiced < HERO_TELL_BEAT_COOLDOWN_MESSAGES) continue;
        const pull = (sinceVoiced === null ? 10 : Math.min(6, sinceVoiced / 40))
            + Math.min(3, tell.sightings?.length || 0)
            + (isIntimateTell(tell) ? 0.5 : 0);
        if (!best || pull > best.pull) best = { tell, witnesses, pull };
    }
    return best;
}

/**
 * The absence beat (slice 4): a habit the hero has visibly DROPPED — faded,
 * once established, its witness still on the roster — may be remarked on
 * once ("you noticed I stopped?"). Never voiced first, then the longest
 * since the last absence remark. Only consulted when no live tell is due.
 */
export function selectAbsenceTellCandidate(tells = [], npcs = [], { messages = null, messageCount } = {}) {
    const roster = (Array.isArray(npcs) ? npcs : []).filter(n => n && typeof n === 'object' && text(n.name)
        && (!n.rosterTier || n.rosterTier === 'character'));
    let best = null;
    for (const tell of (Array.isArray(tells) ? tells : [])) {
        if (!isHeroTellFaded(tell, { messages, messageCount })) continue;
        if ((tell.voicedCount || 0) === 0) continue; // an absence is only noticeable of a habit someone once named
        const witnesses = (tell.witnesses || []).filter(w => roster.some(n => namesMatch(n.name, w)));
        if (witnesses.length === 0) continue;
        const sinceRemark = distanceFrom(tell.lastAbsenceRemarkMessage, { messages, messageCount });
        if (sinceRemark !== null && sinceRemark < HERO_TELL_ABSENCE_COOLDOWN_MESSAGES) continue;
        const pull = (sinceRemark === null ? 10 : Math.min(6, sinceRemark / 60)) + Math.min(3, tell.sightings?.length || 0);
        if (!best || pull > best.pull) best = { tell, witnesses, pull, mode: 'absence' };
    }
    return best;
}

/** `{ tellId, mode, witnesses, mintedAtMessage, opensAtMessage, closesAtMessage }`. */
export function mintHeroTellBeat(candidate, { messageCount, delayScenes = 0 } = {}) {
    if (!candidate?.tell?.id || !Number.isFinite(messageCount)) return null;
    const opens = Math.floor(messageCount) + Math.max(0, Math.floor(delayScenes)) * BEAT_SCENE_MESSAGES;
    return {
        tellId: candidate.tell.id,
        mode: HERO_TELL_BEAT_MODES.has(candidate.mode) ? candidate.mode : 'remark',
        witnesses: normalizeWitnesses(candidate.witnesses),
        mintedAtMessage: Math.floor(messageCount),
        opensAtMessage: opens,
        closesAtMessage: opens + BEAT_WINDOW_MESSAGES,
    };
}

/** Load-boundary twin: complete-or-null. */
export function sanitizeHeroTellBeat(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const tellId = text(raw.tellId, 80);
    const opens = Number(raw.opensAtMessage);
    const closes = Number(raw.closesAtMessage);
    if (!tellId || !Number.isFinite(opens) || !Number.isFinite(closes) || closes < opens) return null;
    const minted = Number(raw.mintedAtMessage);
    return {
        tellId,
        mode: HERO_TELL_BEAT_MODES.has(raw.mode) ? raw.mode : 'remark',
        witnesses: normalizeWitnesses(raw.witnesses),
        mintedAtMessage: Number.isFinite(minted) ? Math.max(0, Math.floor(minted)) : Math.max(0, Math.floor(opens)),
        opensAtMessage: Math.max(0, Math.floor(opens)),
        closesAtMessage: Math.max(0, Math.floor(closes)),
    };
}

export function isHeroTellBeatOpen(beat, messageCount) {
    const b = sanitizeHeroTellBeat(beat);
    if (!b || !Number.isFinite(messageCount)) return false;
    return messageCount >= b.opensAtMessage && messageCount <= b.closesAtMessage;
}

export function isHeroTellBeatExpired(beat, messageCount) {
    const b = sanitizeHeroTellBeat(beat);
    if (!b) return true;
    return Number.isFinite(messageCount) && messageCount > b.closesAtMessage;
}

/**
 * The cadence's expiry stamp at the window's CLOSE. A remark window that
 * closed unvoiced stamps the ENGINE's key only (`lastBeatMessage`: the cue
 * was on the DM's desk, so the pick rotates and the cooldown runs) and
 * never the fiction's — nothing was said on record, so nothing reaches the
 * sheet (2026-09-24 sweep). A window the fiction already spent (a Scribe
 * `voiced` report at or after the mint) is left as it is. An absence
 * window stamps `lastAbsenceRemarkMessage` and never counts as a voice.
 */
export function stampTellVoiced(tells = [], beat) {
    const b = sanitizeHeroTellBeat(beat);
    if (!b || !Array.isArray(tells)) return tells;
    const idx = tells.findIndex(t => t && t.id === b.tellId);
    if (idx === -1) return tells;
    const held = tells[idx];
    if (b.mode === 'absence') {
        return tells.map((t, i) => (i === idx ? { ...held, lastAbsenceRemarkMessage: b.opensAtMessage } : t));
    }
    if (beatVoicedByFiction(b, tells)) return tells;
    return tells.map((t, i) => (i === idx ? { ...held, lastBeatMessage: b.closesAtMessage } : t));
}

/**
 * Did the fiction voice this beat's tell since the beat was MINTED? (the
 * reducer closes the beat, the render skips the cue). The mint, not the
 * opening: a remark said during a delayed window's wait already spent it —
 * cueing the same line again at the opening was the 2026-09-24 finding.
 */
export function beatVoicedByFiction(beat, tells = []) {
    const b = sanitizeHeroTellBeat(beat);
    if (!b || b.mode !== 'remark') return false;
    const tell = (Array.isArray(tells) ? tells : []).find(t => t && t.id === b.tellId);
    return !!tell && Number.isFinite(tell.lastVoicedMessage) && tell.lastVoicedMessage >= b.mintedAtMessage;
}

const KIND_LABELS = {
    manner: 'manner',
    habit: 'habit',
    principle: 'principle',
    intimate: 'intimate — known only to the one who shared the bed',
};

function describeTell(tell, witnesses) {
    const who = witnesses.length > 0 ? ` (seen by ${witnesses.join(', ')})` : '';
    return `- ${tell.text} [${KIND_LABELS[normalizeHeroTellKind(tell.kind)]}${who}]`;
}

/**
 * The standing rule for the block below — STATIC, so the prompt builder
 * puts it in the cached prefix beside CRITICAL RULE 9 (2026-09-24 sweep:
 * the ~860-char paragraph used to ride the dynamic half on every turn a
 * witness was present). The block itself carries lines only.
 */
export const HERO_TELLS_STANDING_RULE = `**WHAT THEY HAVE NOTICED ABOUT THE HERO.** When a section of that name is present, it lists patterns in the hero's MANNER that the characters in the scene have watched form, each with the witnesses who know it. This is what these people KNOW of the hero's ways. They may draw on it in their own register — an aside, a tease, an in-joke, a raised eyebrow, a serious question — sparingly, when the scene touches it, never as a list and never more than a touch per scene. It is always THEIR reading of the hero, said or shown in fiction; the narrator never states the hero's feelings or motives as fact, and the hero may confirm, deny, or laugh it off. A character who did not witness a pattern does not know it. A tell marked intimate is spoken of only by the partner who knows it and only where the two are private or in a look or phrase only they would understand — never before others, never crudely, and never to shame.`;

/** The block's byte ceiling: header + intro + HERO_TELL_PROMPT_CAP lines at every cap (text, label, 8 witnesses). */
export const HERO_TELLS_BLOCK_CHAR_CEILING = 4800;

/**
 * The standing knowledge lines: what the people in THIS scene have noticed
 * about the hero, one line per tell with its present witnesses. The rule on
 * how to use them lives in the cached prefix (HERO_TELLS_STANDING_RULE).
 * Empty when nobody present has seen a pattern.
 */
export function buildHeroTellsBlock(tells = [], { presentNames = [], messages = null, messageCount, combatActive = false } = {}) {
    if (combatActive) return '';
    const voiceable = listVoiceableTells(tells, { presentNames, messages, messageCount });
    if (voiceable.length === 0) return '';
    const lines = voiceable.map(({ tell, witnesses }) => describeTell(tell, witnesses));
    return `## WHAT THEY HAVE NOTICED ABOUT THE HERO — PRIVATE
Patterns the characters present have watched form (only the named witnesses know each one; the standing rule applies):
${lines.join('\n')}`;
}

/**
 * The pointed remark. Re-judged at RENDER (the world-tempo rule): the window
 * must be open, the tell must still be live, a witness named on the beat must
 * be present, and never in combat.
 */
export function buildHeroTellBeatBlock(beat, tells = [], { presentNames = [], messages = null, messageCount, combatActive = false } = {}) {
    const b = sanitizeHeroTellBeat(beat);
    if (!b || combatActive || !isHeroTellBeatOpen(b, messageCount)) return '';
    const tell = (Array.isArray(tells) ? tells : []).find(t => t && t.id === b.tellId);
    if (!tell) return '';
    const absence = b.mode === 'absence';
    if (absence ? !isHeroTellFaded(tell, { messages, messageCount }) : !isHeroTellLive(tell, { messages, messageCount })) return '';
    // Re-judged at render like the tempo card: a remark the fiction already
    // said since the mint is spent even if the beat is still on the session.
    if (!absence && beatVoicedByFiction(b, tells)) return '';
    const present = (Array.isArray(presentNames) ? presentNames : []).map(n => text(n)).filter(Boolean);
    const witnesses = b.witnesses.filter(w => present.some(name => namesMatch(name, w)));
    if (witnesses.length === 0) return '';
    const speaker = witnesses[0];
    const intimate = isIntimateTell(tell);
    if (absence) {
        const privately = intimate ? ' Intimate knowledge: only in private with the hero, never before others.' : '';
        return `## SOMEONE NOTICES WHAT THE HERO STOPPED DOING — PRIVATE
${speaker} once knew the hero for this: ${tell.text}. It has not happened in a long while, and ${speaker} has noticed the ABSENCE. In this scene or the next, ONCE, when the moment allows, let ${speaker} remark on it — "You haven't done that in a while", a question about what changed, a fond or wary observation — in ${speaker}'s own voice and at the register their bond has earned.${privately} It is ${speaker}'s reading, never narrator fact; the hero decides what it means. Never repeated once said.`;
    }
    const register = intimate
        ? `This is intimate knowledge: ${speaker} may bring it up ONLY in private with the hero, or as a look or phrase only the two of them would understand — never before others, never crudely, and never to shame; it can be a tease, a fond certainty, or a real question about what the hero wants.`
        : `Let it be ${speaker}'s READING of the hero — a guess out loud ("Let me guess — the pipe, and off you went?"), a tease, or a real question ("You're never serious. What is it you're afraid of?") — in ${speaker}'s own voice and at the register their bond has earned. It may be wrong; the hero decides.`;
    return `## SOMEONE HAS THE HERO'S NUMBER — PRIVATE
${speaker} has noticed a pattern in the hero: ${tell.text}. In this scene or the next, ONCE, when the moment allows, let ${speaker} say so. ${register} Never as narrator fact, never forcing the hero's answer, never repeated once said.`;
}
