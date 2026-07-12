import { describe, expect, it, vi, beforeEach } from 'vitest';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('../engine/dice.ts', () => {
    let id = 0;
    const draw = () => (rollQueue.length ? rollQueue.shift() : 10);
    const makeResult = (rolls, modifier, description) => {
        const subtotal = rolls.reduce((sum, roll) => sum + roll, 0);
        return {
            id: `initiative-test-${++id}`,
            timestamp: 0,
            notation: '1d20',
            dice: { count: rolls.length, sides: 20 },
            rolls,
            subtotal,
            modifier,
            total: subtotal + modifier,
            description,
            isCritical: rolls.length === 1 && rolls[0] === 20,
            isCritFail: rolls.length === 1 && rolls[0] === 1,
        };
    };
    return {
        rollDie: () => draw(),
        rollWithModifier: (count, sides, modifier = 0, description = '') =>
            makeResult(Array.from({ length: count }, draw), modifier, description),
        rollNotation: (notation, description = '') => makeResult([draw()], 0, description || notation),
    };
});

const { gameReducer, initialGameState } = await import('./gameReducer.js');

function makeState() {
    return {
        ...initialGameState,
        character: {
            name: 'Astra',
            race: 'human',
            class: 'fighter',
            level: 1,
            currentHP: 12,
            maxHP: 12,
            abilityScores: {
                strength: 16,
                dexterity: 14,
                constitution: 14,
                intelligence: 10,
                wisdom: 10,
                charisma: 8,
            },
            conditions: [],
        },
        party: [{ id: 'companion-1', name: 'Garrick', hp: 10, maxHp: 10, status: 'healthy' }],
        messages: [],
        rollHistory: [],
    };
}

beforeEach(() => {
    rollQueue.length = 0;
});

describe('combat start initiative', () => {
    it('rolls player, companion, and enemy initiative in the engine instead of trusting DM values', () => {
        rollQueue.push(
            4,  // enemy initiative, despite DM sending 99
            12, // player initiative d20 + DEX 2 = 14
            9   // companion initiative
        );

        const next = gameReducer(makeState(), {
            type: 'START_COMBAT',
            payload: {
                playerInitiative: 1,
                enemies: [{ name: 'Goblin', hp: 7, ac: 13, initiative: 99 }],
            },
        });

        expect(next.combat.active).toBe(true);
        expect(next.combat.enemies[0]).toMatchObject({ name: 'Goblin', initiative: 4 });
        expect(next.combat.turnOrder.map(t => `${t.type}:${t.initiative}`)).toEqual([
            'player:14',
            'companion:9',
            'enemy:4',
        ]);
        expect(next.rollHistory[0]).toMatchObject({ description: 'Initiative', total: 14 });
        expect(next.messages.at(-1).content).toContain('Initiative');
        expect(next.combat.phase).toBe('awaiting_player');
    });

    it('creates one Opening Initiative slot for actors who beat the player and queues the initiating action', () => {
        rollQueue.push(18, 10, 9); // enemy, player +2 = 12, companion
        const queuedExchange = {
            playerSlots: [{ action: 'dodge', id: 'player-slot-1', description: '' }],
            enemyIntents: [],
            companionIntents: [],
        };
        const next = gameReducer(makeState(), {
            type: 'START_COMBAT',
            payload: {
                enemies: [{ name: 'Goblin', hp: 7, ac: 13 }],
                queuedExchange,
            },
        });
        expect(next.combat.phase).toBe('opening');
        expect(next.combat.openingActorIds).toEqual([next.combat.enemies[0].id]);
        expect(next.combat.queuedExchange).toMatchObject({ playerSlots: [{ action: 'dodge' }] });
        expect(next.combat.turnOrder[next.combat.currentTurn].type).toBe('enemy');
    });

    it('reconciles a queued starting attack with the canonical enemy id', () => {
        rollQueue.push(4, 12, 9); // enemy, player +2, companion
        const next = gameReducer(makeState(), {
            type: 'START_COMBAT',
            payload: {
                enemies: [{ name: 'Goblin Duelist', hp: 15, ac: 13 }],
                queuedExchange: {
                    playerSlots: [{ action: 'attack', strikes: [{ target: 'goblin-duelist' }] }],
                    enemyIntents: [{ enemyId: 'goblin-duelist', action: 'attack', target: 'player' }],
                    companionIntents: [],
                },
            },
        });
        const enemyId = next.combat.enemies[0].id;
        expect(enemyId).toBe('enemy-goblin-duelist');
        expect(next.combat.queuedExchange.playerSlots[0].strikes[0].target).toBe(enemyId);
        expect(next.combat.queuedExchange.enemyIntents[0].enemyId).toBe(enemyId);
    });

    it('uses declared surprise only to adjust Opening Initiative slots', () => {
        rollQueue.push(18, 10, 9); // enemy beats player
        const enemiesSurprised = gameReducer(makeState(), {
            type: 'START_COMBAT',
            payload: { surprise: 'enemies', enemies: [{ name: 'Goblin', hp: 7, ac: 13 }] },
        });
        expect(enemiesSurprised.combat.openingActorIds).toEqual([]);
        expect(enemiesSurprised.combat.phase).toBe('awaiting_player');

        rollQueue.push(4, 20, 9); // enemy loses initiative, but surprised player grants its opening
        const playerSurprised = gameReducer(makeState(), {
            type: 'START_COMBAT',
            payload: { surprise: 'player', enemies: [{ name: 'Goblin', hp: 7, ac: 13 }] },
        });
        expect(playerSurprised.combat.openingActorIds).toEqual([playerSurprised.combat.enemies[0].id]);
        expect(playerSurprised.combat.phase).toBe('opening');
    });
});

