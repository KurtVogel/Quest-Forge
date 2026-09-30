#!/usr/bin/env node
/**
 * Real-provider combat pacing eval.
 *
 * Run with an explicit key:
 *   $env:GEMINI_API_KEY="..."; npm.cmd run eval:combat
 *   $env:OPENAI_API_KEY="..."; $env:QF_EVAL_PROVIDER="openai"; npm.cmd run eval:combat
 *
 * This intentionally does not read in-app localStorage keys. It only uses env vars
 * provided for the eval process.
 */
import { sendMessage } from '../src/llm/adapter.js';
import { buildSystemPrompt } from '../src/llm/promptBuilder.js';
import { parseResponse } from '../src/llm/responseParser.js';

const provider = process.env.QF_EVAL_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : 'gemini');
const apiKey = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
const model = process.env.QF_EVAL_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-3.1-pro-preview');

const baseFighter = {
    name: 'Astra',
    race: 'human',
    class: 'fighter',
    level: 2,
    exp: 0,
    currentHP: 17,
    maxHP: 20,
    armorClass: 18,
    gold: 0,
    silver: 0,
    copper: 0,
    speed: 30,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    savingThrowProficiencies: ['strength', 'constitution'],
    skillProficiencies: ['athletics', 'perception'],
    conditions: [],
    features: ['Second Wind', 'Fighting Style', 'Action Surge'],
    classResources: {
        secondWind: { used: 0, max: 1 },
        actionSurge: { used: 0, max: 1 },
    },
};

const baseEnemy = { id: 'enemy-1', name: 'Goblin Cutter', hp: 7, maxHp: 7, ac: 13, condition: 'healthy' };

