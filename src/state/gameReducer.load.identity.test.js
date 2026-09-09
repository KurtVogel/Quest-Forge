/**
 * The hero's identity fields load typed and the hero portrait gets the shared
 * allowlist (2026-09-09 audit P1 + P2): `gender: {}` threw out of
 * buildSystemPrompt on EVERY turn and out of the Character Sheet render;
 * `https://tracker.example/pixel.png` rendered as an <img src> from a shared
 * or cloud save.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';
import { buildPortraitPrompt } from '../components/CharacterSheet/portraitPrompt.js';

const junkCharacter = {
    name: { first: 'V' }, race: 'human', class: 'fighter', level: 1, exp: 0, currentHP: 12, maxHP: 12, conditions: [],
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    gender: {}, appearance: {}, background: ['x'],
    portraitUrl: 'https://tracker.example/pixel.png', portraitPrompt: 5, portraitProvider: { p: 1 },
};

const load = (character) => gameReducer(initialGameState, {
    type: 'LOAD_GAME',
    payload: { character, inventory: [], messages: [] },
});

const promptOf = (state) => buildSystemPrompt({
    ...state,
    preset: 'classicFantasy',
    ruleset: 'simplified5e',
    customSystemPrompt: '',
    retrievedMemories: [],
});

describe('LOAD_GAME hero identity typing', () => {
    it('string-clamps name/gender/appearance/background and strips a non-allowlisted portrait URL', () => {
        const next = load(junkCharacter);
        expect(next.character).toMatchObject({
            name: 'Adventurer', gender: '', appearance: '', background: '', portraitUrl: '', portraitPrompt: '', portraitProvider: '',
        });
    });

    it('keeps real values and an allowlisted portrait', () => {
        const next = load({
            ...junkCharacter,
            name: ' Aune ', gender: 'woman', appearance: 'Grey braid.', background: 'Born in Ashford.',
            portraitUrl: 'data:image/jpeg;base64,abc123==',
        });
        expect(next.character).toMatchObject({
            name: 'Aune', gender: 'woman', appearance: 'Grey braid.', background: 'Born in Ashford.',
            portraitUrl: 'data:image/jpeg;base64,abc123==',
        });
    });

    it('the prompt builds and the portrait prompt computes after a junk load', () => {
        const next = load(junkCharacter);
        expect(() => promptOf(next)).not.toThrow();
        expect(promptOf(next)).not.toContain('[object Object]');
        expect(() => buildPortraitPrompt(next.character, '', [])).not.toThrow();
    });

    it('the consumers are belted even WITHOUT the load heal (an in-memory object field never throws)', () => {
        const state = { ...load(junkCharacter), character: { ...junkCharacter, name: 'Vesa' } };
        expect(() => promptOf(state)).not.toThrow();
        expect(promptOf(state)).not.toContain('[object Object]');
        expect(buildPortraitPrompt(state.character, 'scarred', [])).not.toContain('[object Object]');
    });
});

describe('UPDATE_CHARACTER portrait allowlist', () => {
    const state = load({ ...junkCharacter, name: 'Vesa', gender: 'man', portraitUrl: 'data:image/png;base64,old==' });

    it('never stores a non-allowlisted URL and does not stamp the portrait metadata', () => {
        const next = gameReducer(state, {
            type: 'UPDATE_CHARACTER',
            payload: { portraitUrl: 'https://tracker.example/pixel.png', portraitProvider: 'gemini', portraitUpdatedAt: 123, portraitPrompt: 'p' },
        });
        expect(next.character.portraitUrl).toBe('data:image/png;base64,old==');
        expect(next.character.portraitProvider).toBe('');
        expect(next.character.portraitUpdatedAt).toBeUndefined();
    });

    it('a text/html data URL from a mis-typed provider payload is refused too', () => {
        const next = gameReducer(state, {
            type: 'UPDATE_CHARACTER',
            payload: { portraitUrl: 'data:text/html;base64,PHNjcmlwdD4=', portraitProvider: 'gemini' },
        });
        expect(next.character.portraitUrl).toBe('data:image/png;base64,old==');
        expect(next.character.portraitProvider).toBe('');
    });

    it('stores an allowlisted URL with its metadata, and an explicit clear stays a clear', () => {
        const next = gameReducer(state, {
            type: 'UPDATE_CHARACTER',
            payload: { portraitUrl: 'data:image/webp;base64,bmV3', portraitProvider: 'xai', portraitUpdatedAt: 5 },
        });
        expect(next.character).toMatchObject({ portraitUrl: 'data:image/webp;base64,bmV3', portraitProvider: 'xai', portraitUpdatedAt: 5 });
        const cleared = gameReducer(next, { type: 'UPDATE_CHARACTER', payload: { portraitUrl: '' } });
        expect(cleared.character.portraitUrl).toBe('');
    });

    it('non-portrait updates pass through untouched', () => {
        const next = gameReducer(state, { type: 'UPDATE_CHARACTER', payload: { appearance: 'A new scar.' } });
        expect(next.character.appearance).toBe('A new scar.');
        expect(next.character.portraitUrl).toBe('data:image/png;base64,old==');
    });
});

describe('SET_NPC_PORTRAIT metadata stamps only when the URL survives', () => {
    const withNpc = gameReducer(initialGameState, {
        type: 'UPDATE_NPC',
        payload: { name: 'Aune Virtapää', disposition: 'wary', gender: 'woman' },
    });
    const npcId = withNpc.npcs[0].id;

    it('a rejected URL leaves the record untouched — no "Rendered by gemini" beside no picture', () => {
        const next = gameReducer(withNpc, {
            type: 'SET_NPC_PORTRAIT',
            payload: { id: npcId, portraitUrl: 'data:text/html;base64,PHNjcmlwdD4=', portraitProvider: 'gemini', portraitPrompt: 'p' },
        });
        expect(next.npcs[0].portraitUrl).toBeUndefined();
        expect(next.npcs[0].portraitProvider).toBeUndefined();
        expect(next.npcs[0].portraitUpdatedAt).toBeUndefined();
    });
});
