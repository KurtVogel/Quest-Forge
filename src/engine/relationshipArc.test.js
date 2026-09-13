import { describe, expect, it } from 'vitest';
import {
    BEAT_WINDOW_MESSAGES,
    BOND_ABSENCE_MIN_MESSAGES,
    OPEN_THREAD_STALE_MESSAGES,
    buildRelationshipBeatBlock,
    deriveRelationshipStage,
    describeAbsence,
    describeStageForPrompt,
    isRelationshipBeatOpen,
    listKnownByNpc,
    mintRelationshipBeat,
    resolveOpenThread,
    sanitizeRelationshipBeat,
    selectRelationshipBeatCandidate,
} from './relationshipArc.js';

const m = (text, kind, salience, at) => ({ text, kind, salience, at });
const messagesOf = n => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));

describe('listKnownByNpc — what they know about you, from the epistemics layer (2026-09-13)', () => {
    const worldFacts = [
        { fact: 'The hero is the exiled heir of Saltmere.', knownBy: ['Maren Holt', 'the hero'] },
        { fact: 'Brackwater has a harbor.', knownBy: [] },
        { fact: 'The hero owes Odo forty gold.', knownBy: ['Odo Ferrin'] },
        { fact: 'Only the hero knows this.', knownBy: ['the hero'] },
    ];
    const storyMemory = [
        { type: 'playerCanon', text: 'The hero swore never to return to Saltmere.', knownBy: ['Maren'] },
        { type: 'promise', text: 'Public promise.', knownBy: [] },
    ];

    it('lists private facts and cards whose knownBy names the NPC; never common knowledge or hero-only secrets', () => {
        expect(listKnownByNpc({ name: 'Maren Holt' }, worldFacts, storyMemory).map(k => k.text)).toEqual([
            'The hero is the exiled heir of Saltmere.',
            'The hero swore never to return to Saltmere.',
        ]);
        expect(listKnownByNpc({ name: 'Odo' }, worldFacts, storyMemory).map(k => k.text)).toEqual(['The hero owes Odo forty gold.']);
        expect(listKnownByNpc({ name: 'Bran' }, worldFacts, storyMemory)).toEqual([]);
        expect(listKnownByNpc({ name: 'Maren' }, 'junk', [null, 4])).toEqual([]);
    });
});

describe('describeAbsence — a bond left alone cools, sharpens, scars, or stings (2026-09-13)', () => {
    const intimate = { name: 'Maren', disposition: 'friendly', lastSeenMessage: 2, bondMoments: [m('First night together.', 'intimacy', 5, 1)] };

    it('registers nothing before the threshold and nothing for indifferent bonds', () => {
        expect(describeAbsence(intimate, { messages: messagesOf(20), messageCount: 20 })).toBeNull();
        const indifferent = { name: 'Odo', disposition: 'neutral', lastSeenMessage: 2, lastNotes: 'Sold rope.', bondMoments: [{ text: 'Sold rope.', at: 1 }] };
        expect(describeAbsence(indifferent, { messages: messagesOf(80), messageCount: 80 })).toBeNull();
    });

    it('cools an intimate bond, sharpens a rival, scars an estranged one — measured in conversational distance', () => {
        const cooled = describeAbsence(intimate, { messages: messagesOf(40), messageCount: 40 });
        expect(cooled.tone).toBe('cooled');
        expect(cooled.away).toBe(38);
        expect(cooled.line).toContain('cooled');
        const rival = { name: 'Odo', disposition: 'hostile', lastSeenMessage: 2, bondMoments: [m('Odo swore to see the hero hang.', 'quarrel', 4, 1)] };
        expect(describeAbsence(rival, { messages: messagesOf(40), messageCount: 40 }).tone).toBe('sharpened');
        const estranged = { name: 'Maren', disposition: 'neutral', lastSeenMessage: 2, bondMoments: [m('First night.', 'intimacy', 5, 1), m('She sold him out.', 'betrayal', 5, 2)] };
        expect(describeAbsence(estranged, { messages: messagesOf(40), messageCount: 40 }).tone).toBe('scarred');
        // System lines never age the absence.
        const padded = [...messagesOf(20), ...Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, role: 'system', content: 'x' }))];
        expect(describeAbsence(intimate, { messages: padded, messageCount: padded.length })).toBeNull();
    });

    it('a stale open thread stings for anyone, even someone seen recently', () => {
        const familiar = { name: 'Bran', disposition: 'neutral', lastSeenMessage: 38, stanceToPlayer: 'Polite.', openThread: 'Waiting for the hero to return his cart.', openThreadMessage: 2 };
        const result = describeAbsence(familiar, { messages: messagesOf(40), messageCount: 40 });
        expect(result.tone).toBe('stinging');
        expect(result.threadAge).toBe(38);
        expect(result.line).toContain('begun to sting');
        const rival = { ...familiar, disposition: 'hostile', bondMoments: [m('Bran cursed the hero.', 'quarrel', 4, 1)] };
        expect(describeAbsence(rival, { messages: messagesOf(40), messageCount: 40 }).line).toContain('have not forgotten');
        expect(BOND_ABSENCE_MIN_MESSAGES).toBeGreaterThan(OPEN_THREAD_STALE_MESSAGES);
    });
});

