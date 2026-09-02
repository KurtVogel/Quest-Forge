import { describe, expect, it, vi, beforeEach } from 'vitest';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('../engine/dice.ts', () => {
    let id = 0;
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted — a test under-queued its rolls');
        return rollQueue.shift();
    };
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
        rollDice: (count) => Array.from({ length: count }, draw),
        rollWithModifier: (count, sides, modifier = 0, description = '') =>
            makeResult(Array.from({ length: count }, draw), modifier, description),
        rollNotation: (notation, description = '') => makeResult([draw()], 0, description || notation),
    };
});

const { gameReducer, initialGameState } = await import('./gameReducer.js');
const combatEngine = await import('../engine/combatExchange.js');

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

    it('whitelists combat_start enemy fields — unknown keys never enter combat state (2026-08-29 audit)', () => {
        rollQueue.push(4, 12, 9); // enemy, player, companion
        const next = gameReducer(makeState(), {
            type: 'START_COMBAT',
            payload: {
                enemies: [{
                    name: 'Goblin', hp: 7, ac: 13,
                    sneakyPayload: 'persisted-through-every-autosave',
                    __proto__pollution: true,
                }],
            },
        });
        const enemy = next.combat.enemies[0];
        expect(enemy.sneakyPayload).toBeUndefined();
        expect(enemy['__proto__pollution']).toBeUndefined();
        expect(enemy).toMatchObject({ name: 'Goblin', hp: 7, maxHp: 7, ac: 13, combatStatus: 'active' });
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
    // FINALIZE_VICTORY (a never-dispatched wrapper around END_COMBAT) was removed
    // in the 2026-07-31 dead-code sweep; these pin the same XP semantics through
    // the real END_COMBAT path the exchange machine and applyEvents actually use.
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

        const next = gameReducer(state, { type: 'END_COMBAT', payload: { autoVictory: true } });

        expect(next.combat.active).toBe(false);
        expect(next.character.exp).toBeGreaterThan(0);
        expect(next.messages.some(m => m.content.includes('Experience gained'))).toBe(true);
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
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { autoVictory: true } });
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

    it('emits one exchange-tagged system message per resolved event and stores no derived summary', () => {
        // Pins the exchange's message footprint (2026-08-03 P2): one message per
        // EVENT — an event text containing a newline stays a single chat message —
        // each tagged `exchangeLine` so the DM window can drop it, and the
        // persisted result carries events only (summary derives at read time).
        const events = [
            { type: 'note', text: 'Torvald gives up their attack to shield the hero —\nenemy attacks aimed at the hero strike Torvald instead.' },
            { type: 'note', text: 'Goblin defends and gives up its attack.' },
        ];
        const payload = {
            exchangeId: 'exchange-footprint',
            enemies: [{ id: 'e1', name: 'Goblin', hp: 7, maxHp: 7, ac: 12, condition: 'healthy', combatStatus: 'active' }],
            party: makeState().party,
            playerDamage: 0,
            deathSaveNatural: null,
            rolls: [],
            consumeActionSurge: false,
            result: { exchangeId: 'exchange-footprint', kind: 'exchange', round: 2, terminal: null, events },
        };
        const before = activeState();
        const committed = gameReducer(before, { type: 'APPLY_COMBAT_EXCHANGE', payload });
        const added = committed.messages.slice(before.messages.length);
        expect(added).toHaveLength(events.length);
        expect(added.every(m => m.role === 'system' && m.exchangeLine === true)).toBe(true);
        expect(added[0].content).toContain('\n');
        expect(committed.combat.lastExchangeResult).not.toHaveProperty('summary');
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

    it('is a no-op during OPENING and AWAITING_NARRATION — a stray reject must not abandon pending bookkeeping (2026-08-27 audit)', () => {
        for (const phase of ['opening', 'awaiting_narration']) {
            const base = lockedState();
            const state = { ...base, combat: { ...base.combat, phase } };
            const rejected = gameReducer(state, { type: 'REJECT_COMBAT_EXCHANGE', payload: { reason: 'stray' } });
            expect(rejected).toBe(state);
        }
    });
});

