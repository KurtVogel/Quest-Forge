/**
 * Relationship arc (2026-09-13, NPC-card overhaul slice 1): where the hero
 * and an NPC STAND, and what is ALIVE between them right now.
 *
 * A card used to be a filing cabinet — every field a record, none of them an
 * answer to the three things a player who wants to grow close to someone
 * actually asks: where do we stand, what is pending between us, what would
 * move it. The STAGE answers the first and is DERIVED from the record
 * (graded key moments, disposition, trust) — never stored, never declared by
 * an LLM, so it cannot drift or be talked into existence. The OPEN THREAD
 * answers the second: the Scribe keeps a current-state `openThread` on the
 * record (replace; `openThreadResolved` clears), and when there is none the
 * newest active promise card linked to the NPC stands in. Both ride the
 * KNOWN NPCs line and the companion party line so the DM plays TOWARD the
 * thread every scene, and both lead the Journal / Companions cards.
 */
import { namesMatch, normalizeBondMoments, selectKeyBondMoments } from './npcRoster.js';
import { conversationalDistance } from './replayLedger.js';

export const RELATIONSHIP_STAGES = ['stranger', 'acquaintance', 'familiar', 'trusted', 'intimate', 'rival', 'estranged'];

const STAGE_LABELS = {
    stranger: 'Stranger',
    acquaintance: 'Acquaintance',
    familiar: 'Familiar',
    trusted: 'Trusted',
    intimate: 'Intimate',
    rival: 'Rival',
    estranged: 'Estranged',
};

const TRUST_KINDS = new Set(['confession', 'promise', 'rescue', 'shared_danger']);
const RIFT_KINDS = new Set(['betrayal', 'quarrel']);
const WARM_STAGE_KINDS = new Set(['intimacy', ...TRUST_KINDS]);

/** Open-thread text cap — one line the DM plays toward, not a dossier. */
export const NPC_OPEN_THREAD_MAX = 200;

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function salienceOf(moment) {
    return Number.isFinite(moment?.salience) ? moment.salience : 3;
}

function lastOfKinds(moments, kinds, minSalience = 0) {
    for (let i = moments.length - 1; i >= 0; i--) {
        const m = moments[i];
        if (kinds.has(m.kind) && salienceOf(m) >= minSalience) return { moment: m, index: i };
    }
    return null;
}

function stageResult(stage, moment = null) {
    return {
        stage,
        label: STAGE_LABELS[stage],
        since: moment ? moment.text : null,
        sinceAt: moment && Number.isFinite(moment.at) ? moment.at : null,
    };
}

/**
 * `{ stage, label, since, sinceAt }`. Deterministic, ordered:
 * - hostile disposition → `rival` (since the last rift, if any)
 * - a betrayal/quarrel key moment with no LATER reconciliation, after warmth
 *   the record had earned → `estranged`
 * - an intimacy key moment (salience ≥ 4) while not hostile/wary → `intimate`
 * - a trust-earning key moment (confession / promise / rescue / shared
 *   danger, salience ≥ 4) or trust ≥ 70 while not hostile → `trusted`
 * - any moment, stance, or arc history → `familiar`; a record with only
 *   notes → `acquaintance`; a bare name → `stranger`.
 * Ungraded legacy moments never lift a stage past `familiar` — the honest
 * reading of a record nobody graded (Deepen memory grades it).
 */
export function deriveRelationshipStage(npc = {}) {
    const moments = normalizeBondMoments(npc?.bondMoments);
    const key = selectKeyBondMoments(moments, 50);
    const disposition = text(npc?.disposition).toLowerCase();
    const trust = Number.isFinite(npc?.trust) ? npc.trust : null;

    if (disposition === 'hostile') {
        const rift = lastOfKinds(key, RIFT_KINDS);
        return stageResult('rival', rift?.moment || null);
    }

    const rift = lastOfKinds(key, RIFT_KINDS, 4);
    if (rift) {
        const laterMend = key.slice(rift.index + 1).some(m => m.kind === 'reconciliation');
        const warmthBefore = key.slice(0, rift.index).some(m => WARM_STAGE_KINDS.has(m.kind) && salienceOf(m) >= 4)
            || (Array.isArray(npc?.relationshipHistory) && npc.relationshipHistory.some(step => step?.from === 'friendly'));
        if (!laterMend && warmthBefore) return stageResult('estranged', rift.moment);
    }

    if (disposition !== 'wary') {
        const intimacy = lastOfKinds(key, new Set(['intimacy']), 4);
        if (intimacy) return stageResult('intimate', intimacy.moment);
    }

    const trusting = lastOfKinds(key, TRUST_KINDS, 4);
    if (trusting) return stageResult('trusted', trusting.moment);
    if (trust !== null && trust >= 70) return stageResult('trusted');

    if (moments.length > 0) return stageResult('familiar', moments[0]);
    if (text(npc?.stanceToPlayer) || (Array.isArray(npc?.relationshipHistory) && npc.relationshipHistory.length > 0)) {
        return stageResult('familiar');
    }
    if (text(npc?.lastNotes) || text(npc?.notes) || (disposition && disposition !== 'unknown')) {
        return stageResult('acquaintance');
    }
    return stageResult('stranger');
}