describe('combat victory finalization', () => {
    it('ends combat and awards fallback XP when all enemies are defeated', () => {
        const state = {
            ...makeState(),
            combat: {
                active: true,
                enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' }],
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 14 }],
                currentTurn: 0,
                round: 2,
                xpAwarded: false,
            },
        };

        const next = gameReducer(state, { type: 'FINALIZE_VICTORY' });

        expect(next.combat.active).toBe(false);
        expect(next.character.exp).toBeGreaterThan(0);
        expect(next.messages.some(m => m.content.includes('Experience gained'))).toBe(true);
    });

    it('does not end combat while any enemy is still alive', () => {
        const state = {
            ...makeState(),
            combat: {
                active: true,
                enemies: [
                    { id: 'enemy-1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' },
                    { id: 'enemy-2', name: 'Guard', hp: 5, maxHp: 11, ac: 14, condition: 'bloodied' },
                ],
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 14 }],
                currentTurn: 0,
                round: 2,
                xpAwarded: false,
            },
        };

        const next = gameReducer(state, { type: 'FINALIZE_VICTORY' });

        expect(next).toBe(state);
    });

    it('awards victory XP when a foe flees instead of incentivizing execution', () => {
        const state = {
            ...makeState(),
            combat: {
                ...initialGameState.combat,
                active: true,
                enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, condition: 'healthy', combatStatus: 'fled' }],
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 14 }],
            },
        };
        const next = gameReducer(state, { type: 'FINALIZE_VICTORY' });
        expect(next.combat.active).toBe(false);
        expect(next.character.exp).toBeGreaterThan(0);
    });
});

