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

    it('rejects out-of-range enemy stats to defaults and clamps HP/AC at the boundary', () => {
        const { events } = parseResponse(fence({
            combat_start: {
                enemies: [
                    { name: 'Brute', hp: 9999, ac: 999, attack_bonus: 99, damage: '50d100+80' },
                    { name: 'Goblin', hp: 7, ac: 12, attack_bonus: 4, damage: '1d6+2' },
                    { name: 'Oddity', hp: 5, ac: 10, attack_bonus: -40, damage: '1d7' },
                ],
            },
        }));
        const [brute, goblin, oddity] = events.combatStart.enemies;
        // Absurd OFFENSIVE stats are REJECTED (not clamped to max) → omitted → engine default later.
        expect(brute.attackBonus).toBeUndefined();
        expect(brute.damage).toBeUndefined();
        // DEFENSIVE stats are clamped into a safe band.
        expect(brute.hp).toBe(999);
        expect(brute.ac).toBe(12);
        // Reasonable values pass through untouched.
        expect(goblin.attackBonus).toBe(4);
        expect(goblin.damage).toBe('1d6+2');
        // Lower out-of-range + non-weapon die size both rejected.
        expect(oddity.attackBonus).toBeUndefined();
        expect(oddity.damage).toBeUndefined();
    });
});

describe('combat_exchange validation', () => {
    it('normalizes bounded player slots and actor intents without accepting dice authority', () => {
        const { events } = parseResponse(fence({
            combat_exchange: {
                player_slots: [{ action: 'attack', strikes: [{ target: 'enemy-1' }], modifier: 99, damage: '50d100' }],
                enemy_intents: [{ enemy_id: 'enemy-1', action: 'defend', modifier: 99 }],
                companion_intents: [{ companion_id: 'ally-1', action: 'attack', target: 'enemy-1' }],
            },
        }));
        expect(events.combatExchange).toEqual({
            playerSlots: [{ id: 'player-slot-1', action: 'attack', description: '', strikes: [{ target: 'enemy-1' }], weaponId: null }],
            enemyIntents: [{ enemyId: 'enemy-1', action: 'defend', target: 'player', description: '' }],
            companionIntents: [{ companionId: 'ally-1', action: 'attack', target: 'enemy-1', description: '' }],
        });
        expect(events.combatExchange.playerSlots[0]).not.toHaveProperty('modifier');
        expect(events.combatExchange.playerSlots[0]).not.toHaveProperty('damage');
    });

    it('marks malformed envelopes as rejected instead of partially resolving them', () => {
        const { events } = parseResponse(fence({
            combat_exchange: { player_slots: [{ action: 'wish' }] },
        }));
        expect(events.combatExchange).toBeNull();
        expect(events.combatExchangeRejected).toBe(true);
    });
});

describe('active combat event authority', () => {
    it('ignores mechanical mutations from a response that committed no combat exchange', () => {
        const events = parseResponse(fence({
            damage_taken: 20,
            healing: 20,
            enemy_updates: [{ id: 'enemy-1', hp: 0 }],
            combat_end: true,
            exp_awarded: 999,
        })).events;
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => ({
            combat: { active: true },
            character: { class: 'fighter', classResources: {} },
            party: [],
        }));
        expect(dispatch).not.toHaveBeenCalled();
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

describe('applyEvents resource contract', () => {
    it('ignores DM-emitted player resource spends and paired healing for UI-owned resources', () => {
        const { events } = parseResponse(fence({
            resources_used: ['secondWind'],
            healing: 8,
        }));
        const dispatch = vi.fn();

        applyEvents(events, dispatch, () => ({
            character: {
                class: 'fighter',
                classResources: { secondWind: { used: 0, max: 1 } },
            },
            party: [],
        }));

        expect(dispatch).not.toHaveBeenCalledWith({ type: 'USE_RESOURCE', payload: 'secondWind' });
        expect(dispatch).not.toHaveBeenCalledWith({ type: 'HEAL', payload: 8 });
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

describe('hidden front events', () => {
    it('parses and dispatches front updates', () => {
        const { events } = parseResponse(fence({
            front_updates: [{
                id: 'front-local-pressure',
                clock: 2,
                publicHints: ['A burned wagon blocks the north road.'],
            }],
        }));
        const dispatch = vi.fn();

        applyEvents(events, dispatch, () => ({ character: {}, party: [] }));

        expect(events.frontUpdates).toHaveLength(1);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_FRONT',
            payload: {
                id: 'front-local-pressure',
                clock: 2,
                publicHints: ['A burned wagon blocks the north road.'],
            },
        });
    });
});

describe('story memory events', () => {
    it('parses and dispatches narrative-only memory updates', () => {
        const { events } = parseResponse(fence({
            memory_updates: [{
                id: 'mem-ribbon',
                used: true,
                status: 'resolved',
                salience: 2,
                damage_taken: 999,
            }],
        }));
        const dispatch = vi.fn();

        applyEvents(events, dispatch, () => ({ character: {}, party: [] }));

        expect(events.memoryUpdates).toEqual([{
            id: 'mem-ribbon',
            status: 'resolved',
            used: true,
            salience: 2,
        }]);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_STORY_MEMORY',
            payload: {
                id: 'mem-ribbon',
                status: 'resolved',
                used: true,
                salience: 2,
            },
        });
        expect(dispatch).not.toHaveBeenCalledWith({ type: 'TAKE_DAMAGE', payload: 999 });
    });
});