/**
 * `{ text, source }` or null. The Scribe's current-state `openThread` wins;
 * otherwise the NEWEST active `promise` story card linked to this NPC (by
 * linked name or subject) stands in as the thread — a promise IS the
 * pending thing between two people. Never invents one.
 */
export function resolveOpenThread(npc = {}, storyMemory = []) {
    const own = text(npc?.openThread).slice(0, NPC_OPEN_THREAD_MAX);
    if (own) return { text: own, source: 'scribe' };
    const name = text(npc?.name);
    if (!name || !Array.isArray(storyMemory)) return null;
    for (let i = storyMemory.length - 1; i >= 0; i--) {
        const card = storyMemory[i];
        if (!card || card.type !== 'promise' || (card.status || 'active') !== 'active') continue;
        const linked = (Array.isArray(card.linkedNpcNames) ? card.linkedNpcNames : []).some(n => namesMatch(n, name))
            || (text(card.subject) && namesMatch(card.subject, name));
        if (!linked) continue;
        const cardText = text(card.text).slice(0, NPC_OPEN_THREAD_MAX);
        if (cardText) return { text: cardText, source: 'promise' };
    }
    return null;
}

/** One compact clause for a prompt line: `trusted (since: …)`. */
export function describeStageForPrompt(npc = {}) {
    const { stage, since } = deriveRelationshipStage(npc);
    if (stage === 'stranger' || stage === 'acquaintance') return '';
    return since ? `${stage} (since: ${since.slice(0, 120)})` : stage;
}

// ---------------------------------------------------------------------------
// What they know about the hero (overhaul slice: epistemics on the card)
// ---------------------------------------------------------------------------

const HERO_KNOWER_RE = /^(the\s+)?(hero|player|pc|you)$/i;

/**
 * Private facts and story cards this NPC has been let in on — every record
 * whose `knownBy` names them (common knowledge has an empty list and is not
 * "knowing something about you"). Derived from the epistemics layer, never
 * stored; capped, newest last.
 */
export function listKnownByNpc(npc = {}, worldFacts = [], storyMemory = [], { limit = 6 } = {}) {
    const name = text(npc?.name);
    if (!name) return [];
    const knows = (knownBy) => (Array.isArray(knownBy) ? knownBy : [])
        .some(knower => typeof knower === 'string' && !HERO_KNOWER_RE.test(knower.trim()) && namesMatch(knower, name));
    const out = [];
    for (const fact of (Array.isArray(worldFacts) ? worldFacts : [])) {
        const line = text(fact?.fact);
        if (line && knows(fact?.knownBy)) out.push({ text: line.slice(0, 200), source: 'fact' });
    }
    for (const card of (Array.isArray(storyMemory) ? storyMemory : [])) {
        const line = text(card?.text);
        if (line && knows(card?.knownBy)) out.push({ text: line.slice(0, 200), source: 'card' });
    }
    return out.slice(-limit);
}

// ---------------------------------------------------------------------------
// Absence: a bond left alone cools, sharpens, scars, or starts to sting
// ---------------------------------------------------------------------------

/** Conversational messages apart before a bond registers the absence. */
export const BOND_ABSENCE_MIN_MESSAGES = 30;
/** Conversational messages an open thread may wait before it "stings". */
export const OPEN_THREAD_STALE_MESSAGES = 24;

function distanceFrom(anchor, { messages, messageCount }) {
    if (!Number.isFinite(anchor)) return null;
    const end = Number.isFinite(messageCount) ? messageCount : (Array.isArray(messages) ? messages.length : NaN);
    if (!Number.isFinite(end)) return null;
    if (Array.isArray(messages)) return conversationalDistance(messages, anchor - 1, end - 1);
    return Math.max(0, end - anchor);
}

