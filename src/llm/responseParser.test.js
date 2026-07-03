/**
 * Golden-fixture tests for the response parser — each case is a real LLM
 * failure mode this codebase has had to survive: unfenced JSON, malformed
 * JSON, prose roll requests, pre-narrated outcomes, insane numeric values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('./adapter.js', () => ({ sendMessage }));

import { parseResponse, detectPreNarratedOutcome, applyEvents, detectSemanticTextRolls } from './responseParser.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

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

    it('preserves public roll adjudication fields', () => {
        const { events } = parseResponse(fence({
            requested_rolls: [{
                type: 'skill_check', skill: 'persuasion', dc: 12,
                reason: 'A guard actively refuses entry',
                opposition: 'Strict orders',
                failure_stakes: 'The gate closes',
                difficulty_reason: 'Meaningful opposition',
                advantage: true,
                advantage_reason: 'The player has a signed writ',
            }],
        }));
        expect(events.requestedRolls[0]).toMatchObject({
            reason: 'A guard actively refuses entry',
            opposition: 'Strict orders',
            failureStakes: 'The gate closes',
            difficultyReason: 'Meaningful opposition',
            advantageReason: 'The player has a signed writ',
        });
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

    it('coerces string-typed coin/XP amounts instead of silently zeroing them', () => {
        // Real failure mode: the DM emitted "gold_found": "15" and the player's
        // narrated tomb loot vanished with no warning.
        const { events } = parseResponse(fence({
            gold_found: '15',
            silver_found: '3',
            copper_found: '15 cp',
            exp_awarded: '50',
            healing: '4 HP',
        }));
        expect(events.goldFound).toBe(15);
        expect(events.silverFound).toBe(3);
        expect(events.copperFound).toBe(15);
        expect(events.expAwarded).toBe(50);
        expect(events.healing).toBe(4);
    });

    it('still clamps coerced string amounts to sane bounds', () => {
        const { events } = parseResponse(fence({ gold_found: '999999', damage_taken: '-5' }));
        expect(events.goldFound).toBe(10000);
        expect(events.damageTaken).toBe(0);
    });

    it('caps items_found at 20 entries', () => {
        const { events } = parseResponse(fence({ items_found: Array.from({ length: 50 }, (_, i) => `Trinket ${i}`) }));
        expect(events.itemsFound).toHaveLength(20);
    });

    it('adds premise starting belongings once without trusting invented mechanics', () => {
        const { events } = parseResponse(fence({
            starting_items: [
                { name: 'Longsword', damage: '50d100', magicBonus: 3 },
                { name: "Mother's old lute", description: 'Carried from Tanelorn', damage: '20d20', valueCp: 99999 },
                { name: "Mother's old lute", description: 'Duplicate wording' },
            ],
        }));
        let state = {
            ...initialGameState,
            character: {
                name: 'Vesa',
                class: 'fighter',
                level: 1,
                armorClass: 12,
                abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            },
            inventory: [{ id: 'sword-1', itemKey: 'longsword', name: 'Longsword', type: 'weapon', damage: '1d8', equipped: true }],
        };
        const dispatch = action => { state = gameReducer(state, action); };

        expect(events.startingItems[1]).toEqual({ name: "Mother's old lute", description: 'Carried from Tanelorn' });
        applyEvents(events, dispatch, () => state);

        expect(state.inventory.filter(item => item.itemKey === 'longsword')).toHaveLength(1);
        const lutes = state.inventory.filter(item => item.name === "Mother's old lute");
        expect(lutes).toHaveLength(1);
        expect(lutes[0]).toMatchObject({ type: 'gear', description: 'Carried from Tanelorn', attackBonus: 0, damageBonus: 0 });
        expect(lutes[0].damage).toBeUndefined();
        expect(lutes[0].valueCp).toBeUndefined();
    });

    it('canonicalizes and safely equips descriptive catalog loot', () => {
        const { events } = parseResponse(fence({
            items_found: [{
                name: 'massive warhammer',
                type: 'gear',
                damage: '50d100',
                attackBonus: 99,
                valueCp: 1,
            }],
            equipment_changes: [{ action: 'equip', name: 'massive warhammer' }],
        }));
        let state = {
            ...initialGameState,
            character: {
                name: 'Vesa',
                class: 'fighter',
                level: 1,
                armorClass: 18,
                abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            },
            inventory: [{
                id: 'longsword-1', itemKey: 'longsword', name: 'Longsword', type: 'weapon', damage: '1d8', equipped: true,
            }],
        };
        const dispatch = action => { state = gameReducer(state, action); };

        applyEvents(events, dispatch, () => state);

        const warhammer = state.inventory.find(item => item.itemKey === 'warhammer');
        expect(warhammer).toMatchObject({
            name: 'Warhammer', type: 'weapon', damage: '1d8', attackBonus: 0, valueCp: 1500, equipped: true,
        });
        expect(state.inventory.find(item => item.id === 'longsword-1').equipped).toBe(false);
        expect(state.inventory.filter(item => item.equipped && item.type === 'weapon')).toHaveLength(1);
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

    it('uses the standard solo-play DC when a prose roll request omits one', () => {
        const { events } = parseResponse('Make a Perception check to listen at the door.');
        expect(events?.requestedRolls?.[0]).toMatchObject({ type: 'skill_check', skill: 'perception', dc: 10 });
    });

    it('detects a standalone "[Skill] check" phrase without a roll verb', () => {
        // Deliberately no outcome language here — narrating a result ("reveals...",
        // "you notice...") before dice exist is the pre-narrated-outcome failure mode
        // this parser is supposed to catch, not something a clean roll request looks like.
        const { events } = parseResponse('A Perception check is called for as you scan the room.');
        expect(events?.requestedRolls?.[0]).toMatchObject({ type: 'skill_check', skill: 'perception' });
    });

    it('detects a standalone "[Skill] saving throw" phrase as a saving_throw', () => {
        const { events } = parseResponse('A constitution saving throw is called for as the poison spreads.');
        expect(events?.requestedRolls?.[0]).toMatchObject({ type: 'saving_throw', skill: 'constitution' });
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
        expect(enemy.conditions).toEqual([]);
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

    it('keeps only engine-supported enemy conditions at combat start', () => {
        const { events } = parseResponse(fence({
            combat_start: {
                enemies: [{ name: 'Wolf', hp: 12, ac: 13, conditions: ['Prone', 'Made Up'] }],
            },
        }));
        expect(events.combatStart.enemies[0].conditions).toEqual(['prone']);
    });
});

describe('combat_exchange validation', () => {
    it('normalizes bounded enemy-condition synchronization and successful-check effects', () => {
        const { events } = parseResponse(fence({
            combat_exchange: {
                player_slots: [{
                    action: 'check', skill: 'athletics', dc: 14,
                    on_success: { target: 'wolf', add: ['Prone', 'Made Up'] },
                }],
                enemy_intents: [{ enemy_id: 'wolf', action: 'attack', target: 'player', remove_conditions: ['Prone'] }],
                enemy_condition_updates: [{ enemy_id: 'wolf', add: ['Prone'] }],
            },
        }));

        expect(events.combatExchange.playerSlots[0].onSuccess).toEqual({ target: 'wolf', add: ['prone'], remove: [] });
        expect(events.combatExchange.enemyIntents[0].removeConditions).toEqual(['prone']);
        expect(events.combatExchange.enemyConditionUpdates).toEqual([{ target: 'wolf', add: ['prone'], remove: [] }]);
    });

    it('links a combat-starting attack to the canonical enemy id in the same response', () => {
        const { events } = parseResponse(fence({
            combat_start: {
                enemies: [{ name: 'Goblin Duelist', hp: 15, ac: 13, attack_bonus: 4, damage: '1d6+2' }],
            },
            combat_exchange: {
                player_slots: [{ action: 'attack', strikes: [{ target: 'goblin-duelist' }] }],
                enemy_intents: [{ enemy_id: 'goblin-duelist', action: 'attack', target: 'player' }],
            },
        }));
        const enemyId = events.combatStart.enemies[0].id;
        expect(enemyId).toBe('enemy-goblin-duelist');
        expect(events.combatExchange.playerSlots[0].strikes[0].target).toBe(enemyId);
        expect(events.combatExchange.enemyIntents[0].enemyId).toBe(enemyId);
    });

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

describe('parseResponse JSON repair paths', () => {
    it('repairs a fenced JSON block with a trailing comma', () => {
        const raw = '```json\n{ "gold_found": 5, }\n```';
        const { events } = parseResponse(raw);
        expect(events).not.toBeNull();
        expect(events.goldFound).toBe(5);
    });

    it('gives up on an irreparable fenced JSON block and returns null events', () => {
        const raw = 'You find a chest.\n```json\n{ gold_found: 5 }\n```';
        const { narrative, events } = parseResponse(raw);
        expect(events).toBeNull();
        // On total repair failure the raw response (including the broken fence) is
        // returned verbatim rather than just the pre-JSON narrative.
        expect(narrative).toBe(raw);
    });

    it('repairs an unfenced JSON block with a trailing comma', () => {
        const raw = 'The door creaks open.\n{ "requested_rolls": [ { "type": "skill_check", "skill": "perception", "dc": 12 }, ], }';
        const { events } = parseResponse(raw);
        expect(events?.requestedRolls).toHaveLength(1);
    });

    it('falls through to the text-roll detector when unfenced JSON is irreparable', () => {
        const raw = 'Make a Perception check (DC 12) to notice the trap.\n{ requested_rolls: [broken] }';
        const { events } = parseResponse(raw);
        expect(events?.requestedRolls?.[0]).toMatchObject({ type: 'skill_check', skill: 'perception' });
    });

    it('returns empty narrative and null events for an empty response', () => {
        expect(parseResponse('')).toEqual({ narrative: '', events: null });
        expect(parseResponse(null)).toEqual({ narrative: '', events: null });
    });
});

describe('applyEvents dispatch coverage', () => {
    function run(payload, state = { character: {}, party: [] }) {
        const { events } = parseResponse(fence(payload));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => state);
        return dispatch;
    }

    it('dispatches TAKE_DAMAGE and HEAL for plain damage/healing events', () => {
        const dispatch = run({ damage_taken: 5, healing: 3 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'TAKE_DAMAGE', payload: 5 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'HEAL', payload: 3 });
    });

    it('dispatches USE_RESOURCE for a resource the class catalog does not own', () => {
        // Rogue has no UI-tracked class resources, so any resource the DM names
        // falls through to the generic (non-UI) dispatch path.
        const dispatch = run(
            { resources_used: ['sneakAttack'] },
            { character: { class: 'rogue', classResources: {} }, party: [] },
        );
        expect(dispatch).toHaveBeenCalledWith({ type: 'USE_RESOURCE', payload: 'sneakAttack' });
    });

    it('does not dispatch USE_RESOURCE again for an already-exhausted resource', () => {
        const dispatch = run(
            { resources_used: ['sneakAttack'] },
            { character: { class: 'rogue', classResources: { sneakAttack: { used: 1, max: 1 } } }, party: [] },
        );
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'USE_RESOURCE' }));
    });

    it('dispatches purchases and sells and suppresses matching found/lost duplicates', () => {
        const dispatch = run({
            purchase: { itemKey: 'torch' },
            sell: { itemKey: 'dagger' },
            items_found: [{ itemKey: 'torch' }],
            items_lost: [{ name: 'dagger' }],
        });
        expect(dispatch).toHaveBeenCalledWith({ type: 'PURCHASE_ITEM', payload: { itemKey: 'torch' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'SELL_ITEM', payload: { itemKey: 'dagger' } });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_ITEM' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'REMOVE_ITEM_BY_NAME' }));
    });

    it('passes source and player-message metadata to purchase transactions when available', () => {
        const { events } = parseResponse(fence({ purchase: { itemKey: 'dagger' } }));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => ({ character: {}, party: [] }), {
            lootSourceId: 'msg-buy-1',
            playerMessage: 'I buy a dagger.',
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'PURCHASE_ITEM',
            payload: {
                itemKey: 'dagger',
                _meta: {
                    sourceId: 'msg-buy-1',
                    playerMessage: 'I buy a dagger.',
                },
            },
        });
    });

    it('dispatches a found item and a lost item by name', () => {
        const dispatch = run({ items_found: ['Rusty Key'], items_lost: ['Torch'] });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_ITEM', payload: { name: 'Rusty Key' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_ITEM_BY_NAME', payload: 'Torch' });
    });

    it('suppresses a loose coin loss emitted alongside an atomic purchase', () => {
        const dispatch = run({ purchase: { itemKey: 'torch' }, gold_lost: 5 });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'REMOVE_GOLD' }));
    });

    it('suppresses a loose coin gain emitted alongside an atomic sale', () => {
        const dispatch = run({ sell: { itemKey: 'torch' }, gold_found: 5 });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_GOLD' }));
    });

    it('dispatches loose gold/silver/copper found and lost independently of trades', () => {
        const dispatch = run({ gold_found: 3, silver_lost: 2, copper_found: 7 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_GOLD', payload: 3 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_SILVER', payload: 2 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_COPPER', payload: 7 });
    });

    it('skips loot dispatch when the loot source was already claimed', () => {
        const state = { character: {}, party: [], appliedLootSourceIds: ['msg-1'] };
        const { events } = parseResponse(fence({ items_found: ['Gem'], gold_found: 10 }));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => state, { lootSourceId: 'msg-1' });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_ITEM' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_GOLD' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'CLAIM_LOOT_SOURCE' }));
    });

    it('claims a new loot source before granting the loot', () => {
        const { events } = parseResponse(fence({ gold_found: 10 }));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => ({ character: {}, party: [], appliedLootSourceIds: [] }), { lootSourceId: 'msg-2' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'CLAIM_LOOT_SOURCE', payload: 'msg-2' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_GOLD', payload: 10 });
    });

    it('dispatches an explicit LEVEL_UP without also awarding raw exp', () => {
        const dispatch = run({ level_up: true, exp_awarded: 50 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'LEVEL_UP', payload: { bonusExp: 50, reason: 'milestone' } });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_EXP' }));
    });

    it('dispatches ADD_EXP when no explicit level-up is signaled', () => {
        const dispatch = run({ exp_awarded: 25 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_EXP', payload: 25 });
    });

    it('dispatches a rest, conditions, and quest updates', () => {
        const dispatch = run({
            rest_taken: 'short',
            conditions_gained: ['prone'],
            conditions_removed: ['blinded'],
            quest_updates: [
                { status: 'new', name: 'Find the relic', description: 'It was lost long ago.' },
                { status: 'completed', id: 'q1', name: 'Find the relic' },
            ],
        });
        expect(dispatch).toHaveBeenCalledWith({ type: 'TAKE_REST', payload: 'short' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_CONDITION', payload: 'prone' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_CONDITION', payload: 'blinded' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_QUEST', payload: { name: 'Find the relic', description: 'It was lost long ago.' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'COMPLETE_QUEST', payload: { id: 'q1', name: 'Find the relic' } });
    });

    it('dispatches combat start/end, enemy, and companion updates', () => {
        const dispatch = run({
            combat_start: { enemies: [{ name: 'Goblin', hp: 7, maxHp: 7, ac: 12 }] },
            enemy_updates: [{ id: 'e1', hp: 3 }],
            add_companions: [{ name: 'Garrick' }],
            update_companions: [{ name: 'Garrick', hp: 8 }],
            remove_companions: ['Garrick'],
        });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'START_COMBAT' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_ENEMY', payload: { id: 'e1', hp: 3 } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_COMPANION', payload: { name: 'Garrick' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_COMPANION', payload: { name: 'Garrick', hp: 8 } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_COMPANION', payload: { name: 'Garrick' } });
    });

    it('dispatches END_COMBAT with whether the DM already awarded XP', () => {
        const dispatch = run({ combat_end: true, exp_awarded: 40 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'END_COMBAT', payload: { llmAwardedXp: true } });
    });

    it('normalizes string world facts into fact/category objects and dispatches them', () => {
        const dispatch = run({ world_facts: ['The bridge is out.'] });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'The bridge is out.', category: 'general' }],
        });
    });

    it('dispatches npc updates', () => {
        const dispatch = run({ npc_updates: [{ name: 'Captain Voss', disposition: 'hostile' }] });
        expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_NPC', payload: { name: 'Captain Voss', disposition: 'hostile' } });
    });

    it('converts a non-lethal player_death into a narrative continuation for a leveled party character', () => {
        const dispatch = run(
            { player_death: { description: 'The blade finds its mark.' } },
            { character: { level: 5 }, party: [{ id: 'c1' }] },
        );
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'ADD_MESSAGE',
            payload: expect.objectContaining({ role: 'system', isDeathEvent: true }),
        }));
        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_CHARACTER',
            payload: { currentHP: 0, isDead: true, dying: false },
        });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYER_DEFEAT' }));
    });

    it('applyEvents is a no-op when events is null', () => {
        const dispatch = vi.fn();
        applyEvents(null, dispatch, () => ({ character: {}, party: [] }));
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('ignores mutation events during setupPhase except starting combat', () => {
        const { events } = parseResponse(fence({
            combat_start: { enemies: [{ name: 'Goblin', hp: 7, maxHp: 7, ac: 12 }] },
            gold_found: 100,
        }));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => ({ character: {}, party: [] }), { setupPhase: true });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'START_COMBAT' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_GOLD' }));
        expect(dispatch).toHaveBeenCalledTimes(1);
    });
});

describe('detectSemanticTextRolls', () => {
    beforeEach(() => {
        sendMessage.mockReset();
    });

    it('returns null without settings or narrative', async () => {
        expect(await detectSemanticTextRolls('Some text.', null)).toBeNull();
        expect(await detectSemanticTextRolls('', { apiKey: 'k' })).toBeNull();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('extracts detected rolls from a well-formed response', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            requested_rolls: [{ type: 'skill_check', skill: 'perception', dc: 12, description: 'Spot the trap' }],
        }));
        const rolls = await detectSemanticTextRolls('Make a Perception check.', { apiKey: 'k', llmProvider: 'gemini' });
        expect(rolls).toEqual([{ type: 'skill_check', skill: 'perception', dc: 12, description: 'Spot the trap' }]);
    });

    it('returns null when no JSON is extractable', async () => {
        sendMessage.mockResolvedValue('no json here');
        const rolls = await detectSemanticTextRolls('Some narration.', { apiKey: 'k', llmProvider: 'gemini' });
        expect(rolls).toBeNull();
    });

    it('returns null when the extracted JSON fails to parse', async () => {
        sendMessage.mockResolvedValue('{ requested_rolls: [broken] }');
        const rolls = await detectSemanticTextRolls('Some narration.', { apiKey: 'k', llmProvider: 'gemini' });
        expect(rolls).toBeNull();
    });

    it('returns null when requested_rolls is missing or not an array', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ requested_rolls: 'nope' }));
        const rolls = await detectSemanticTextRolls('Some narration.', { apiKey: 'k', llmProvider: 'gemini' });
        expect(rolls).toBeNull();
    });

    it('returns null when the provider call throws', async () => {
        sendMessage.mockRejectedValue(new Error('network down'));
        const rolls = await detectSemanticTextRolls('Some narration.', { apiKey: 'k', llmProvider: 'gemini' });
        expect(rolls).toBeNull();
    });
});
