/**
 * The default campaign prompt's lean-description paragraph (2026-11-09) and
 * the heal that moves an UNEDITED old default to it. Vesa: "the vivid sensory
 * thing is over-done often, like I'm stepping into the next room and my
 * nostrils are filled with the smell of tallow, parapets, fluted brass
 * thingamajigs, copper and tallow again".
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CUSTOM_SYSTEM_PROMPT, RETIRED_DEFAULT_CUSTOM_SYSTEM_PROMPTS } from '../data/dmStylePrompt.js';
import { initialGameState } from './initialState.js';
import { healRetiredDefaultPrompt, sanitizeSettings } from './settingsSchema.js';

const OLD = RETIRED_DEFAULT_CUSTOM_SYSTEM_PROMPTS[0];

describe('the default campaign prompt', () => {
    it('keeps description lean and saves vividness for the moments that earn it', () => {
        expect(initialGameState.settings.customSystemPrompt).toBe(DEFAULT_CUSTOM_SYSTEM_PROMPT);
        expect(DEFAULT_CUSTOM_SYSTEM_PROMPT).toContain('Keep description lean: describe a place only when it is new or when it matters, with at most one sensory detail, and never open a turn on a smell.');
        expect(DEFAULT_CUSTOM_SYSTEM_PROMPT).toContain('Save vivid, sensory narration for the moments that earn it');
        expect(DEFAULT_CUSTOM_SYSTEM_PROMPT).not.toContain('Use vivid, sensory narration for violence, fear, injury, intimacy, poverty, power, and consequence.');
        // NPCs push back (Vesa, the same evening: "gives a lot of character and life to it").
        const NPC_LINE = ' They can refuse, lie, bargain, or want something in return.';
        expect(DEFAULT_CUSTOM_SYSTEM_PROMPT).toContain(`Treat NPCs as people with independent motives, desires and agendas.${NPC_LINE}`);
        // Everything else after the first paragraph is the shipped text, unchanged.
        expect(DEFAULT_CUSTOM_SYSTEM_PROMPT.replace(NPC_LINE, '').split('\n\n').slice(1)).toEqual(OLD.split('\n\n').slice(1));
    });

    it('the default shipped for a few hours on 2026-11-09 is retired too and heals', () => {
        expect(RETIRED_DEFAULT_CUSTOM_SYSTEM_PROMPTS).toHaveLength(2);
        const interim = RETIRED_DEFAULT_CUSTOM_SYSTEM_PROMPTS[1];
        expect(interim).toContain('Keep description lean');
        expect(interim).not.toContain('They can refuse');
        expect(healRetiredDefaultPrompt(interim)).toBe(DEFAULT_CUSTOM_SYSTEM_PROMPT.trim());
    });

    it('the retired default is the text shipped until 2026-11-09, verbatim', () => {
        expect(OLD).toContain('Use vivid, sensory narration for violence, fear, injury, intimacy, poverty, power, and consequence.');
    });
});

describe('the settings heal', () => {
    it('an unedited old default — line endings and outer whitespace aside — becomes the current default', () => {
        const current = DEFAULT_CUSTOM_SYSTEM_PROMPT.trim();
        expect(healRetiredDefaultPrompt(OLD)).toBe(current);
        expect(healRetiredDefaultPrompt(`  ${OLD.replace(/\n/g, '\r\n')}\r\n`)).toBe(current);
        expect(sanitizeSettings({ customSystemPrompt: OLD }).customSystemPrompt).toBe(current);
    });

    it('any edit is the player\'s own and is kept as written', () => {
        const edited = OLD.replace('dark humor', 'gallows humor');
        expect(healRetiredDefaultPrompt(edited)).toBe(edited);
        expect(sanitizeSettings({ customSystemPrompt: edited }).customSystemPrompt).toBe(edited.trim());
        expect(sanitizeSettings({ customSystemPrompt: '' }).customSystemPrompt).toBe('');
        expect(sanitizeSettings({ llmProvider: 'gemini' })).not.toHaveProperty('customSystemPrompt');
    });
});
