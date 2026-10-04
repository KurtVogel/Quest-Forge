/**
 * The !db guards: when the user has not configured their own Firebase, every
 * cloud function must return its documented empty value instead of throwing.
 * Lives in its own file because the firebase.js mock is per-module-graph.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/firebase.js', () => ({ db: null }));

const { saveGameToCloud, loadGameFromCloud, listCloudSaves, deleteGameFromCloud } = await import('./cloudSync.js');

describe('cloud sync without a configured Firebase', () => {
    it('every function answers in the one result shape: unavailable, with the Settings remedy — an empty list is not a failure', async () => {
        const unavailable = { ok: false, reason: 'unavailable' };
        const save = await saveGameToCloud('u1', 'slot-1', { session: {}, character: {} });
        expect(save).toMatchObject(unavailable);
        expect(save.message).toContain('Settings');
        expect(await loadGameFromCloud('u1', 'slot-1')).toMatchObject(unavailable);
        expect(await deleteGameFromCloud('u1', 'slot-1')).toMatchObject(unavailable);
        expect(await listCloudSaves('u1')).toEqual({ ok: true, saves: [] });
    });
});
