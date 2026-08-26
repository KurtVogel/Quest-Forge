/**
 * stampCriticalRoll — the single owner of the crit RULE's display stamp
 * (2026-08-20 audit P2: a Champion's natural 19 rendered as a crit in the Dice
 * Log out of combat but not in combat, because combatExchange pushed the roll
 * unstamped while rollResolver mutated its own copy of the logic).
 */
import { describe, expect, it } from 'vitest';
import { isCriticalNatural, stampCriticalRoll } from './combatMath.js';

const champion = { class: 'fighter', level: 3, martialArchetype: 'champion' };
const wizard = { class: 'wizard', level: 5 };

describe('stampCriticalRoll', () => {
    it('stamps a Champion natural 19 as a crit with the threshold label', () => {
        const roll = { isCritical: false, rolls: [19] };
        expect(stampCriticalRoll(champion, roll, 19)).toBe(true);
        expect(roll.isCritical).toBe(true);
        expect(roll.criticalThreshold).toBe('Champion 19-20');
    });

    it('leaves a non-Champion natural 19 unstamped', () => {
        const roll = { isCritical: false, rolls: [19] };
        expect(stampCriticalRoll(wizard, roll, 19)).toBe(false);
        expect(roll.isCritical).toBe(false);
    });

    it('keeps an already-stamped natural 20 untouched (no Champion label)', () => {
        const roll = { isCritical: true, rolls: [20] };
        expect(stampCriticalRoll(champion, roll, 20)).toBe(true);
        expect(roll.criticalThreshold).toBeUndefined();
    });

    it('tolerates a missing roll object', () => {
        expect(stampCriticalRoll(champion, null, 19)).toBe(false);
    });

    it('agrees with isCriticalNatural on the underlying rule', () => {
        expect(isCriticalNatural(champion, 19)).toBe(true);
        expect(isCriticalNatural({ ...champion, level: 2 }, 19)).toBe(false);
        expect(isCriticalNatural(wizard, 20)).toBe(true);
    });
});
