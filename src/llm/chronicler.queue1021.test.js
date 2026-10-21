/**
 * The 2026-10-21 chronicler queue: the epilogue reply enters the Chronicle
 * (and only the Chronicle — DECISIONS.md 2026-10-21), the final part never
 * claims a withheld setup row the player can still reveal, clip + salvage
 * both warn, the fence grammar is the parser's, a chapter's `createdAt` is a
 * sane epoch, and an all-junk close over an undefined chronicle keeps the
 * ceremony nudge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from './adapter.js';
import { chronicleToMarkdown, collectChronicleEntries, planChroniclePassages, writeChronicleChapters, CHRONICLE_MIN_MESSAGES } from './chronicler.js';
import { collectNarrativeEntries } from './narrativeMessages.js';
import { EPILOGUE_REQUEST_MESSAGE, RECAP_REQUEST_MESSAGE } from './tableTalk.js';
import { CHRONICLE_CHAPTER_TEXT_MAX } from '../config/contentLimits.js';
import { appendChronicleChapter, gameReducer, initialGameState } from '../state/gameReducer.js';
import { normalizeChronicleChapter, saneEpochMs } from '../state/handlers/shared.js';

vi.mock('./adapter.js', () => ({ sendMessage: vi.fn() }));

const SETTINGS = { llmProvider: 'gemini', apiKey: 'test-key', model: 'test-model' };
const play = (count) => Array.from({ length: count }, (_, i) => ({ id: `m${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: `Play beat number ${i}.` }));

const ENDING = [
    { id: 'u1', role: 'user', content: 'I charge the Cutter.' },
    { id: 'a1', role: 'assistant', content: 'The blade finds you first.' },
    { id: 's1', role: 'system', content: '🪦 **Here ends the story of Astra**, level 4 human fighter.', kind: 'epitaph' },
    { id: 'u2', role: 'user', content: EPILOGUE_REQUEST_MESSAGE },
    { id: 'a2', role: 'assistant', content: 'Jorun buried her at the crossroads and never spoke of it again.' },
    { id: 'u3', role: 'user', content: RECAP_REQUEST_MESSAGE },
    { id: 'a3', role: 'assistant', content: 'Out of character: you are dead, the quests are open.' },
];

beforeEach(() => sendMessage.mockReset());

describe('the epilogue is the chronicle\'s one table-talk exception', () => {
    it('collectChronicleEntries keeps the DM\'s epilogue reply flagged, drops the request, and still drops the recap pair', () => {
        const ids = collectChronicleEntries(ENDING, 0).map(e => e.message.id);
        expect(ids).toEqual(['u1', 'a1', 's1', 'a2']);
        expect(collectChronicleEntries(ENDING, 0).find(e => e.message.id === 'a2').epilogue).toBe(true);
        expect(collectChronicleEntries(ENDING, 0).find(e => e.message.id === 'a1').epilogue).toBeUndefined();
    });

    it('the memory readers\' default gate still skips the epilogue pair (DECISIONS 2026-09-30 holds)', () => {
        expect(collectNarrativeEntries(ENDING, 0).map(e => e.message.id)).toEqual(['u1', 'a1', 's1']);
    });

    it('the transcript line tells the chronicler what the epilogue is', () => {
        const [chunk] = planChroniclePassages(collectChronicleEntries(ENDING, 0), 'Astra');
        expect(chunk.transcript).toContain('DM — THE EPILOGUE (what became of everyone after the hero\'s death; retell it as the saga\'s close, nothing after it): Jorun buried her');
        expect(chunk.transcript).toContain('DM: The blade finds you first.');
        expect(chunk.transcript).not.toContain('Out of character');
    });
});

describe('the final part stops before a revealable setup row (2026-10-21 P2)', () => {
    it('with a proposal on the table the claim ends on the last narrative row; without one it claims the raw end', async () => {
        sendMessage.mockResolvedValue('The saga, retold.');
        const messages = [
            ...play(CHRONICLE_MIN_MESSAGES),
            { id: 'setup-1', role: 'assistant', content: 'Withheld: a Stealth check is proposed.', hidden: true },
            { id: 'err-1', role: 'system', content: 'Error resolving check: Failed to fetch', kind: 'error' },
        ];
        const pending = { rolls: [{ type: 'skill_check', skill: 'stealth', dc: 12 }], playerAction: 'I sneak', setupMessageId: 'setup-1', preNarrated: false };
        const { chapters } = await writeChronicleChapters({ state: { settings: SETTINGS, messages, chronicle: [], pendingRoleplayCheck: pending } });
        expect(chapters[0].toIndex).toBe(CHRONICLE_MIN_MESSAGES - 1);

        // A RETOLD row after the setup is claimed with it — the claim never
        // stops short of the last message the chapter retold.
        sendMessage.mockResolvedValue('The saga, retold.');
        const retoldTail = [...messages, { id: 'sys-2', role: 'system', content: 'Rolled 14 — success.' }];
        const tail = await writeChronicleChapters({ state: { settings: SETTINGS, messages: retoldTail, chronicle: [], pendingRoleplayCheck: pending } });
        expect(tail.chapters[0].toIndex).toBe(retoldTail.length - 1);

        sendMessage.mockResolvedValue('The saga, retold.');
        const open = await writeChronicleChapters({ state: { settings: SETTINGS, messages, chronicle: [] } });
        expect(open.chapters[0].toIndex).toBe(messages.length - 1);
    });

    it('a pre-narrated proposal has nothing to reveal, so the raw end is claimed', async () => {
        sendMessage.mockResolvedValue('The saga, retold.');
        const messages = [...play(CHRONICLE_MIN_MESSAGES), { id: 'setup-1', role: 'assistant', content: 'Spoiled outcome.', hidden: true }];
        const pending = { rolls: [{ type: 'skill_check', skill: 'stealth', dc: 12 }], playerAction: 'I sneak', setupMessageId: 'setup-1', preNarrated: true };
        const { chapters } = await writeChronicleChapters({ state: { settings: SETTINGS, messages, chronicle: [], pendingRoleplayCheck: pending } });
        expect(chapters[0].toIndex).toBe(messages.length - 1);
    });
});

describe('clip + salvage both warn (2026-10-21 P2)', () => {
    it('a clipped first passage and a failed second call keep both sentences in one warning', async () => {
        sendMessage
            .mockResolvedValueOnce('x'.repeat(CHRONICLE_CHAPTER_TEXT_MAX + 500))
            .mockRejectedValueOnce(new Error('stall'));
        const { chapters, clipped, salvaged, warning } = await writeChronicleChapters({ state: { settings: SETTINGS, messages: play(40), chronicle: [] } });
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(chapters).toHaveLength(1);
        expect(chapters[0].text).toHaveLength(CHRONICLE_CHAPTER_TEXT_MAX);
        expect(clipped).toBe(true);
        expect(salvaged).toBe(true);
        expect(warning).toContain('failed partway');
        expect(warning).toContain('was clipped at its end');
    });
});

describe('the fence grammar is the parser\'s (2026-10-21 P2)', () => {
    it('a bare object fence and an upper-case JSON fence are stripped from the transcript like the tagged one', () => {
        const rows = [
            { message: { role: 'assistant', content: 'The door opens.\n```\n{"location": "Hall"}\n```' }, index: 0 },
            { message: { role: 'assistant', content: 'A shape moves.\n```JSON\n{"quest_updates": []}\n```\nIt is gone.' }, index: 1 },
            { message: { role: 'assistant', content: 'Classic.\n```json\n{"a": 1}\n```' }, index: 2 },
        ];
        const [chunk] = planChroniclePassages(rows, 'Astra');
        expect(chunk.transcript).not.toMatch(/\{"/);
        expect(chunk.transcript).toContain('DM: The door opens.');
        expect(chunk.transcript).toContain('A shape moves.');
        expect(chunk.transcript).toContain('It is gone.');
        expect(chunk.transcript).toContain('DM: Classic.');
    });
});

describe('a chapter\'s createdAt is a sane epoch (2026-10-21 P2)', () => {
    it('an absurd finite stamp becomes now at the composer and the export prints a real date', () => {
        const now = Date.now();
        const chapter = normalizeChronicleChapter({ title: 'T', text: 'Prose.', fromIndex: 0, toIndex: 3, createdAt: 1e300 });
        expect(chapter.createdAt).toBeGreaterThanOrEqual(now);
        expect(chronicleToMarkdown([chapter], 'Saga')).not.toContain('Invalid Date');
        expect(saneEpochMs(1e300, 1000)).toBe(1000);
        expect(saneEpochMs(-5, 1000)).toBe(1000);
        expect(saneEpochMs('junk', 1000)).toBe(1000);
        const kept = Date.UTC(2026, 9, 1);
        expect(saneEpochMs(kept, now)).toBe(kept);
        const appended = appendChronicleChapter([], { title: 'T', text: 'Prose.', fromIndex: 0, toIndex: 3 });
        expect(appended[0].createdAt).toBeGreaterThanOrEqual(now);
    });
});

describe('an all-junk close never consumes the ceremony nudge (2026-10-21 P2)', () => {
    it('over an undefined chronicle the nudge stays and no chapter lands', () => {
        const { chronicle: _dropped, ...withoutChronicle } = initialGameState;
        const state = { ...withoutChronicle, messages: play(4), session: { ...initialGameState.session, id: 's', chapterCloseSuggested: { reason: 'front', atMessage: 2 } } };
        const next = gameReducer(state, { type: 'ADD_CHRONICLE_CHAPTER', payload: [{ text: '' }, null, 42] });
        expect(next.session.chapterCloseSuggested).toEqual({ reason: 'front', atMessage: 2 });
        expect(next.chronicle ?? []).toEqual([]);
        const landed = gameReducer(state, { type: 'ADD_CHRONICLE_CHAPTER', payload: { title: 'T', text: 'Prose.', fromIndex: 0, toIndex: 3 } });
        expect(landed.session.chapterCloseSuggested).toBeNull();
        expect(landed.chronicle).toHaveLength(1);
    });
});
