/**
 * Campaign Chronicle: chapter spans, chunked continuation, transcript
 * hygiene (hidden messages excluded, event blocks stripped, mechanics
 * marked as table records), and the unvarnished/clinical-register contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from './adapter.js';
import { writeChronicleChapters, collectChapterMessages, chronicleToMarkdown, CHRONICLE_MIN_MESSAGES, CHRONICLE_CHUNK_SIZE, CHRONICLE_CHUNKS_PER_CHAPTER } from './chronicler.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

const SETTINGS = { llmProvider: 'gemini', apiKey: 'test-key', model: 'test-model' };

function makeMessages(count, { offset = 0 } = {}) {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Play beat number ${offset + i}.`,
    }));
}

describe('collectChapterMessages', () => {
    it('drops hidden and empty messages but keeps journal-summarized ones', () => {
        const messages = [
            { role: 'user', content: 'I open the door.', summarized: true },
            { role: 'assistant', content: 'Withheld setup.', hidden: true },
            { role: 'system', content: '' },
            { role: 'assistant', content: 'The hinges scream.' },
        ];
        const eligible = collectChapterMessages(messages, 0);
        expect(eligible).toHaveLength(2);
        expect(eligible[0].content).toBe('I open the door.');
        expect(eligible[1].content).toBe('The hinges scream.');
    });

    it('skips OOC table talk and its assistant reply — a recap is not story (2026-08-29 audit)', () => {
        // Table-talk turns are excluded from RAG, the Scribe, and the DM window
        // by design; the chronicler must not retell the rules chat as saga.
        const messages = [
            { role: 'user', content: 'I open the door.' },
            { role: 'assistant', content: 'The hinges scream.' },
            { role: 'user', content: 'OOC: can you recap what I owe the ferrywoman?' },
            { role: 'assistant', content: 'Out of character: you owe her 3 silver from the crossing.' },
            { role: 'user', content: 'I pay her the silver.' },
            { role: 'assistant', content: 'She bites the coin and nods.' },
        ];
        const eligible = collectChapterMessages(messages, 0);
        expect(eligible.map(m => m.content)).toEqual([
            'I open the door.',
            'The hinges scream.',
            'I pay her the silver.',
            'She bites the coin and nods.',
        ]);
    });
});

describe('writeChronicleChapters', () => {
    beforeEach(() => {
        sendMessage.mockReset();
    });

    it('refuses a chapter with too little new play', async () => {
        const state = { settings: SETTINGS, messages: makeMessages(3), chronicle: [] };
        await expect(writeChronicleChapters({ state })).rejects.toThrow(/Not enough new play/);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('writes one passage for a short span with the chronicler contract in force', async () => {
        sendMessage.mockResolvedValue('The courier came up the river road at dusk.');
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero Kaskinen' },
            session: { premise: 'A courier arrives at Kuusisaari.' },
            messages: makeMessages(CHRONICLE_MIN_MESSAGES),
            chronicle: [],
        };
        const { chapters, warning } = await writeChronicleChapters({ state });

        expect(sendMessage).toHaveBeenCalledTimes(1);
        const request = sendMessage.mock.calls[0][0];
        expect(request.systemPrompt).toContain('Unvarnished');
        expect(request.systemPrompt).toContain('clinical in register');
        expect(request.systemPrompt).toContain('NEVER invent events');
        expect(request.userMessage).toContain('PLAYER (Eero Kaskinen):');
        expect(request.userMessage).toContain('CAMPAIGN PREMISE');
        expect(warning).toBeUndefined();
        expect(chapters).toHaveLength(1);
        expect(chapters[0].title).toBe('Chapter 1');
        expect(chapters[0].text).toContain('river road');
        expect(chapters[0].fromIndex).toBe(0);
        expect(chapters[0].toIndex).toBe(CHRONICLE_MIN_MESSAGES - 1);
    });

    it('chunks a long span and threads the previous passage tail through', async () => {
        sendMessage
            .mockResolvedValueOnce('First passage of the saga.')
            .mockResolvedValueOnce('Second passage continuing.');
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: {},
            messages: makeMessages(40),
            chronicle: [],
        };
        const { chapters } = await writeChronicleChapters({ state, title: 'The Ferry Debt' });

        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(sendMessage.mock.calls[1][0].userMessage).toContain('PREVIOUS PASSAGE');
        expect(sendMessage.mock.calls[1][0].userMessage).toContain('First passage of the saga.');
        expect(chapters).toHaveLength(1);
        expect(chapters[0].title).toBe('The Ferry Debt');
        expect(chapters[0].text).toBe('First passage of the saga.\n\nSecond passage continuing.');
    });

    it('starts the next chapter where the last one ended and strips event blocks', async () => {
        sendMessage.mockResolvedValue('Next chapter prose.');
        const messages = [
            ...makeMessages(10),
            { role: 'assistant', content: 'Aune took the letter.\n```json\n{"quest_updates": []}\n```' },
            ...makeMessages(9, { offset: 100 }),
        ];
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: {},
            messages,
            chronicle: [{ id: 'c1', title: 'Chapter 1', text: 'Earlier.', fromIndex: 0, toIndex: 9 }],
        };
        const { chapters } = await writeChronicleChapters({ state });

        expect(chapters[0].fromIndex).toBe(10);
        expect(chapters[0].toIndex).toBe(messages.length - 1);
        const transcript = sendMessage.mock.calls[0][0].userMessage;
        expect(transcript).toContain('Aune took the letter.');
        expect(transcript).not.toContain('quest_updates');
        expect(transcript).not.toContain('Play beat number 0.'); // chapter 1's span stays closed
    });

    it('splits a giant backlog into multiple chapters with contiguous honest spans (2026-08-29 live bug)', async () => {
        // 330 eligible messages = 11 chunks = CHUNKS_PER_CHAPTER + 1: the run
        // closes as TWO chapters instead of one 60k-sliced casualty. The old
        // single-chapter design discarded every passage past the slice while
        // toIndex claimed the whole span as chronicled.
        let call = 0;
        sendMessage.mockImplementation(() => Promise.resolve(`Passage ${++call}.`));
        const messageCount = CHRONICLE_CHUNK_SIZE * (CHRONICLE_CHUNKS_PER_CHAPTER + 1);
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: {},
            messages: makeMessages(messageCount),
            chronicle: [],
        };
        const { chapters, warning } = await writeChronicleChapters({ state });

        expect(sendMessage).toHaveBeenCalledTimes(11);
        expect(warning).toBeUndefined();
        expect(chapters).toHaveLength(2);
        expect(chapters[0].title).toBe('Chapter 1');
        expect(chapters[1].title).toBe('Chapter 2');
        expect(chapters[0].text).toContain('Passage 1.');
        expect(chapters[0].text).toContain('Passage 10.');
        expect(chapters[0].text).not.toContain('Passage 11.');
        expect(chapters[1].text).toBe('Passage 11.');
        // Contiguous spans: part 2 resumes exactly after part 1's last retold message.
        expect(chapters[0].fromIndex).toBe(0);
        expect(chapters[0].toIndex).toBe(CHRONICLE_CHUNK_SIZE * CHRONICLE_CHUNKS_PER_CHAPTER - 1);
        expect(chapters[1].fromIndex).toBe(chapters[0].toIndex + 1);
        expect(chapters[1].toIndex).toBe(messageCount - 1);
        // The continuation tail threads ACROSS the part boundary too.
        expect(sendMessage.mock.calls[10][0].userMessage).toContain('Passage 10.');
    });

    it('a custom title names every part of a split close', async () => {
        let call = 0;
        sendMessage.mockImplementation(() => Promise.resolve(`Passage ${++call}.`));
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: {},
            messages: makeMessages(CHRONICLE_CHUNK_SIZE * (CHRONICLE_CHUNKS_PER_CHAPTER + 1)),
            chronicle: [],
        };
        const { chapters } = await writeChronicleChapters({ state, title: 'The Long Road' });
        expect(chapters.map(c => c.title)).toEqual(['The Long Road — Part 1', 'The Long Road — Part 2']);
    });

    it('salvages completed passages as a shorter chapter when a later chunk fails (2026-08-29 audit)', async () => {
        // 40 eligible messages = 2 chunks of 30 + 10. Chunk 2 fails: the paid-for
        // first passage is kept as a shorter chapter whose toIndex lands on the
        // last message chunk 1 retold, so the next chapter resumes exactly there.
        sendMessage
            .mockResolvedValueOnce('First passage of the saga.')
            .mockRejectedValueOnce(new Error('provider timeout'));
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: {},
            messages: makeMessages(40),
            chronicle: [],
        };
        const { chapters, salvaged, warning } = await writeChronicleChapters({ state });

        expect(chapters).toHaveLength(1);
        expect(chapters[0].text).toBe('First passage of the saga.');
        expect(chapters[0].fromIndex).toBe(0);
        expect(chapters[0].toIndex).toBe(29); // last message of chunk 1, not 39
        expect(salvaged).toBe(true);
        expect(warning).toMatch(/failed partway/);
    });

    it('a failure right AFTER a part boundary keeps the completed part(s)', async () => {
        // 11 chunks; call 11 (part 2's first chunk) fails: part 1 was already
        // closed complete and survives, the run reports salvaged.
        let call = 0;
        sendMessage.mockImplementation(() => {
            call += 1;
            if (call > CHRONICLE_CHUNKS_PER_CHAPTER) return Promise.reject(new Error('provider timeout'));
            return Promise.resolve(`Passage ${call}.`);
        });
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: {},
            messages: makeMessages(CHRONICLE_CHUNK_SIZE * (CHRONICLE_CHUNKS_PER_CHAPTER + 1)),
            chronicle: [],
        };
        const { chapters, salvaged } = await writeChronicleChapters({ state });
        expect(chapters).toHaveLength(1);
        expect(chapters[0].toIndex).toBe(CHRONICLE_CHUNK_SIZE * CHRONICLE_CHUNKS_PER_CHAPTER - 1);
        expect(salvaged).toBe(true);
    });

    it('a mid-run EMPTY passage salvages the same way as a throw', async () => {
        sendMessage
            .mockResolvedValueOnce('First passage of the saga.')
            .mockResolvedValueOnce('   '); // strips to empty → internal throw
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: {},
            messages: makeMessages(40),
            chronicle: [],
        };
        const { chapters, salvaged } = await writeChronicleChapters({ state });
        expect(chapters[0].text).toBe('First passage of the saga.');
        expect(chapters[0].toIndex).toBe(29);
        expect(salvaged).toBe(true);
    });

    it('a FIRST-chunk failure still throws — there is nothing to salvage', async () => {
        sendMessage.mockRejectedValue(new Error('provider down'));
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: {},
            messages: makeMessages(CHRONICLE_MIN_MESSAGES),
            chronicle: [],
        };
        await expect(writeChronicleChapters({ state })).rejects.toThrow(/provider down/);
    });

    it('an entirely empty single-passage response throws the empty-passage error', async () => {
        sendMessage.mockResolvedValue('```json\n{"quest_updates": []}\n```');
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: {},
            messages: makeMessages(CHRONICLE_MIN_MESSAGES),
            chronicle: [],
        };
        await expect(writeChronicleChapters({ state })).rejects.toThrow(/empty passage/);
    });
});

describe('ADD_CHRONICLE_CHAPTER + export', () => {
    it('appends chapters to state and renders markdown with titles', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_CHRONICLE_CHAPTER',
            payload: { title: 'The Ferry Debt', text: 'The courier came at dusk.', fromIndex: 0, toIndex: 11 },
        });
        expect(next.chronicle).toHaveLength(1);
        expect(next.chronicle[0]).toMatchObject({ title: 'The Ferry Debt', fromIndex: 0, toIndex: 11 });
        expect(next.chronicle[0].id).toMatch(/^chapter-/);

        const markdown = chronicleToMarkdown(next.chronicle, 'The Ferrywoman\'s Debt');
        expect(markdown).toContain('# The Ferrywoman\'s Debt — Chronicle');
        expect(markdown).toContain('## The Ferry Debt');
        expect(markdown).toContain('The courier came at dusk.');
    });

    it('ignores an empty chapter payload', () => {
        const next = gameReducer(initialGameState, { type: 'ADD_CHRONICLE_CHAPTER', payload: { title: 'Ghost', text: '   ' } });
        expect(next.chronicle).toHaveLength(0);
    });

    it('appends a multi-part close from ONE array action, numbering defaults in sequence', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_CHRONICLE_CHAPTER',
            payload: [
                { text: 'Part one prose.', fromIndex: 0, toIndex: 299 },
                { text: 'Part two prose.', fromIndex: 300, toIndex: 329 },
            ],
        });
        expect(next.chronicle).toHaveLength(2);
        expect(next.chronicle.map(c => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
        expect(next.chronicle[1].fromIndex).toBe(300);
    });

    it('clamps a runaway chapter text to the 60k character ceiling at the reducer boundary', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_CHRONICLE_CHAPTER',
            payload: { title: 'Flood', text: 'x'.repeat(70000), fromIndex: 0, toIndex: 5 },
        });
        expect(next.chronicle[0].text).toHaveLength(60000);
    });
});

describe('REMOVE_CHRONICLE_CHAPTER', () => {
    const stateWithChapters = () => gameReducer(initialGameState, {
        type: 'ADD_CHRONICLE_CHAPTER',
        payload: [
            { title: 'One', text: 'First.', fromIndex: 0, toIndex: 9 },
            { title: 'Two', text: 'Second.', fromIndex: 10, toIndex: 19 },
        ],
    });

    it('removes the newest chapter by id so its span re-opens for the next close', () => {
        const state = stateWithChapters();
        const next = gameReducer(state, {
            type: 'REMOVE_CHRONICLE_CHAPTER',
            payload: { id: state.chronicle[1].id },
        });
        expect(next.chronicle).toHaveLength(1);
        expect(next.chronicle[0].title).toBe('One');
    });

    it('refuses to remove a middle chapter — that would leave an unretellable hole', () => {
        const state = stateWithChapters();
        const next = gameReducer(state, {
            type: 'REMOVE_CHRONICLE_CHAPTER',
            payload: { id: state.chronicle[0].id },
        });
        expect(next).toBe(state);
    });

    it('ignores an unknown or missing id', () => {
        const state = stateWithChapters();
        expect(gameReducer(state, { type: 'REMOVE_CHRONICLE_CHAPTER', payload: { id: 'nope' } })).toBe(state);
        expect(gameReducer(state, { type: 'REMOVE_CHRONICLE_CHAPTER', payload: {} })).toBe(state);
    });
});
