import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildSpellSlots } from '../engine/spellcasting.js';

// 2026-11-04 spellcasting P2: the roster-NPC heal fallback had no dedupe and
// no target cap — Cure Wounds (ONE recipient) on five names healed five.

const SCORES = { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 };
const clericState = () => ({
    ...initialGameState,
    character: {
        name: 'Brenna', race: 'dwarf', class: 'cleric', level: 5,
        currentHP: 30, maxHP: 30, armorClass: 17,
        abilityScores: SCORES, conditions: [],
        hitDice: { total: 5, remaining: 5, die: 8 },
        spellSlots: buildSpellSlots(5), sustainedSpell: null,
    },
    party: [],
    npcs: [
        { id: 'npc-ottilie', name: 'Sister Ottilie', rosterTier: 'character', kind: 'character' },
        { id: 'npc-tam', name: 'Brother Tam', rosterTier: 'character', kind: 'character' },
        { id: 'npc-hesk', name: 'Hesk', rosterTier: 'character', kind: 'character' },
        { id: 'npc-mira', name: 'Mira', rosterTier: 'character', kind: 'character' },
    ],
    messages: [],
});
const healedLines = (state) => state.messages.filter(m => /is healed/.test(m.content || '')).map(m => m.content).join('\n');

describe('the roster heal lane honors one record, one recipient, and the spell cap', () => {
    it('Cure Wounds on two roster names heals one and says the rest are unaffected', () => {
        const next = gameReducer(clericState(), { type: 'CAST_SPELL', payload: { spell: 'Cure Wounds', targets: ['Ottilie', 'Sister Ottilie', 'Brother Tam', 'Hesk', 'Mira'], _meta: { sourceId: 'msg-1' } } });
        expect(next.character.spellSlots[1].used).toBe(1);
        const lines = healedLines(next);
        expect(lines.match(/Sister Ottilie/g)).toHaveLength(1);
        expect(lines).not.toMatch(/Brother Tam|Hesk|Mira/);
        expect(next.messages.map(m => m.content).join('\n')).toMatch(/only one recipient; extra targets are unaffected/);
        expect(next.recentSpellCasts.at(-1)).not.toMatch(/sister ottilie\+o:sister ottilie/);
    });

    it('Mass Healing Word heals at most three', () => {
        const next = gameReducer(clericState(), { type: 'CAST_SPELL', payload: { spell: 'Mass Healing Word', targets: ['Sister Ottilie', 'Brother Tam', 'Hesk', 'Mira'], _meta: { sourceId: 'msg-2' } } });
        const lines = healedLines(next);
        expect(['Sister Ottilie', 'Brother Tam', 'Hesk', 'Mira'].filter(name => lines.includes(name))).toHaveLength(3);
        expect(next.messages.map(m => m.content).join('\n')).toMatch(/up to 3 recipients/);
    });
});