describe('NPC initiative — someone reaches out (2026-09-13)', () => {
    const maren = { id: 'npc-maren', name: 'Maren', rosterTier: 'character', disposition: 'friendly', lastSeenMessage: 2, openThread: 'Waiting to hear about the caravan.', openThreadMessage: 2, bondMoments: [m('First night.', 'intimacy', 5, 1)] };
    const odo = { id: 'npc-odo', name: 'Odo', rosterTier: 'character', disposition: 'hostile', lastSeenMessage: 2, bondMoments: [m('Odo swore to see the hero hang.', 'quarrel', 4, 1)] };
    const bran = { id: 'npc-bran', name: 'Bran', rosterTier: 'character', disposition: 'neutral', lastSeenMessage: 2, stanceToPlayer: 'Polite.', openThread: 'Wants his cart back.', openThreadMessage: 2 };
    const near = { ...maren, id: 'npc-near', name: 'Near', lastSeenMessage: 38 };

    it('selects only eligible stages that are long absent — a rival needs no thread, an indifferent bond never qualifies, presence disqualifies', () => {
        const ctx = { messages: messagesOf(40), messageCount: 40 };
        expect(selectRelationshipBeatCandidate([bran, near], [], ctx)).toBeNull();
        expect(selectRelationshipBeatCandidate([odo], [], ctx).npc.name).toBe('Odo');
        const pick = selectRelationshipBeatCandidate([bran, odo, maren, near], [], ctx);
        expect(pick.npc.name).toBe('Maren');
        expect(pick.thread.text).toBe('Waiting to hear about the caravan.');
        expect(selectRelationshipBeatCandidate([maren], [], { messages: messagesOf(20), messageCount: 20 })).toBeNull();
        expect(selectRelationshipBeatCandidate([{ ...maren, rosterTier: 'archived_creature' }], [], ctx)).toBeNull();
        expect(selectRelationshipBeatCandidate('junk', [], ctx)).toBeNull();
    });

    it('mints a typed beat with the rolled delay, sanitizes complete-or-null, and opens only inside its window', () => {
        const candidate = selectRelationshipBeatCandidate([maren], [], { messages: messagesOf(40), messageCount: 40 });
        const beat = mintRelationshipBeat(candidate, { messageCount: 40, delayScenes: 2 });
        expect(beat).toEqual({
            npcId: 'npc-maren', npcName: 'Maren', stage: 'intimate', thread: 'Waiting to hear about the caravan.',
            mintedAtMessage: 40, opensAtMessage: 52, closesAtMessage: 52 + BEAT_WINDOW_MESSAGES,
        });
        expect(isRelationshipBeatOpen(beat, 51)).toBe(false);
        expect(isRelationshipBeatOpen(beat, 52)).toBe(true);
        expect(isRelationshipBeatOpen(beat, 52 + BEAT_WINDOW_MESSAGES + 1)).toBe(false);
        expect(sanitizeRelationshipBeat({ ...beat, opensAtMessage: '52', closesAtMessage: '90', stage: 'intimate' })).toMatchObject({ opensAtMessage: 52, closesAtMessage: 90 });
        expect(sanitizeRelationshipBeat({ ...beat, stage: 'demigod' })).toBeNull();
        expect(sanitizeRelationshipBeat({ ...beat, closesAtMessage: 10 })).toBeNull();
        expect(sanitizeRelationshipBeat([])).toBeNull();
        expect(mintRelationshipBeat(null, { messageCount: 40 })).toBeNull();
    });

    it('renders the private cue only in the window, only off the live roster, never in combat — in the register the bond earned', () => {
        const candidate = selectRelationshipBeatCandidate([odo], [], { messages: messagesOf(40), messageCount: 40 });
        const beat = mintRelationshipBeat(candidate, { messageCount: 40, delayScenes: 0 });
        const block = buildRelationshipBeatBlock(beat, [odo], { messageCount: 41 });
        expect(block).toContain('## SOMEONE REACHES OUT — PRIVATE');
        expect(block).toContain('Odo (rival toward the hero)');
        expect(block).toContain('a summons, a warning, a debt called in, a bounty');
        expect(block).toContain('never force the hero\'s reaction');
        expect(buildRelationshipBeatBlock(beat, [odo], { messageCount: 41, combatActive: true })).toBe('');
        expect(buildRelationshipBeatBlock(beat, [odo], { messageCount: 39 })).toBe('');
        expect(buildRelationshipBeatBlock(beat, [], { messageCount: 41 })).toBe('');
        expect(buildRelationshipBeatBlock(beat, [{ ...odo, rosterTier: 'archived_creature' }], { messageCount: 41 })).toBe('');
        const warm = buildRelationshipBeatBlock(mintRelationshipBeat(selectRelationshipBeatCandidate([maren], [], { messages: messagesOf(40), messageCount: 40 }), { messageCount: 40 }), [maren], { messageCount: 40 });
        expect(warm).toContain('Between them now: Waiting to hear about the caravan.');
        expect(warm).toContain('a letter or a messenger');
    });
});

