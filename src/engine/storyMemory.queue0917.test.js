/**
 * Queue sweep 2026-09-17 — story-memory Lap-2 hostile-input pins at the ENGINE
 * boundary (`normalizeStoryMemoryCard` and its list/flag/stamp readers). Every
 * case reproduces an audit line that used to throw, declassify, demote, or
 * poison the prompt.
 */
import { describe, expect, it } from 'vitest';
import {
    applyStoryMemoryDormancy,
    buildStoryMemoryPromptBlock,
    curateStoryMemory,
    formatSecrecyTag,
    normalizeStoryMemoryCard,
    normalizeStoryMemoryUpdate,
} from './storyMemory.js';

describe('P1: a card must be a plain object', () => {
    it('null / arrays / scalars normalize to null instead of throwing', () => {
        expect(normalizeStoryMemoryCard(null)).toBeNull();
        expect(normalizeStoryMemoryCard(undefined)).toBeNull();
        expect(normalizeStoryMemoryCard(['a promise'])).toBeNull();
        expect(normalizeStoryMemoryCard('a promise')).toBeNull();
        expect(normalizeStoryMemoryCard(7)).toBeNull();
        expect(normalizeStoryMemoryCard(true)).toBeNull();
    });

    it('a null EXISTING base is tolerated on the merge lane', () => {
        const card = normalizeStoryMemoryCard({ text: 'Oren owes the hero a boat.' }, null);
        expect(card.text).toBe('Oren owes the hero a boat.');
    });
});

describe('P1: a SCALAR list field is a one-item list', () => {
    it('knownBy: "the hero" keeps the card SECRET and drops witnessed (secrecy beats hearsay)', () => {
        const card = normalizeStoryMemoryCard({ text: 'The hero buried the seal under the elm.', knownBy: 'the hero', witnessed: true });
        expect(card.knownBy).toEqual(['the hero']);
        expect(card.witnessed).toBeUndefined();
        expect(buildStoryMemoryPromptBlock([card])).toContain('[SECRET — known only to: the hero]');
    });

    it('linkedNpcNames: "Maren" still earns the present-NPC bonus in curation', () => {
        const card = normalizeStoryMemoryCard({ text: 'Maren swore to meet the hero at the mill.', type: 'promise', linkedNpcNames: 'Maren' });
        expect(card.linkedNpcNames).toEqual(['Maren']);
        const [best] = curateStoryMemory({ memories: [card], query: 'the mill', npcs: [{ name: 'Maren' }] });
        expect(best.score).toBeGreaterThan(card.salience * 2 + card.emotionalCharge + 5);
    });

    it('tags: "map" is one tag, and the update lane reads scalars the same way', () => {
        expect(normalizeStoryMemoryCard({ text: 'x marks the spot', tags: 'map' }).tags).toEqual(['map']);
        const update = normalizeStoryMemoryUpdate({ id: 'mem-1', tags: 'map', linked_npc_names: 'Maren' });
        expect(update.tags).toEqual(['map']);
        expect(update.linkedNpcNames).toEqual(['Maren']);
    });
});

describe('P2: witnessed reads through toFlag', () => {
    it('"false" / "no" / 0 are NOT witnessed; "true" / true / "yes" are', () => {
        const at = (witnessed) => normalizeStoryMemoryCard({ text: 'A public duel in the square.', witnessed }).witnessed;
        expect(at('false')).toBeUndefined();
        expect(at('no')).toBeUndefined();
        expect(at(0)).toBeUndefined();
        expect(at('true')).toBe(true);
        expect(at(true)).toBe(true);
        expect(at('yes')).toBe(true);
    });
});

