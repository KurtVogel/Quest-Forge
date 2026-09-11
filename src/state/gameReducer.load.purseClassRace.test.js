/**
 * The purse, class, race, and inventory rows load TYPED (2026-09-11 persistence
 * audit, Lap 2 hostile input): `gold: {}` beside 40 sp 5 cp made the first
 * "+1 gp" grant wipe the WHOLE purse to zero; `class: {}` printed
 * "[object Object]" into the prompt and collapsed a Fighter's resources; a cut
 * legacy class ("paladin") loaded featureless on a d8 with no notice; a null
 * inventory row became a permanent "Unknown item" and an object name a React
 * child throw.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';
import { characterCurrencyToCopper } from '../engine/currency.js';
import { MAX_COIN_HELD } from '../config/contentLimits.js';

const baseCharacter = {
    name: 'Survivor', race: 'human', class: 'fighter', level: 3, exp: 900, currentHP: 20, maxHP: 20, conditions: [],
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
};

const load = (character, extra = {}) => gameReducer(initialGameState, {
    type: 'LOAD_GAME',
    payload: { character: { ...baseCharacter, ...character }, inventory: [], messages: [], ...extra },
});

const promptOf = (state) => buildSystemPrompt({
    ...state,
    preset: 'classicFantasy',
    ruleset: 'simplified5e',
    customSystemPrompt: '',
    retrievedMemories: [],
});

describe('LOAD_GAME purse typing (2026-09-11 persistence P1)', () => {
    it('an object gold field loads as 0 and the first coin grant keeps the silver and copper', () => {
        const next = load({ gold: {}, silver: 40, copper: 5 });
        expect(next.character.gold).toBe(0);
        expect(next.character.silver).toBe(40);
        expect(next.character.copper).toBe(5);
        const granted = gameReducer(next, { type: 'ADD_COIN_GRANT', payload: { gold: 1, silver: 0, copper: 0, _meta: { sourceId: 'grant-1' } } });
        expect(characterCurrencyToCopper(granted.character)).toBe(405 + 100);
    });

    it('a junk string loads as 0, a numeric string coerces, a negative floors, a giant value clamps', () => {
        expect(load({ gold: 'abc' }).character.gold).toBe(0);
        expect(load({ gold: '12' }).character.gold).toBe(12);
        expect(load({ silver: -40 }).character.silver).toBe(0);
        expect(load({ copper: 1e15 }).character.copper).toBe(MAX_COIN_HELD);
    });

    it('the prompt never prints an object purse', () => {
        expect(promptOf(load({ gold: {} }))).not.toContain('[object Object]');
    });
});

describe('LOAD_GAME class/race whitelist (2026-09-11 persistence P1)', () => {
    it('an object class falls back to Fighter with rebuilt resources and a visible notice', () => {
        const next = load({ class: {}, classResources: {} });
        expect(next.character.class).toBe('fighter');
        expect(next.character.classResources.secondWind).toBeDefined();
        expect(next.character.hitDice.die).toBe(10);
        expect(next.messages.some(m => m.role === 'system' && /Hero updated for this version/.test(m.content))).toBe(true);
        expect(promptOf(next)).toContain('**Class:** Fighter');
        expect(promptOf(next)).not.toContain('[object Object]');
    });

    it('a cut legacy class loads as Fighter with its stale derived fields replaced, and the notice names the old option', () => {
        const next = load({
            class: 'paladin', race: 'halfling',
            classResources: { layOnHands: { used: 0, max: 15 } },
            features: ['Divine Sense'], spellSlots: { 1: { used: 0, max: 2 } },
        });
        expect(next.character.class).toBe('fighter');
        expect(next.character.race).toBe('human');
        expect(next.character.classResources.layOnHands).toBeUndefined();
        expect(next.character.classResources.secondWind).toBeDefined();
        expect(next.character.features).not.toContain('Divine Sense');
        expect(next.character.spellSlots).toBeUndefined();
        expect(next.character.fightingStyle).toBe('defense');
        expect(next.character.level).toBe(3);
        expect(next.character.exp).toBe(900);
        const notice = next.messages.find(m => m.role === 'system' && /Hero updated for this version/.test(m.content));
        expect(notice.content).toContain('class "paladin" → Fighter');
        expect(notice.content).toContain('race "halfling" → Human');
    });

    it('is a no-op for a known class and race — no notice, no rebuild', () => {
        const next = load({ class: 'cleric', race: 'dwarf', classResources: { channelDivinity: { used: 1, max: 1 } } });
        expect(next.character.class).toBe('cleric');
        expect(next.character.classResources.channelDivinity.used).toBe(1);
        expect(next.messages.some(m => /Hero updated for this version/.test(m.content || ''))).toBe(false);
    });

    it('fires once: re-loading the healed save shows no second notice', () => {
        const healed = load({ class: 'paladin' });
        const again = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: healed.character, inventory: [], messages: [] },
        });
        expect(again.messages.filter(m => /Hero updated for this version/.test(m.content || ''))).toHaveLength(0);
    });
});

describe('LOAD_GAME inventory row typing (2026-09-11 persistence P2)', () => {
    it('drops null/number rows and blanks an object name to the Unknown item default', () => {
        const next = load({}, {
            inventory: [null, 42, 'Dagger', { name: { x: 1 }, type: 'gear' }, { name: 'Torch', type: 'gear', quantity: 2 }],
        });
        const names = next.inventory.map(item => item.name);
        expect(names).toEqual(['Unknown item', 'Torch']);
        expect(promptOf(next)).not.toContain('[object Object]');
    });
});