describe('lost/escaped-fight XP for genuinely slain foes', () => {
    function makeTerminalState(terminal, enemies) {
        const base = makeState();
        return {
            ...base,
            character: { ...base.character, exp: 0 },
            combat: {
                ...initialGameState.combat,
                active: true,
                enemies,
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 14 }],
                phase: 'awaiting_narration',
                xpAwarded: false,
                lastExchangeResult: { exchangeId: 'ex-1', kind: 'exchange', terminal },
            },
        };
    }

    it('awards XP on defeat for enemies slain before the player fell — and only those', () => {
        const state = makeTerminalState('defeat', [
            { id: 'enemy-1', name: 'Bruiser', hp: 0, maxHp: 20, ac: 13, condition: 'dead' },
            { id: 'enemy-2', name: 'Dockhand', hp: 9, maxHp: 9, ac: 12, condition: 'healthy' },
        ]);
        const next = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'ex-1' } });
        expect(next.combat.active).toBe(false);
        expect(next.character.exp).toBeGreaterThan(0);
        const xpMessage = next.messages.find(m => m.content.includes('foes slain before the fight ended'));
        expect(xpMessage.content).toContain('Bruiser');
        expect(xpMessage.content).not.toContain('Dockhand');
    });

    it('awards no XP on defeat when the overcome foes only fled or surrendered', () => {
        const state = makeTerminalState('defeat', [
            { id: 'enemy-1', name: 'Cutpurse', hp: 6, maxHp: 6, ac: 12, condition: 'healthy', combatStatus: 'fled' },
            { id: 'enemy-2', name: 'Enforcer', hp: 14, maxHp: 14, ac: 13, condition: 'healthy' },
        ]);
        const next = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'ex-1' } });
        expect(next.combat.active).toBe(false);
        expect(next.character.exp).toBe(0);
    });

    it('awards XP for a slain foe when the player escapes the rest of the fight', () => {
        const state = makeTerminalState('escaped', [
            { id: 'enemy-1', name: 'Watchdog', hp: 0, maxHp: 8, ac: 12, condition: 'dead' },
            { id: 'enemy-2', name: 'Handler', hp: 11, maxHp: 11, ac: 13, condition: 'healthy' },
        ]);
        const next = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'ex-1' } });
        expect(next.combat.active).toBe(false);
        expect(next.character.exp).toBeGreaterThan(0);
    });

    it('does not double-award on defeat when XP was already earned during the fight', () => {
        const state = makeTerminalState('defeat', [
            { id: 'enemy-1', name: 'Bruiser', hp: 0, maxHp: 20, ac: 13, condition: 'dead' },
        ]);
        state.combat.xpAwarded = true;
        const next = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'ex-1' } });
        expect(next.combat.active).toBe(false);
        expect(next.character.exp).toBe(0);
    });
});

describe('enemy-stat validation at every entry point', () => {
    it('clamps HP/AC and rejects absurd attack stats at START_COMBAT', () => {
        rollQueue.push(5, 10, 9); // enemy init, player init, companion init
        const next = gameReducer(makeState(), {
            type: 'START_COMBAT',
            payload: { enemies: [{ name: 'Brute', hp: 9999, ac: 999, attackBonus: 99, damage: '50d100' }] },
        });
        const e = next.combat.enemies[0];
        expect(e.hp).toBe(999);
        expect(e.ac).toBe(12);
        expect(e.attackBonus).toBeUndefined();
        expect(e.damage).toBeUndefined();
    });

    it('UPDATE_ENEMY only changes HP and ignores injected mechanical stats', () => {
        const state = {
            ...makeState(),
            combat: {
                active: true,
                enemies: [{ id: 'e1', name: 'Goblin', hp: 10, maxHp: 10, ac: 13, attackBonus: 4, damage: '1d6+2', condition: 'healthy' }],
                turnOrder: [],
                currentTurn: 0,
                round: 1,
            },
        };
        const next = gameReducer(state, {
            type: 'UPDATE_ENEMY',
            payload: { id: 'e1', hp: 4, attackBonus: 99, damage: '50d100', ac: 999, name: 'Hacked' },
        });
        const e = next.combat.enemies[0];
        expect(e.hp).toBe(4);
        expect(e.condition).toBe('bloodied');
        expect(e.attackBonus).toBe(4);
        expect(e.damage).toBe('1d6+2');
        expect(e.ac).toBe(13);
        expect(e.name).toBe('Goblin');
    });

    it('LOAD_GAME re-validates enemy stats from an untrusted save', () => {
        const next = gameReducer(makeState(), {
            type: 'LOAD_GAME',
            payload: {
                character: makeState().character,
                inventory: [],
                combat: {
                    active: true,
                    enemies: [{ id: 'e1', name: 'Brute', hp: 9999, maxHp: 9999, ac: 999, attackBonus: 99, damage: '50d100', condition: 'healthy' }],
                    turnOrder: [],
                    currentTurn: 0,
                    round: 1,
                },
            },
        });
        const e = next.combat.enemies[0];
        expect(e.hp).toBe(999);
        expect(e.ac).toBe(12);
        expect(e.attackBonus).toBeUndefined();
        expect(e.damage).toBeUndefined();
    });

    it('preserves a defeated enemy at zero HP and safely ignores malformed enemy collections', () => {
        const defeated = gameReducer(makeState(), {
            type: 'LOAD_GAME',
            payload: {
                character: makeState().character,
                combat: {
                    active: true,
                    enemies: [{ id: 'e1', name: 'Goblin', hp: 0, maxHp: 7, ac: 12, condition: 'healthy' }],
                },
            },
        });
        expect(defeated.combat.enemies[0]).toMatchObject({ hp: 0, maxHp: 7, condition: 'dead' });

        const malformed = gameReducer(makeState(), {
            type: 'LOAD_GAME',
            payload: { character: makeState().character, combat: { active: true, enemies: { nope: true } } },
        });
        expect(malformed.combat.enemies).toEqual([]);
    });

    it('clamps UPDATE_ENEMY HP to an integer between zero and max HP', () => {
        const base = {
            ...makeState(),
            combat: {
                ...initialGameState.combat,
                active: true,
                enemies: [{ id: 'e1', name: 'Goblin', hp: 5, maxHp: 10, ac: 12, condition: 'bloodied' }],
            },
        };
        const overhealed = gameReducer(base, { type: 'UPDATE_ENEMY', payload: { id: 'e1', hp: 999.8 } });
        expect(overhealed.combat.enemies[0]).toMatchObject({ hp: 10, condition: 'healthy' });
        const defeated = gameReducer(base, { type: 'UPDATE_ENEMY', payload: { id: 'e1', hp: -4 } });
        expect(defeated.combat.enemies[0]).toMatchObject({ hp: 0, condition: 'dead' });
    });
});

