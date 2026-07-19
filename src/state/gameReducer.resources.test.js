import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

function makeFighter(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Astra',
            race: 'human',
            class: 'fighter',
            level: 2,
            currentHP: 20,
            maxHP: 20,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            classResources: {
                secondWind: { used: 0, max: 1 },
                actionSurge: { used: 0, max: 1 },
            },
            hitDice: { total: 2, remaining: 2, die: 10 },
            conditions: [],
            ...overrides,
        },
        messages: [],
    };
}

describe('class resource activation', () => {
    it('marks Action Surge as pending until the next player action resolves', () => {
        const start = makeFighter();
        start.combat = {
            ...initialGameState.combat,
            active: true,
            phase: 'awaiting_player',
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 12 }],
            currentTurn: 0,
        };
        const surged = gameReducer(start, {
            type: 'ACTIVATE_RESOURCE',
            payload: 'actionSurge',
        });

        expect(surged.character.classResources.actionSurge.used).toBe(1);
        expect(surged.character.pendingActionSurge).toBe(true);
        expect(surged.messages.at(-1).content).toContain('Action Surge');

        expect(surged.character.pendingActionSurge).toBe(true);
    });

    it('does not activate Action Surge off-turn or outside combat', () => {
        const outside = gameReducer(makeFighter(), { type: 'ACTIVATE_RESOURCE', payload: 'actionSurge' });
        expect(outside.character.classResources.actionSurge.used).toBe(0);

        const opening = makeFighter();
        opening.combat = { ...initialGameState.combat, active: true, phase: 'opening' };
        const blocked = gameReducer(opening, { type: 'ACTIVATE_RESOURCE', payload: 'actionSurge' });
        expect(blocked.character.classResources.actionSurge.used).toBe(0);

        const awaitingIntent = makeFighter();
        awaitingIntent.combat = { ...initialGameState.combat, active: true, phase: 'awaiting_intent' };
        const locked = gameReducer(awaitingIntent, { type: 'ACTIVATE_RESOURCE', payload: 'actionSurge' });
        expect(locked.character.classResources.actionSurge.used).toBe(0);
    });

    it('blocks rests during combat so resources cannot recharge mid-fight', () => {
        const start = makeFighter({
            classResources: {
                secondWind: { used: 1, max: 1 },
                actionSurge: { used: 1, max: 1 },
            },
        });
        start.combat = { ...initialGameState.combat, active: true, phase: 'awaiting_player' };
        const rested = gameReducer(start, { type: 'TAKE_REST', payload: 'short' });
        expect(rested.character.classResources.actionSurge.used).toBe(1);
        expect(rested.messages.at(-1).content).toContain('cannot take');
    });

    it('clears pending Action Surge on rest', () => {
        const rested = gameReducer(makeFighter({
            pendingActionSurge: true,
            classResources: {
                secondWind: { used: 1, max: 1 },
                actionSurge: { used: 1, max: 1 },
            },
        }), {
            type: 'TAKE_REST',
            payload: 'short',
        });

        expect(rested.character.pendingActionSurge).toBe(false);
        expect(rested.character.classResources.actionSurge.used).toBe(0);
    });

    it('requests one fictional beat for a successful player-triggered rest', () => {
        const shortRest = gameReducer(makeFighter({ currentHP: 10 }), {
            type: 'TAKE_REST',
            payload: 'short',
            meta: { narrate: true },
        });
        const longRest = gameReducer(makeFighter({ currentHP: 10 }), {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { narrate: true },
        });

        expect(shortRest.messages.at(-1).narrationCue).toMatchObject({
            type: 'player_mechanic',
            mechanic: 'Short Rest',
            actionType: 'rest',
        });
        expect(longRest.messages.at(-1).narrationCue).toMatchObject({
            type: 'player_mechanic',
            mechanic: 'Long Rest',
            actionType: 'rest',
        });
    });

    it('does not duplicate narration for a rest already declared by the DM', () => {
        const rested = gameReducer(makeFighter({ currentHP: 10 }), {
            type: 'TAKE_REST',
            payload: 'long',
        });

        expect(rested.messages.at(-1)).not.toHaveProperty('narrationCue');
    });
});

