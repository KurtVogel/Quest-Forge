/**
 * Campaign Chronicle: chapter spans, chunked continuation, transcript
 * hygiene (hidden messages excluded, event blocks stripped, mechanics
 * marked as table records), and the unvarnished/clinical-register contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from './adapter.js';
import { writeChronicleChapter, collectChapterMessages, chronicleToMarkdown, CHRONICLE_MIN_MESSAGES } from './chronicler.js';
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
});

describe('writeChronicleChapter', () => {
    beforeEach(() => {
        sendMessage.mockReset();
    });

    it('refuses a chapter with too little new play', async () => {
        const state = { settings: SETTINGS, messages: makeMessages(3), chronicle: [] };
        await expect(writeChronicleChapter({ state })).rejects.toThrow(/Not enough new play/);
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
        const chapter = await writeChronicleChapter({ state });

        expect(sendMessage).toHaveBeenCalledTimes(1);
        const request = sendMessage.mock.calls[0][0];
        expect(request.systemPrompt).toContain('Unvarnished');
        expect(request.systemPrompt).toContain('clinical in register');
        expect(request.systemPrompt).toContain('NEVER invent events');
        expect(request.userMessage).toContain('PLAYER (Eero Kaskinen):');
        expect(request.userMessage).toContain('CAMPAIGN PREMISE');
        expect(chapter.title).toBe('Chapter 1');
        expect(chapter.text).toContain('river road');
        expect(chapter.fromIndex).toBe(0);
        expect(chapter.toIndex).toBe(CHRONICLE_MIN_MESSAGES - 1);
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
        const chapter = await writeChronicleChapter({ state, title: 'The Ferry Debt' });

        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(sendMessage.mock.calls[1][0].userMessage).toContain('PREVIOUS PASSAGE');
        expect(sendMessage.mock.calls[1][0].userMessage).toContain('First passage of the saga.');
        expect(chapter.title).toBe('The Ferry Debt');
        expect(chapter.text).toBe('First passage of the saga.\n\nSecond passage continuing.');
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
        const chapter = await writeChronicleChapter({ state });

        expect(chapter.fromIndex).toBe(10);
        expect(chapter.toIndex).toBe(messages.length - 1);
        const transcript = sendMessage.mock.calls[0][0].userMessage;
        expect(transcript).toContain('Aune took the letter.');
        expect(transcript).not.toContain('quest_updates');
        expect(transcript).not.toContain('Play beat number 0.'); // chapter 1's span stays closed
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
});
