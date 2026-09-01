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
        // "(woman)" beside the name — the art director's inviolable-gender tag
        // convention, unified across every portrait prompt 2026-08-26.
        // Display names, never data keys ("Dwarf Cleric", not "dwarf cleric" —
        // the halfOrc key was painted verbatim, 2026-09-01 P2).
        expect(prompt).toContain('Tuuli Rautio (woman), a Dwarf Cleric');
        expect(prompt).toContain('Compact and wiry, pale grey eyes.');
        expect(prompt).toContain('Wearing/carrying: Scale Mail, Mace.');
    });

    it('omits the gender token when none is recorded', () => {
        const prompt = buildPortraitPrompt(
            { name: 'Borin', race: 'dwarf', class: 'fighter' },
            'Stocky and scarred.',
        );
        expect(prompt).toContain('Borin, a Dwarf Fighter');
    });

    it('renders the half-orc data key as its display name (2026-09-01 P2)', () => {
        const prompt = buildPortraitPrompt({ name: 'Ghazra', gender: 'woman', race: 'halfOrc', class: 'fighter' }, 'Tusked, grey-green skin.');
        expect(prompt).toContain('Ghazra (woman), a Half-Orc Fighter');
        expect(prompt).not.toContain('halfOrc');
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

    it('combines registered species and gender into one identity tag', () => {
        const prompt = buildNpcPortraitPrompt({
            name: 'Vex Nailbiter',
            species: 'goblin',
            gender: 'woman',
            appearance: 'Yellow eyes, filed teeth, patchwork leathers.',
        });
        // "(goblin woman)" — without the species the painter defaults to a human figure.
        expect(prompt).toContain('Vex Nailbiter (goblin woman)');
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
