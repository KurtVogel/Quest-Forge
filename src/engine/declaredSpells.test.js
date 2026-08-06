import { describe, expect, it } from 'vitest';
import { reconcileDeclaredSpells } from './declaredSpells.js';
import { buildSpellSlots } from './spellcasting.js';

/** Level-1 cleric like playtest #4's Brunhild: knows Sacred Flame + Cure Wounds tier. */
function cleric(level = 1) {
    return { name: 'Brunhild', class: 'cleric', level, spellSlots: buildSpellSlots(level) };
}

function castExchange(spell, extraSlots = []) {
    return {
        playerSlots: [
            { id: 'player-slot-1', action: 'cast', spell, target: 'enemy-1', targets: ['enemy-1'], slotLevel: null },
            ...extraSlots,
        ],
        enemyIntents: [],
        companionIntents: [],
    };
}

describe('reconcileDeclaredSpells (playtest #4: silent spell adaptation)', () => {
    it('explains an off-catalog declared spell instead of adapting silently', () => {
        const exchange = castExchange('Sacred Flame');
        const { exchange: out, notes } = reconcileDeclaredSpells(
            'I cast Guiding Bolt at the ghoul-hound.', exchange, cleric());
        expect(out).toBe(exchange); // nothing to rewrite — the adaptation stands
        expect(notes).toEqual([expect.stringContaining('Resolved as Sacred Flame')]);
    });

    it('explains a catalog spell the hero cannot cast yet (Healing Word at cleric 1)', () => {
        const { notes } = reconcileDeclaredSpells(
            'I cast Sacred Flame and speak a Healing Word over my wound.',
            castExchange('Sacred Flame'), cleric());
        expect(notes).toEqual([expect.stringContaining('Healing Word is a level 2 spell')]);
        expect(notes[0]).toContain('cleric level 3');
    });

    it('rewrites the cast slot to the one castable action spell the player named', () => {
        const exchange = castExchange('Sacred Flame');
        const { exchange: out, notes } = reconcileDeclaredSpells(
            'I cast Cure Wounds on myself before it bites again.', exchange, cleric());
        expect(out).not.toBe(exchange);
        expect(out.playerSlots[0]).toMatchObject({ action: 'cast', spell: 'Cure Wounds', slotLevel: null });
        expect(exchange.playerSlots[0].spell).toBe('Sacred Flame'); // input never mutated
        expect(notes).toEqual([expect.stringContaining('Cast adjusted to your declared Cure Wounds')]);
    });

    it('leaves the DM\'s pick alone when it already matches the declared spell', () => {
        const exchange = castExchange('Cure Wounds');
        const { exchange: out, notes } = reconcileDeclaredSpells(
            'I cast Cure Wounds on myself.', exchange, cleric());
        expect(out).toBe(exchange);
        expect(notes).toEqual([]);
    });

    it('leaves an ambiguous declaration (two castable action spells) to the DM', () => {
        const wizard = { name: 'Aiv', class: 'wizard', level: 3, spellSlots: buildSpellSlots(3) };
        const exchange = castExchange('Magic Missile');
        const { exchange: out } = reconcileDeclaredSpells(
            'I cast Magic Missile, or maybe Sleep if they cluster up.', exchange, wizard);
        expect(out).toBe(exchange);
    });

    it('never nags on a non-cast turn even when flavor text names a spell', () => {
        const exchange = {
            playerSlots: [{ id: 'player-slot-1', action: 'attack', target: 'enemy-1' }],
            enemyIntents: [],
            companionIntents: [],
        };
        const { notes } = reconcileDeclaredSpells(
            'No Healing Word can fix this town. I attack.', exchange, cleric());
        expect(notes).toEqual([]);
    });

    it('flags a spell from another class list as uncastable', () => {
        const { notes } = reconcileDeclaredSpells(
            'I cast Fireball!', castExchange('Sacred Flame'), cleric(5));
        expect(notes).toEqual([expect.stringContaining('Fireball is not a spell your class can cast')]);
    });

    it('tolerates junk input without throwing', () => {
        expect(reconcileDeclaredSpells('', null, null)).toMatchObject({ notes: [] });
        expect(reconcileDeclaredSpells('I cast something.', { playerSlots: 'junk' }, cleric()).notes).toEqual([]);
    });
});
