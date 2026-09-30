/**
 * `conversationalDistance` — O(1) per call through a prefix count memoized on
 * the transcript array (2026-09-30 story-memory + prompt-building Lap-3 P2).
 * The count skips system lines and hidden / deleted rows like every ledger
 * window; these pins hold the memoized form to the original walk bit for bit.
 */
import { describe, expect, it } from 'vitest';
import { conversationalDistance } from './replayLedger.js';

/** The pre-2026-09-30 walk, kept here as the oracle. */
function walk(messages, fromIndex, toIndex) {
    let distance = 0;
    for (let i = Math.max(0, fromIndex + 1); i <= Math.min(toIndex, messages.length - 1); i++) {
        const message = messages[i];
        if (!message || message.role === 'system' || message.hidden || message.deleted) continue;
        distance += 1;
    }
    return distance;
}

/** Deterministic LCG so the fixture is reproducible without a seed library. */
function makeRandom(seed) {
    let x = seed >>> 0;
    return () => {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        return x / 0x100000000;
    };
}

function makeTranscript(length, seed) {
    const random = makeRandom(seed);
    return Array.from({ length }, (_, i) => {
        const roll = random();
        if (roll < 0.08) return null;
        if (roll < 0.30) return { id: `s${i}`, role: 'system', content: 'engine line' };
        const row = { id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `row ${i}` };
        if (roll > 0.92) row.hidden = true;
        else if (roll > 0.86) row.deleted = true;
        return row;
    });
}

describe('conversationalDistance — memoized prefix count', () => {
    it('matches the original walk on every (from, to) pair of a mixed transcript, including out-of-range and degenerate bounds', () => {
        const messages = makeTranscript(120, 7);
        const probes = [-5, -1, 0, 1, 2, 17, 58, 59, 60, 118, 119, 120, 121, 500, 2.5, NaN];
        for (const from of probes) {
            for (const to of probes) {
                expect(conversationalDistance(messages, from, to), `from ${from} to ${to}`).toBe(walk(messages, Math.floor(from), Math.floor(to)));
            }
        }
    });

    it('counts only conversational rows: system, hidden, deleted, and null rows are skipped', () => {
        const messages = [
            { role: 'user', content: 'a' },
            { role: 'system', content: 'roll' },
            { role: 'assistant', content: 'b', hidden: true },
            null,
            { role: 'assistant', content: 'c', deleted: true },
            { role: 'assistant', content: 'd' },
            { role: 'user', content: 'e' },
        ];
        expect(conversationalDistance(messages, -1, 6)).toBe(3);
        expect(conversationalDistance(messages, 0, 6)).toBe(2);
        expect(conversationalDistance(messages, 5, 6)).toBe(1);
        expect(conversationalDistance(messages, 6, 6)).toBe(0);
        expect(conversationalDistance(messages, 6, 2)).toBe(0);
    });

    it('re-counts when the same array grows in place (the length belt) and keeps the raw-gap fallback without a transcript', () => {
        const messages = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
        expect(conversationalDistance(messages, -1, 1)).toBe(2);
        messages.push({ role: 'user', content: 'c' }, { role: 'system', content: 'x' }, { role: 'assistant', content: 'd' });
        expect(conversationalDistance(messages, -1, 4)).toBe(4);
        expect(conversationalDistance(messages, 1, 4)).toBe(2);
        expect(conversationalDistance(null, 3, 10)).toBe(7);
        expect(conversationalDistance(undefined, 10, 3)).toBe(0);
    });

    it('is O(1) after the first call on a transcript: 20,000 distances over 6,000 rows finish in well under the old walk\'s time', () => {
        const messages = makeTranscript(6000, 11);
        conversationalDistance(messages, 0, 5999); // warm the count
        const started = performance.now();
        let sum = 0;
        for (let i = 0; i < 20000; i++) {
            sum += conversationalDistance(messages, (i * 37) % 6000, 5999);
        }
        const elapsed = performance.now() - started;
        expect(sum).toBeGreaterThan(0);
        // The old walk averaged ~3,000 rows per call here: 20,000 calls ≈ 60M
        // row visits, hundreds of ms. Generous ceiling for a slow CI box.
        expect(elapsed).toBeLessThan(200);
    });
});