function baseState(overrides = {}) {
    return {
        character: { ...baseFighter, ...(overrides.character || {}) },
        inventory: [
            { id: 'item-armor', name: 'Chain Mail', type: 'armor', armorType: 'heavy', baseAC: 16, equipped: true },
            { id: 'item-sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true },
            { id: 'item-shield', name: 'Shield', type: 'shield', isShield: true, shieldAC: 2, equipped: true },
        ],
        quests: [],
        rollHistory: [],
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        customSystemPrompt: '',
        journal: [],
        npcs: [],
        party: overrides.party || [],
        currentLocation: 'Old road',
        combat: overrides.combat ?? {
            active: true,
            round: 1,
            bonusActionUsed: false,
            enemies: [baseEnemy],
            turnOrder: [
                { type: 'player', name: 'Astra', initiative: 14 },
                { type: 'enemy', id: 'enemy-1', name: 'Goblin Cutter', initiative: 9 },
            ],
            currentTurn: 0,
        },
        worldFacts: [],
        retrievedMemories: [],
        premise: '',
        messageHistory: overrides.messageHistory || [],
    };
}

const scenarios = [
    {
        id: 'attack-that-starts-combat-keeps-its-target',
        state: baseState({
            combat: { active: false },
            messageHistory: [{
                role: 'assistant',
                content: 'A lone Goblin Duelist stands five feet away in an empty arena and challenges you to a fight. What do you do?',
            }],
        }),
        userMessage: 'I accept and immediately attack the Goblin Duelist with my longsword.',
        checks: [
            hasCombatStart,
            hasCombatExchange,
            startingAttackTargetsDeclaredEnemy,
            noRollRequests,
            noOutcomeFieldsWithExchange,
        ],
    },
    {
        id: 'active-attack-batched-exchange',
        state: baseState(),
        userMessage: 'I step in behind my shield and slash the goblin with my longsword.',
        checks: [
            hasCombatExchange,
            playerSlot('attack'),
            attackTargets('enemy-1'),
            noRollRequests,
            noOutcomeFieldsWithExchange,
        ],
    },
    {
        id: 'action-surge-two-actions-one-roll-block',
        state: baseState({
            character: {
                pendingActionSurge: true,
                classResources: {
                    secondWind: { used: 0, max: 1 },
                    actionSurge: { used: 1, max: 1 },
                },
            },
        }),
        userMessage: 'I use the surge to attack twice, driving forward before it can recover.',
        checks: [
            playerSlotCount(2),
            noResourcesUsed,
            noRollRequests,
            noOutcomeFieldsWithExchange,
        ],
    },
    {
        id: 'second-wind-main-action-still-available',
        state: baseState({
            character: {
                currentHP: 10,
                classResources: {
                    secondWind: { used: 1, max: 1 },
                    actionSurge: { used: 0, max: 1 },
                },
            },
            combat: {
                active: true,
                round: 1,
                bonusActionUsed: true,
                enemies: [baseEnemy],
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 14 }],
                currentTurn: 0,
            },
            messageHistory: [
                { role: 'user', content: '**Second Wind** *(bonus action)* — you recover **8 HP** (now 18/20). Your main action is still available.' },
            ],
        }),
        userMessage: 'With my breath back, I attack the goblin.',
        checks: [
            hasCombatExchange,
            playerSlot('attack'),
            noResourcesUsed,
            noRollRequests,
            noOutcomeFieldsWithExchange,
        ],
    },
    {
        id: 'low-level-threat-is-not-forced-execution',
        state: baseState({
            character: { level: 1, currentHP: 12, maxHP: 12 },
            combat: { active: false },
        }),
        userMessage: 'A knight and two armed guards block the alley. I freeze in the shadows and stay absolutely still, trying not to be noticed.',
        checks: [
            noPlayerDeath,
            lowLevelDoesNotStartDogpile,
        ],
    },
    // WOW 2026-09-27 (combat-drama slice A) — the honor rate, scored without a
    // judge: the previous narration ended on each foe's telegraph, and this
    // round's enemy_intents must deliver it. Run several times for a rate.
    {
        id: 'telegraph-honored-by-next-intents',
        state: baseState({
            party: [{ id: 'companion-1', name: 'Torvald', hp: 18, maxHp: 18, ac: 15, level: 2, affinity: 60, status: 'healthy', weapon: 'Longsword', damage: '1d8+2', attackBonus: 4 }],
            combat: {
                active: true,
                round: 2,
                bonusActionUsed: false,
                enemies: [
                    { id: 'enemy-1', name: 'Goblin Archer', hp: 7, maxHp: 7, ac: 13, condition: 'healthy', combatStatus: 'active', conditions: [] },
                    { id: 'enemy-2', name: 'Goblin Cutter', hp: 1, maxHp: 7, ac: 13, condition: 'critical', combatStatus: 'active', conditions: [] },
                ],
                turnOrder: [
                    { type: 'player', name: 'Astra', initiative: 14 },
                    { type: 'companion', id: 'companion-1', name: 'Torvald', initiative: 11 },
                    { type: 'enemy', id: 'enemy-1', name: 'Goblin Archer', initiative: 9 },
                    { type: 'enemy', id: 'enemy-2', name: 'Goblin Cutter', initiative: 6 },
                ],
                currentTurn: 0,
                phase: 'awaiting_player',
            },
            messageHistory: [
                { role: 'user', content: 'I drive my sword into the cutter.' },
                { role: 'assistant', content: 'Your blade opens the cutter\'s thigh and it staggers, blood sheeting down its leg. Torvald\'s swing at the archer goes wide. The archer nocks another arrow, its yellow eye fixed on Torvald across the fire. The cutter, bleeding badly, lowers its blade and backs toward the open door, one hand already on the frame. What do you do?' },
            ],
        }),
        userMessage: 'I leave the cutter to its retreat and charge the archer before it can loose.',
        checks: [
            hasCombatExchange,
            enemyIntent('enemy-1', ['attack'], 'companion-1'),
            enemyIntent('enemy-2', ['flee', 'surrender']),
            noRollRequests,
            noOutcomeFieldsWithExchange,
        ],
    },
    // Bloodied foes break instead of dying in place (the DMG morale rule).
    {
        id: 'bloodied-foes-break',
        state: baseState({
            combat: {
                active: true,
                round: 3,
                bonusActionUsed: false,
                enemies: [
                    { id: 'enemy-1', name: 'Goblin Raider', hp: 2, maxHp: 7, ac: 13, condition: 'critical', combatStatus: 'active', conditions: [] },
                    { id: 'enemy-2', name: 'Goblin Raider 2', hp: 3, maxHp: 7, ac: 13, condition: 'bloodied', combatStatus: 'active', conditions: [] },
                    { id: 'enemy-3', name: 'Goblin Raider 3', hp: 1, maxHp: 7, ac: 13, condition: 'critical', combatStatus: 'active', conditions: [] },
                ],
                turnOrder: [
                    { type: 'player', name: 'Astra', initiative: 14 },
                    { type: 'enemy', id: 'enemy-1', name: 'Goblin Raider', initiative: 9 },
                    { type: 'enemy', id: 'enemy-2', name: 'Goblin Raider 2', initiative: 8 },
                    { type: 'enemy', id: 'enemy-3', name: 'Goblin Raider 3', initiative: 6 },
                ],
                currentTurn: 0,
                phase: 'awaiting_player',
            },
            messageHistory: [
                { role: 'user', content: 'I cut down the nearest raider.' },
                { role: 'assistant', content: 'Your longsword takes the first raider across the ribs and it drops to one knee. The other two are no better off — one clutches a gashed arm, the other drags a leg. Three raiders, all bleeding, their leader already dead in the ditch behind them; the one on its knee looks from you to the treeline and back. What do you do?' },
            ],
        }),
        // An UNAMBIGUOUS action (2026-09-30): 'I raise my sword and step toward the kneeling one' read as a threat, and
        // Terra answered it with the clarifying question the contract allows ('ordering it to surrender, or striking?') — no
        // envelope, no morale to measure. The break must be observed on a turn that commits an attack.
        userMessage: 'I attack the kneeling raider with my longsword.',
        checks: [
            hasCombatExchange,
            someFoeBreaks(['enemy-1', 'enemy-2', 'enemy-3']),
            noRollRequests,
            noOutcomeFieldsWithExchange,
        ],
    },
    {
        id: 'combat-question-does-not-commit-an-action',
        state: baseState(),
        userMessage: 'Before I act, how far away is the goblin and is there any cover?',
        checks: [
            noCombatExchange,
            noRollRequests,
        ],
    },
];

