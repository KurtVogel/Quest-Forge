/** WOW 2026-11-04: the quest wire carries patron / promised / outcome, typed string-or-drop. */
import { describe, expect, it } from 'vitest';
import { normalizeEvents } from './eventChannels.js';

describe('quest_updates — the sworn record fields at the wire', () => {
    it('reads patron, promised and outcome as clamped strings; outcome only on a close', () => {
        const events = normalizeEvents({
            quest_updates: [
                { status: 'new', name: 'The Manifest', description: 'd', patron: '  Hesper Vane ', promised: 'p'.repeat(300), outcome: 'not yet' },
                { status: 'completed', name: 'The Manifest', outcome: ' Delivered. ' },
                { status: 'failed', id: 'q-1', outcome: 'o'.repeat(500), patron: { name: 'object' }, promised: 42 },
            ],
        });
        expect(events.questUpdates[0]).toEqual({ name: 'The Manifest', description: 'd', patron: 'Hesper Vane', promised: 'p'.repeat(120), status: 'new' });
        expect(events.questUpdates[1]).toEqual({ name: 'The Manifest', outcome: 'Delivered.', status: 'completed' });
        expect(events.questUpdates[2]).toEqual({ id: 'q-1', outcome: 'o'.repeat(200), status: 'failed' });
    });
});