describe('deriveRelationshipStage (2026-09-13 overhaul slice 1) — derived from the record, never declared', () => {
    it('reads stranger → acquaintance → familiar off a thin record', () => {
        expect(deriveRelationshipStage({ name: 'Odo' }).stage).toBe('stranger');
        expect(deriveRelationshipStage({ name: 'Odo', lastNotes: 'Sold the hero rope.' }).stage).toBe('acquaintance');
        expect(deriveRelationshipStage({ name: 'Odo', disposition: 'neutral' }).stage).toBe('acquaintance');
        expect(deriveRelationshipStage({ name: 'Odo', stanceToPlayer: 'Wary of the hero.' }).stage).toBe('familiar');
        const withLegacy = deriveRelationshipStage({ name: 'Odo', bondMoments: [{ text: 'Shared a drink.', at: 5 }] });
        expect(withLegacy.stage).toBe('familiar');
        expect(withLegacy.since).toBe('Shared a drink.');
    });

    it('ungraded legacy moments never lift a stage past familiar', () => {
        const npc = { name: 'Maren', disposition: 'friendly', bondMoments: [
            { text: 'Maren and the hero spent the night together.', at: 1 },
            { text: 'Maren confessed her sister vanished.', at: 2 },
        ] };
        expect(deriveRelationshipStage(npc).stage).toBe('familiar');
    });

    it('a trust-earning key moment makes trusted, an intimacy key moment makes intimate, with the moment as "since"', () => {
        const trusted = deriveRelationshipStage({ name: 'Maren', disposition: 'friendly', bondMoments: [
            m('Maren confessed her sister vanished with the caravan.', 'confession', 4, 1),
        ] });
        expect(trusted).toMatchObject({ stage: 'trusted', label: 'Trusted', since: 'Maren confessed her sister vanished with the caravan.', sinceAt: 1 });

        const intimate = deriveRelationshipStage({ name: 'Maren', disposition: 'friendly', bondMoments: [
            m('Maren confessed her sister vanished with the caravan.', 'confession', 4, 1),
            m('Maren and the hero spent their first night together.', 'intimacy', 5, 2),
        ] });
        expect(intimate.stage).toBe('intimate');
        expect(intimate.since).toContain('first night');
    });

    it('a salience-3 intimacy or confession is not enough; trust >= 70 is', () => {
        expect(deriveRelationshipStage({ name: 'Maren', bondMoments: [m('A kiss.', 'intimacy', 3, 1)] }).stage).toBe('familiar');
        expect(deriveRelationshipStage({ name: 'Maren', trust: 72, lastNotes: 'x' }).stage).toBe('trusted');
    });

    it('a wary disposition holds intimate back to trusted; hostile is rival since the last rift', () => {
        const wary = deriveRelationshipStage({ name: 'Maren', disposition: 'wary', bondMoments: [
            m('First night together.', 'intimacy', 5, 1),
            m('She confessed her fear.', 'confession', 4, 2),
        ] });
        expect(wary.stage).toBe('trusted');
        const hostile = deriveRelationshipStage({ name: 'Odo', disposition: 'hostile', bondMoments: [
            m('Odo swore to see the hero hang.', 'quarrel', 4, 1),
        ] });
        expect(hostile).toMatchObject({ stage: 'rival', since: 'Odo swore to see the hero hang.' });
        expect(deriveRelationshipStage({ name: 'Odo', disposition: 'hostile' }).stage).toBe('rival');
    });

    it('a betrayal after earned warmth makes estranged unless a later reconciliation mends it', () => {
        const rows = [
            m('First night together.', 'intimacy', 5, 1),
            m('Maren sold the hero to the watch.', 'betrayal', 5, 2),
        ];
        const estranged = deriveRelationshipStage({ name: 'Maren', disposition: 'neutral', bondMoments: rows });
        expect(estranged).toMatchObject({ stage: 'estranged', since: 'Maren sold the hero to the watch.' });
        const mended = deriveRelationshipStage({ name: 'Maren', disposition: 'friendly', bondMoments: [
            ...rows,
            m('Maren begged forgiveness and the hero gave it.', 'reconciliation', 4, 3),
        ] });
        expect(mended.stage).toBe('intimate');
        // A betrayal with no warmth before it is just a rift on a familiar record.
        expect(deriveRelationshipStage({ name: 'Odo', disposition: 'neutral', bondMoments: [m('Odo cheated the hero at dice.', 'betrayal', 4, 1)] }).stage).toBe('familiar');
        // Warmth proven by arc history counts too.
        expect(deriveRelationshipStage({ name: 'Odo', disposition: 'neutral', relationshipHistory: [{ from: 'friendly', to: 'wary', at: 1 }], bondMoments: [m('Odo cheated the hero at dice.', 'betrayal', 4, 2)] }).stage).toBe('estranged');
    });

    it('describeStageForPrompt renders a compact clause and nothing for thin records', () => {
        expect(describeStageForPrompt({ name: 'Odo', lastNotes: 'x' })).toBe('');
        expect(describeStageForPrompt({ name: 'Maren', trust: 80, lastNotes: 'x' })).toBe('trusted');
        expect(describeStageForPrompt({ name: 'Maren', disposition: 'friendly', bondMoments: [m('She saved the hero at the ford.', 'rescue', 5, 1)] }))
            .toBe('trusted (since: She saved the hero at the ford.)');
    });

    it('survives hostile input', () => {
        expect(deriveRelationshipStage(null).stage).toBe('stranger');
        expect(deriveRelationshipStage({ name: 'X', bondMoments: 'junk', relationshipHistory: 7, disposition: {} }).stage).toBe('stranger');
    });
});

