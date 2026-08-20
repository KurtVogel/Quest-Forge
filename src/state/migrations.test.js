import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION, getSaveVersion, MIGRATIONS, migrateLoadedSave } from './migrations.js';
import { SAVE_VERSION, serializeGameState } from './persistence.js';
import { gameReducer, initialGameState } from './gameReducer.js';

const fighterSave = (overrides = {}) => ({
    character: {
        name: 'Veteran', race: 'human', class: 'fighter', level: 4, exp: 0,
        currentHP: 30, maxHP: 30, conditions: [],
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    },
    inventory: [],
    messages: [],
    ...overrides,
});

const retirementNotice = save =>
    (save.messages || []).some(m => (m.content || '').includes('flat level bonus to hit and damage has been retired'));

describe('save-version machinery', () => {
    it('persistence stamps the pipeline version (SAVE_VERSION is CURRENT_SAVE_VERSION)', () => {
        expect(CURRENT_SAVE_VERSION).toBe(3);
        expect(SAVE_VERSION).toBe(CURRENT_SAVE_VERSION);
        expect(serializeGameState(initialGameState).saveVersion).toBe(CURRENT_SAVE_VERSION);
    });

    it('reads pre-versioned and junk stamps as version 0', () => {
        expect(getSaveVersion({})).toBe(0);
        expect(getSaveVersion({ saveVersion: undefined })).toBe(0);
        expect(getSaveVersion({ saveVersion: 'two' })).toBe(0);
        expect(getSaveVersion({ saveVersion: -3 })).toBe(0);
        expect(getSaveVersion({ saveVersion: 2 })).toBe(2);
        expect(getSaveVersion({ saveVersion: '2' })).toBe(2);
    });

    it('keeps MIGRATIONS ordered by toVersion with none beyond the current version', () => {
        const versions = MIGRATIONS.map(m => m.toVersion);
        expect([...versions].sort((a, b) => a - b)).toEqual(versions);
        expect(Math.max(...versions)).toBeLessThanOrEqual(CURRENT_SAVE_VERSION);
    });

    it('re-stamps every migrated save with the current version', () => {
        expect(migrateLoadedSave(fighterSave()).saveVersion).toBe(CURRENT_SAVE_VERSION);
        expect(migrateLoadedSave(fighterSave({ saveVersion: 2 })).saveVersion).toBe(CURRENT_SAVE_VERSION);
        expect(migrateLoadedSave(fighterSave({ saveVersion: 99 })).saveVersion).toBe(CURRENT_SAVE_VERSION);
    });
});

describe('healDuplicateInventoryRows (queue P2, live playtests #7-#8 stale-twin ghosts)', () => {
    it('merges exact case-insensitive duplicate qty-1 unequipped rows into one stack', () => {
        const save = migrateLoadedSave(fighterSave({
            inventory: [
                { id: 'i-1', name: 'Rusted iron keys', quantity: 1 },
                { id: 'i-2', name: 'rusted iron keys', quantity: 1 },
                { id: 'i-3', name: 'Lodestone' },
                { id: 'i-4', name: 'Lodestone', quantity: 1 },
                { id: 'i-5', name: 'Rope', quantity: 1 },
            ],
        }));
        const keys = save.inventory.filter(i => /rusted iron keys/i.test(i.name));
        expect(keys).toHaveLength(1);
        expect(keys[0].quantity).toBe(2);
        const lodestones = save.inventory.filter(i => i.name === 'Lodestone');
        expect(lodestones).toHaveLength(1);
        expect(lodestones[0].quantity).toBe(2);
        expect(save.inventory.find(i => i.name === 'Rope').quantity).toBe(1);
    });

    it('never touches equipped copies, stacked quantities, or near-name variants', () => {
        const save = migrateLoadedSave(fighterSave({
            inventory: [
                // One copy equipped: both rows stay (a worn blade is not a ghost).
                { id: 'w-1', name: 'Shortsword', type: 'weapon', damage: '1d6', equipped: true, quantity: 1 },
                { id: 'w-2', name: 'Shortsword', type: 'weapon', damage: '1d6', quantity: 1 },
                // A real stack beside a single: quantities differ, leave alone.
                { id: 'p-1', name: 'Healing Potion', type: 'consumable', quantity: 3 },
                { id: 'p-2', name: 'Healing Potion', type: 'consumable', quantity: 1 },
                // Near-name variants are different rows by design.
                { id: 'b-1', name: 'Brick of raw bog-wax', quantity: 1 },
                { id: 'b-2', name: 'brick of bog-wax', quantity: 1 },
            ],
        }));
        expect(save.inventory.filter(i => i.name === 'Shortsword')).toHaveLength(2);
        expect(save.inventory.filter(i => i.name === 'Healing Potion')).toHaveLength(2);
        expect(save.inventory.filter(i => /bog-wax/i.test(i.name))).toHaveLength(2);
    });

    it('is a no-op reference-wise on a clean inventory', () => {
        const save = migrateLoadedSave(fighterSave({
            inventory: [
                { id: 'i-1', name: 'Rope', quantity: 1 },
                { id: 'i-2', name: 'Lantern', quantity: 1 },
            ],
        }));
        expect(save.inventory.map(i => i.name)).toEqual(['Rope', 'Lantern']);
    });
});

