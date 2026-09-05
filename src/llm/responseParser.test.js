/**
 * Golden-fixture tests for the response parser — each case is a real LLM
 * failure mode this codebase has had to survive: unfenced JSON, malformed
 * JSON, prose roll requests, pre-narrated outcomes, insane numeric values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('./adapter.js', () => ({ sendMessage }));

import { parseResponse, detectPreNarratedOutcome, detectSemanticTextRolls } from './responseParser.js';
import { applyEvents } from '../state/applyEvents.js';
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

    it('drops null/array/number/blank items_found and items_lost elements at the boundary', () => {
        // A null element would crash the traded-item dedup's `.name` read and an
        // array/number would mint a junk "Unknown item" (2026-07-28 audit).
        const { events } = parseResponse(fence({
            items_found: [null, 'Rope', ['nested'], 42, { name: 'Lantern' }, '   '],
            items_lost: [null, 'Torch', 7],
        }));
        expect(events.itemsFound).toEqual(['Rope', { name: 'Lantern' }]);
        expect(events.itemsLost).toEqual(['Torch']);
    });

    it('keeps a clamped premise stack quantity ("two Potions of Healing")', () => {
        const { events } = parseResponse(fence({
            starting_items: [
                { name: 'Potion of Healing', itemKey: 'potionHealing', quantity: 2 },
                { name: 'Trail rations', quantity: 999 },
                { name: 'Walking stick', quantity: 'not-a-number' },
            ],
        }));
        expect(events.startingItems[0]).toMatchObject({ quantity: 2 });
        expect(events.startingItems[1]).toMatchObject({ quantity: 10 }); // clamped
        expect(events.startingItems[2].quantity).toBeUndefined(); // defaults to 1, omitted
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

    it('parses unfenced JSON for non-roll channels instead of leaking it into narrative', () => {
        // 2026-08-05 audit P1: the fallback anchored ONLY on requested_rolls —
        // an unfenced response on any other channel dropped all events silently
        // AND the raw JSON flowed into the displayed narrative → journal → RAG.
        const raw = 'Steel rings out as the bandits charge!\n{ "combat_start": { "enemies": [ { "name": "Bandit", "hp": 11 } ] } }';
        const { narrative, events } = parseResponse(raw);
        expect(events?.combatStart?.enemies?.[0]?.name).toBe('Bandit');
        expect(narrative).toBe('Steel rings out as the bandits charge!');
        expect(narrative).not.toContain('combat_start');
    });

    it('parses unfenced quest_updates and spell_cast JSON', () => {
        const quests = parseResponse('She nods.\n{ "quest_updates": [ { "id": "q1", "name": "Find the ledger", "status": "new", "description": "Recover it." } ] }');
        expect(quests.events?.questUpdates).toHaveLength(1);
        expect(quests.narrative).toBe('She nods.');

        const spell = parseResponse('Light blooms.\n{ "spell_cast": { "spell": "cureWounds", "level": 1 } }');
        expect(spell.events?.spellCasts?.length).toBe(1);
        expect(spell.narrative).toBe('Light blooms.');
    });

    it('P0 regression: unfenced JSON where requested_rolls follows an npc_updates object keeps the roll', () => {
        // The old extractor anchored on the nearest '{' — the closed Guard object —
        // parsed it "successfully", and silently dropped the roll request.
        const raw = 'The guard eyes you.\n{ "npc_updates": [ { "name": "Guard", "disposition": "wary" } ], "requested_rolls": [ { "type": "skill_check", "skill": "deception", "dc": 12 } ] }';
        const { narrative, events } = parseResponse(raw);
        expect(events?.requestedRolls).toHaveLength(1);
        expect(events.requestedRolls[0]).toMatchObject({ skill: 'deception', dc: 12 });
        expect(events?.npcUpdates?.[0]?.name).toBe('Guard');
        expect(narrative).toBe('The guard eyes you.');
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

    it('detects a "[Skill] check" phrase near a request verb Pattern 1 misses', () => {
        // "make one final ... check" dodges Pattern 1's required "a/an" article;
        // Pattern 2 catches it because a request verb precedes the skill noun.
        const { events } = parseResponse('You make one final Perception check as you scan the room.');
        expect(events?.requestedRolls?.[0]).toMatchObject({ type: 'skill_check', skill: 'perception' });
    });

    it('detects a "[Skill] saving throw" near a request verb as a saving_throw', () => {
        const { events } = parseResponse('Give me one constitution saving throw as the poison spreads.');
        expect(events?.requestedRolls?.[0]).toMatchObject({ type: 'saving_throw', skill: 'constitution' });
    });

    it('does NOT mint a phantom proposal from verb-less recap prose (2026-08-29 audit)', () => {
        // "your earlier Perception check served you well" is a recap, not a
        // request — the old bare-noun Pattern 2 staged a visible DC-10 proposal
        // from it that only a Challenge or the arbiter could walk back.
        const { events } = parseResponse('Your earlier Perception check served you well; the corridor holds no more surprises.');
        expect(events?.requestedRolls ?? []).toEqual([]);
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
        // Initiative is engine-owned: the DM-supplied values are not accepted
        // and no fallback is minted here (dead pipeline deleted 2026-08-29).
        expect(enemy.initiative).toBeUndefined();
        expect(events.combatStart.player_initiative).toBeUndefined();
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
    it('flags true pre-narrated outcomes', () => {
        const preNarrated = [
            'You hit the goblin and it falls dead.',
            'Your blade strikes true!',
            'You slay the last bandit before he can scream.',
            'A critical hit! The ogre staggers backward.',
            'You successfully pick the lock and slip inside.',
        ];
        for (const narrative of preNarrated) {
            expect(detectPreNarratedOutcome(narrative), narrative).toBe(true);
        }
    });

    it('does not flag neutral setup narration', () => {
        const neutral = [
            'The goblin eyes you warily, blade half-raised.',
            'You swing your blade at the goblin as it lunges toward you.',
            '"You\'ll never hit me from up there!" the archer jeers.',
        ];
        for (const narrative of neutral) {
            expect(detectPreNarratedOutcome(narrative), narrative).toBe(false);
        }
    });

    it('still flags legitimate narration that merely contains an outcome phrase (pinned current behavior)', () => {
        // KNOWN-BLUNT: the detector is a plain lowercase substring scan over
        // OUTCOME_KEYWORDS, so legit dialogue, past-tense recaps, and roll-free
        // perception prose that happen to contain a keyword false-positive. Pinned
        // as-is — sharpening the detector is a source change out of scope here.
        const bluntFalsePositives = [
            // KNOWN-BLUNT: NPC dialogue about someone else's marksmanship ('strikes true').
            '"Every arrow he fires strikes true," the innkeeper says of the marksman.',
            // KNOWN-BLUNT: past-context recap ('you kill' matches inside 'you killed').
            'The wanted poster names the raider you killed at the ford last winter.',
            // KNOWN-BLUNT: perception prose with no roll in play ('you notice').
            'You notice the door is locked, its hinges rusted shut.',
        ];
        for (const narrative of bluntFalsePositives) {
            expect(detectPreNarratedOutcome(narrative), narrative).toBe(true);
        }
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

    it('gives up on an irreparable fenced JSON block: null events, flagged, prose-only narrative', () => {
        const raw = 'You find a chest.\n```json\n{ "gold_found": 5, "items_found": [ { "name": "Gem" ] ] } } }\n```';
        const { narrative, events, eventsDropped } = parseResponse(raw);
        expect(events).toBeNull();
        expect(eventsDropped).toBe(true);
        // The narrative is the PROSE only. Until 2026-09-05 the full response
        // (broken fence included) came back and turnOrchestrator committed it as
        // the assistant message — raw JSON in the chat, the save, the DM's own
        // window, the journal, and RAG.
        expect(narrative).toBe('You find a chest.');
        expect(narrative).not.toContain('```');
    });

    it('an empty fenced block drops nothing into the narrative either', () => {
        const { narrative, events, eventsDropped } = parseResponse('The road is quiet.\n```json\n```');
        expect(events).toBeNull();
        expect(eventsDropped).toBe(true);
        expect(narrative).toBe('The road is quiet.');
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

    it('suppresses loose healing emitted alongside rest_taken — the rest owns recovery', () => {
        const dispatch = run({ healing: 7, rest_taken: 'short' });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'HEAL' }));
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'TAKE_REST', payload: 'short' }));
    });

    it('suppresses loose healing emitted alongside spell_cast — the engine rolls spell healing', () => {
        const dispatch = run({ healing: 9, spell_cast: { spell: 'Cure Wounds' } });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'HEAL' }));
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'CAST_SPELL' }));
    });

    it('dispatches CAST_SPELL for a spell_cast event with bounded fields', () => {
        const dispatch = run({ spell_cast: { spell: 'Cure Wounds', slot_level: 99, target: 'Jorun' } });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'CAST_SPELL',
            payload: expect.objectContaining({ spell: 'Cure Wounds', slotLevel: 5, target: 'Jorun' }),
        });

        const bare = run({ spell_cast: 'detect magic' });
        expect(bare).toHaveBeenCalledWith({
            type: 'CAST_SPELL',
            payload: expect.objectContaining({ spell: 'detect magic', slotLevel: null, target: null }),
        });
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

    it('survives a null purchase element without dropping the response\'s other events (2026-08-29 audit)', () => {
        // A "purchases": [null, …] used to throw on `p.itemKey` in applyEvents
        // BEFORE any dispatch — the narrative was already committed, so every
        // event the response carried (quest closures, coins, the valid
        // purchases) vanished with only the generic error line.
        const dispatch = run({
            purchases: [null, { itemKey: 'torch' }],
            sells: ['junk-string-entry', { itemKey: 'dagger' }],
            quest_updates: [{ name: 'Buy supplies', status: 'completed' }],
        });
        // The same-response quest completion stamps questCompletionAdjacent
        // meta on the transactions (2026-08-31 P1: wide replay horizon for
        // completion-adjacent grants).
        expect(dispatch).toHaveBeenCalledWith({
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'torch', _meta: { questCompletionAdjacent: true } },
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SELL_ITEM',
            payload: { itemKey: 'dagger', _meta: { questCompletionAdjacent: true } },
        });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'COMPLETE_QUEST' }));
    });

    it('passes source and player-message metadata to sell transactions when available', () => {
        const { events } = parseResponse(fence({ sell: { itemKey: 'dagger' } }));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => ({ character: {}, party: [] }), {
            lootSourceId: 'msg-sell-1',
            playerMessage: 'I sell my dagger.',
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SELL_ITEM',
            payload: {
                itemKey: 'dagger',
                _meta: {
                    sourceId: 'msg-sell-1',
                    playerMessage: 'I sell my dagger.',
                },
            },
        });
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
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'APPLY_COIN_LOSS' }));
    });

    it('passes a loose coin gain emitted alongside an atomic sale through to the reducer (value-judged there)', () => {
        // Since 2026-09-03 the gain side is value-aware in ADD_COIN_GRANT: a gain equal
        // to this reply's sale proceeds is the duplicate report, a different value is a
        // separate payment riding the same response (a bounty beside a sale).
        const dispatch = run({ sell: { itemKey: 'torch' }, gold_found: 5 });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SELL_ITEM' }));
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_COIN_GRANT' }));
    });

    it('dispatches loose gold/silver/copper found and lost independently of trades', () => {
        const dispatch = run({ gold_found: 3, silver_lost: 2, copper_found: 7 });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'ADD_COIN_GRANT',
            payload: expect.objectContaining({ gold: 3, silver: 0, copper: 7 }),
        }));
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'APPLY_COIN_LOSS',
            payload: expect.objectContaining({ gold: 0, silver: 2, copper: 0 }),
        }));
    });

    it('skips loot dispatch when the loot source was already claimed', () => {
        const state = { character: {}, party: [], appliedLootSourceIds: ['msg-1'] };
        const { events } = parseResponse(fence({ items_found: ['Gem'], gold_found: 10 }));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => state, { lootSourceId: 'msg-1' });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_ITEM' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_COIN_GRANT' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'CLAIM_LOOT_SOURCE' }));
    });

    it('claims a new loot source before granting the loot', () => {
        const { events } = parseResponse(fence({ gold_found: 10 }));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => ({ character: {}, party: [], appliedLootSourceIds: [] }), { lootSourceId: 'msg-2' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'CLAIM_LOOT_SOURCE', payload: 'msg-2' });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'ADD_COIN_GRANT',
            payload: expect.objectContaining({ gold: 10, _meta: expect.objectContaining({ sourceId: 'msg-2' }) }),
        }));
    });

    it('dispatches an explicit LEVEL_UP without also awarding raw exp', () => {
        const dispatch = run({ level_up: true, exp_awarded: 50 });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'LEVEL_UP',
            payload: expect.objectContaining({ bonusExp: 50, reason: 'milestone', _meta: expect.any(Object) }),
        });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_EXP' }));
    });

    it('dispatches ADD_EXP with replay-guard meta when no explicit level-up is signaled', () => {
        const dispatch = run({ exp_awarded: 25 });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'ADD_EXP',
            payload: expect.objectContaining({ amount: 25, _meta: expect.any(Object) }),
        });
    });

    it('suppresses exp_awarded emitted alongside a quest completion — the engine pays quest XP itself', () => {
        const dispatch = run({
            exp_awarded: 75,
            quest_updates: [{ status: 'completed', id: 'q1', name: 'Find the relic' }],
        });
        expect(dispatch).toHaveBeenCalledWith({ type: 'COMPLETE_QUEST', payload: { id: 'q1', name: 'Find the relic' } });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_EXP' }));
        // Non-completion statuses keep the award: nothing engine-side pays for them.
        const updatedOnly = run({
            exp_awarded: 75,
            quest_updates: [{ status: 'updated', id: 'q1', name: 'Find the relic' }],
        });
        expect(updatedOnly).toHaveBeenCalledWith({
            type: 'ADD_EXP',
            payload: expect.objectContaining({ amount: 75 }),
        });
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
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'TAKE_REST',
            payload: 'short',
            meta: expect.objectContaining({ source: 'dm' }),
        }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_CONDITION', payload: 'prone' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_CONDITION', payload: 'blinded' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_QUEST', payload: { name: 'Find the relic', description: 'It was lost long ago.' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'COMPLETE_QUEST', payload: { id: 'q1', name: 'Find the relic' } });
    });

    it('routes updated quests to the ADD_QUEST upsert and failed quests to FAIL_QUEST', () => {
        const dispatch = run({
            quest_updates: [
                { status: 'updated', id: 'q1', name: 'Find the relic', description: 'The trail leads to the sunken vault.' },
                { status: 'failed', id: 'q2', name: 'Save the caravan' },
            ],
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'ADD_QUEST',
            payload: { id: 'q1', name: 'Find the relic', description: 'The trail leads to the sunken vault.' },
        });
        expect(dispatch).toHaveBeenCalledWith({ type: 'FAIL_QUEST', payload: { id: 'q2', name: 'Save the caravan' } });
    });

    it('drops quest updates missing both id and name instead of creating ghost quests', () => {
        const dispatch = run({
            quest_updates: [
                { status: 'new', description: 'A quest with no identity.' },
                { status: 'updated', name: '   ' },
                { status: 'new', name: 'Real Quest', description: 'Has a name.' },
            ],
        });
        const questCalls = dispatch.mock.calls.filter(([action]) => action.type === 'ADD_QUEST');
        expect(questCalls).toHaveLength(1);
        expect(questCalls[0][0].payload.name).toBe('Real Quest');
    });

    it('type-guards quest updates: object-valued name/description cannot reach the save (2026-07-25 P1)', () => {
        const { events } = parseResponse(fence({
            quest_updates: [
                // Object name survives a truthiness guard ('[object Object]') and
                // would crash QuestPanel's render permanently.
                { status: 'new', name: { title: 'Sneaky object' }, description: 'desc' },
                { status: 'new', name: 'Valid Quest', description: { nested: 'object' } },
                { status: 'new', name: 42, description: 'numeric name' },
            ],
        }));
        expect(events.questUpdates).toHaveLength(1);
        expect(events.questUpdates[0].name).toBe('Valid Quest');
        expect(events.questUpdates[0].description).toBeUndefined();
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => ({ character: {}, party: [] }));
        const questCalls = dispatch.mock.calls.filter(([action]) => action.type === 'ADD_QUEST');
        expect(questCalls).toHaveLength(1);
        expect(typeof questCalls[0][0].payload.name).toBe('string');
    });

    it('accepts a numeric quest id by coercing it to a string', () => {
        const { events } = parseResponse(fence({
            quest_updates: [{ status: 'completed', id: 7, name: 'Find the relic' }],
        }));
        expect(events.questUpdates[0].id).toBe('7');
    });

    it('defaults an identified quest with a missing or misspelled status to new instead of dropping it', () => {
        const dispatch = run({
            quest_updates: [
                { name: 'Accepted Job', description: 'The DM forgot the status field.' },
                { status: 'complated', id: 'q9', name: 'Typo Quest' },
            ],
        });
        const questCalls = dispatch.mock.calls.filter(([action]) => action.type === 'ADD_QUEST');
        expect(questCalls.map(([action]) => action.payload.name)).toEqual(['Accepted Job', 'Typo Quest']);
    });

    it('aliases obvious completion/failure status synonyms instead of downgrading them to new (2026-08-28)', () => {
        // "complete"/"done"/"finished" used to default to 'new', silently
        // turning a completion into an upsert refresh — and no audit backstop
        // covers quest closure.
        const dispatch = run({
            quest_updates: [
                { status: 'complete', id: 'q1', name: 'Find the Relic' },
                { status: 'done', id: 'q2', name: 'Escort the Merchant' },
                { status: 'finished', id: 'q3', name: 'Clear the Mine' },
                { status: 'fail', id: 'q4', name: 'Save the Caravan' },
                { status: 'abandoned', id: 'q5', name: 'Guard the Shrine' },
                { status: 'in progress', id: 'q6', name: 'Chart the Marsh' },
            ],
        });
        expect(dispatch).toHaveBeenCalledWith({ type: 'COMPLETE_QUEST', payload: { id: 'q1', name: 'Find the Relic' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'COMPLETE_QUEST', payload: { id: 'q2', name: 'Escort the Merchant' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'COMPLETE_QUEST', payload: { id: 'q3', name: 'Clear the Mine' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'FAIL_QUEST', payload: { id: 'q4', name: 'Save the Caravan' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'FAIL_QUEST', payload: { id: 'q5', name: 'Guard the Shrine' } });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'ADD_QUEST',
            payload: { id: 'q6', name: 'Chart the Marsh' },
        });
    });

    it('caps a quest_updates flood at 8 entries', () => {
        const { events } = parseResponse(fence({
            quest_updates: Array.from({ length: 40 }, (_, i) => ({ status: 'new', name: `Quest ${i}` })),
        }));
        expect(events.questUpdates).toHaveLength(8);
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
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_COMPANION', payload: { name: 'Garrick', id: '' } });
    });

    it('carries an id-only companion removal through to the reducer', () => {
        // The DM is shown each companion's id in the party block and routinely
        // references it instead of the name; dropping those entries left the
        // departed companion in the party panel (2026-08-25).
        const dispatch = run({ remove_companions: [{ id: 'companion-17-abc' }] });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'REMOVE_COMPANION',
            payload: { name: '', id: 'companion-17-abc' },
        });
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
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_COIN_GRANT' }));
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
        const rolls = await detectSemanticTextRolls('Make an Insight check to read her.', { apiKey: 'k', llmProvider: 'gemini' });
        expect(rolls).toBeNull();
    });

    it('returns null when the extracted JSON fails to parse', async () => {
        sendMessage.mockResolvedValue('{ requested_rolls: [broken] }');
        const rolls = await detectSemanticTextRolls('Make an Insight check to read her.', { apiKey: 'k', llmProvider: 'gemini' });
        expect(rolls).toBeNull();
    });

    it('repairs a truncated detector response instead of silently dropping it (2026-08-29 audit)', async () => {
        // Every sibling machinery consumer gets the repair path via the shared
        // loose parser; this lane used raw JSON.parse until the consolidation.
        sendMessage.mockResolvedValue('{"requested_rolls": [{"type": "skill_check", "skill": "insight", "dc": 12');
        const rolls = await detectSemanticTextRolls('Make an Insight check to read her.', { apiKey: 'k', llmProvider: 'gemini' });
        expect(rolls).toEqual([{ type: 'skill_check', skill: 'insight', dc: 12 }]);
    });

    it('returns null when requested_rolls is missing or not an array', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ requested_rolls: 'nope' }));
        const rolls = await detectSemanticTextRolls('Make an Insight check to read her.', { apiKey: 'k', llmProvider: 'gemini' });
        expect(rolls).toBeNull();
    });

    it('returns null when the provider call throws', async () => {
        sendMessage.mockRejectedValue(new Error('network down'));
        const rolls = await detectSemanticTextRolls('Make an Insight check to read her.', { apiKey: 'k', llmProvider: 'gemini' });
        expect(rolls).toBeNull();
    });

    it('skips the LLM call for prose that merely mentions a check or save', async () => {
        // 2026-08-05 audit: bare \bcheck\b/\bsave\b gated open on ordinary prose,
        // so most no-roll narrations paid a blocking Flash-Lite round trip.
        const prose = 'A quick check of the room turns up nothing. You save your strength and press on.';
        expect(await detectSemanticTextRolls(prose, { apiKey: 'k', llmProvider: 'gemini' })).toBeNull();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('gates open on request-shaped prose, an explicit DC, or a die name', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ requested_rolls: [] }));
        for (const prose of [
            'Roll a Wisdom saving throw.',
            'The fumes sting — make a Constitution save to resist.',
            'Spotting it needs a sharp eye (DC 14).',
            'Give me a d20.',
        ]) {
            await detectSemanticTextRolls(prose, { apiKey: 'k', llmProvider: 'gemini' });
        }
        expect(sendMessage).toHaveBeenCalledTimes(4);
    });
});

describe('hostile event-block shapes (2026-07-27 audit)', () => {
    it('survives a fenced ```json null``` block — valid JSON, so no repair engages', () => {
        const { narrative, events } = parseResponse('The mist thickens.\n\n```json\nnull\n```');
        expect(narrative).toBe('The mist thickens.');
        expect(events).not.toBeNull();
        expect(events.requestedRolls).toEqual([]);
        expect(events.questUpdates).toEqual([]);
    });

    it('survives fenced scalar and array blocks the same way', () => {
        expect(parseResponse('Onward.\n\n```json\n42\n```').events.requestedRolls).toEqual([]);
        expect(parseResponse('Onward.\n\n```json\n["loose"]\n```').events.requestedRolls).toEqual([]);
    });

    it('drops null/scalar/array elements in requested_rolls and keeps valid siblings', () => {
        const { events } = parseResponse(fence({
            requested_rolls: [
                null,
                'roll perception',
                ['skill_check'],
                { type: 'skill_check', skill: 'perception', dc: 12 },
            ],
        }));
        expect(events.requestedRolls).toHaveLength(1);
        expect(events.requestedRolls[0]).toMatchObject({ type: 'skill_check', skill: 'perception', dc: 12 });
    });

    it('drops non-object enemy_updates elements before they reach UPDATE_ENEMY', () => {
        const { events } = parseResponse(fence({
            enemy_updates: [null, 7, 'goblin', ['goblin'], { id: 'goblin-1', hp: 3 }],
        }));
        expect(events.enemyUpdates).toEqual([{ id: 'goblin-1', hp: 3 }]);
    });
});

describe('requested_rolls hostile-field guards (2026-07-23 audit)', () => {
    it('coerces a truthy non-string skill/ability to null instead of crashing mid-batch', () => {
        const raw = 'Careful now.\n\n```json\n' + JSON.stringify({
            requested_rolls: [
                { type: 'skill_check', skill: ['stealth', 'acrobatics'], dc: 12 },
                { type: 'skill_check', skill: 42, ability: { weird: true }, dc: 10 },
                { type: 'skill_check', skill: '  perception ', dc: 8 },
            ],
        }) + '\n```';
        const { events } = parseResponse(raw);
        expect(events.requestedRolls[0].skill).toBeNull();
        expect(events.requestedRolls[1].skill).toBeNull();
        expect(events.requestedRolls[1].ability).toBeNull();
        expect(events.requestedRolls[2].skill).toBe('perception'); // trimmed
    });
});

describe('applyEvents carries an items_lost quantity (2026-09-03 P1)', () => {
    function run(payload) {
        const { events } = parseResponse(fence(payload));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => ({ character: {}, party: [] }));
        return dispatch;
    }

    it('forwards a count and "all" as { name, quantity }, and a bare name as a string', () => {
        const dispatch = run({ items_lost: [{ name: 'Torch', quantity: 2 }, { name: 'Rations (1 day)', quantity: 'ALL' }, 'Rope', { name: 'Arrow', quantity: 1 }] });
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_ITEM_BY_NAME', payload: { name: 'Torch', quantity: 2 } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_ITEM_BY_NAME', payload: { name: 'Rations (1 day)', quantity: 'all' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_ITEM_BY_NAME', payload: 'Rope' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_ITEM_BY_NAME', payload: { name: 'Arrow', quantity: 1 } });
    });

    it('drops junk quantities back to the bare-name default', () => {
        const dispatch = run({ items_lost: [{ name: 'Torch', quantity: 'some' }, { name: 'Dart', quantity: -3 }] });
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_ITEM_BY_NAME', payload: 'Torch' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_ITEM_BY_NAME', payload: 'Dart' });
    });
});

describe('parseResponse fence shapes (2026-09-05 audit)', () => {
    it('appends prose that follows the JSON block instead of dropping it', () => {
        const raw = 'The gate creaks.\n```json\n{ "gold_found": 3 }\n```\nA guard waves you through.';
        const { narrative, events } = parseResponse(raw);
        expect(events.goldFound).toBe(3);
        expect(narrative).toBe('The gate creaks.\n\nA guard waves you through.');
    });

    it('a JSON-first response keeps its trailing prose as the narrative (never an empty message)', () => {
        const raw = '```json\n{ "gold_found": 3 }\n```\nYou pocket the coins and move on.';
        const { narrative, events } = parseResponse(raw);
        expect(events.goldFound).toBe(3);
        expect(narrative).toBe('You pocket the coins and move on.');
    });

    it('a second fenced block is still discarded, but prose around it survives', () => {
        const raw = 'One.\n```json\n{ "gold_found": 1 }\n```\nTwo.\n```json\n{ "gold_found": 99 }\n```\nThree.';
        const { narrative, events } = parseResponse(raw);
        expect(events.goldFound).toBe(1);
        expect(narrative).toBe('One.\n\nTwo.\n\nThree.');
        expect(narrative).not.toContain('99');
    });

    it('recognizes an upper-case ```JSON tag', () => {
        const { narrative, events } = parseResponse('Quiet street.\n```JSON\n{ "gold_found": 2 }\n```');
        expect(events.goldFound).toBe(2);
        expect(narrative).toBe('Quiet street.');
    });

    it('recognizes a bare ``` fence whose body is an object', () => {
        const { narrative, events } = parseResponse('Quiet street.\n```\n{ "gold_found": 2 }\n```');
        expect(events.goldFound).toBe(2);
        expect(narrative).toBe('Quiet street.');
        expect(narrative).not.toContain('```');
    });

    it('leaves a bare fence around non-JSON prose alone (a sign, a letter) — pure narrative', () => {
        const raw = 'The sign reads:\n```\nKEEP OUT\n```\nYou shrug.';
        const { narrative, events } = parseResponse(raw);
        expect(events).toBeNull();
        expect(narrative).toBe(raw);
    });

    it('strips a dangling fence opener when an unclosed block falls to the anchor path', () => {
        const raw = 'You listen.\n```json\n{ "requested_rolls": [ { "type": "skill_check", "skill": "perception", "dc": 12 } ] }';
        const { narrative, events } = parseResponse(raw);
        expect(events?.requestedRolls).toHaveLength(1);
        expect(narrative).toBe('You listen.');
    });

    it('a prose mention of a wire key before an unfenced block no longer swallows the block as narrative', () => {
        const raw = "I'll log this under quest_updates so we remember.\n{ \"quest_updates\": [ { \"id\": \"q-1\", \"name\": \"Find the well\", \"status\": \"new\" } ] }";
        const { narrative, events } = parseResponse(raw);
        expect(events?.questUpdates).toHaveLength(1);
        expect(narrative).toBe("I'll log this under quest_updates so we remember.");
    });
});