describe('DM rest replay guard', () => {
    const filler = (n) => Array.from({ length: n }, (_, i) => ({
        id: `filler-${i}`,
        role: i % 2 ? 'assistant' : 'user',
        content: `turn ${i}`,
    }));

    it('applies the first DM-emitted rest and stamps the ledger', () => {
        const rested = gameReducer(makeFighter({ currentHP: 10 }), {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-1' },
        });

        expect(rested.character.currentHP).toBe(20);
        expect(rested.messages.at(-1).content).toContain('Long Rest');
        expect(rested.recentRests).toEqual(['msg-1|long|0']);
    });

    it('suppresses a re-emitted DM rest within the window — no banner, no re-heal', () => {
        const rested = gameReducer(makeFighter({ currentHP: 10 }), {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-1' },
        });
        // The hero takes damage and moves on; the DM echoes rest_taken turns later.
        const wounded = {
            ...rested,
            character: { ...rested.character, currentHP: 12 },
            messages: [...rested.messages, ...filler(4)],
        };
        const echoed = gameReducer(wounded, {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-2' },
        });

        expect(echoed.character.currentHP).toBe(12);
        expect(echoed.messages).toHaveLength(wounded.messages.length);
        // Re-stamped at the echo's index so a persistent echo stays suppressed.
        expect(echoed.recentRests.at(-1)).toBe(`msg-2|long|${wounded.messages.length - 1}`);
    });

    it('suppresses a DM echo of a Character Sheet button rest', () => {
        const rested = gameReducer(makeFighter({ currentHP: 10 }), {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { narrate: true },
        });
        const echoed = gameReducer(rested, {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-9' },
        });

        expect(echoed.messages).toHaveLength(rested.messages.length);
    });

    it('honors a nearby DM rest when the player explicitly rests again', () => {
        const rested = gameReducer(makeFighter({ currentHP: 10 }), {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-1' },
        });
        const wounded = { ...rested, character: { ...rested.character, currentHP: 5 } };
        const again = gameReducer(wounded, {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-2', playerMessage: 'We make camp and rest for the night again.' },
        });

        expect(again.character.currentHP).toBe(20);
        expect(again.messages.at(-1).content).toContain('Long Rest');
    });

    it('does not treat partitive "the rest of" as rest intent', () => {
        const rested = gameReducer(makeFighter({ currentHP: 10 }), {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-1' },
        });
        const echoed = gameReducer(rested, {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-2', playerMessage: 'I grab the rest of the coins and head out.' },
        });

        expect(echoed.messages).toHaveLength(rested.messages.length);
    });

    it('always suppresses an exact same-source replay, even with rest intent', () => {
        const rested = gameReducer(makeFighter({ currentHP: 10 }), {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-1', playerMessage: 'We rest.' },
        });
        const replayed = gameReducer(rested, {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-1', playerMessage: 'We rest.' },
        });

        expect(replayed.messages).toHaveLength(rested.messages.length);
    });

    it('applies a DM rest again once the replay window has passed', () => {
        const rested = gameReducer(makeFighter({ currentHP: 10 }), {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-1' },
        });
        const later = {
            ...rested,
            character: { ...rested.character, currentHP: 8 },
            messages: [...rested.messages, ...filler(12)],
        };
        const secondRest = gameReducer(later, {
            type: 'TAKE_REST',
            payload: 'long',
            meta: { source: 'dm', sourceId: 'msg-2' },
        });

        expect(secondRest.character.currentHP).toBe(20);
        expect(secondRest.messages.at(-1).content).toContain('Long Rest');
    });

    it('never suppresses deliberate Character Sheet button rests', () => {
        const first = gameReducer(makeFighter({ currentHP: 10 }), {
            type: 'TAKE_REST',
            payload: 'short',
            meta: { narrate: true },
        });
        const second = gameReducer(first, {
            type: 'TAKE_REST',
            payload: 'short',
            meta: { narrate: true },
        });

        expect(second.messages).toHaveLength(first.messages.length + 1);
    });
});