describe('atomic combat exchange lifecycle', () => {
    function activeState(overrides = {}) {
        return {
            ...makeState(),
            character: {
                ...makeState().character,
                pendingActionSurge: true,
                classResources: { actionSurge: { used: 1, max: 1 } },
            },
            combat: {
                ...initialGameState.combat,
                active: true,
                phase: 'awaiting_player',
                round: 2,
                enemies: [{ id: 'e1', name: 'Goblin', hp: 7, maxHp: 7, ac: 12, condition: 'healthy', combatStatus: 'active' }],
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 12 }],
                currentTurn: 0,
            },
            ...overrides,
        };
    }

    it('commits HP, rolls, phase, and Action Surge once by exchangeId', () => {
        const payload = {
            exchangeId: 'exchange-1',
            enemies: [{ id: 'e1', name: 'Goblin', hp: 4, maxHp: 7, ac: 12, condition: 'bloodied', combatStatus: 'active' }],
            party: makeState().party,
            playerDamage: 3,
            deathSaveNatural: null,
            rolls: [{ id: 'roll-1', total: 17 }],
            consumeActionSurge: true,
            result: { exchangeId: 'exchange-1', kind: 'exchange', round: 2, terminal: null, summary: '**Astra attacks Goblin** — Hit.' },
        };
        const committed = gameReducer(activeState(), { type: 'APPLY_COMBAT_EXCHANGE', payload });
        expect(committed.character.currentHP).toBe(9);
        expect(committed.character.pendingActionSurge).toBe(false);
        expect(committed.combat.phase).toBe('awaiting_narration');
        expect(committed.combat.enemies[0].hp).toBe(4);
        expect(committed.rollHistory).toHaveLength(1);

        const duplicate = gameReducer(committed, { type: 'APPLY_COMBAT_EXCHANGE', payload });
        expect(duplicate).toBe(committed);
        expect(duplicate.character.currentHP).toBe(9);
        expect(duplicate.rollHistory).toHaveLength(1);
    });

    it('renders the exchange roll summary before the falls/defeat status line it caused', () => {
        const payload = {
            exchangeId: 'exchange-fatal',
            enemies: [{ id: 'e1', name: 'Goblin', hp: 7, maxHp: 7, ac: 12, condition: 'healthy', combatStatus: 'active' }],
            party: makeState().party,
            playerDamage: 12, // drops the hero to 0 HP → "falls!" status line
            deathSaveNatural: null,
            rolls: [],
            consumeActionSurge: false,
            result: { exchangeId: 'exchange-fatal', kind: 'exchange', round: 2, terminal: 'dying', summary: '**Goblin attacks Astra** — Hit for 12 damage.' },
        };
        const committed = gameReducer(activeState(), { type: 'APPLY_COMBAT_EXCHANGE', payload });
        const contents = committed.messages.map(m => m.content);
        const rollIdx = contents.findIndex(c => c.includes('Goblin attacks Astra'));
        const statusIdx = contents.findIndex(c => c.includes('falls!'));
        expect(rollIdx).toBeGreaterThanOrEqual(0);
        expect(statusIdx).toBeGreaterThan(rollIdx);
    });

    it('locks an in-flight intent and safely unlocks it without committing mechanics', () => {
        const start = activeState();
        const locked = gameReducer(start, { type: 'BEGIN_COMBAT_INTENT' });
        expect(locked.combat.phase).toBe('awaiting_intent');
        expect(locked.character.currentHP).toBe(start.character.currentHP);
        const cancelled = gameReducer(locked, { type: 'CANCEL_COMBAT_INTENT' });
        expect(cancelled.combat.phase).toBe('awaiting_player');
        expect(cancelled.combat.round).toBe(start.combat.round);
    });

    it('advances the round only after matching narration and ignores duplicate acknowledgments', () => {
        const committed = {
            ...activeState(),
            combat: {
                ...activeState().combat,
                phase: 'awaiting_narration',
                lastExchangeResult: { exchangeId: 'exchange-2', kind: 'exchange', terminal: null },
            },
        };
        const wrong = gameReducer(committed, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'wrong' } });
        expect(wrong).toBe(committed);

        const complete = gameReducer(committed, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'exchange-2' } });
        expect(complete.combat.phase).toBe('awaiting_player');
        expect(complete.combat.round).toBe(3);
        const duplicate = gameReducer(complete, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'exchange-2' } });
        expect(duplicate).toBe(complete);
    });

    it('keeps a queued initiating action through Opening Initiative narration', () => {
        const queued = { playerSlots: [{ action: 'dodge' }], enemyIntents: [], companionIntents: [] };
        const opening = activeState({
            combat: {
                ...activeState().combat,
                phase: 'opening',
                queuedExchange: queued,
                openingActorIds: ['e1'],
            },
        });
        const committed = gameReducer(opening, {
            type: 'APPLY_COMBAT_EXCHANGE',
            payload: {
                exchangeId: 'opening-1', enemies: opening.combat.enemies, party: opening.party,
                playerDamage: 0, rolls: [], consumeActionSurge: false,
                result: { exchangeId: 'opening-1', kind: 'opening', terminal: null, summary: 'Goblin misses.' },
            },
        });
        expect(committed.combat.queuedExchange).toEqual(queued);
        const narrated = gameReducer(committed, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'opening-1' } });
        expect(narrated.combat.phase).toBe('awaiting_player');
        expect(narrated.combat.queuedExchange).toEqual(queued);
        expect(narrated.combat.round).toBe(2);
    });
});

