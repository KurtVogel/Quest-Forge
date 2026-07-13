/**
 * The !db guards: when the user has not configured their own Firebase, every
 * cloud function must return its documented empty value instead of throwing.
 * Lives in its own file because the firebase.js mock is per-module-graph.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/firebase.js', () => ({ db: null }));

const { saveGameToCloud, loadGameFromCloud, listCloudSaves, deleteGameFromCloud } = await import('./cloudSync.js');

describe('cloud sync without a configured Firebase', () => {
    it('every function returns its safe empty value', async () => {
        expect(await saveGameToCloud('u1', 'slot-1', { session: {}, character: {} })).toBe(false);
        expect(await loadGameFromCloud('u1', 'slot-1')).toBeNull();
        expect(await listCloudSaves('u1')).toEqual([]);
        expect(await deleteGameFromCloud('u1', 'slot-1')).toBe(false);
    });
});