function hasCombatExchange(events) {
    return { pass: !!events?.combatExchange, message: 'expected a valid combat_exchange intent envelope' };
}

function hasCombatStart(events) {
    return { pass: !!events?.combatStart, message: 'expected combat_start for the accepted duel' };
}

function startingAttackTargetsDeclaredEnemy(events) {
    const enemyIds = new Set((events?.combatStart?.enemies || []).map(enemy => enemy.id));
    const attackTargets = (events?.combatExchange?.playerSlots || [])
        .filter(slot => slot.action === 'attack')
        .flatMap(slot => slot.strikes || [])
        .map(strike => strike.target);
    return {
        pass: enemyIds.size > 0 && attackTargets.length > 0 && attackTargets.every(target => enemyIds.has(target)),
        message: 'expected the queued starting attack to target a declared canonical enemy id',
    };
}

function noCombatExchange(events) {
    return { pass: !events?.combatExchange, message: 'expected no committed exchange for a clarification question' };
}

function playerSlot(action) {
    return events => ({
        pass: (events?.combatExchange?.playerSlots || []).some(slot => slot.action === action),
        message: `expected a ${action} player slot`,
    });
}

function playerSlotCount(count) {
    return events => ({
        pass: (events?.combatExchange?.playerSlots || []).length === count,
        message: `expected exactly ${count} player slots`,
    });
}

