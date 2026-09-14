/**
 * Chronicler queue sweep 2026-09-14 (2026-09-13 audit): the part budget is
 * counted in CHARACTERS like the reducer clamp, an over-long passage is
 * clipped with a warning, and an async close that outlives a campaign load
 * is dropped at the reducer (the same guard covers Deepen memory + portraits).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from './adapter.js';
import { writeChronicleChapters, CHRONICLE_CHUNK_SIZE } from './chronicler.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { campaignStamp } from '../state/handlers/shared.js';
import { CHRONICLE_CHAPTER_TEXT_MAX, CHRONICLE_PART_CHAR_BUDGET } from '../config/contentLimits.js';

vi.mock('./adapter.js', () => ({ sendMessage: vi.fn() }));

const SETTINGS = { llmProvider: 'gemini', apiKey: 'test-key', model: 'test-model' };
const messages = (count) => Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Play beat number ${i}.`,
}));

beforeEach(() => sendMessage.mockReset());

describe('part budget in characters (P1)', () => {
    it('ten 7,000-char passages close as TWO parts, neither over the chapter ceiling, spans contiguous, nothing lost', async () => {
        let call = 0;
        sendMessage.mockImplementation(() => Promise.resolve(`P${++call} ` + 'x'.repeat(6995)));
        const count = CHRONICLE_CHUNK_SIZE * 10;
        const { chapters, warning } = await writeChronicleChapters({
            state: { settings: SETTINGS, character: { name: 'Eero' }, session: {}, messages: messages(count), chronicle: [] },
        });
        expect(warning).toBeUndefined();
        expect(chapters).toHaveLength(2);
        for (const chapter of chapters) {
            expect(chapter.text.length).toBeLessThanOrEqual(CHRONICLE_PART_CHAR_BUDGET);
            expect(chapter.text.length).toBeLessThanOrEqual(CHRONICLE_CHAPTER_TEXT_MAX);
        }
        expect(chapters[0].text).toContain('P7 ');
        expect(chapters[0].text).not.toContain('P8 ');
        expect(chapters[1].text).toContain('P8 ');
        expect(chapters[1].text).toContain('P10 ');
        expect(chapters[0].fromIndex).toBe(0);
        expect(chapters[0].toIndex).toBe(CHRONICLE_CHUNK_SIZE * 7 - 1);
        expect(chapters[1].fromIndex).toBe(chapters[0].toIndex + 1);
        expect(chapters[1].toIndex).toBe(count - 1);
        // A split the chunk count would never have made is still titled as parts.
        expect(chapters.map(c => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
        // Through the reducer, no chapter is sliced.
        const next = gameReducer(initialGameState, { type: 'ADD_CHRONICLE_CHAPTER', payload: chapters });
        expect(next.chronicle.map(c => c.text.length)).toEqual(chapters.map(c => c.text.length));
    });

    it('a custom title names both parts of a character-driven split', async () => {
        let call = 0;
        sendMessage.mockImplementation(() => Promise.resolve(`P${++call} ` + 'x'.repeat(30000)));
        const { chapters } = await writeChronicleChapters({
            title: 'The Long Winter',
            state: { settings: SETTINGS, character: { name: 'Eero' }, session: {}, messages: messages(CHRONICLE_CHUNK_SIZE * 2), chronicle: [] },
        });
        expect(chapters.map(c => c.title)).toEqual(['The Long Winter — Part 1', 'The Long Winter — Part 2']);
    });

    it('a single passage past the chapter ceiling is clipped with a visible warning', async () => {
        sendMessage.mockImplementation(() => Promise.resolve('y'.repeat(CHRONICLE_CHAPTER_TEXT_MAX + 500)));
        const { chapters, warning, clipped } = await writeChronicleChapters({
            state: { settings: SETTINGS, character: { name: 'Eero' }, session: {}, messages: messages(8), chronicle: [] },
        });
        expect(clipped).toBe(true);
        expect(warning).toMatch(/clipped/);
        expect(chapters[0].text).toHaveLength(CHRONICLE_CHAPTER_TEXT_MAX);
    });
});

describe('campaign identity on async writes (P1)', () => {
    const campaignA = { ...initialGameState, session: { ...initialGameState.session, id: 'campaign-a', loadNonce: 1 }, messages: messages(12) };
    const campaignB = { ...initialGameState, session: { ...initialGameState.session, id: 'campaign-b', loadNonce: 2 }, messages: messages(8) };
    const chapter = { title: 'Ashes', text: 'Campaign A prose.', fromIndex: 0, toIndex: 11 };

    it('a chapter close stamped for campaign A never lands on campaign B — a visible error line instead', () => {
        const meta = campaignStamp(campaignA);
        const next = gameReducer(campaignB, { type: 'ADD_CHRONICLE_CHAPTER', payload: chapter, meta });
        expect(next.chronicle ?? []).toHaveLength(0);
        expect(next.messages.at(-1)).toMatchObject({ role: 'system', kind: 'error' });
        expect(next.messages.at(-1).content).toMatch(/different campaign/);
    });

    it('a same-campaign RELOAD (same id, new nonce) also drops the stale close', () => {
        const meta = campaignStamp(campaignA);
        const reloaded = { ...campaignA, session: { ...campaignA.session, loadNonce: 2 } };
        const next = gameReducer(reloaded, { type: 'ADD_CHRONICLE_CHAPTER', payload: chapter, meta });
        expect(next.chronicle ?? []).toHaveLength(0);
    });

    it('a matching stamp — or no stamp at all — writes as before', () => {
        const stamped = gameReducer(campaignA, { type: 'ADD_CHRONICLE_CHAPTER', payload: chapter, meta: campaignStamp(campaignA) });
        expect(stamped.chronicle).toHaveLength(1);
        const bare = gameReducer(campaignA, { type: 'ADD_CHRONICLE_CHAPTER', payload: chapter });
        expect(bare.chronicle).toHaveLength(1);
    });

    it('Deepen memory (UPDATE_NPC) and a portrait (SET_NPC_PORTRAIT) get the same guard', () => {
        const withNpc = gameReducer(campaignA, { type: 'UPDATE_NPC', payload: { name: 'Aune Virtapää', disposition: 'wary' } });
        const npcId = withNpc.npcs[0].id;
        const staleMeta = campaignStamp(campaignB);
        const deepened = gameReducer(withNpc, { type: 'UPDATE_NPC', payload: { id: npcId, name: 'Aune Virtapää', lastNotes: 'From another campaign.' }, meta: staleMeta });
        expect(deepened).toBe(withNpc);
        const painted = gameReducer(withNpc, {
            type: 'SET_NPC_PORTRAIT',
            payload: { id: npcId, portraitUrl: 'data:image/jpeg;base64,abc123==', portraitProvider: 'xai' },
            meta: staleMeta,
        });
        expect(painted).toBe(withNpc);
        const fresh = gameReducer(withNpc, {
            type: 'SET_NPC_PORTRAIT',
            payload: { id: npcId, portraitUrl: 'data:image/jpeg;base64,abc123==', portraitProvider: 'xai' },
            meta: campaignStamp(withNpc),
        });
        expect(fresh.npcs[0].portraitUrl).toBe('data:image/jpeg;base64,abc123==');
    });
});
