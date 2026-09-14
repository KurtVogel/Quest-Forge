/**
 * Spell wire parity (2026-09-13 audit P2): a numeric-string slot_level is a
 * real upcast on BOTH lanes, and an object target is dropped, never
 * "[object Object]".
 */
import { describe, expect, it } from 'vitest';
import { normalizeEvents } from './eventChannels.js';
import { normalizeCombatExchange } from '../engine/combatExchange.js';
import { chooseSlotLevel, buildSpellSlots } from '../engine/spellcasting.js';
import { findSpell } from '../data/spells.js';

describe('spell_cast (out of combat)', () => {
    it('"slot_level": "2" upcasts instead of silently downcasting to a level-1 slot', () => {
        const events = normalizeEvents({ spell_cast: { spell: 'Cure Wounds', slot_level: '2', target: 'Terho' } });
        expect(events.spellCasts[0]).toMatchObject({ spell: 'Cure Wounds', slotLevel: 2, target: 'Terho' });
        const junk = normalizeEvents({ spell_cast: { spell: 'Cure Wounds', slot_level: 'two' } });
        expect(junk.spellCasts[0].slotLevel).toBeNull();
    });

    it('an object target is dropped (targets list still fills in)', () => {
        const events = normalizeEvents({ spell_cast: { spell: 'Cure Wounds', target: { evil: true } } });
        expect(events.spellCasts[0].target).toBeNull();
        const withList = normalizeEvents({ spell_cast: { spell: 'Mass Healing Word', target: { evil: true }, targets: ['Terho', 'Aune'] } });
        expect(withList.spellCasts[0].target).toBe('Terho');
    });
});

describe('combat_exchange cast slot', () => {
    it('"slot_level": "3" is honored like the number', () => {
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'magic missile', target: 'Goblin', slot_level: '3' }],
            enemy_intents: [],
        });
        expect(intent.playerSlots[0].slotLevel).toBe(3);
    });
});

describe('chooseSlotLevel belt', () => {
    it('a numeric-string request picks that slot when it is available', () => {
        const slots = buildSpellSlots(5);
        expect(chooseSlotLevel(slots, findSpell('cureWounds'), '2')).toBe(2);
        expect(chooseSlotLevel(slots, findSpell('cureWounds'), 'x')).toBe(1);
    });
});
