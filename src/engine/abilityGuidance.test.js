import { describe, it, expect } from 'vitest';
import { getAbilityGuidance } from './abilityGuidance.js';
import { CLASSES, CLASS_LIST } from '../data/classes.js';
import { ABILITY_NAMES, STANDARD_ARRAY } from './characterUtils.js';

describe('getAbilityGuidance', () => {
    it('covers every class with a complete, deduplicated priority', () => {
        for (const charClass of CLASS_LIST) {
            const guidance = getAbilityGuidance(charClass);
            expect(guidance, charClass).toBeTruthy();
            expect([...guidance.priority].sort()).toEqual([...ABILITY_NAMES].sort());
        }
    });

    it("leads with each class's primary ability", () => {
        for (const charClass of CLASS_LIST) {
            expect(getAbilityGuidance(charClass).priority[0], charClass)
                .toBe(CLASSES[charClass].primaryAbility);
        }
    });

    it('explains every ability it ranks', () => {
        for (const charClass of CLASS_LIST) {
            const { priority, notes } = getAbilityGuidance(charClass);
            for (const ability of priority) {
                expect(notes[ability], `${charClass}.${ability}`).toBeTruthy();
            }
        }
    });

    it('spends the whole standard array, best value first', () => {
        const { priority, recommended } = getAbilityGuidance('wizard');
        expect(priority.map(a => recommended[a])).toEqual(STANDARD_ARRAY);
        expect(recommended.intelligence).toBe(15);
    });

    it('flips Strength and Dexterity for an Archery fighter', () => {
        const melee = getAbilityGuidance('fighter');
        const archer = getAbilityGuidance('fighter', { fightingStyle: 'archery' });
        expect(melee.recommended.strength).toBe(15);
        expect(archer.recommended.dexterity).toBe(15);
        expect(archer.recommended.strength).toBe(13);
        // The override replaces only the notes it restates.
        expect(archer.notes.dexterity).not.toBe(melee.notes.dexterity);
        expect(archer.notes.wisdom).toBe(melee.notes.wisdom);
    });

    it('ignores an unknown fighting style and unknown classes', () => {
        expect(getAbilityGuidance('fighter', { fightingStyle: 'nonsense' }).recommended.strength).toBe(15);
        expect(getAbilityGuidance('bard')).toBeNull();
        expect(getAbilityGuidance(undefined)).toBeNull();
    });
});
