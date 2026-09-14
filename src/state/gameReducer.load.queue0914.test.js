/**
 * Queue sweep 2026-09-14 — load-boundary pins for the four open audit groups:
 * spellcasting (09-13), chronicler (09-13), rules-math (09-14), quests (09-14).
 * Every case here reproduces a queue line against LOAD_GAME and the reader
 * that used to crash or misbehave.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';
import { summarizeSpellSlots } from '../engine/spellcasting.js';
import { getAllSkills, getSkillModifier } from '../engine/rules.js';

const SCORES = { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 };

const save = (character = {}, extra = {}) => ({
    character: {
        name: 'Veteran', race: 'human', class: 'fighter', level: 3, exp: 0,
        currentHP: 28, maxHP: 28, conditions: [], abilityScores: { ...SCORES },
        ...character,
    },
    inventory: [],
    messages: Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Beat ${i}` })),
    ...extra,
});

const load = (payload) => gameReducer(initialGameState, { type: 'LOAD_GAME', payload });

const promptFor = (state) => buildSystemPrompt({
    character: state.character, inventory: state.inventory, quests: state.quests, rollHistory: [],
    preset: 'classicFantasy', ruleset: 'simplified5e', customSystemPrompt: '', journal: [], npcs: [], party: [],
    currentLocation: 'Jewelglade', combat: { active: false }, worldFacts: [], fronts: [], storyMemory: [],
    retrievedMemories: [], premise: '', recentRulings: [], messages: [], messageCount: 0,
});

describe('spellcasting at load (2026-09-13 audit)', () => {
    it('P1: a NON-caster save carrying spellSlots/sustainedSpell loads with both stripped — the Combat panel summary can never throw', () => {
        const next = load(save({ spellSlots: { 1: null }, sustainedSpell: { key: 'mage_armor', acBonus: '5' } }));
        expect(next.character.spellSlots).toBeUndefined();
        expect(next.character.sustainedSpell).toBeUndefined();
        // The panel's own gate (isSpellcaster && spellSlots) plus the strip: no `null.max`.
        expect(() => summarizeSpellSlots(next.character.spellSlots)).not.toThrow();
        expect(summarizeSpellSlots(next.character.spellSlots)).toBe('');
        const junk = load(save({ spellSlots: 'junk' }));
        expect(junk.character.spellSlots).toBeUndefined();
    });

    it('P2: a caster\'s string slot tally is KEPT (the load never refills the day\'s magic)', () => {
        const next = load(save({ class: 'wizard', level: 3, spellSlots: { 1: { used: '4', max: 4 }, 2: { used: '1', max: 2 } } }));
        expect(next.character.spellSlots[1]).toEqual({ used: 4, max: 4 });
        expect(next.character.spellSlots[2]).toEqual({ used: 1, max: 2 });
    });

    it('P2: a string arcaneRecovery.used is typed at load so a wizard\'s short rest actually recovers slots', () => {
        const loaded = load(save({
            class: 'wizard', level: 5, currentHP: 20, maxHP: 20,
            classResources: { arcaneRecovery: { used: '0', max: 1 } },
            spellSlots: { 1: { used: 4, max: 4 }, 2: { used: 3, max: 3 }, 3: { used: 2, max: 2 } },
        }));
        expect(loaded.character.classResources.arcaneRecovery).toEqual({ used: 0, max: 1 });
        const rested = gameReducer(loaded, { type: 'TAKE_REST', payload: 'short' });
        expect(rested.character.classResources.arcaneRecovery.used).toBe(1);
        expect(rested.character.spellSlots[3].used).toBe(1);
        expect(rested.messages.at(-1).content).toMatch(/Arcane Recovery restores/);
    });

    it('P2 nit: sustainedSpell.targetId is string-or-drop', () => {
        const next = load(save({
            class: 'wizard', level: 3,
            sustainedSpell: { key: 'mage_armor', targetType: 'companion', targetId: { evil: true }, targetName: 'Terho' },
        }));
        expect(next.character.sustainedSpell.targetId).toBeUndefined();
    });
});

describe('rules-math at load (2026-09-14 audit)', () => {
    it('P1: number / string / object proficiency lists load as typed arrays — skill rolls, the sheet, and the prompt all survive', () => {
        for (const junk of [42, 'stealth and perception', { stealth: true }, true]) {
            const next = load(save({ skillProficiencies: junk, expertiseSkills: junk, savingThrowProficiencies: junk }));
            expect(next.character.skillProficiencies).toEqual([]);
            expect(next.character.expertiseSkills).toEqual([]);
            expect(next.character.savingThrowProficiencies).toEqual([]);
            expect(() => getAllSkills(next.character)).not.toThrow();
            expect(getSkillModifier(next.character, 'stealth')).toBe(1); // DEX only — no substring proficiency
            expect(() => promptFor(next)).not.toThrow();
        }
    });

    it('P1: known keys survive deduped, unknown keys drop, expertise needs proficiency', () => {
        const next = load(save({
            class: 'rogue',
            skillProficiencies: ['stealth', 'stealth', 'Stealth', 'flying', 42, 'perception'],
            expertiseSkills: ['stealth', 'arcana'],
            savingThrowProficiencies: ['dexterity', 'luck', 'intelligence', 'dexterity'],
        }));
        expect(next.character.skillProficiencies).toEqual(['stealth', 'perception']);
        expect(next.character.expertiseSkills).toEqual(['stealth']);
        expect(next.character.savingThrowProficiencies).toEqual(['dexterity', 'intelligence']);
    });

    it('P1: a non-caster with a string sustained acBonus loads with a NUMERIC armor class', () => {
        const next = load(save({ sustainedSpell: { key: 'mage_armor', acBonus: '5' } }));
        expect(typeof next.character.armorClass).toBe('number');
        expect(next.character.armorClass).toBe(11); // 10 + DEX 1, no phantom buff
    });
});

describe('quests at load (2026-09-14 audit)', () => {
    it('P1: an object-named row is dropped, never "[object Object]" in the prompt', () => {
        const next = load(save({}, { quests: [{ id: 'q1', name: { evil: true }, status: 'active' }, { id: 'q2', name: 'Find the ledger', status: 'active' }] }));
        expect(next.quests.map(q => q.name)).toEqual(['Find the ledger']);
        expect(promptFor(next)).not.toContain('[object Object]');
    });

    it('P2: uppercase status normalizes so the DM re-opening the quest updates instead of minting a twin', () => {
        const next = load(save({}, { quests: [{ id: 'q1', name: 'Guard the caravan', status: 'ACTIVE' }] }));
        expect(next.quests[0].status).toBe('active');
        const again = gameReducer(next, { type: 'ADD_QUEST', payload: { name: 'Guard the caravan', description: 'Leaves at dawn.' } });
        expect(again.quests).toHaveLength(1);
        expect(again.quests[0].description).toBe('Leaves at dawn.');
        const unknown = load(save({}, { quests: [{ id: 'q1', name: 'X', status: 'paused' }] }));
        expect(unknown.quests[0].status).toBe('active');
    });

    it('P2: an id-less row gets an id, a duplicate id is re-minted, an oversized name/description clamps', () => {
        const next = load(save({}, {
            quests: [
                { name: 'No id here', status: 'active' },
                { id: 'dup', name: 'First', status: 'completed' },
                { id: 'dup', name: 'Second', status: 'active' },
                { id: 'big', name: 'n'.repeat(200000), description: 'd'.repeat(5000), status: 'active' },
            ],
        }));
        expect(typeof next.quests[0].id).toBe('string');
        expect(next.quests[0].id.length).toBeGreaterThan(0);
        expect(new Set(next.quests.map(q => q.id)).size).toBe(4);
        expect(next.quests[1].id).toBe('dup');
        expect(next.quests[2].id).not.toBe('dup');
        expect(next.quests[3].name).toHaveLength(160);
        expect(next.quests[3].description).toHaveLength(800);
        // The quest block adds the clamped rows only — never a 200k name.
        expect(promptFor(next).length - promptFor({ ...next, quests: [] }).length).toBeLessThan(2000);
        // The panel's ✕ removes exactly one row now that every row has its own id.
        const removed = gameReducer(next, { type: 'REMOVE_QUEST', payload: next.quests[0].id });
        expect(removed.quests).toHaveLength(3);
    });

    it('P2: a future openedAtMessage clamps to the transcript and a junk one is dropped (full tier, never same-turn)', () => {
        const next = load(save({}, { quests: [{ id: 'q1', name: 'A', status: 'active', openedAtMessage: 1e15 }, { id: 'q2', name: 'B', status: 'active', openedAtMessage: 'soon' }] }));
        expect(next.quests[0].openedAtMessage).toBe(50);
        expect(next.quests[1].openedAtMessage).toBeUndefined();
        expect(next.quests.some(q => 'junk' in q)).toBe(false);
    });
});

describe('chronicler at load (2026-09-13 audit)', () => {
    it('P2: a future toIndex clamps to the transcript so the next close is possible again, and unknown keys drop', () => {
        const next = load(save({}, {
            chronicle: [{ id: 'ch-1', title: 'Far', text: 'Prose.', fromIndex: 0, toIndex: 1e15, junk: { nested: true } }],
        }));
        expect(next.chronicle[0].toIndex).toBe(49);
        expect(next.chronicle[0]).not.toHaveProperty('junk');
    });

    it('P2: session.chapterCloseSuggested is complete-or-null — an object title never reaches the Chronicle tab', () => {
        const poisoned = load(save({}, { session: { id: 's1', chapterCloseSuggested: { frontId: 'f1', title: { evil: true }, at: 1 } } }));
        expect(poisoned.session.chapterCloseSuggested).toBeNull();
        const healthy = load(save({}, { session: { id: 's1', chapterCloseSuggested: { frontId: 'f1', title: 'The Ash Court', at: 1 } } }));
        expect(healthy.session.chapterCloseSuggested).toEqual({ frontId: 'f1', title: 'The Ash Court', at: 1 });
        const absent = load(save({}, { session: { id: 's1' } }));
        expect(absent.session).not.toHaveProperty('chapterCloseSuggested');
    });
});