describe('bonus-action lane marks combat.bonusActionUsed (2026-08-27 audit P1)', () => {
    function readyState(combatOverrides = {}) {
        return {
            ...makeState(),
            combat: {
                ...initialGameState.combat,
                active: true,
                phase: 'awaiting_player',
                round: 2,
                enemies: [{ id: 'e1', name: 'Goblin', hp: 7, maxHp: 7, ac: 12, condition: 'healthy', combatStatus: 'active' }],
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 12 }],
                currentTurn: 0,
                ...combatOverrides,
            },
        };
    }
    const payloadFor = (extra = {}) => ({
        exchangeId: 'exchange-bw',
        enemies: readyState().combat.enemies,
        party: [],
        playerDamage: 0,
        rolls: [],
        consumeActionSurge: false,
        result: { exchangeId: 'exchange-bw', kind: 'exchange', terminal: null, summary: 'Second Wind.' },
        ...extra,
    });

    it('an exchange that spent the bonus action locks the flag until the round ends', () => {
        const committed = gameReducer(readyState(), {
            type: 'APPLY_COMBAT_EXCHANGE',
            payload: payloadFor({ bonusActionUsed: true }),
        });
        expect(committed.combat.bonusActionUsed).toBe(true);
        // COMPLETE_COMBAT_NARRATION resets the flag for the next round.
        const narrated = gameReducer(committed, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'exchange-bw' } });
        expect(narrated.combat.bonusActionUsed).toBe(false);
    });

    it('a plain exchange never clears a potion-set flag mid-round', () => {
        const committed = gameReducer(readyState({ bonusActionUsed: true }), {
            type: 'APPLY_COMBAT_EXCHANGE',
            payload: payloadFor(),
        });
        expect(committed.combat.bonusActionUsed).toBe(true);
    });
});

describe('END_COMBAT client-side XP fallback', () => {
    function endCombatState(enemies, combatOverrides = {}) {
        const base = makeState();
        return {
            ...base,
            character: { ...base.character, exp: 0 },
            combat: {
                ...initialGameState.combat,
                active: true,
                enemies,
                xpAwarded: false,
                ...combatOverrides,
            },
        };
    }

    it('awards estimated XP for overcome foes when the DM never did', () => {
        const state = endCombatState([
            { id: 'e1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' },       // 7*2+13*3 = 53
            { id: 'e2', name: 'Bandit', hp: 5, maxHp: 10, ac: 12, combatStatus: 'fled' },   // 10*2+12*3 = 56
        ]);
        const next = gameReducer(state, { type: 'END_COMBAT', payload: {} });

        expect(next.combat.active).toBe(false);
        expect(next.character.exp).toBe(109);
        const xpMessage = next.messages.at(-1).content;
        expect(xpMessage).toContain('+109 XP');
        expect(xpMessage).toContain('battle complete: Goblin, Bandit');
    });

    it('excludes enemies still standing from the fallback award', () => {
        const state = endCombatState([
            { id: 'e1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' },
            { id: 'e2', name: 'Ogre', hp: 30, maxHp: 30, ac: 13 }, // still active
        ]);
        const next = gameReducer(state, { type: 'END_COMBAT', payload: {} });

        expect(next.character.exp).toBe(53);
        expect(next.messages.at(-1).content).toContain('battle complete: Goblin');
    });

    it('pays only genuinely slain foes on a loss (slainXpOnly), never fled or surrendered ones', () => {
        const state = endCombatState([
            { id: 'e1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' },       // slain: pays
            { id: 'e2', name: 'Bandit', hp: 5, maxHp: 10, ac: 12, combatStatus: 'fled' },   // fled on a loss: no XP
            { id: 'e3', name: 'Thug', hp: 8, maxHp: 8, ac: 11, combatStatus: 'surrendered' },
        ]);
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { defeat: true, slainXpOnly: true } });

        expect(next.character.exp).toBe(53);
        expect(next.messages.at(-1).content).toContain('foes slain before the fight ended: Goblin');
    });

    it('pays boss-tier XP for a killed floor-qualifying boss and ordinary XP for a fled one', () => {
        const base = endCombatState([
            { id: 'e1', name: 'Kroll the Butcher', hp: 0, maxHp: 200, ac: 20, condition: 'dead', boss: true },
        ]);
        const state = { ...base, character: { ...base.character, level: 5 } };
        const next = gameReducer(state, { type: 'END_COMBAT', payload: {} });
        // raw = 200*2 + 20*3 = 460 → boss pays min(920, quest tier 938) = 920 at L5.
        expect(next.character.exp).toBe(920);

        const fledBase = endCombatState([
            { id: 'e1', name: 'Kroll the Butcher', hp: 120, maxHp: 200, ac: 20, combatStatus: 'fled', boss: true },
        ]);
        const fledState = { ...fledBase, character: { ...fledBase.character, level: 5 } };
        const fledNext = gameReducer(fledState, { type: 'END_COMBAT', payload: {} });
        expect(fledNext.character.exp).toBe(300); // ordinary flee-XP, no elevated tier
    });

    it('ignores a boss flag on a below-floor mook (untrusted input)', () => {
        const state = endCombatState([
            { id: 'e1', name: 'Goblin "Boss"', hp: 0, maxHp: 7, ac: 13, condition: 'dead', boss: true },
        ]);
        const next = gameReducer(state, { type: 'END_COMBAT', payload: {} });
        expect(next.character.exp).toBe(53); // plain 7*2 + 13*3
    });

    it('stays silent when the DM already awarded XP this turn (llmAwardedXp)', () => {
        const state = endCombatState([
            { id: 'e1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' },
        ]);
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { llmAwardedXp: true } });

        expect(next.character.exp).toBe(0);
        expect(next.messages.some(m => (m.content || '').includes('XP'))).toBe(false);
    });

    it('stays silent when XP was already earned earlier in the fight (combat.xpAwarded)', () => {
        const state = endCombatState(
            [{ id: 'e1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' }],
            { xpAwarded: true },
        );
        const next = gameReducer(state, { type: 'END_COMBAT', payload: {} });

        expect(next.character.exp).toBe(0);
        expect(next.messages.some(m => (m.content || '').includes('XP'))).toBe(false);
    });

    it('awards nothing when every foe escaped a lost fight', () => {
        const state = endCombatState([
            { id: 'e1', name: 'Bandit', hp: 5, maxHp: 10, ac: 12, combatStatus: 'fled' },
        ]);
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { escaped: true, slainXpOnly: true } });

        expect(next.character.exp).toBe(0);
        expect(next.combat.active).toBe(false);
    });
});

