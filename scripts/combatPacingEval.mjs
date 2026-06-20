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
        party: [],
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

function noOutcomeFieldsWithExchange(events) {
    const hasExchange = !!events?.combatExchange;
    const hasOutcome = !!events && (
        events.damageTaken > 0 || events.damageDealt > 0 || events.healing > 0 ||
        events.expAwarded > 0 || events.enemyUpdates.length > 0 || events.combatEnd
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