describe('resolveOpenThread — the Scribe thread wins, an active linked promise stands in', () => {
    const cards = [
        { type: 'promise', status: 'active', text: 'The hero swore to Maren he would find the caravan.', linkedNpcNames: ['Maren Holt'] },
        { type: 'promise', status: 'resolved', text: 'The hero promised Odo a drink.', linkedNpcNames: ['Odo'] },
        { type: 'mystery', status: 'active', text: 'Who burned the mill?', subject: 'Maren Holt' },
        { type: 'promise', status: 'active', text: 'Bran expects the hero back by winter.', subject: 'Bran' },
    ];

    it('prefers the recorded thread', () => {
        expect(resolveOpenThread({ name: 'Maren Holt', openThread: 'Waiting to hear about the caravan.' }, cards))
            .toEqual({ text: 'Waiting to hear about the caravan.', source: 'scribe' });
    });

    it('falls back to the newest active promise linked by name or subject, never a resolved or non-promise card', () => {
        expect(resolveOpenThread({ name: 'Maren' }, cards)).toEqual({ text: 'The hero swore to Maren he would find the caravan.', source: 'promise' });
        expect(resolveOpenThread({ name: 'Odo' }, cards)).toBeNull();
        expect(resolveOpenThread({ name: 'Bran' }, cards)).toEqual({ text: 'Bran expects the hero back by winter.', source: 'promise' });
        expect(resolveOpenThread({ name: 'Nobody' }, cards)).toBeNull();
    });

    it('survives hostile input', () => {
        expect(resolveOpenThread({ name: 'Maren', openThread: { evil: true } }, cards).source).toBe('promise');
        expect(resolveOpenThread({ name: 'Maren' }, 'junk')).toBeNull();
        expect(resolveOpenThread(null, [null, 4, { type: 'promise' }])).toBeNull();
    });
});