describe('healShadowInventoryRows (2026-08-20 playtest: lowercase narrated twins of catalog rows)', () => {
    it('merges a keyless narrated shadow into its catalog-keyed twin', () => {
        const save = migrateLoadedSave(fighterSave({
            inventory: [
                { id: 'r-1', itemKey: 'ropeHempen', name: 'Hempen Rope (50 ft)', quantity: 1 },
                { id: 'r-2', name: 'hempen rope', quantity: 1 },
            ],
        }));
        const ropes = save.inventory.filter(i => /rope/i.test(i.name));
        expect(ropes).toHaveLength(1);
        expect(ropes[0].itemKey).toBe('ropeHempen');
        expect(ropes[0].quantity).toBe(2);
    });

    it('leaves a shadow alone when two keyed twins could claim it', () => {
        const save = migrateLoadedSave(fighterSave({
            inventory: [
                { id: 'r-1', itemKey: 'ropeHempen', name: 'Hempen Rope (50 ft)', quantity: 1 },
                { id: 'r-2', itemKey: 'ropeSilk', name: 'Silk Rope (50 ft)', quantity: 1 },
                { id: 'r-3', name: 'rope', quantity: 1 },
            ],
        }));
        expect(save.inventory).toHaveLength(3);
    });

    it('never absorbs equipped or stacked shadows, and never merges keyless near-name pairs', () => {
        const save = migrateLoadedSave(fighterSave({
            inventory: [
                { id: 'a-1', itemKey: 'leatherArmor', name: 'Leather Armor', type: 'armor', baseAC: 11, quantity: 1 },
                { id: 'a-2', name: 'leather armor', type: 'armor', baseAC: 11, equipped: true, quantity: 1 },
                { id: 'c-1', itemKey: 'candlesWax', name: 'Wax Candles (x5)', quantity: 1 },
                { id: 'c-2', name: 'wax candles', quantity: 5 },
                { id: 'b-1', name: 'Brick of raw bog-wax', quantity: 1 },
                { id: 'b-2', name: 'brick of bog-wax', quantity: 1 },
            ],
        }));
        expect(save.inventory.filter(i => /leather armor/i.test(i.name)).length).toBeGreaterThanOrEqual(2);
        expect(save.inventory.filter(i => /candles/i.test(i.name))).toHaveLength(2);
        expect(save.inventory.filter(i => /bog-wax/i.test(i.name))).toHaveLength(2);
    });
});

describe('version gating', () => {
    it('runs versioned migrations for pre-boundary saves (unstamped and v2)', () => {
        const unstamped = migrateLoadedSave(fighterSave());
        expect(retirementNotice(unstamped)).toBe(true);
        expect(unstamped.character.levelBonusRetired).toBe(true);

        const v2 = migrateLoadedSave(fighterSave({ saveVersion: 2 }));
        expect(retirementNotice(v2)).toBe(true);
    });

    it('skips versioned migrations for current and unknown future versions', () => {
        const current = migrateLoadedSave(fighterSave({ saveVersion: CURRENT_SAVE_VERSION }));
        expect(retirementNotice(current)).toBe(false);
        expect(current.character.levelBonusRetired).toBeUndefined();

        const future = migrateLoadedSave(fighterSave({ saveVersion: 99 }));
        expect(retirementNotice(future)).toBe(false);
    });

    it('still runs unconditional heals on future-version saves', () => {
        // Version stamps are no proof of shape (cloud saves can be hand-edited):
        // numeric coercion, banked level-ups, and slot minting must never be gated.
        const future = migrateLoadedSave(fighterSave({
            saveVersion: 99,
            character: {
                name: 'Edited', race: 'human', class: 'wizard', level: '3', exp: '20',
                currentHP: '10', maxHP: '18', conditions: [],
                abilityScores: { strength: 8, dexterity: 12, constitution: 12, intelligence: 16, wisdom: 10, charisma: 10 },
            },
        }));
        expect(future.character.level).toBe(3);
        expect(future.character.exp).toBe(20);
        expect(future.character.spellSlots).toBeTruthy();
        expect(future.character.hitDice).toEqual({ total: '3', remaining: '3', die: 6 });
    });

    it('LOAD_GAME respects the gate end to end', () => {
        const legacy = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: fighterSave() });
        expect(retirementNotice(legacy)).toBe(true);
        expect(legacy.saveVersion).toBe(CURRENT_SAVE_VERSION);

        const modern = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: fighterSave({ saveVersion: CURRENT_SAVE_VERSION }),
        });
        expect(retirementNotice(modern)).toBe(false);
    });
});
