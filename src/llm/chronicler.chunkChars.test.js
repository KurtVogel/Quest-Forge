/**
 * 2026-09-26 chronicler Lap-3 (performance & token budget) queue sweep — a
 * passage's transcript is budgeted in CHARACTERS with the message count as
 * the belt, the length aim scales with the material, and the Journal tab's
 * estimate reads the chronicler's own plan.
 *
 * Measured pre-fix: `CHUNK_SIZE` 30 × `MESSAGE_CLIP` 4,000 put one call's
 * transcript anywhere from 740 chars (30 curt rows) to 122k chars (30 clipped
 * narrations) against ONE fixed "300–700 words" ask.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from './adapter.js';
import {
    writeChronicleChapters, planChroniclePassages, passageWordAim, collectChapterEntries,
    CHRONICLE_CHUNK_CHARS, CHRONICLE_CHUNK_SIZE,
} from './chronicler.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

const SETTINGS = { llmProvider: 'gemini', apiKey: 'test-key', model: 'test-model' };

const fatRow = (i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    // 6,000 chars: past the 4,000 per-message clip, so every rendered row is a clipped narration.
    content: `Beat ${i}. ${'The torch guttered and the corridor breathed cold around them. '.repeat(100)}`,
});
const curtRow = (i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Beat ${i}.` });

const transcriptOf = (userMessage) => userMessage.slice(userMessage.indexOf('TRANSCRIPT OF THIS SPAN:\n') + 'TRANSCRIPT OF THIS SPAN:\n'.length);
const aimOf = (userMessage) => userMessage.match(/LENGTH AIM: (\d+)–(\d+) words/).slice(1, 3).map(Number);

describe('planChroniclePassages — a chunk is at most CHRONICLE_CHUNK_CHARS of transcript', () => {
    it('30 clipped narrations become several chunks, each under the character ceiling, nothing lost or reordered', () => {
        const messages = Array.from({ length: 30 }, (_, i) => fatRow(i));
        const chunks = planChroniclePassages(collectChapterEntries(messages, 0), 'Eero');
        // Pre-fix this was ONE 122k-char chunk.
        expect(chunks.length).toBeGreaterThanOrEqual(6);
        for (const chunk of chunks) {
            expect(chunk.transcript.length).toBeLessThanOrEqual(CHRONICLE_CHUNK_CHARS);
            expect(chunk.chars).toBe(chunk.transcript.length);
            expect(chunk.entries.length).toBeLessThanOrEqual(CHRONICLE_CHUNK_SIZE);
        }
        const indexes = chunks.flatMap(chunk => chunk.entries.map(entry => entry.index));
        expect(indexes).toEqual(Array.from({ length: 30 }, (_, i) => i));
        // The chunks are FULL, not timid: the next row would have overflowed each one.
        for (let i = 0; i < chunks.length - 1; i++) {
            const nextLine = chunks[i + 1].transcript.split('\n\n')[0];
            expect(chunks[i].chars + 2 + nextLine.length).toBeGreaterThan(CHRONICLE_CHUNK_CHARS);
        }
    });

    it('the message count is only the belt: 30 curt rows are one chunk, 31 are two', () => {
        const thirty = planChroniclePassages(collectChapterEntries(Array.from({ length: 30 }, (_, i) => curtRow(i)), 0), 'Eero');
        expect(thirty).toHaveLength(1);
        expect(thirty[0].chars).toBeLessThan(1000);
        const thirtyOne = planChroniclePassages(collectChapterEntries(Array.from({ length: 31 }, (_, i) => curtRow(i)), 0), 'Eero');
        expect(thirtyOne).toHaveLength(2);
        expect(thirtyOne[1].entries).toHaveLength(1);
    });

    it('an empty span plans nothing and never throws', () => {
        expect(planChroniclePassages([], 'Eero')).toEqual([]);
        expect(planChroniclePassages()).toEqual([]);
    });
});

describe('passageWordAim — the ask matches the material', () => {
    it('a full chunk keeps the classic 300–700; a small one asks for less; the floor holds', () => {
        expect(passageWordAim(CHRONICLE_CHUNK_CHARS)).toEqual([300, 700]);
        expect(passageWordAim(5000)).toEqual([83, 179]);
        expect(passageWordAim(740)).toEqual([60, 150]);
        expect(passageWordAim(0)).toEqual([60, 150]);
        expect(passageWordAim('junk')).toEqual([60, 150]);
        expect(passageWordAim(10 ** 9)).toEqual([300, 700]);
    });
});

describe('writeChronicleChapters — every call rides the plan', () => {
    beforeEach(() => {
        sendMessage.mockReset();
    });

    it('never sends a transcript over the ceiling, scales the LENGTH AIM per passage, clips the premise, and makes exactly as many calls as the plan says', async () => {
        const calls = [];
        sendMessage.mockImplementation(async ({ userMessage, systemPrompt }) => {
            calls.push({ userMessage, systemPrompt });
            return `Passage ${calls.length}. `.repeat(40);
        });
        // 21 fat rows + a curt tail row: the last chunk is one clipped row and the tail.
        const messages = [...Array.from({ length: 21 }, (_, i) => fatRow(i)), curtRow(21)];
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: { premise: 'P'.repeat(8000) },
            messages,
            chronicle: [],
        };
        const plan = planChroniclePassages(collectChapterEntries(messages, 0), 'Eero');
        const { chapters } = await writeChronicleChapters({ state });

        expect(calls).toHaveLength(plan.length);
        calls.forEach((call, i) => {
            const transcript = transcriptOf(call.userMessage);
            expect(transcript.length).toBeLessThanOrEqual(CHRONICLE_CHUNK_CHARS);
            expect(transcript).toBe(plan[i].transcript);
            expect(aimOf(call.userMessage)).toEqual(passageWordAim(plan[i].chars));
            // The fixed ask is gone from the system prompt; the rule points at the aim.
            expect(call.systemPrompt).not.toContain('300-700');
            expect(call.systemPrompt).toContain('LENGTH AIM');
            // The premise clip: 1,200 of the 8,000 allowance.
            expect(call.userMessage).toContain(`CAMPAIGN PREMISE (background canon, not events of this span): ${'P'.repeat(1200)}`);
            expect(call.userMessage).not.toContain('P'.repeat(1201));
        });
        // A full chunk (four clipped rows ≈ 16k chars) asks for near the classic
        // band; the curt tail asks for the floor.
        const [fullLow, fullHigh] = aimOf(calls[0].userMessage);
        expect(fullLow).toBeGreaterThanOrEqual(250);
        expect(fullHigh).toBeGreaterThanOrEqual(550);
        const [tailLow, tailHigh] = aimOf(calls[calls.length - 1].userMessage);
        expect(tailLow).toBeLessThan(fullLow / 2);
        expect(tailHigh).toBeLessThan(fullHigh / 2);
        // The whole span is chronicled, honestly.
        expect(chapters).toHaveLength(1);
        expect(chapters[0].fromIndex).toBe(0);
        expect(chapters[0].toIndex).toBe(messages.length - 1);
    });
});
