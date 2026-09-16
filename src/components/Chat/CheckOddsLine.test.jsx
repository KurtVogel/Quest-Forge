/**
 * The odds line on the roleplay-check card (WOW 2026-09-16): rendered through
 * react-dom/server so the pin needs no DOM — the line is the engine's numbers
 * shown before the Roll / Challenge / Change approach decision.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CheckOddsLine from './CheckOddsLine.jsx';
import { formatCheckOddsLine } from './checkOdds.js';

function makeCharacter(overrides = {}) {
    return {
        name: 'Testo',
        class: 'rogue',
        level: 5,
        abilityScores: { strength: 10, dexterity: 18, constitution: 12, intelligence: 10, wisdom: 14, charisma: 8 },
        skillProficiencies: ['stealth', 'perception'],
        expertiseSkills: [],
        savingThrowProficiencies: ['dexterity', 'intelligence'],
        conditions: [],
        ...overrides,
    };
}

describe('formatCheckOddsLine', () => {
    it('renders skill, modifier, source, DC, and the flat chance', () => {
        const line = formatCheckOddsLine(makeCharacter(), [], { type: 'skill_check', skill: 'stealth', dc: 12 });
        // +4 DEX + 3 prof = +7; faces 5..20 succeed = 16/20.
        expect(line).toBe('Stealth +7 (proficient) · DC 12 · 80%');
    });

    it('appends the advantage chance when the ruling grants advantage', () => {
        const line = formatCheckOddsLine(makeCharacter(), [], { type: 'skill_check', skill: 'stealth', dc: 12, advantage: true });
        expect(line).toBe('Stealth +7 (proficient) · DC 12 · 80% — advantage: 96%');
    });

    it('appends the disadvantage chance, including one imposed by a condition', () => {
        const ruled = formatCheckOddsLine(makeCharacter(), [], { type: 'skill_check', skill: 'stealth', dc: 12, disadvantage: true });
        expect(ruled).toBe('Stealth +7 (proficient) · DC 12 · 80% — disadvantage: 64%');
        const frightened = formatCheckOddsLine(makeCharacter({ conditions: ['frightened'] }), [], { type: 'skill_check', skill: 'stealth', dc: 12 });
        expect(frightened).toBe('Stealth +7 (proficient) · DC 12 · 80% — disadvantage: 64%');
    });

    it('labels a saving throw by ability and a bare ability check by its short name', () => {
        expect(formatCheckOddsLine(makeCharacter(), [], { type: 'saving_throw', skill: 'wisdom', dc: 13 }))
            .toBe('WIS save +2 (WIS) · DC 13 · 50%');
        expect(formatCheckOddsLine(makeCharacter(), [], { type: 'saving_throw', skill: 'dexterity', dc: 13 }))
            .toBe('DEX save +7 (proficient) · DC 13 · 75%');
        expect(formatCheckOddsLine(makeCharacter(), [], { type: 'skill_check', skill: 'strength', dc: 10 }))
            .toBe('STR check +0 (STR) · DC 10 · 55%');
    });

    it('an unproficient skill names its ability; an unknown skill is +0 untrained', () => {
        expect(formatCheckOddsLine(makeCharacter(), [], { type: 'skill_check', skill: 'athletics', dc: 10 }))
            .toBe('Athletics +0 (STR) · DC 10 · 55%');
        expect(formatCheckOddsLine(makeCharacter(), [], { type: 'skill_check', skill: 'basket weaving', dc: 10 }))
            .toBe('Basket weaving +0 (untrained) · DC 10 · 55%');
    });

    it('says when a condition and the ruling cancelled out', () => {
        const line = formatCheckOddsLine(makeCharacter({ conditions: ['Frightened'] }), [], { type: 'skill_check', skill: 'stealth', dc: 12, advantage: true });
        expect(line).toBe('Stealth +7 (proficient) · DC 12 · 80% — frightened cancelled out');
    });

    it('is empty for a roll the odds helper declines', () => {
        expect(formatCheckOddsLine(makeCharacter(), [], { type: 'skill_check', skill: 'initiative', dc: 10 })).toBe('');
        expect(formatCheckOddsLine(null, [], { skill: 'stealth' })).toBe('');
    });
});

describe('<CheckOddsLine />', () => {
    it('renders the line in its own element on the card', () => {
        const html = renderToStaticMarkup(
            <CheckOddsLine character={makeCharacter()} inventory={[]} roll={{ type: 'skill_check', skill: 'stealth', dc: 12, advantage: true }} />
        );
        expect(html).toContain('class="roleplay-check-odds"');
        expect(html).toContain('Stealth +7 (proficient) · DC 12 · 80% — advantage: 96%');
    });

    it('renders nothing for a declined roll', () => {
        const html = renderToStaticMarkup(
            <CheckOddsLine character={makeCharacter()} inventory={[]} roll={{ type: 'skill_check', skill: 'initiative', dc: 10 }} />
        );
        expect(html).toBe('');
    });
});