describe('P2: engine stamps clamp to the transcript at load; wall-clock stamps are typed', () => {
    it('a future lastUsedMessage clamps to "now" so the cooldown expires instead of pinning the card out forever', () => {
        const card = normalizeStoryMemoryCard(
            { text: 'Oren owes the hero a boat.', type: 'promise', lastUsedMessage: 1e9, lastSeenMessage: 1e9, firstSeenMessage: 1e9 },
            null,
            { maxMessageCount: 51 },
        );
        expect(card).toMatchObject({ lastUsedMessage: 51, lastSeenMessage: 51, firstSeenMessage: 51 });
        // 60 conversational messages later the promise scores again.
        const messages = Array.from({ length: 111 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
        const [scored] = curateStoryMemory({ memories: [card], query: 'boat', messages });
        expect(scored?.score).toBeGreaterThan(0);
    });

    it('a negative or fractional stamp rounds into range; a non-number stamp is dropped', () => {
        const card = normalizeStoryMemoryCard({ text: 'x', lastSeenMessage: -4, firstSeenMessage: 2.6, lastUsedMessage: '9' }, null, { maxMessageCount: 10 });
        expect(card.lastSeenMessage).toBe(0);
        expect(card.firstSeenMessage).toBe(3);
        expect(card.lastUsedMessage).toBeUndefined();
    });

    it('without maxMessageCount the stamps pass through (the live merge lane)', () => {
        const card = normalizeStoryMemoryCard({ text: 'x', lastSeenMessage: 40 });
        expect(card.lastSeenMessage).toBe(40);
    });

    it('junk wall-clock stamps type to now / null and a salience-2 card no longer goes dormant on the next cadence', () => {
        const before = Date.now();
        const card = normalizeStoryMemoryCard({ text: 'A quiet beat.', salience: 2, firstSeenAt: 'junk', lastSeenAt: { at: 1 }, lastUsedAt: 'never' });
        expect(card.firstSeenAt).toBeGreaterThanOrEqual(before);
        expect(card.lastSeenAt).toBeGreaterThanOrEqual(before);
        expect(card.lastUsedAt).toBeNull();
        const journal = [1, 2, 3].map(i => ({ timestamp: before - 1000 * i }));
        expect(applyStoryMemoryDormancy([card], journal)[0].status).toBe('active');
    });

    it('the dormancy belt reads a poisoned stored stamp as "never", not NaN', () => {
        const stored = { text: 'x', type: 'callback', status: 'active', salience: 2, firstSeenAt: 'junk', lastSeenAt: Date.now(), lastUsedAt: null };
        const journal = [1, 2, 3].map(i => ({ timestamp: Date.now() - 1000 * i }));
        expect(applyStoryMemoryDormancy([stored], journal)[0].status).toBe('active');
    });
});

describe('P2: string-or-drop on text / subject / id / location / source', () => {
    it('an object text is no text (null card); an object subject/id/location/source is dropped', () => {
        expect(normalizeStoryMemoryCard({ text: { nested: true } })).toBeNull();
        const card = normalizeStoryMemoryCard({ text: 'A promise.', subject: { x: 1 }, id: { y: 2 }, location: ['Mill'], source: { z: 3 } });
        expect(card.subject).toBe('');
        expect(card.id).toMatch(/^mem-/);
        expect(card.location).toBe('');
        expect(card.source).toBe('scribe');
        expect(JSON.stringify(card)).not.toContain('[object Object]');
        expect(buildStoryMemoryPromptBlock([card])).not.toContain('[object Object]');
    });

    it('two object-id cards never merge into one "[object Object]" identity', () => {
        const a = normalizeStoryMemoryCard({ text: 'First beat.', id: { y: 1 } });
        const b = normalizeStoryMemoryCard({ text: 'Second beat.', id: { y: 2 } });
        expect(a.id).not.toBe(b.id);
    });

    it('a numeric id reads as its digits', () => {
        expect(normalizeStoryMemoryCard({ text: 'x', id: 12 }).id).toBe('12');
    });
});

describe('P2: list ELEMENTS are clamped', () => {
    it('a 100k knower / NPC name / tag is cut to 80 characters on the card, in the SECRET tag, and in the prompt block', () => {
        const huge = 'N'.repeat(100_000);
        const card = normalizeStoryMemoryCard({ text: 'A secret.', knownBy: [huge], linkedNpcNames: [huge], tags: [huge] });
        expect(card.knownBy[0]).toHaveLength(80);
        expect(card.linkedNpcNames[0]).toHaveLength(80);
        expect(card.tags[0]).toHaveLength(80);
        expect(formatSecrecyTag([huge]).length).toBeLessThan(200);
        expect(buildStoryMemoryPromptBlock([card]).length).toBeLessThan(1500);
    });
});

describe('P2: type identity folds case and punctuation', () => {
    it('Promise / PROMISE / player canon / npc-agenda / Player_Canon resolve to their canonical types', () => {
        const typeOf = (type) => normalizeStoryMemoryCard({ text: 'x', type }).type;
        expect(typeOf('Promise')).toBe('promise');
        expect(typeOf('PROMISE')).toBe('promise');
        expect(typeOf('player canon')).toBe('playerCanon');
        expect(typeOf('Player_Canon')).toBe('playerCanon');
        expect(typeOf('npc-agenda')).toBe('npcAgenda');
        expect(typeOf('NPC Agenda')).toBe('npcAgenda');
        expect(typeOf('Foreshadow')).toBe('foreshadow');
        expect(typeOf('not a type')).toBe('callback');
    });

    it('a case-drifted promise keeps the +2 bonus and the dormancy exemption', () => {
        const card = normalizeStoryMemoryCard({ text: 'Oren owes the hero a boat.', type: 'Promise', salience: 1 });
        const journal = [1, 2, 3].map(i => ({ timestamp: Date.now() + 1000 * i }));
        expect(applyStoryMemoryDormancy([card], journal)[0].status).toBe('active');
    });
});
