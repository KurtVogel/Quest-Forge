import { describe, expect, it } from 'vitest';
import { deriveRelationshipStage, describeStageForPrompt, resolveOpenThread } from './relationshipArc.js';

const m = (text, kind, salience, at) => ({ text, kind, salience, at });

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