describe('death seam through the reducer: engine plan → APPLY_COMBAT_EXCHANGE agree (2026-09-02 audit P1/P2)', () => {
    const { planCombatExchange, normalizeCombatExchange } = combatEngine;

    function dyingState({ level = 1, party, enemies } = {}) {
        return {
            ...makeState(),
            character: {
                ...makeState().character,
                level,
                currentHP: 0,
                maxHP: 12,
                dying: true,
                isDead: false,
                deathSaves: { successes: 0, failures: 0 },
                conditions: ['Unconscious'],
            },
            party: party ?? [{ id: 'c1', name: 'Brann', hp: 0, maxHp: 8, ac: 12, status: 'downed' }],
            combat: {
                ...initialGameState.combat,
                active: true,
                phase: 'awaiting_player',
                round: 3,
                enemies: enemies ?? [{ id: 'e1', name: 'Goblin', hp: 7, maxHp: 7, ac: 12, attackBonus: 4, damage: '1d6+2', condition: 'healthy', combatStatus: 'active' }],
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 12 }],
                currentTurn: 0,
            },
        };
    }

    it('level-1 hero dying, only companion downed: the death save converts to a defeat setback and combat ends on its own', () => {
        const before = dyingState();
        const plan = planCombatExchange(before, normalizeCombatExchange({
            player_slots: [{ action: 'death_save' }],
            enemy_intents: [{ enemy_id: 'e1', action: 'defend' }],
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.result.terminal).toBe('defeat');

        const committed = gameReducer(before, { type: 'APPLY_COMBAT_EXCHANGE', payload: plan.payload });
        expect(committed.character).toMatchObject({ lowLevelDefeat: true, dying: false, isDead: false, currentHP: 0 });
        expect(committed.character.deathSaves).toEqual({ successes: 0, failures: 0 });
        expect(committed.messages.some(m => m.content.includes('Death save skipped'))).toBe(true);
        expect(committed.combat.phase).toBe('awaiting_narration');

        const ended = gameReducer(committed, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: plan.payload.exchangeId } });
        expect(ended.combat.active).toBe(false);
        expect(ended.character).toMatchObject({ lowLevelDefeat: true, dying: false, isDead: false });
    });

    it('a manual End Combat from a lowLevelDefeat hero mid-fight closes the fight without touching the setback', () => {
        const stuck = {
            ...dyingState(),
            character: { ...dyingState().character, dying: false, lowLevelDefeat: true },
        };
        const ended = gameReducer(stuck, { type: 'END_COMBAT', payload: {} });
        expect(ended.combat.active).toBe(false);
        expect(ended.character).toMatchObject({ lowLevelDefeat: true, dying: false, isDead: false, currentHP: 0 });
    });

    it('DEATH_SAVE_RESULT with no die is a no-op outside the low-level-solo conversion (never a phantom failure)', () => {
        const leveled = dyingState({ level: 3 });
        const next = gameReducer(leveled, { type: 'DEATH_SAVE_RESULT', payload: { die: null } });
        expect(next).toBe(leveled);
    });

    it('natural 20 then a hitting foe: the reducer revives at 1 HP and the same-exchange hit drops the hero back to dying', () => {
        const before = dyingState({ level: 3 });
        // This file's dice mock exports no parseNotation, so the damage kernel
        // falls back to a flat 1d4: damage = the drawn value.
        rollQueue.push(
            20, // death save
            19, // goblin attack: 19 + 4 vs AC 12
            3,  // damage
        );
        const plan = planCombatExchange(before, normalizeCombatExchange({
            player_slots: [{ action: 'death_save' }],
            enemy_intents: [{ enemy_id: 'e1', action: 'attack', target: 'player' }],
        }));
        expect(plan.payload).toMatchObject({ deathSaveNatural: 20, playerDamage: 3 });
        expect(plan.payload.result.terminal).toBe('dying');

        const committed = gameReducer(before, { type: 'APPLY_COMBAT_EXCHANGE', payload: plan.payload });
        expect(committed.character).toMatchObject({ currentHP: 0, dying: true, isDead: false, lowLevelDefeat: false });
        expect(committed.character.deathSaves).toEqual({ successes: 0, failures: 0 });
        expect(committed.messages.some(m => m.content.includes('falls!'))).toBe(true);
    });

    it('hero and only companion both dropping in one exchange: engine terminal and reducer state both say defeat setback', () => {
        const before = {
            ...dyingState({
                party: [{ id: 'c1', name: 'Brann', hp: 4, maxHp: 8, ac: 12, status: 'healthy' }],
                enemies: [
                    { id: 'e1', name: 'Goblin', hp: 7, maxHp: 7, ac: 12, attackBonus: 4, damage: '1d6+2', condition: 'healthy', combatStatus: 'active' },
                    { id: 'e2', name: 'Wolf', hp: 9, maxHp: 9, ac: 12, attackBonus: 4, damage: '1d6+2', condition: 'healthy', combatStatus: 'active' },
                ],
            }),
        };
        before.character = { ...before.character, currentHP: 3, dying: false, conditions: [] };
        rollQueue.push(
            19, 4, // goblin hits Astra for 4 (flat 1d4 fallback, see above): 3 → 0
            19, 4, // wolf hits Brann for 4: 4 → 0 (downed)
        );
        const plan = planCombatExchange(before, normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            companion_intents: [{ companion_id: 'c1', action: 'pass' }],
            enemy_intents: [
                { enemy_id: 'e1', action: 'attack', target: 'player' },
                { enemy_id: 'e2', action: 'attack', target: 'c1' },
            ],
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.party[0].status).toBe('downed');
        expect(plan.payload.result.terminal).toBe('defeat');

        const committed = gameReducer(before, { type: 'APPLY_COMBAT_EXCHANGE', payload: plan.payload });
        expect(committed.character).toMatchObject({ currentHP: 0, lowLevelDefeat: true, dying: false, isDead: false });
        expect(committed.party[0].status).toBe('downed');
    });
});
