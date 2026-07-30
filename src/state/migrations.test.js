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