describe('rest and resource mechanics', () => {
    it('Second Wind clears low-level defeat when it restores HP', () => {
        const next = gameReducer(makeFighter({
            level: 1,
            currentHP: 0,
            maxHP: 12,
            lowLevelDefeat: true,
            conditions: ['Unconscious'],
            deathSaves: { successes: 0, failures: 0 },
            classResources: {
                secondWind: { used: 0, max: 1 },
            },
        }), {
            type: 'ACTIVATE_RESOURCE',
            payload: 'secondWind',
        });

        expect(next.character.currentHP).toBeGreaterThan(0);
        expect(next.character.lowLevelDefeat).toBe(false);
        expect(next.character.conditions).not.toContain('Unconscious');
        expect(next.character.deathSaves).toEqual({ successes: 0, failures: 0 });
        expect(next.character.classResources.secondWind.used).toBe(1);
    });

    it('Second Wind spends the combat bonus action without ending the main action', () => {
        const start = makeFighter({
            currentHP: 10,
            classResources: {
                secondWind: { used: 0, max: 2 },
                actionSurge: { used: 0, max: 1 },
            },
        });
        start.combat = {
            active: true,
            enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, condition: 'healthy' }],
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 12 }],
            currentTurn: 0,
            round: 1,
            xpAwarded: false,
            bonusActionUsed: false,
        };

        const used = gameReducer(start, { type: 'ACTIVATE_RESOURCE', payload: 'secondWind' });
        const blocked = gameReducer(used, { type: 'ACTIVATE_RESOURCE', payload: 'secondWind' });
        const awaitingNarration = {
            ...used,
            combat: {
                ...used.combat,
                phase: 'awaiting_narration',
                lastExchangeResult: { exchangeId: 'exchange-reset', kind: 'exchange', terminal: null },
            },
        };
        const nextRound = gameReducer(awaitingNarration, {
            type: 'COMPLETE_COMBAT_NARRATION',
            payload: { exchangeId: 'exchange-reset' },
        });

        expect(used.combat.bonusActionUsed).toBe(true);
        expect(used.character.classResources.secondWind.used).toBe(1);
        expect(used.messages.at(-1).content).toContain('bonus action');
        expect(used.messages.at(-1).content).toContain('main action is still available');
        expect(used.messages.at(-1).narrationCue).toMatchObject({
            type: 'player_mechanic',
            mechanic: 'Second Wind',
            actionType: 'bonus action',
        });
        expect(blocked.character.classResources.secondWind.used).toBe(1);
        expect(blocked.messages.at(-1).content).toContain('Bonus action already used');
        expect(nextRound.combat.bonusActionUsed).toBe(false);
    });

    it('does not allow a bonus action resource outside the player combat turn', () => {
        const start = makeFighter({ currentHP: 10 });
        start.combat = {
            active: true,
            enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, condition: 'healthy' }],
            turnOrder: [
                { type: 'enemy', id: 'enemy-1', name: 'Goblin', initiative: 13 },
                { type: 'player', name: 'Astra', initiative: 12 },
            ],
            currentTurn: 0,
            round: 1,
            xpAwarded: false,
            bonusActionUsed: false,
        };

        const next = gameReducer(start, { type: 'ACTIVATE_RESOURCE', payload: 'secondWind' });

        expect(next.character.classResources.secondWind.used).toBe(0);
        expect(next.combat.bonusActionUsed).toBe(false);
        expect(next.messages.at(-1).content).toContain('use it on your turn');
    });

    it('short rest does not grant free healing when no hit dice remain', () => {
        const next = gameReducer(makeFighter({
            currentHP: 4,
            hitDice: { total: 2, remaining: 0, die: 10 },
        }), {
            type: 'TAKE_REST',
            payload: 'short',
        });

        expect(next.character.currentHP).toBe(4);
        expect(next.character.hitDice.remaining).toBe(0);
        expect(next.messages.at(-1).content).toContain('Recovered 0 HP');
    });

    it('short rest hit dice healing revives a dying character', () => {
        const next = gameReducer(makeFighter({
            level: 3,
            currentHP: 0,
            dying: true,
            conditions: ['Unconscious'],
            deathSaves: { successes: 1, failures: 1 },
            hitDice: { total: 3, remaining: 1, die: 10 },
        }), {
            type: 'TAKE_REST',
            payload: 'short',
        });

        expect(next.character.currentHP).toBeGreaterThan(0);
        expect(next.character.dying).toBe(false);
        expect(next.character.conditions).not.toContain('Unconscious');
        expect(next.character.deathSaves).toEqual({ successes: 0, failures: 0 });
        expect(next.character.hitDice.remaining).toBe(0);
    });

    it('long rest does not revive a dead character', () => {
        const start = makeFighter({
            currentHP: 0,
            isDead: true,
            classResources: {
                secondWind: { used: 1, max: 1 },
                actionSurge: { used: 1, max: 1 },
            },
        });

        const next = gameReducer(start, {
            type: 'TAKE_REST',
            payload: 'long',
        });

        expect(next.character.currentHP).toBe(0);
        expect(next.character.isDead).toBe(true);
        expect(next.character.classResources.secondWind.used).toBe(1);
        expect(next.messages.at(-1).content).toContain('dead cannot recover');
    });
});
