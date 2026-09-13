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
