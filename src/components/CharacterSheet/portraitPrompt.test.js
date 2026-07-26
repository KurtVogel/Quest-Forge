/**
 * Portrait prompt templates: the gender signal must ride beside the identity
 * (the inviolable-gender convention, DECISIONS.md 2026-07-25) and the merged
 * appearance record must be the likeness.
 */
import { describe, expect, it } from 'vitest';
import { buildPortraitPrompt, buildNpcPortraitPrompt } from './portraitPrompt.js';

describe('buildPortraitPrompt (hero)', () => {
    it('carries gender, race, class, appearance, and gear', () => {
        const prompt = buildPortraitPrompt(
            { name: 'Tuuli Rautio', gender: 'woman', race: 'dwarf', class: 'cleric' },
            'Compact and wiry, pale grey eyes.',
            ['Scale Mail', 'Mace'],
        );
        expect(prompt).toContain('Tuuli Rautio, a woman dwarf cleric');
        expect(prompt).toContain('Compact and wiry, pale grey eyes.');
        expect(prompt).toContain('Wearing/carrying: Scale Mail, Mace.');
    });

    it('omits the gender token when none is recorded', () => {
        const prompt = buildPortraitPrompt(
            { name: 'Borin', race: 'dwarf', class: 'fighter' },
            'Stocky and scarred.',
        );
        expect(prompt).toContain('Borin, a dwarf fighter');
    });
});

describe('buildNpcPortraitPrompt', () => {
    it('rides the registered gender beside the name and uses the merged looks', () => {
        const prompt = buildNpcPortraitPrompt({
            name: 'Aune Virtapää',
            gender: 'woman',
            appearance: 'Broad-shouldered, grey-streaked dark braid, scar through her left eyebrow.',
            lastNotes: 'Runs the Kuusisaari ferry crossing.',
        });
        expect(prompt).toContain('Aune Virtapää (woman)');
        expect(prompt).toContain('grey-streaked dark braid');
        expect(prompt).toContain('Context: Runs the Kuusisaari ferry crossing.');
    });

    it('never leaks privateNotes into the painter context', () => {
        const prompt = buildNpcPortraitPrompt({
            name: 'Onni Rautakallio',
            gender: 'man',
            appearance: 'Stooped older man.',
            privateNotes: 'Secretly informs on travelers to the river-guild.',
        });
        expect(prompt).not.toContain('river-guild');
        expect(prompt).toContain('Onni Rautakallio (man)');
    });
});
