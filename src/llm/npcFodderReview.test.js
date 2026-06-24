import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildFodderReviewBatch,
    extractArchiveIdsFallback,
    parseReviewResponse,
    suggestArchivableFodder,
} from './npcFodderReview.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({ sendMessage: vi.fn() }));

describe('npcFodderReview', () => {
    beforeEach(() => sendMessage.mockReset());

    it('builds compact review payloads and skips pinned or archived NPCs', () => {
        const batch = buildFodderReviewBatch([
            { id: '1', name: 'Goblin runt A', lastNotes: 'Slain in the cave.' },
            { id: '2', name: 'Captain Riven', pinned: true, lastNotes: 'Pursuing Vesa.' },
            { id: '3', name: 'Goblin #4', rosterTier: 'archived_creature' },
        ]);

        expect(batch).toHaveLength(1);
        expect(batch[0]).toMatchObject({ id: '1', name: 'Goblin runt A' });
    });

    it('returns only validated archive ids from the Scribe response', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            archive_ids: ['gob-1', 'gob-2', 'missing-id'],
        }));

        const result = await suggestArchivableFodder({
            settings: { apiKey: 'test', llmProvider: 'gemini', model: 'gemini-test' },
            npcs: [
                { id: 'gob-1', name: 'Goblin runt A', lastNotes: 'Killed.' },
                { id: 'gob-2', name: 'Goblin runt B', lastNotes: 'Killed.' },
                { id: 'riv', name: 'Captain Riven', agenda: 'Restore order.', lastNotes: 'Antagonist.' },
            ],
        });

        expect(result.ids).toEqual(['gob-1', 'gob-2']);
        expect(result.partialFailure).toBe(false);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('parses fenced JSON and falls back when the payload is malformed', () => {
        const allowed = new Set(['gob-1', 'gob-2']);
        const fenced = '```json\n{"archive_ids":["gob-1","gob-2"]}\n```';
        expect(parseReviewResponse(fenced, allowed)).toEqual(['gob-1', 'gob-2']);

        const broken = '{"archive_ids":["gob-1","gob-2"';
        expect(parseReviewResponse(broken, allowed)).toEqual(['gob-1', 'gob-2']);
        expect(extractArchiveIdsFallback(broken)).toEqual(['gob-1', 'gob-2']);
    });

    it('requires an API key', async () => {
        await expect(suggestArchivableFodder({ npcs: [], settings: {} }))
            .rejects
            .toThrow(/API key/i);
    });

    it('throws a friendly error only when every batch fails to parse', async () => {
        sendMessage.mockResolvedValue('Sorry, I cannot help with that.');

        await expect(suggestArchivableFodder({
            settings: { apiKey: 'test', llmProvider: 'gemini', model: 'gemini-test' },
            npcs: [{ id: 'gob-1', name: 'Goblin runt A', lastNotes: 'Killed.' }],
        })).rejects.toThrow(/could not read the AI response/i);
    });
});