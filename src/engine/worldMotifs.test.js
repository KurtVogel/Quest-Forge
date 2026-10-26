/**
 * The durable bestiary + motif tally (WOW 2026-10-26, slice 2).
 */
import { describe, expect, it } from 'vitest';
import {
    MAX_WORLD_MOTIFS,
    WORN_MOTIFS_LINE_CAP,
    WORN_MOTIF_THRESHOLD,
    describeWornMotifs,
    listWornMotifs,
    normalizeMotifKey,
    normalizeMotifList,
    recordWorldMotifs,
    sanitizeWorldMotifs,
} from './worldMotifs.js';

describe('normalizeMotifKey / normalizeMotifList', () => {
    it('lowercases, folds punctuation, clamps, and drops junk and placeholders', () => {
        expect(normalizeMotifKey('  Eyeless  Undead! ')).toBe('eyeless undead');
        expect(normalizeMotifKey('Pine-wood bandits')).toBe('pine-wood bandits');
        expect(normalizeMotifKey('x'.repeat(80))).toHaveLength(40);
        for (const junk of ['', 'no', 'none', 'N/A', 'unknown', null, 42, { x: 1 }]) {
            expect(normalizeMotifKey(junk), String(junk)).toBeNull();
        }
    });

    it('a scalar is a one-item list; the list dedupes and caps', () => {
        expect(normalizeMotifList('Timber palisade')).toEqual(['timber palisade']);
        expect(normalizeMotifList(['Black ichor', 'black ichor', 'bone-piles', 'a third'])).toEqual(['black ichor', 'bone-piles']);
        expect(normalizeMotifList(undefined)).toEqual([]);
    });
});

describe('recordWorldMotifs', () => {
    it('counts each key once per call, stamps the newest message, and returns the same object when nothing lands', () => {
        let tally = recordWorldMotifs({}, ['ghoul', 'Ghoul', 'pine woods'], { atMessage: 10 });
        expect(tally).toEqual({ ghoul: { count: 1, lastMessage: 10 }, 'pine woods': { count: 1, lastMessage: 10 } });
        tally = recordWorldMotifs(tally, ['ghoul'], { atMessage: 30 });
        expect(tally.ghoul).toEqual({ count: 2, lastMessage: 30 });
        expect(recordWorldMotifs(tally, [])).toBe(tally);
        expect(recordWorldMotifs(tally, ['', 'none'])).toBe(tally);
        expect(recordWorldMotifs(null, 'bandit', { atMessage: 'x' })).toEqual({ bandit: { count: 1, lastMessage: 0 } });
    });

    it('caps the tally at MAX_WORLD_MOTIFS — the lowest count, then the oldest, leaves first', () => {
        let tally = {};
        for (let i = 0; i < MAX_WORLD_MOTIFS; i += 1) {
            tally = recordWorldMotifs(tally, [`motif ${i}`], { atMessage: i });
        }
        tally = recordWorldMotifs(tally, ['motif 0'], { atMessage: 100 }); // now count 2
        tally = recordWorldMotifs(tally, ['newcomer'], { atMessage: 101 });
        expect(Object.keys(tally)).toHaveLength(MAX_WORLD_MOTIFS);
        expect(tally['motif 0'].count).toBe(2);
        expect(tally['motif 1']).toBeUndefined(); // count 1, the oldest of them
        expect(tally.newcomer).toEqual({ count: 1, lastMessage: 101 });
    });
});

describe('listWornMotifs / describeWornMotifs', () => {
    const tally = {
        'eyeless undead': { count: 6, lastMessage: 200 },
        'pine woods': { count: 9, lastMessage: 180 },
        'timber outpost': { count: 4, lastMessage: 210 },
        bandit: { count: 2, lastMessage: 220 },
        marsh: { count: WORN_MOTIF_THRESHOLD, lastMessage: 50 },
    };

    it('lists the worn keys highest count first, under the line cap', () => {
        expect(listWornMotifs(tally).map(entry => entry.key)).toEqual(['pine woods', 'eyeless undead', 'timber outpost', 'marsh']);
        const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, { count: 5 + i, lastMessage: i }]));
        expect(listWornMotifs(many)).toHaveLength(WORN_MOTIFS_LINE_CAP);
        expect(listWornMotifs(null)).toEqual([]);
    });

    it('renders the one standing line as a negative list, and nothing below the threshold', () => {
        const line = describeWornMotifs(tally);
        expect(line.startsWith('THIS WORLD HAS ALREADY SHOWN: pine woods ×9, eyeless undead ×6, timber outpost ×4, marsh ×3.')).toBe(true);
        expect(line).toContain('NONE of these unless the player hunts them or established canon puts them in THIS exact place');
        expect(line).not.toContain('bandit');
        expect(describeWornMotifs({ bandit: { count: 2, lastMessage: 1 } })).toBe('');
        expect(describeWornMotifs(undefined)).toBe('');
    });
});

describe('sanitizeWorldMotifs — the load twin', () => {
    it('types keys and entries, clamps stamps, folds a key that normalizes onto another, and caps', () => {
        const loaded = sanitizeWorldMotifs({
            'Eyeless Undead': { count: '3', lastMessage: 9999 },
            'eyeless undead': { count: 2, lastMessage: 4 },
            junk: 'x',
            none: { count: 5, lastMessage: 1 },
            zero: { count: 0, lastMessage: 1 },
            okay: { count: 1.9, lastMessage: -4 },
        }, { maxMessageCount: 50 });
        expect(loaded).toEqual({
            'eyeless undead': { count: 5, lastMessage: 50 },
            okay: { count: 1, lastMessage: 0 },
        });
        expect(sanitizeWorldMotifs(null)).toEqual({});
        expect(sanitizeWorldMotifs([1])).toEqual({});
        const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`key ${i}`, { count: i + 1, lastMessage: i }]));
        expect(Object.keys(sanitizeWorldMotifs(many))).toHaveLength(MAX_WORLD_MOTIFS);
    });
});