describe('REJECT_COMBAT_EXCHANGE', () => {
    function lockedState() {
        return {
            ...makeState(),
            combat: {
                ...initialGameState.combat,
                active: true,
                phase: 'awaiting_intent',
                round: 1,
                enemies: [{ id: 'e1', name: 'Goblin', hp: 7, maxHp: 7, ac: 12, condition: 'healthy', combatStatus: 'active' }],
                turnOrder: [
                    { type: 'enemy', id: 'e1', initiative: 18 },
                    { type: 'player', name: 'Astra', initiative: 12 },
                ],
                currentTurn: 0,
                queuedExchange: { playerSlots: [{ action: 'attack' }] },
            },
        };
    }

    it('unlocks a bad exchange envelope back to awaiting_player and clears the queue', () => {
        const state = lockedState();
        const rejected = gameReducer(state, {
            type: 'REJECT_COMBAT_EXCHANGE',
            payload: { reason: 'Target no longer exists.' },
        });
        expect(rejected.combat.phase).toBe('awaiting_player');
        expect(rejected.combat.queuedExchange).toBeNull();
        expect(rejected.combat.currentTurn).toBe(1); // player's turnOrder index
        expect(rejected.messages.at(-1).content).toMatch(/Target no longer exists/);
    });

    it('falls back to a generic reason when none is provided', () => {
        const state = lockedState();
        const rejected = gameReducer(state, { type: 'REJECT_COMBAT_EXCHANGE', payload: {} });
        expect(rejected.messages.at(-1).content).toMatch(/action envelope was invalid/);
    });

    it('is a no-op when combat is not active', () => {
        const state = { ...makeState(), combat: { ...initialGameState.combat, active: false } };
        const rejected = gameReducer(state, { type: 'REJECT_COMBAT_EXCHANGE', payload: {} });
        expect(rejected).toBe(state);
    });
});
