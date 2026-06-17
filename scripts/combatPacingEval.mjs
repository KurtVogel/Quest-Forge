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
import { detectPreNarratedOutcome, parseResponse } from '../src/llm/responseParser.js';

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
            hasRoll('attack_roll'),
            rollHas('attack_roll', 'target'),
            rollHas('attack_roll', 'damage'),
            noPreNarratedOutcome,
            noOutcomeFieldsWithRolls,
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
            atLeastRolls('attack_roll', 2),
            noResourcesUsed,
            noPreNarratedOutcome,
            noOutcomeFieldsWithRolls,
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
            hasRoll('attack_roll'),
            noResourcesUsed,
            noOutcomeFieldsWithRolls,
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
        id: 'post-roll-victory-closes-combat-with-xp',
        state: baseState(),
        userMessage: [
            '[SYSTEM: Dice rolled — results below. Narrate the outcome in ONE cohesive, vivid pass that reads naturally on its own.',
            'RULES: If the roll results show every tracked enemy is DOWNED, narrate victory now and emit combat_end: true plus exp_awarded; do NOT request more combat rolls.',
            'Damage and HP for these attacks have ALREADY been applied by the system — narrate the wounds, but do NOT output damage_taken, damage_dealt, or enemy_updates for them.]',
            '',
            '[ROLL RESULT: Astra cuts at the goblin vs AC 13, rolled 18 — HIT for 9 damage. Goblin Cutter now 0/7 HP — Goblin Cutter is DOWNED. (HP applied by the system — do NOT adjust it via damage_taken/enemy_updates)]',
        ].join('\n'),
        checks: [
            noRollRequests,
            combatEnded,
            xpAwarded,
            noDuplicateEngineHp,
        ],
    },
    {
        id: 'post-roll-enemy-survives-asks-next-action-not-extra-damage',
        state: baseState(),
        userMessage: [
            '[SYSTEM: Dice rolled — results below. Narrate the outcome in ONE cohesive, vivid pass that reads naturally on its own.',
            'Damage and HP for these attacks have ALREADY been applied by the system — narrate the wounds, but do NOT output damage_taken, damage_dealt, or enemy_updates for them.]',
            '',
            '[ROLL RESULT: Astra cuts at the goblin vs AC 13, rolled 17 — HIT for 3 damage. Goblin Cutter now 4/7 HP. (HP applied by the system — do NOT adjust it via damage_taken/enemy_updates)]',
        ].join('\n'),
        checks: [
            noDuplicateEngineHp,
            noCombatEnd,
            noDamageRollRequest,
        ],
    },
];

function hasRoll(type) {
    return (events) => ({
        pass: (events?.requestedRolls || []).some(r => r.type === type),
        message: `expected requested_rolls to include ${type}`,
    });
}

function atLeastRolls(type, count) {
    return (events) => ({
        pass: (events?.requestedRolls || []).filter(r => r.type === type).length >= count,
        message: `expected at least ${count} ${type} rolls`,
    });
}

function rollHas(type, field) {
    return (events) => ({
        pass: (events?.requestedRolls || []).some(r => r.type === type && r[field]),
        message: `expected ${type} roll to include ${field}`,
    });
}

function noPreNarratedOutcome(events, narrative) {
    return {
        pass: !(events?.requestedRolls?.length > 0 && detectPreNarratedOutcome(narrative)),
        message: 'roll request pre-narrated an outcome',
    };
}

function noOutcomeFieldsWithRolls(events) {
    const hasRolls = (events?.requestedRolls || []).length > 0;
    const hasOutcome = !!events && (
        events.damageTaken > 0 ||
        events.damageDealt > 0 ||
        events.healing > 0 ||
        events.expAwarded > 0 ||
        events.enemyUpdates.length > 0 ||
        events.resourcesUsed.length > 0 ||
        events.itemsFound.length > 0 ||
        events.itemsLost.length > 0
    );
    return {
        pass: !hasRolls || !hasOutcome,
        message: 'roll request included outcome mutation fields',
    };
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

function noDamageRollRequest(events) {
    return {
        pass: !(events?.requestedRolls || []).some(r => r.type === 'damage_roll'),
        message: 'expected no standalone combat damage_roll after engine-applied HP',
    };
}

function combatEnded(events) {
    return {
        pass: !!events?.combatEnd,
        message: 'expected combat_end: true on post-roll victory',
    };
}

function noCombatEnd(events) {
    return {
        pass: !events?.combatEnd,
        message: 'expected combat to remain active while an enemy survives',
    };
}

function xpAwarded(events) {
    return {
        pass: (events?.expAwarded || 0) > 0,
        message: 'expected exp_awarded on post-roll victory',
    };
}

function noDuplicateEngineHp(events) {
    return {
        pass: !events || (events.damageTaken === 0 && events.damageDealt === 0 && events.enemyUpdates.length === 0),
        message: 'expected no duplicate HP mutations after engine-applied damage',
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
