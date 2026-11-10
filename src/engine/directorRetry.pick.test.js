/**
 * One director per pass, one in flight (2026-11-09 living-world P2): the
 * effect launched every ready director at once.
 */
import { describe, expect, it } from 'vitest';
import { DIRECTOR_RETRY_MIN_DISTANCE, pickDirectorToRun } from './directorRetry.js';

const rows = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
const table = [
    { name: 'frontAftermath', getKey: s => s.session.pendingFrontAftermath?.frontId || null },
    { name: 'absenceDrift', getKey: s => s.session.pendingAbsenceDrift?.key || null },
    { name: 'regionalFronts', getKey: s => s.session.pendingRegionalFronts?.key || null },
];
const armed = (session = {}) => ({
    messages: rows(40),
    session: {
        pendingFrontAftermath: { frontId: 'front-1' },
        pendingAbsenceDrift: { key: 'loc|40' },
        pendingRegionalFronts: { key: 'land|40' },
        ...session,
    },
});

describe('pickDirectorToRun', () => {
    it('three armed directors launch ONE per pass, in table order, each after the last settles', () => {
        const parked = {};
        const launched = [];
        for (let pass = 0; pass < 6; pass++) {
            const picked = pickDirectorToRun(table, armed(), parked, false);
            if (!picked) continue;
            parked[picked.director.name] = picked.key;
            launched.push(picked.director.name);
            // While that call is out, no pass launches another.
            expect(pickDirectorToRun(table, armed(), parked, true)).toBeNull();
        }
        expect(launched).toEqual(['frontAftermath', 'absenceDrift', 'regionalFronts']);
    });

    it('skips a parked key, an unarmed director and one inside its backoff', () => {
        expect(pickDirectorToRun(table, armed(), { frontAftermath: 'front-1' }).director.name).toBe('absenceDrift');
        expect(pickDirectorToRun(table, armed({ pendingFrontAftermath: null })).director.name).toBe('absenceDrift');
        const failed = armed({ directorFailures: { frontAftermath: { key: 'front-1', attempts: 1, atMessage: 40 - (DIRECTOR_RETRY_MIN_DISTANCE - 1) } } });
        expect(pickDirectorToRun(table, failed).director.name).toBe('absenceDrift');
        expect(pickDirectorToRun(table, { messages: [], session: {} })).toBeNull();
        expect(pickDirectorToRun(null, armed())).toBeNull();
    });
});
