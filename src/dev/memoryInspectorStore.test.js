import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    captureInjection,
    captureReflection,
    captureScribePass,
    getInspectorSnapshot,
    isMemoryInspectorEnabled,
    resetInspector,
    subscribeInspector,
} from './memoryInspectorStore.js';

afterEach(() => {
    resetInspector();
});

describe('memory inspector capture store', () => {
    it('captures an injection with clipped text and rounded scores', () => {
        captureInjection({
            playerMessage: '  I ask the   archivist about the caravans.  ',
            location: 'Clockwork Tower',
            retrieved: [{ text: 'The caravans stopped a week ago.', category: 'world_fact', score: 0.71234567, location: 'Lowlands' }],
            curated: [{
                id: 'mem-1', type: 'promise', subject: 'sundial', text: 'Promised to mend the sundial.',
                salience: 3, emotionalCharge: 2, score: 14.5678, lastUsedAt: null,
            }],
        });

        const { lastInjection } = getInspectorSnapshot();
        expect(lastInjection.playerMessage).toBe('I ask the archivist about the caravans.');
        expect(lastInjection.retrieved[0]).toMatchObject({ category: 'world_fact', score: 0.712, location: 'Lowlands' });
        expect(lastInjection.curated[0]).toMatchObject({ id: 'mem-1', type: 'promise', score: 14.568, salience: 3 });
        expect(lastInjection.at).toBeGreaterThan(0);
    });

    it('caps injection lists and tolerates missing fields', () => {
        captureInjection({
            retrieved: Array.from({ length: 20 }, (_, i) => ({ text: `memory ${i}` })),
            curated: Array.from({ length: 20 }, (_, i) => ({ text: `card ${i}` })),
        });
        const { lastInjection } = getInspectorSnapshot();
        expect(lastInjection.retrieved).toHaveLength(12);
        expect(lastInjection.curated).toHaveLength(12);
        expect(lastInjection.retrieved[0].score).toBeNull();
        expect(lastInjection.curated[0].type).toBe('callback');
    });

    it('captures scribe and reflection passes independently', () => {
        captureScribePass({
            facts: [{ fact: 'The tower burned.' }, 'The orchard is breached.'],
            npcsUpdated: ['Tallis'],
            cards: [{ type: 'wound', subject: 'shoulder', text: 'Axe wound to the shoulder.' }],
            playerAppearance: true,
            location: 'Conservatory',
            lootAudited: true,
        });
        captureReflection({
            cadenceId: 'journal-s1-30',
            frontAdvances: [{ id: 'front-v2-1', delta: 1, reason: 'Player ignored the scout.', symptom: 'Smoke over the pass.' }],
            cards: [],
        });

        const snapshot = getInspectorSnapshot();
        expect(snapshot.lastScribePass.facts).toEqual(['The tower burned.', 'The orchard is breached.']);
        expect(snapshot.lastScribePass).toMatchObject({ playerAppearance: true, location: 'Conservatory', lootAudited: true, paymentAudited: false });
        expect(snapshot.lastReflection.cadenceId).toBe('journal-s1-30');
        expect(snapshot.lastReflection.frontAdvances[0]).toMatchObject({ id: 'front-v2-1', delta: 1 });
        expect(snapshot.lastScribePass.cards[0]).toMatchObject({ type: 'wound', subject: 'shoulder' });
    });

    it('returns a stable snapshot reference between captures and notifies subscribers', () => {
        const before = getInspectorSnapshot();
        expect(getInspectorSnapshot()).toBe(before);

        const listener = vi.fn();
        const unsubscribe = subscribeInspector(listener);
        captureInjection({ playerMessage: 'hello' });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(getInspectorSnapshot()).not.toBe(before);

        unsubscribe();
        captureInjection({ playerMessage: 'again' });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('resets to the empty snapshot', () => {
        captureInjection({ playerMessage: 'hello' });
        resetInspector();
        expect(getInspectorSnapshot()).toMatchObject({ lastInjection: null, lastScribePass: null, lastReflection: null });
    });
});

describe('isMemoryInspectorEnabled', () => {
    it('honors the settings toggle and defaults to off', () => {
        expect(isMemoryInspectorEnabled({ memoryInspector: true })).toBe(true);
        expect(isMemoryInspectorEnabled({ memoryInspector: false })).toBe(false);
        // No window in the node test environment: the URL-flag path must fail safe.
        expect(isMemoryInspectorEnabled({})).toBe(false);
        expect(isMemoryInspectorEnabled(undefined)).toBe(false);
    });
});
