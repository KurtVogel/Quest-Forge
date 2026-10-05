/**
 * Tests for roll resolution with deterministic dice — death save thresholds,
 * saving-throw proficiency wiring, and automatic condition advantage/disadvantage.
 * The dice module is mocked with a queue so outcomes are scripted, not random.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRequestedRolls, resolveRolls, formatRollSummary } from './rollResolver.js';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('./dice.ts', () => {
    let id = 0;
    const makeResult = (rolls, modifier, description) => {
        const subtotal = rolls.reduce((a, b) => a + b, 0);
        return {
            id: `test-roll-${++id}`,
            timestamp: 0,
            notation: '',
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
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted — a test under-queued its rolls');
        return rollQueue.shift();
    };
    const parseNotation = (notation) => {
        const m = String(notation).replace(/\s+/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/i);
        if (!m) throw new Error(`Invalid dice notation: "${notation}"`);
        return { count: parseInt(m[1], 10), sides: parseInt(m[2], 10), modifier: m[3] ? parseInt(m[3], 10) : 0 };
    };
    return {
        rollWithModifier: (count, sides, modifier = 0, description = '') =>
            makeResult(Array.from({ length: count }, draw), modifier, description),
        rollNotation: (notation, description = '') => {
            const { count, modifier } = parseNotation(notation);
            return makeResult(Array.from({ length: count }, draw), modifier, description);
        },
        parseNotation,
        rollDie: () => draw(),
        rollDice: (count) => Array.from({ length: count }, draw),
    };
});

function makeCharacter(overrides = {}) {
    return {
        name: 'Testo',
        class: 'fighter',
        level: 2,
        currentHP: 12,
        maxHP: 20,
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
        savingThrowProficiencies: ['strength', 'constitution'],
        skillProficiencies: [],
        conditions: [],
        ...overrides,
    };
}

function run(rolls, characterOverrides = {}) {
    const dispatch = vi.fn();
    const character = makeCharacter(characterOverrides);
    const { results } = resolveRolls(rolls, { character, inventory: [], party: [], dispatch });
    return { results, dispatch, character };
}

function runWithContext(rolls, ctx = {}) {
    const dispatch = vi.fn();
    const character = makeCharacter(ctx.character || {});
    const { results } = resolveRolls(rolls, {
        character,
        inventory: ctx.inventory || [],
        party: ctx.party || [],
        dispatch,
    });
    return { results, dispatch, character };
}

const messagesFrom = (dispatch) => dispatch.mock.calls
    .filter(([a]) => a.type === 'ADD_MESSAGE')
    .map(([a]) => a.payload.content)
    .join('\n');

beforeEach(() => { rollQueue.length = 0; });

describe('active-combat legacy-batch rejection (repair layer removed 2026-07-23)', () => {
    const combat = {
        active: true,
        currentTurn: 0,
        turnOrder: [{ id: 'player', type: 'player', name: 'Testo', initiative: 18 }],
        enemies: [
            { id: 'chief', name: 'Chief Kraul', hp: 23, maxHp: 28, ac: 14, condition: 'healthy' },
        ],
    };

    it('rejects any legacy batch during active combat without rolling or dispatching', async () => {
        const dispatch = vi.fn();
        const sendToLLM = vi.fn().mockResolvedValue({ requestedRolls: [] });

        const outcome = await handleRequestedRolls(
            [
                { type: 'attack_roll', skill: null, target: null, description: 'Sword strike' },
                { type: 'npc_attack', attackerId: 'chief', attacker: 'Chief Kraul', target: 'player' },
            ],
            {
                getState: () => ({ character: makeCharacter(), inventory: [], combat, party: [] }),
                dispatch,
                sendToLLM,
                playerAction: 'I attack it again',
            }
        );

        expect(outcome).toBeUndefined();
        expect(dispatch).not.toHaveBeenCalled();
        expect(sendToLLM).not.toHaveBeenCalled();
    });
});

describe('active-combat isolation from the legacy roll resolver', () => {
    const playerTurnCombat = (enemies) => ({
        active: true,
        round: 1,
        currentTurn: 0,
        turnOrder: [{ id: 'player', type: 'player', name: 'Testo', initiative: 18 }],
        enemies,
    });

    it('rejects all legacy requested_rolls during active combat', async () => {
        const dispatch = vi.fn();
        const sendToLLM = vi.fn();
        const combat = playerTurnCombat([
            { id: 'gob', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, attackBonus: 4, damage: '1d6+2', condition: 'healthy' },
        ]);
        const outcome = await handleRequestedRolls(
            [
                { type: 'attack_roll', skill: 'attack', target: 'gob', dc: 13 },
                { type: 'npc_attack', attackerId: 'gob', target: 'player', modifier: 99, damage: '50d100' },
            ],
            {
                getState: () => ({ character: makeCharacter(), inventory: [], combat, party: [] }),
                dispatch,
                sendToLLM,
                playerAction: 'I attack the goblin',
            }
        );
        expect(outcome).toBeUndefined();
        expect(sendToLLM).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('an out-of-combat attack is a to-hit against the stated DC (2026-10-05)', () => {
    // combat.enemies is empty outside a fight and the resolver refuses a live
    // one, so no roll here ever has a tracked enemy: the "live enemy AC" /
    // inline-damage / UPDATE_ENEMY half was unreachable and is gone.
    it('resolves against roll.dc and rolls no damage, whatever target or notation the wire names', () => {
        rollQueue.push(12); // ONE die: 12 + 5 = 17 vs DC 15. A damage die would throw (queue exhausted).
        const inventory = [{ type: 'weapon', category: 'martialMelee', name: 'Longsword', damage: '1d8', equipped: true }];
        const { results, dispatch } = runWithContext(
            [{ type: 'attack_roll', skill: 'attack', target: 'gob', damage: '1d8+3', dc: 15, description: 'Smash the door' }],
            { inventory },
        );
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ type: 'attack_roll', dc: 15, rolled: 17, success: true });
        expect(results[0].damage).toBeUndefined();
        expect(dispatch.mock.calls.map(([a]) => a.type)).toEqual(['ADD_ROLL', 'ADD_MESSAGE']);
        expect(formatRollSummary(results)).toBe('[ROLL RESULT: Smash the door, vs AC 15, rolled 17 — HIT]');
    });
});

describe('death saves', () => {
    // Level 5: a dying L1-2 hero with no standing companion is low-level solo and
    // never rolls (the reducer converts the save into a setback — see the
    // low-level-solo describe below); real death saves need a hero past that band.
    const dyingChar = { level: 5, currentHP: 0, dying: true, deathSaves: { successes: 0, failures: 0 }, conditions: ['Unconscious'] };

    it('10+ is a success and dispatches DEATH_SAVE_RESULT', () => {
        rollQueue.push(15);
        const { results, dispatch } = run([{ type: 'death_save' }], dyingChar);
        expect(results[0]).toMatchObject({ type: 'death_save', rolled: 15, outcome: 'success', successes: 1 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'DEATH_SAVE_RESULT', payload: { die: 15 } });
    });

    it('posts THE shared death-save line — the count on the page (WOW 2026-09-30)', () => {
        const lineOf = dispatch => dispatch.mock.calls.map(([a]) => a).find(a => a.type === 'ADD_MESSAGE' && String(a.payload?.content).startsWith('**Death Saving Throw:**'));
        rollQueue.push(4);
        const failed = run([{ type: 'death_save' }], { ...dyingChar, name: 'Astra', deathSaves: { successes: 0, failures: 1 } });
        expect(lineOf(failed.dispatch).payload).toMatchObject({ role: 'system', content: '**Death Saving Throw:** natural **4** — failure (2/3). One more and Astra dies.' });
        expect(lineOf(failed.dispatch).payload).not.toHaveProperty('isDeathEvent');
        rollQueue.push(13);
        const succeeded = run([{ type: 'death_save' }], { ...dyingChar, name: 'Astra' });
        expect(lineOf(succeeded.dispatch).payload.content).toBe('**Death Saving Throw:** natural **13** — success (1/3). Two more and Astra is stable.');
        rollQueue.push(1);
        const died = run([{ type: 'death_save' }], { ...dyingChar, name: 'Astra', deathSaves: { successes: 1, failures: 1 } });
        expect(lineOf(died.dispatch).payload).toMatchObject({ content: '**Death Saving Throw:** natural **1** — THE THIRD FAILURE. Astra dies.' });
        expect(formatRollSummary(died.results)).toContain('THE PLAYER CHARACTER IS DEAD');
    });

    it('below 10 is a failure; natural 1 counts twice', () => {
        rollQueue.push(7);
        expect(run([{ type: 'death_save' }], dyingChar).results[0]).toMatchObject({ outcome: 'failure', failures: 1 });
        rollQueue.push(1);
        expect(run([{ type: 'death_save' }], dyingChar).results[0]).toMatchObject({ outcome: 'failure', failures: 2 });
    });

    it('natural 20 revives', () => {
        rollQueue.push(20);
        expect(run([{ type: 'death_save' }], dyingChar).results[0].outcome).toBe('revived');
    });

    it('third success stabilizes, third failure kills', () => {
        rollQueue.push(11);
        expect(run([{ type: 'death_save' }], { ...dyingChar, deathSaves: { successes: 2, failures: 0 } }).results[0].outcome).toBe('stable');
        rollQueue.push(2);
        expect(run([{ type: 'death_save' }], { ...dyingChar, deathSaves: { successes: 0, failures: 2 } }).results[0].outcome).toBe('dead');
    });

    it('does not roll death saves for protected low-level defeat', () => {
        rollQueue.push(1);
        const { results, dispatch } = run(
            [{ type: 'death_save' }],
            { currentHP: 0, dying: false, lowLevelDefeat: true, conditions: ['Unconscious'] }
        );
        expect(results[0]).toMatchObject({
            type: 'note',
            text: expect.stringContaining('No death saving throw is rolled'),
        });
        expect(dispatch).not.toHaveBeenCalledWith({ type: 'DEATH_SAVE_RESULT', payload: { die: 1 } });
    });
});

describe('saving throws', () => {
    it('applies save proficiency (CON +2 mod, +2 prof at level 2)', () => {
        rollQueue.push(10);
        const { results } = run([{ type: 'saving_throw', skill: 'constitution', dc: 13 }]);
        expect(results[0]).toMatchObject({ rolled: 14, success: true });
    });

    it('uses the bare ability modifier without proficiency (DEX +1)', () => {
        rollQueue.push(10);
        const { results } = run([{ type: 'saving_throw', skill: 'dexterity', dc: 13 }]);
        expect(results[0]).toMatchObject({ rolled: 11, success: false });
    });
});

describe('condition effects on rolls', () => {
    it('applies explicit advantage to an outside-combat skill check', () => {
        rollQueue.push(4, 17); // advantage keeps 17; CHA -1 => 16
        const { results, dispatch } = run([
            { type: 'skill_check', skill: 'persuasion', dc: 12, advantage: true, description: 'Use the evidence convincingly' },
        ]);
        expect(results[0]).toMatchObject({ rolled: 16, success: true });
        expect(messagesFrom(dispatch)).toContain('advantage');
        expect(messagesFrom(dispatch)).toContain('kept 17');
    });

    it('poisoned imposes disadvantage on checks (two dice, lower kept)', () => {
        rollQueue.push(18, 6); // disadvantage keeps the 6
        const { results, dispatch } = run(
            [{ type: 'skill_check', skill: 'stealth', dc: 12 }],
            { conditions: ['Poisoned'] }
        );
        expect(results[0].rolled).toBe(7); // 6 + DEX 1
        expect(messagesFrom(dispatch)).toContain('poisoned');
        expect(messagesFrom(dispatch)).toContain('disadvantage');
    });

    it('poisoned does not affect saving throws', () => {
        rollQueue.push(10);
        const { results } = run(
            [{ type: 'saving_throw', skill: 'constitution', dc: 13 }],
            { conditions: ['Poisoned'] }
        );
        expect(results[0].rolled).toBe(14); // single die, no disadvantage
    });

    it('explicit advantage + condition disadvantage cancel to one die', () => {
        rollQueue.push(9);
        const { results } = run(
            [{ type: 'skill_check', skill: 'stealth', dc: 12, advantage: true }],
            { conditions: ['Poisoned'] }
        );
        expect(results[0].rolled).toBe(10); // straight roll: 9 + DEX 1
    });

    it('enemies attack a prone player with advantage', () => {
        rollQueue.push(5, 17); // advantage keeps the 17
        const { results, dispatch } = run(
            [{ type: 'npc_attack', attacker: 'Goblin', target: 'player', modifier: 2 }],
            { conditions: ['Prone'] }
        );
        // 17 + 2 = 19 vs live AC (10 + DEX 1 = 11, no armor equipped)
        expect(results[0]).toMatchObject({ rolled: 19, success: true });
        expect(messagesFrom(dispatch)).toContain('prone');
    });

    it('attacks against an invisible player have disadvantage', () => {
        rollQueue.push(15, 4); // disadvantage keeps the 4
        const { results } = run(
            [{ type: 'npc_attack', attacker: 'Goblin', target: 'player', modifier: 2 }],
            { conditions: ['Invisible'] }
        );
        expect(results[0]).toMatchObject({ rolled: 6, success: false });
    });
});

describe('companion attacks', () => {
    const garrick = { id: 'companion-1', name: 'Garrick', hp: 18, maxHp: 18, ac: 14, attackBonus: 4, damage: '1d8+2', status: 'healthy' };

    it('rolls a companion to-hit with the ENGINE attack bonus against the stated DC — no damage, no HP flush', () => {
        rollQueue.push(14); // 14 + 4 = 18 vs DC 13; a damage die would throw
        const { results, dispatch } = runWithContext(
            [{ type: 'companion_attack', attackerId: garrick.id, target: 'the lock', dc: 13, modifier: 9, description: 'Garrick cuts at the rope' }],
            { party: [garrick] },
        );

        expect(results[0]).toMatchObject({ type: 'companion_attack', attacker: 'Garrick', dc: 13, rolled: 18, success: true });
        expect(results[0].damage).toBeUndefined();
        expect(dispatch.mock.calls.map(([a]) => a.type)).toEqual(['ADD_ROLL', 'ADD_MESSAGE']);
        expect(messagesFrom(dispatch)).toBe('**Garrick cuts at the rope** (vs AC 13): Rolled **18** — **Hit!**');
        expect(formatRollSummary(results)).toBe('[ROLL RESULT: Garrick cuts at the rope vs AC 13, rolled 18 — HIT]');
    });

    it('does not let a downed companion act', () => {
        const { results, dispatch } = runWithContext(
            [{ type: 'companion_attack', attackerId: 'companion-1', target: 'enemy-1' }],
            { party: [{ ...garrick, hp: 0, status: 'downed' }] },
        );

        expect(results[0]).toMatchObject({ type: 'note', text: expect.stringContaining('cannot act') });
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('fighter fighting styles in roll resolution', () => {
    it('rerolls 1s and 2s on a standalone two-handed damage roll for Great Weapon Fighting', () => {
        rollQueue.push(1, 2, 5, 6); // two damage dice, then their two rerolls
        const inventory = [{ type: 'weapon', category: 'martialMelee', name: 'Greatsword', damage: '2d6', twoHanded: true, equipped: true }];

        const { results, dispatch } = runWithContext(
            [{ type: 'damage_roll', notation: '2d6+3', description: 'Greatsword damage' }],
            { character: { fightingStyle: 'greatWeaponFighting' }, inventory },
        );

        expect(results[0]).toMatchObject({ type: 'damage_roll', rolled: 14 });
        // THE damage line — one wording for every lane (2026-10-05).
        expect(messagesFrom(dispatch)).toBe('**Greatsword damage** (2d6+3): **14** damage (dice: 5, 6, mod: +3; Great Weapon Fighting rerolls: 1->5, 2->6)');
    });
});

describe('fighter Champion archetype', () => {
    const longsword = [{ type: 'weapon', category: 'martialMelee', name: 'Longsword', damage: '1d8', equipped: true }];

    it('makes a level 3 Champion crit on a natural 19 — a crit beats any AC', () => {
        rollQueue.push(19);
        const { results, dispatch } = runWithContext(
            [{ type: 'attack_roll', skill: 'attack', dc: 30 }],
            { character: { level: 3, martialArchetype: 'champion' }, inventory: longsword },
        );

        expect(results[0]).toMatchObject({ success: true, critical: true });
        expect(messagesFrom(dispatch)).toContain('Champion critical on natural 19');
    });

    it('does not make a non-Champion natural 19 auto-hit', () => {
        rollQueue.push(19);
        const { results } = runWithContext(
            [{ type: 'attack_roll', skill: 'attack', dc: 30 }],
            { character: { level: 3, martialArchetype: null }, inventory: longsword },
        );

        expect(results[0]).toMatchObject({ success: false, critical: false });
    });
});

describe('legacy combat roll isolation', () => {
    it('does not ask the DM to close combat from legacy attack rolls', async () => {
        rollQueue.push(18, 6);
        const enemy = { id: 'enemy-1', name: 'Goblin', hp: 6, maxHp: 6, ac: 13, condition: 'healthy' };
        const dispatch = vi.fn();
        const sendToLLM = vi.fn().mockResolvedValue({ requestedRolls: [] });

        await handleRequestedRolls(
            [{ type: 'attack_roll', skill: 'attack', target: enemy.id, dc: enemy.ac, damage: '1d8+3', description: 'Astra cuts at the goblin' }],
            {
                getState: () => ({
                    character: makeCharacter(),
                    inventory: [{ type: 'weapon', category: 'martialMelee', name: 'Longsword', damage: '1d8', equipped: true }],
                    combat: { active: true, enemies: [enemy] },
                    party: [],
                }),
                dispatch,
                sendToLLM,
            }
        );

        expect(sendToLLM).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('natural 20 out-of-combat checks', () => {
    it('forces a skill check to succeed on a natural 20 regardless of DC', () => {
        rollQueue.push(20); // natural 20
        const { results, dispatch } = run(
            [{ type: 'skill_check', skill: 'athletics', dc: 30 }]
        );
        expect(results[0]).toMatchObject({
            success: true,
            critical: true,
            rolled: 23, // 20 + athletics mod (+3)
        });
        expect(messagesFrom(dispatch)).toContain('Natural 20!');
    });

    it('formats a natural 20 skill check outcome as a CRITICAL SUCCESS in the roll summary', () => {
        const summary = formatRollSummary([{
            type: 'skill_check',
            skill: 'stealth',
            dc: 25,
            rolled: 22,
            success: true,
            critical: true,
            description: 'Sneak past the giant',
        }]);
        expect(summary).toContain('SUCCESS (CRITICAL SUCCESS / NATURAL 20)');
    });
});

describe('pending declared loot rides the outcome prompt, never the engine', () => {
    const outOfCombatState = () => ({
        character: makeCharacter(),
        inventory: [],
        combat: { active: false, enemies: [] },
        party: [],
    });
    const searchRoll = [{ type: 'skill_check', skill: 'perception', dc: 12, description: 'Search the tomb' }];
    const tombLoot = { goldFound: 15, silverFound: 0, copperFound: 0, itemsFound: [{ name: 'Silver Ring', quantity: 1 }] };

    it('adds a grant-or-deny loot note to the outcome prompt without granting anything itself', async () => {
        rollQueue.push(10);
        const dispatch = vi.fn();
        const sendToLLM = vi.fn().mockResolvedValue({ requestedRolls: [] });

        await handleRequestedRolls(searchRoll, {
            getState: outOfCombatState,
            dispatch,
            sendToLLM,
            playerAction: 'I search the tomb',
            pendingLoot: tombLoot,
        });

        expect(sendToLLM).toHaveBeenCalledTimes(1);
        const [prompt, , opts] = sendToLLM.mock.calls[0];
        expect(prompt).toContain('15 gold');
        expect(prompt).toContain('Silver Ring');
        expect(prompt).toContain('NOT applied');
        // The old design merged loot into events client-side; the engine must not grant it.
        expect(opts.pendingLoot).toBeUndefined();
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_GOLD' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_ITEM' }));
    });

    it('carries pendingLoot metadata through follow-up roll staging', async () => {
        rollQueue.push(10);
        const dispatch = vi.fn();
        const sendToLLM = vi.fn().mockResolvedValue({
            requestedRolls: [{ type: 'saving_throw', skill: 'dexterity', dc: 12, description: 'Dart trap' }],
        });
        const onFollowUpRolls = vi.fn();

        await handleRequestedRolls(searchRoll, {
            getState: outOfCombatState,
            dispatch,
            sendToLLM,
            playerAction: 'I search the tomb',
            pendingLoot: tombLoot,
            onFollowUpRolls,
        });

        expect(onFollowUpRolls).toHaveBeenCalledWith(
            expect.any(Array),
            expect.objectContaining({ pendingLoot: tombLoot })
        );
    });

    it('omits the loot note when nothing was declared', async () => {
        rollQueue.push(10);
        const sendToLLM = vi.fn().mockResolvedValue({ requestedRolls: [] });

        await handleRequestedRolls(searchRoll, {
            getState: outOfCombatState,
            dispatch: vi.fn(),
            sendToLLM,
            playerAction: 'I search the tomb',
        });

        expect(sendToLLM.mock.calls[0][0]).not.toContain('declared potential loot');
    });
});

describe('post-roll outcome carries player-action context', () => {
    it('passes playerActionContext so transaction guards can honor explicit rebuy intent', async () => {
        rollQueue.push(10);
        const sendToLLM = vi.fn().mockResolvedValue({ requestedRolls: [] });

        await handleRequestedRolls(
            [{ type: 'skill_check', skill: 'persuasion', dc: 10, description: 'Haggle' }],
            {
                getState: () => ({ character: makeCharacter(), inventory: [], combat: { active: false, enemies: [] }, party: [] }),
                dispatch: vi.fn(),
                sendToLLM,
                playerAction: 'I buy another dagger.',
            }
        );

        const [, , opts] = sendToLLM.mock.calls[0];
        expect(opts.playerActionContext).toBe('I buy another dagger.');
    });

    it('sends the outcome call as a FIRST-CLASS turn: the player action rides as the second argument (2026-09-02 P1)', async () => {
        // The runner's second argument gates memory retrieval, semantic text-roll
        // detection, the roll arbiter, and pre-narration detection. The follow-up
        // used to pass `undefined` and got none of them.
        rollQueue.push(10);
        const sendToLLM = vi.fn().mockResolvedValue({ requestedRolls: [] });

        await handleRequestedRolls(
            [{ type: 'skill_check', skill: 'perception', dc: 10, description: 'Search the tomb' }],
            {
                getState: () => ({ character: makeCharacter(), inventory: [], combat: { active: false, enemies: [] }, party: [] }),
                dispatch: vi.fn(),
                sendToLLM,
                playerAction: 'I search the tomb',
            }
        );

        expect(sendToLLM).toHaveBeenCalledTimes(1);
        expect(sendToLLM).toHaveBeenCalledWith(
            expect.stringContaining('Dice rolled'),
            'I search the tomb',
            expect.objectContaining({ playerActionContext: 'I search the tomb', suppressHpEvents: false }),
        );
    });
});

describe('follow-up check rejected by the roll arbiter (2026-09-02 P1)', () => {
    const state = () => ({ character: makeCharacter(), inventory: [], combat: { active: false, enemies: [] }, party: [] });
    const climb = [{ type: 'skill_check', skill: 'athletics', dc: 10, description: 'Climb the wall' }];

    it('hands an agency rejection to onFollowUpRejected instead of staging or silently dropping it', async () => {
        rollQueue.push(15);
        const sendToLLM = vi.fn().mockResolvedValue({ requestedRolls: [], _playerAuthorityRollRejected: true });
        const onFollowUpRolls = vi.fn();
        const onFollowUpRejected = vi.fn().mockResolvedValue(undefined);

        await handleRequestedRolls(climb, { getState: state, dispatch: vi.fn(), sendToLLM, playerAction: 'I climb.', onFollowUpRolls, onFollowUpRejected });

        expect(onFollowUpRolls).not.toHaveBeenCalled();
        expect(onFollowUpRejected).toHaveBeenCalledWith({ attackAsCheck: false });
    });

    it('flags an attack-as-check rejection so the caller takes the combat_start correction route', async () => {
        rollQueue.push(15);
        const sendToLLM = vi.fn().mockResolvedValue({ requestedRolls: [], _attackAsCheckRejected: true });
        const onFollowUpRejected = vi.fn().mockResolvedValue(undefined);

        await handleRequestedRolls(climb, { getState: state, dispatch: vi.fn(), sendToLLM, playerAction: 'I climb.', onFollowUpRejected });

        expect(onFollowUpRejected).toHaveBeenCalledWith({ attackAsCheck: true });
    });
});

describe('low-level solo death save mirrors the reducer (2026-09-02 audit)', () => {
    const dyingL1 = { level: 1, currentHP: 0, dying: true, deathSaves: { successes: 0, failures: 2 }, conditions: ['Unconscious'] };

    it('rolls no die and posts no death line when the only companion is down', () => {
        // Two failures banked: a real die below 10 would have narrated a DEATH the
        // reducer never recorded. No die is queued — a draw would throw.
        const { results, dispatch } = runWithContext([{ type: 'death_save' }], {
            character: dyingL1,
            party: [{ id: 'c1', name: 'Bo', hp: 0, maxHp: 10, ac: 10, status: 'downed' }],
        });

        expect(results[0]).toMatchObject({ type: 'note', text: expect.stringContaining('No death saving throw is rolled') });
        expect(results[0].text).not.toMatch(/character dies|is dead/i);
        // The reducer applies the setback (and posts its own "Death save skipped" line).
        expect(dispatch).toHaveBeenCalledWith({ type: 'DEATH_SAVE_RESULT', payload: { die: null } });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_ROLL' }));
        const deathLine = dispatch.mock.calls.map(([a]) => a).find(a => a.type === 'ADD_MESSAGE' && /Death Saving Throw/.test(a.payload?.content || ''));
        expect(deathLine).toBeUndefined();
        expect(formatRollSummary(results)).not.toContain('DEAD');
    });

    it('control: a standing companion means a real death save', () => {
        rollQueue.push(4);
        const { results, dispatch } = runWithContext([{ type: 'death_save' }], {
            character: dyingL1,
            party: [{ id: 'c1', name: 'Bo', hp: 6, maxHp: 10, ac: 10 }],
        });
        expect(results[0]).toMatchObject({ type: 'death_save', rolled: 4, outcome: 'dead' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'DEATH_SAVE_RESULT', payload: { die: 4 } });
    });
});

describe('the working party copies carry a drop through the batch (2026-09-02 audit)', () => {
    it('a companion dropped earlier in the same batch cannot act later in it', () => {
        rollQueue.push(18, 6); // the Orc hits Bo (AC 8) for 1d6 = 6 → Bo drops; no die is queued for Bo's attack
        const { results, dispatch } = runWithContext(
            [
                { type: 'npc_attack', attacker: 'Orc', target: 'c1', modifier: 2, damage: '1d6' },
                { type: 'companion_attack', attackerId: 'c1', dc: 12 },
            ],
            { party: [{ id: 'c1', name: 'Bo', hp: 5, maxHp: 10, ac: 8 }] },
        );
        expect(results[0]).toMatchObject({ type: 'npc_attack', success: true, targetHp: 0 });
        expect(results[1]).toMatchObject({ type: 'note', text: 'Bo is down and cannot act.' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_COMPANION', payload: { id: 'c1', hp: 0 } });
    });
});

describe('a proposal whose every roll resolves to nothing (2026-09-02 audit)', () => {
    const state = () => ({ character: makeCharacter(), inventory: [], combat: { active: false, enemies: [] }, party: [] });
    const initiativeOnly = [{ type: 'skill_check', skill: 'initiative', dc: 10 }];

    it('reveals the withheld setup, posts a set-aside line, and makes no outcome call', async () => {
        const dispatch = vi.fn();
        const sendToLLM = vi.fn();

        const outcome = await handleRequestedRolls(initiativeOnly, {
            getState: state, dispatch, sendToLLM, playerAction: 'I draw steel.', setupMessageId: 'msg-setup-9',
        });

        expect(outcome).toBeUndefined();
        expect(sendToLLM).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith({ type: 'REVEAL_MESSAGE', payload: { id: 'msg-setup-9' } });
        expect(messagesFrom(dispatch)).toContain('no dice were rolled and the check is set aside');
    });

    it('never reveals a setup that pre-narrated an outcome', async () => {
        const dispatch = vi.fn();
        await handleRequestedRolls(initiativeOnly, {
            getState: state, dispatch, sendToLLM: vi.fn(), playerAction: 'I draw steel.', setupMessageId: 'msg-setup-9', preNarrated: true,
        });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'REVEAL_MESSAGE' }));
        expect(messagesFrom(dispatch)).toContain('the check is set aside');
    });
});

describe('follow-up narration failure surfacing', () => {
    it('posts a visible system error when the outcome narration call fails', async () => {
        rollQueue.push(15);
        const dispatch = vi.fn();
        const sendToLLM = vi.fn().mockRejectedValue(new Error('provider 500'));

        await handleRequestedRolls(
            [{ type: 'skill_check', skill: 'athletics', dc: 10, description: 'Climb the wall' }],
            {
                getState: () => ({ character: makeCharacter(), inventory: [], combat: { active: false }, party: [] }),
                dispatch,
                sendToLLM,
                playerAction: 'I climb the wall.',
            }
        );

        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_ROLL' })); // the die landed
        const errorLine = dispatch.mock.calls
            .map(([action]) => action)
            .find(a => a.type === 'ADD_MESSAGE'
                && a.payload?.role === 'system'
                && !a.payload?.hidden
                && /Outcome narration failed/.test(a.payload?.content || ''));
        expect(errorLine).toBeTruthy();
        expect(errorLine.payload.content).toContain('provider 500');
        expect(errorLine.payload.content).toContain('Your roll above stands');
    });
});
describe('enemy attacks a companion (inline damage, queue 2026-07-08)', () => {
    it('rolls vs the companion AC, applies inline damage to the companion, and flushes their HP', () => {
        rollQueue.push(15, 4); // to-hit die (15 + 3 = 18 vs AC 14), damage die
        const { results, dispatch } = runWithContext(
            [{ type: 'npc_attack', attackerId: 'wolf', attacker: 'Fen Wolf', target: 'companion-1', modifier: 3, damage: '1d6+1' }],
            {
                party: [{ id: 'companion-1', name: 'Terho', hp: 15, maxHp: 15, ac: 14, status: 'healthy' }],
            }
        );

        const attack = results.find(r => r.type === 'npc_attack');
        expect(attack).toMatchObject({
            success: true,
            damage: 5, // 1d6(4) + 1
            targetName: 'Terho',
            targetHp: 10,
            targetMaxHp: 15,
        });
        expect(attack.targetIsPlayer).toBeUndefined();
        expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_COMPANION', payload: { id: 'companion-1', hp: 10 } });
        // The player took nothing — no TAKE_DAMAGE flush.
        expect(dispatch.mock.calls.some(([action]) => action.type === 'TAKE_DAMAGE')).toBe(false);
    });

    it('resolves a miss against the companion AC without touching companion HP', () => {
        rollQueue.push(5); // 5 + 3 = 8 vs AC 14 — miss, no damage die drawn
        const { results, dispatch } = runWithContext(
            [{ type: 'npc_attack', attackerId: 'wolf', attacker: 'Fen Wolf', target: 'Terho', modifier: 3, damage: '1d6+1' }],
            {
                party: [{ id: 'companion-1', name: 'Terho', hp: 15, maxHp: 15, ac: 14, status: 'healthy' }],
            }
        );

        expect(results.find(r => r.type === 'npc_attack')).toMatchObject({ success: false });
        expect(dispatch.mock.calls.some(([action]) => action.type === 'UPDATE_COMPANION')).toBe(false);
    });

    it('falls back to the player when the named target is not a tracked companion', () => {
        rollQueue.push(15, 4);
        const { results, dispatch } = runWithContext(
            [{ type: 'npc_attack', attackerId: 'wolf', attacker: 'Fen Wolf', target: 'some stranger', modifier: 3, damage: '1d6+1' }],
            { party: [] }
        );

        expect(results.find(r => r.type === 'npc_attack')).toMatchObject({ targetIsPlayer: true, damage: 5 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'TAKE_DAMAGE', payload: 5 });
    });
});

describe('standalone damage_roll malformed-notation catch (queue 2026-07-08)', () => {
    it('drops an unparseable damage roll without crashing the rest of the batch', () => {
        rollQueue.push(14); // the healthy skill check that must still resolve
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { results } = runWithContext([
            { type: 'damage_roll', notation: 'banana d6', description: 'Nonsense damage' },
            { type: 'skill_check', skill: 'perception', dc: 10 },
        ]);

        expect(results.some(r => r.type === 'damage_roll')).toBe(false); // dropped, not crashed
        expect(results.some(r => r.type === 'skill_check' || r.skill === 'perception')).toBe(true);
        expect(errorSpy).toHaveBeenCalledWith('[RollResolver] Error parsing damage roll notation:', expect.anything());
        errorSpy.mockRestore();
    });
});

describe('exchange-machine parity via the combat math kernel (2026-07-30)', () => {
    it('Uncanny Dodge halves one incoming npc_attack per batch for a Rogue 5+', () => {
        // Rogue L5, no armor: AC 10 + DEX 3 = 13.
        const rogue = {
            class: 'rogue',
            level: 5,
            currentHP: 30,
            maxHP: 30,
            abilityScores: { strength: 10, dexterity: 16, constitution: 12, intelligence: 10, wisdom: 10, charisma: 10 },
        };
        // Attack 1: to-hit 18 (hit) → 2d6 = 5,5 = 10 → halved to 5.
        // Attack 2: to-hit 19 (hit) → 2d6 = 4,4 = 8 → NOT halved (once per batch).
        rollQueue.push(18, 5, 5, 19, 4, 4);
        const { results, dispatch } = runWithContext([
            { type: 'npc_attack', attacker: 'Bandit', damage: '2d6' },
            { type: 'npc_attack', attacker: 'Second Bandit', damage: '2d6' },
        ], { character: rogue });

        expect(results[0]).toMatchObject({ damage: 5, uncannyDodgeApplied: true, targetIsPlayer: true });
        expect(results[1].damage).toBe(8);
        expect(results[1].uncannyDodgeApplied).toBeUndefined();
        expect(messagesFrom(dispatch)).toContain('Uncanny Dodge');
        // HP flush reflects 5 + 8, not 10 + 8.
        expect(results[0].targetHp).toBe(25);
        expect(results[1].targetHp).toBe(17);
    });

});

describe('fighter L5+ out-of-combat Extra Attack (pinned 2026-08-27)', () => {
    it('resolves two independently rolled strikes, each with its own outcome', () => {
        rollQueue.push(20, 1); // strike 1 crits, strike 2 fumbles — modifier-independent
        const { results, dispatch } = run(
            [{ type: 'attack_roll', skill: 'attack', dc: 13, description: 'Sword strike' }],
            { level: 5 }
        );
        expect(results).toHaveLength(2);
        expect(results[0].description).toContain('(Attack 1)');
        expect(results[0].success).toBe(true);
        expect(results[0].critical).toBe(true);
        expect(results[1].description).toContain('(Extra Attack)');
        expect(results[1].success).toBe(false);
        const messages = messagesFrom(dispatch);
        expect(messages).toContain('(Attack 1)');
        expect(messages).toContain('(Extra Attack)');
    });
});

describe('legacy initiative lane retired (DECISIONS.md 2026-08-27)', () => {
    it('skips a requested initiative roll with a system note and rolls no dice', () => {
        // The empty rollQueue proves no die is drawn — the mock throws on an empty queue.
        const { results, dispatch } = run([{ type: 'skill_check', skill: 'initiative', dc: 10 }]);
        expect(results).toHaveLength(0);
        expect(messagesFrom(dispatch)).toContain('Initiative is rolled automatically');
    });
});

describe('DC fallback honors the parser default (2026-08-27 audit)', () => {
    it('an explicit dc of 0 stays 0 instead of silently becoming DC 15', () => {
        rollQueue.push(2);
        const { results } = run([{ type: 'skill_check', skill: 'athletics', dc: 0 }]);
        expect(results[0].dc).toBe(0);
        expect(results[0].success).toBe(true);
    });
});

describe('npc_attack against a companion honors the companion conditions (2026-08-27 audit)', () => {
    it('a prone companion grants the attacker advantage', () => {
        rollQueue.push(5, 18, 4); // advantage pair (18 kept), then 1d6 damage
        const party = [{ id: 'mara', name: 'Mara', hp: 10, maxHp: 10, ac: 12, conditions: ['prone'], status: 'active' }];
        const { results, dispatch } = runWithContext(
            [{ type: 'npc_attack', attacker: 'Bandit', target: 'mara', modifier: 3, damage: '1d6' }],
            { party }
        );
        expect(results[0].success).toBe(true);
        expect(results[0].rolled).toBe(21); // the kept high die + modifier
        expect(messagesFrom(dispatch)).toContain('*(advantage)*');
        expect(dispatch.mock.calls.some(([a]) => a.type === 'UPDATE_COMPANION' && a.payload.hp === 6)).toBe(true);
    });
});
