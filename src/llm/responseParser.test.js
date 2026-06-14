/**
 * Golden-fixture tests for the response parser — each case is a real LLM
 * failure mode this codebase has had to survive: unfenced JSON, malformed
 * JSON, prose roll requests, pre-narrated outcomes, insane numeric values.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseResponse, detectPreNarratedOutcome, applyEvents } from './responseParser.js';

const fence = (obj) => '```json\n' + JSON.stringify(obj, null, 2) + '\n```';

describe('well-formed responses', () => {
    it('splits narrative from a fenced JSON event block', () => {
        const { narrative, events } = parseResponse(
            'The goblin snarls at you.\n\n' + fence({ requested_rolls: [{ type: 'skill_check', skill: 'perception', dc: 12 }] })
        );
        expect(narrative).toBe('The goblin snarls at you.');
        expect(events.requestedRolls).toHaveLength(1);
        expect(events.requestedRolls[0]).toMatchObject({ type: 'skill_check', skill: 'perception', dc: 12 });
    });

    it('returns null events for plain narrative', () => {
        const { narrative, events } = parseResponse('You walk through a quiet forest. Birds sing.');
        expect(narrative).toContain('quiet forest');
        expect(events).toBeNull();
    });

    it('passes saving_throw and death_save roll types through', () => {
        const { events } = parseResponse(fence({
            requested_rolls: [
                { type: 'saving_throw', skill: 'dexterity', dc: 14 },
                { type: 'death_save', description: 'Cling to life' },
            ],
        }));
        expect(events.requestedRolls[0].type).toBe('saving_throw');
        expect(events.requestedRolls[1].type).toBe('death_save');
    });

    it('normalizes purchases: accepts both singular and plural forms', () => {
        const single = parseResponse(fence({ purchase: { itemKey: 'longsword', quantity: 1 } })).events;
        expect(single.purchases).toHaveLength(1);
        const multi = parseResponse(fence({ purchases: [{ itemKey: 'dagger' }, { itemKey: 'rope' }] })).events;
        expect(multi.purchases).toHaveLength(2);
    });

    it('normalizes equipment changes', () => {
        const { events } = parseResponse(fence({
            equipment_changes: [
                { action: 'unequip', type: 'armor', name: 'Chain Mail' },
                { action: 'equip', itemKey: 'longsword' },
                { action: 'polish', name: 'Shield' },
            ],
        }));

        expect(events.equipmentChanges).toEqual([
            { action: 'unequip', itemId: null, itemKey: null, name: 'Chain Mail', type: 'armor' },
            { action: 'equip', itemId: null, itemKey: 'longsword', name: null, type: null },
        ]);
    });
});

describe('defenses against LLM misbehavior', () => {
    it('clamps insane numeric values', () => {
        const { events } = parseResponse(fence({
            damage_taken: 99999,
            exp_awarded: 999999,
            gold_found: 123456,
            healing: -50,
        }));
        expect(events.damageTaken).toBe(999);
        expect(events.expAwarded).toBe(10000);
        expect(events.goldFound).toBe(10000);
        expect(events.healing).toBe(0); // negative clamps to floor
    });

    it('treats non-numeric values as zero', () => {
        const { events } = parseResponse(fence({ damage_taken: 'a lot', exp_awarded: null }));
        expect(events.damageTaken).toBe(0);
        expect(events.expAwarded).toBe(0);
    });

    it('caps items_found at 20 entries', () => {
        const { events } = parseResponse(fence({ items_found: Array.from({ length: 50 }, (_, i) => `Trinket ${i}`) }));
        expect(events.itemsFound).toHaveLength(20);
    });

    it('parses unfenced JSON containing requested_rolls', () => {
        const raw = 'The lock looks tricky.\n{ "requested_rolls": [ { "type": "skill_check", "skill": "sleightOfHand", "dc": 15 } ] }';
        const { narrative, events } = parseResponse(raw);
        expect(events?.requestedRolls).toHaveLength(1);
        expect(narrative).not.toContain('requested_rolls');
    });

    it('detects prose roll requests the DM wrote as text', () => {
        const { events } = parseResponse('The shadows shift around you. Make a Perception check (DC 12) to spot the danger.');
        expect(events?.requestedRolls?.length).toBeGreaterThan(0);
        expect(events.requestedRolls[0]).toMatchObject({ type: 'skill_check', skill: 'perception', dc: 12 });
    });

    it('detects prose saving throw requests as saving_throw', () => {
        const { events } = parseResponse('Poison gas fills the corridor! Make a constitution saving throw (DC 13).');
        expect(events?.requestedRolls?.[0]).toMatchObject({ type: 'saving_throw', skill: 'constitution', dc: 13 });
    });
});

describe('combat_start validation', () => {
    it('fills in defaults for incomplete enemies', () => {
        const { events } = parseResponse(fence({
            combat_start: { enemies: [{ name: 'Goblin' }], player_initiative: 12 },
        }));
        const enemy = events.combatStart.enemies[0];
        expect(enemy.name).toBe('Goblin');
        expect(enemy.hp).toBeGreaterThan(0);
        expect(enemy.ac).toBeGreaterThan(0);
        expect(enemy.initiative).toBeGreaterThanOrEqual(1);
        expect(enemy.initiative).toBeLessThanOrEqual(20);
    });

    it('rejects combat_start with no valid enemies', () => {
        const { events } = parseResponse(fence({ combat_start: { enemies: [{ hp: 10 }, { name: '   ' }] } }));
        expect(events.combatStart).toBeNull();
    });

    it('rejects empty or missing combat_start', () => {
        expect(parseResponse(fence({ combat_start: { enemies: [] } })).events.combatStart).toBeNull();
        expect(parseResponse(fence({ damage_taken: 1 })).events.combatStart).toBeNull();
    });
});

describe('detectPreNarratedOutcome', () => {
    it('flags outcome language', () => {
        expect(detectPreNarratedOutcome('You hit the goblin and it falls dead.')).toBe(true);
        expect(detectPreNarratedOutcome('Your blade strikes true!')).toBe(true);
    });

    it('does not flag neutral narration', () => {
        expect(detectPreNarratedOutcome('The goblin eyes you warily, blade half-raised.')).toBe(false);
    });
});

describe('applyEvents low-level safety', () => {
    it('converts direct player_death into PLAYER_DEFEAT for a level-1 solo character', () => {
        const { events } = parseResponse(fence({
            player_death: { description: 'The captain orders the execution.' },
        }));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => ({
            character: { level: 1 },
            party: [],
        }));

        expect(dispatch).toHaveBeenCalledWith({
            type: 'PLAYER_DEFEAT',
            payload: { description: 'The captain orders the execution.' },
        });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_CHARACTER' }));
    });
});

describe('applyEvents equipment changes', () => {
    it('dispatches equip and unequip item refs', () => {
        const { events } = parseResponse(fence({
            equipment_changes: [
                { action: 'unequip', type: 'armor' },
                { action: 'equip', name: 'Longsword' },
            ],
        }));
        const dispatch = vi.fn();

        applyEvents(events, dispatch, () => ({ character: {}, party: [] }));

        expect(dispatch).toHaveBeenCalledWith({
            type: 'UNEQUIP_ITEM_BY_REF',
            payload: { action: 'unequip', itemId: null, itemKey: null, name: null, type: 'armor' },
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'EQUIP_ITEM_BY_REF',
            payload: { action: 'equip', itemId: null, itemKey: null, name: 'Longsword', type: null },
        });
    });
});