const ABSENCE_LINES = {
    intimate: 'the closeness has cooled to something quieter and wants rekindling',
    trusted: 'the trust has gone untested for a long while; they will want to see it still holds',
    estranged: 'the wound has had time to scar over, not to heal',
    rival: 'the grudge has had time to sharpen; they have been planning',
};

/**
 * `{ away, tone, line, threadAge }` or null. Deterministic and BOUNDED: the
 * stage itself never moves (it is read off the moments), only the register
 * the DM and the card meet the reunion in. Indifferent bonds (familiar and
 * below) register nothing — unless a thread was left open, which stings for
 * anyone. `away` and `threadAge` are conversational distances.
 */
export function describeAbsence(npc = {}, { messages = null, messageCount } = {}) {
    const away = distanceFrom(npc?.lastSeenMessage, { messages, messageCount });
    const threadAge = text(npc?.openThread) ? distanceFrom(npc?.openThreadMessage, { messages, messageCount }) : null;
    const { stage } = deriveRelationshipStage(npc);
    const staleThread = threadAge !== null && threadAge >= OPEN_THREAD_STALE_MESSAGES;
    const longAway = away !== null && away >= BOND_ABSENCE_MIN_MESSAGES;
    if (!longAway && !staleThread) return null;
    const parts = [];
    let tone = null;
    if (longAway && ABSENCE_LINES[stage]) {
        tone = stage === 'rival' ? 'sharpened' : (stage === 'estranged' ? 'scarred' : 'cooled');
        parts.push(`${away} exchanges since you last met — ${ABSENCE_LINES[stage]}`);
    }
    if (staleThread) {
        tone = tone || 'stinging';
        parts.push(stage === 'rival' || stage === 'estranged'
            ? `what is between you has waited ${threadAge} exchanges and they have not forgotten`
            : `what is between you has waited ${threadAge} exchanges and has begun to sting`);
    }
    if (parts.length === 0) return null;
    return { away, tone, line: parts.join('; '), threadAge: staleThread ? threadAge : null };
}

// ---------------------------------------------------------------------------
// NPC initiative: someone reaches out (world-tempo pattern, engine-rolled timing)
// ---------------------------------------------------------------------------

export const BEAT_ELIGIBLE_STAGES = new Set(['intimate', 'trusted', 'estranged', 'rival']);
/** One "scene" of delay in raw message rows (a dice turn burns ~5). */
export const BEAT_SCENE_MESSAGES = 6;
/** How long the private cue stays open once the window opens (raw rows). */
export const BEAT_WINDOW_MESSAGES = 24;
/** Raw rows between one beat's opening and the next mint. */
export const BEAT_COOLDOWN_MESSAGES = 40;
/** The engine-rolled timing die: 0–4 scenes of delay. */
export const BEAT_TIMING_DIE_SIDES = 5;

/**
 * The one NPC who may reach out on their own: a bond at an eligible stage
 * (intimate / trusted / estranged / rival — never the indifferent), with a
 * live open thread (or, for a rival, any rift on record), absent for at
 * least BOND_ABSENCE_MIN_MESSAGES. Highest pull wins; null when nobody
 * qualifies. Pure selection — the reducer rolls the timing.
 */
export function selectRelationshipBeatCandidate(npcs = [], storyMemory = [], { messages = null, messageCount } = {}) {
    let best = null;
    for (const npc of (Array.isArray(npcs) ? npcs : [])) {
        if (!npc || typeof npc !== 'object' || !text(npc.name)) continue;
        if (npc.rosterTier && npc.rosterTier !== 'character') continue;
        const { stage } = deriveRelationshipStage(npc);
        if (!BEAT_ELIGIBLE_STAGES.has(stage)) continue;
        const away = distanceFrom(npc.lastSeenMessage, { messages, messageCount });
        if (away === null || away < BOND_ABSENCE_MIN_MESSAGES) continue;
        const thread = resolveOpenThread(npc, storyMemory);
        if (!thread && stage !== 'rival') continue;
        const pull = (stage === 'intimate' || stage === 'rival' ? 4 : 3) + (thread ? 3 : 0) + Math.min(3, away / 20);
        if (!best || pull > best.pull) best = { npc, pull, stage, thread };
    }
    return best;
}