function attackTargets(target) {
    return events => ({
        pass: (events?.combatExchange?.playerSlots || []).some(slot =>
            slot.action === 'attack' && slot.strikes?.some(strike => strike.target === target)
        ),
        message: `expected an engine-targeted attack against ${target}`,
    });
}

function enemyIntent(enemyId, actions, target = null) {
    return events => {
        const intent = (events?.combatExchange?.enemyIntents || []).find(i => i.enemyId === enemyId);
        const actionOk = !!intent && actions.includes(intent.action);
        const targetOk = target === null || intent?.target === target;
        return {
            pass: actionOk && targetOk,
            message: `expected ${enemyId} to honor its telegraph (${actions.join('/')}${target ? ` → ${target}` : ''}); got ${intent ? `${intent.action} → ${intent.target}` : 'no intent (defaults to attack → player)'}`,
        };
    };
}

function someFoeBreaks(enemyIds) {
    return events => {
        const breaking = (events?.combatExchange?.enemyIntents || []).filter(i => enemyIds.includes(i.enemyId) && ['flee', 'surrender'].includes(i.action));
        return {
            pass: breaking.length > 0,
            message: `expected at least one bloodied foe to flee or surrender; ${breaking.length} did`,
        };
    };
}

function noOutcomeFieldsWithExchange(events) {
    const hasExchange = !!events?.combatExchange;
    const hasOutcome = !!events && (
        events.damageTaken > 0 || events.damageDealt > 0 || events.healing > 0 ||
        events.expAwarded > 0 || events.combatEnd
    );
    return { pass: !hasExchange || !hasOutcome, message: 'combat_exchange included forbidden outcome mutations' };
}

function noResourcesUsed(events) {
    return {
        pass: (events?.resourcesUsed || []).length === 0,
        message: 'expected no DM-emitted resources_used for UI-owned fighter abilities',
    };
}

function noRollRequests(events) {
    return {
        pass: (events?.requestedRolls || []).length === 0,
        message: 'expected no further roll requests',
    };
}

function noPlayerDeath(events) {
    return {
        pass: !events?.playerDeath,
        message: 'expected no player_death under low-level solo safety',
    };
}

function lowLevelDoesNotStartDogpile(events) {
    const enemies = events?.combatStart?.enemies || [];
    return {
        pass: enemies.length <= 1,
        message: 'expected no multi-enemy forced dogpile for level-1 solo safety',
    };
}

async function runScenario(scenario) {
    const state = scenario.state;
    const systemPrompt = buildSystemPrompt(state);
    const response = await sendMessage({
        provider,
        apiKey,
        model,
        systemPrompt,
        messageHistory: state.messageHistory,
        userMessage: scenario.userMessage,
    });
    const { narrative, events } = parseResponse(response);
    const results = scenario.checks.map(check => check(events, narrative));
    return { scenario, response, narrative, events, results };
}

if (!apiKey) {
    console.error(`Missing API key for ${provider}. Set ${provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} before running this eval.`);
    process.exit(2);
}

let failures = 0;
console.log(`Combat pacing eval: provider=${provider} model=${model}`);
for (const scenario of scenarios) {
    console.log(`\n## ${scenario.id}`);
    try {
        const result = await runScenario(scenario);
        for (const check of result.results) {
            console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.message}`);
            if (!check.pass) failures += 1;
        }
        console.log(`rolls=${result.events?.requestedRolls?.length || 0} combatStart=${!!result.events?.combatStart} combatEnd=${!!result.events?.combatEnd} xp=${result.events?.expAwarded || 0}`);
        if (process.env.QF_EVAL_SHOW_RESPONSES === '1') {
            console.log('\n--- response ---');
            console.log(result.response);
        }
    } catch (error) {
        failures += 1;
        console.log(`FAIL scenario threw: ${error.message}`);
    }
}

if (failures > 0) {
    console.error(`\nCombat pacing eval failed ${failures} check(s).`);
    process.exit(1);
}

console.log('\nCombat pacing eval passed.');
