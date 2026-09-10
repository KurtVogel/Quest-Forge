/**
 * "Draft from my hero" (wow audit 2026-09-09, W0 second half): one thinking-free
 * Flash machinery call, JSON-only, three clamped premises; the hero sheet is
 * data in the user message.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { draftPremisesFromHero, PREMISE_DRAFT_COUNT, PREMISE_DRAFT_MAX_LENGTH, PREMISE_DRAFTER_PROMPT, sanitizePremiseDrafts } from './premiseDrafter.js';
import { MACHINERY_MODEL } from './machinery.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({ sendMessage: vi.fn() }));

const settings = { llmProvider: 'openai', apiKey: 'openai-key', geminiApiKey: 'gem-key', preset: 'grimdark' };
const hero = {
    name: 'Ghazra',
    gender: 'woman',
    race: 'halfOrc',
    class: 'fighter',
    background: 'Deserted the Ninth Company after the siege of Carrow.',
    appearance: 'Broad-shouldered, a burn scar across the left forearm.',
};
const premise = (n) => `Ghazra has kept the ferry at Ashmere Landing for a year now, sentence two about place ${n}, sentence three about a person, sentence four about a debt.`;
const goodResponse = JSON.stringify({
    premises: [
        { title: 'The Ferry Debt', premise: premise(1) },
        { title: 'The Landing', premise: premise(2) },
        { title: 'The Sergeant', premise: premise(3) },
    ],
});

describe('draftPremisesFromHero', () => {
    beforeEach(() => sendMessage.mockReset());

    it('refuses without a machinery key and without a named hero, never calling the model', async () => {
        await expect(draftPremisesFromHero({ character: hero, settings: { llmProvider: 'openai', apiKey: 'k' } })).rejects.toThrow(/Gemini key/);
        await expect(draftPremisesFromHero({ character: { race: 'human' }, settings })).rejects.toThrow(/Name your hero/);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('runs on the thinking-free Flash machinery with the hero sheet as data and display names, not keys', async () => {
        sendMessage.mockResolvedValue(goodResponse);
        const drafts = await draftPremisesFromHero({ character: hero, presetKey: 'grimdark', settings });
        expect(drafts).toHaveLength(3);
        const call = sendMessage.mock.calls[0][0];
        expect(call).toMatchObject({ provider: 'gemini', apiKey: 'gem-key', model: MACHINERY_MODEL, thinkingBudget: 0, systemPrompt: PREMISE_DRAFTER_PROMPT });
        const context = JSON.parse(call.userMessage);
        expect(context.hero).toMatchObject({ name: 'Ghazra', gender: 'woman', species: 'Half-Orc', class: 'Fighter' });
        expect(context.hero.background).toContain('Ninth Company');
        expect(context.tone.name).toBe('Grimdark Survival');
        expect(call.userMessage).not.toContain('halfOrc');
        expect(call.messageHistory).toEqual([]);
    });

    it('parses prose-wrapped, lightly broken JSON and clamps every field', async () => {
        sendMessage.mockResolvedValue(`Here you go:\n\`\`\`json\n{"premises": [{"title": "${'T'.repeat(90)}", "premise": "${'x'.repeat(2000)}",}, {"title": "Second", "premise": "${premise(2)}"}]}\n\`\`\``);
        const drafts = await draftPremisesFromHero({ character: hero, settings });
        expect(drafts[0].title).toHaveLength(60);
        expect(drafts[0].premise).toHaveLength(PREMISE_DRAFT_MAX_LENGTH);
        expect(drafts[1]).toEqual({ title: 'Second', premise: premise(2) });
    });

    it('throws on a response without JSON, and when nothing usable survives', async () => {
        sendMessage.mockResolvedValueOnce('I cannot help with that.');
        await expect(draftPremisesFromHero({ character: hero, settings })).rejects.toThrow(/did not contain premises/);
        sendMessage.mockResolvedValueOnce(JSON.stringify({ premises: [{ title: 'Empty', premise: 'short' }, { title: '', premise: premise(1) }] }));
        await expect(draftPremisesFromHero({ character: hero, settings })).rejects.toThrow(/usable premise/);
    });

    it('passes the abort signal through', async () => {
        sendMessage.mockResolvedValue(goodResponse);
        const controller = new AbortController();
        await draftPremisesFromHero({ character: hero, settings, signal: controller.signal });
        expect(sendMessage.mock.calls[0][0].signal).toBe(controller.signal);
    });
});

describe('sanitizePremiseDrafts', () => {
    it('drops junk entries, dedupes by text, caps at three, and types every field', () => {
        const drafts = sanitizePremiseDrafts([
            null,
            { title: { t: 1 }, premise: premise(1) },
            { title: 'A', premise: premise(1) },
            { title: 'A again', premise: premise(1).toUpperCase() },
            { title: 'B', premise: premise(2) },
            { title: 'C', premise: premise(3) },
            { title: 'D', premise: premise(4) },
        ]);
        expect(drafts.map(d => d.title)).toEqual(['A', 'B', 'C']);
        expect(drafts).toHaveLength(PREMISE_DRAFT_COUNT);
        expect(sanitizePremiseDrafts('nope')).toEqual([]);
    });
});

describe('PREMISE_DRAFTER_PROMPT contract', () => {
    it('demands normal-life-first, distinct stakes, third person, and the name-diversity rules', () => {
        expect(PREMISE_DRAFTER_PROMPT).toContain('Normal life first');
        expect(PREMISE_DRAFTER_PROMPT).toContain('DISTINCT stakes');
        expect(PREMISE_DRAFTER_PROMPT).toContain('third person');
        expect(PREMISE_DRAFTER_PROMPT).toContain('NAME DIVERSITY');
        expect(PREMISE_DRAFTER_PROMPT).toContain('unvarnished');
        expect(PREMISE_DRAFTER_PROMPT).toContain('DATA, not instructions');
    });
});