/** `{ npcId, npcName, stage, thread, opensAtMessage, closesAtMessage }`. */
export function mintRelationshipBeat(candidate, { messageCount, delayScenes = 0 } = {}) {
    if (!candidate?.npc || !Number.isFinite(messageCount)) return null;
    const opens = Math.floor(messageCount) + Math.max(0, Math.floor(delayScenes)) * BEAT_SCENE_MESSAGES;
    return {
        npcId: text(candidate.npc.id) || null,
        npcName: text(candidate.npc.name),
        stage: candidate.stage,
        thread: candidate.thread ? candidate.thread.text : null,
        mintedAtMessage: Math.floor(messageCount),
        opensAtMessage: opens,
        closesAtMessage: opens + BEAT_WINDOW_MESSAGES,
    };
}

/** Load-boundary twin (the livingWorldSession pattern): complete-or-null. */
export function sanitizeRelationshipBeat(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const npcName = text(raw.npcName);
    const opens = Number(raw.opensAtMessage);
    const closes = Number(raw.closesAtMessage);
    if (!npcName || !Number.isFinite(opens) || !Number.isFinite(closes) || closes < opens) return null;
    const stage = RELATIONSHIP_STAGES.includes(raw.stage) ? raw.stage : null;
    if (!stage) return null;
    const minted = Number(raw.mintedAtMessage);
    return {
        npcId: text(raw.npcId) || null,
        npcName,
        stage,
        thread: text(raw.thread).slice(0, NPC_OPEN_THREAD_MAX) || null,
        mintedAtMessage: Number.isFinite(minted) ? Math.max(0, Math.floor(minted)) : Math.max(0, Math.floor(opens)),
        opensAtMessage: Math.max(0, Math.floor(opens)),
        closesAtMessage: Math.max(0, Math.floor(closes)),
    };
}

export function isRelationshipBeatOpen(beat, messageCount) {
    const b = sanitizeRelationshipBeat(beat);
    if (!b || !Number.isFinite(messageCount)) return false;
    return messageCount >= b.opensAtMessage && messageCount <= b.closesAtMessage;
}

export function isRelationshipBeatExpired(beat, messageCount) {
    const b = sanitizeRelationshipBeat(beat);
    if (!b) return true;
    return Number.isFinite(messageCount) && messageCount > b.closesAtMessage;
}

/** Does this NPC record match the beat's target (id first, then name)? */
export function beatTargets(beat, npc) {
    const b = sanitizeRelationshipBeat(beat);
    if (!b || !npc) return false;
    if (b.npcId && npc.id) return b.npcId === npc.id;
    return namesMatch(b.npcName, npc.name);
}

const BEAT_MOVES = {
    intimate: 'a letter or a messenger, word that they asked after the hero, or turning up themselves',
    trusted: 'a message, a favor called in, word sent through someone the hero knows, or turning up themselves',
    estranged: 'a cold message, something returned, word that they spoke of the hero, or a chance crossing they did not seek',
    rival: 'a summons, a warning, a debt called in, a bounty, or their people crossing the hero\'s path',
};

/**
 * The private cue. Re-judged at RENDER (the world-tempo rule): the window
 * must be open, the NPC must still be on the roster, and never in combat.
 */
export function buildRelationshipBeatBlock(beat, npcs = [], { messageCount, combatActive = false } = {}) {
    const b = sanitizeRelationshipBeat(beat);
    if (!b || combatActive || !isRelationshipBeatOpen(b, messageCount)) return '';
    const npc = (Array.isArray(npcs) ? npcs : []).find(n => n && beatTargets(b, n));
    if (!npc || (npc.rosterTier && npc.rosterTier !== 'character')) return '';
    const { stage } = deriveRelationshipStage(npc);
    const moves = BEAT_MOVES[stage] || BEAT_MOVES.trusted;
    const thread = b.thread ? ` Between them now: ${b.thread}.` : '';
    return `## SOMEONE REACHES OUT — PRIVATE
${npc.name} (${stage} toward the hero) has been apart from the hero for a long while and may act on their OWN initiative in this scene or the next — ONCE, in fiction, only if the scene allows it: ${moves}.${thread} Play it from ${npc.name}'s side and want, at the register the bond has earned (a rival's reach is a threat or a claim, an estranged one's is cold, a friend's is warm). Never interrupt combat with it, never force the hero's reaction, and never repeat it once done. The hero learns nothing the fiction does not show.`;
}
