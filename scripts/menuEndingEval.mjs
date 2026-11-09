#!/usr/bin/env node
/**
 * Real-provider eval of offered-choice endings (2026-11-09, Vesa: "I haven't
 * really liked it asking me 'do you a) or do you b)' in the end. it's like,
 * let me decide" — "So do you look inside the hatch or wait first?").
 *
 * The habit comes in streaks: the DM imitates its own earlier endings (one
 * eval:plainwords run closed 4 of 8 turns on "Do you …, or …?", the others
 * none). So the fixture starts INSIDE the habit — two prior exchanges whose
 * DM replies end on a narrator either/or — then six ordinary exploration
 * turns, on the default campaign prompt, BEFORE (the NEVER OFFER OPTIONS
 * sentence cut out by string surgery) and AFTER. A thinking-free Flash judge
 * reads each turn's ending:
 *
 *   narrator_choice   the NARRATOR's closing question lists the player's
 *                     alternatives ("Do you X, or Y?") — the thing to remove
 *   character_choice  a CHARACTER poses an either/or in their own voice
 *                     ("You getting in, or am I shoving off alone?") — drama,
 *                     counted, not targeted
 *   open              anything else
 *
 *   npm.cmd run eval:menus
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:menus
 *
 * Key from the environment or the git-ignored .env (GEMINI_API_KEY). Writes a
 * markdown report + raw JSON to test-results/menus/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendMessage } from '../src/llm/adapter.js';
import { buildSystemPrompt } from '../src/llm/promptBuilder.js';
import { parseResponse } from '../src/llm/responseParser.js';
import { parseJsonObjectLoose } from '../src/llm/utils/jsonExtractor.js';
import { initialGameState } from '../src/state/initialState.js';
import { buildPremiseFromStarter, findPremiseStarter } from '../src/data/premiseStarters.js';
import { MACHINERY_MODEL, MACHINERY_FALLBACK_MODEL } from '../src/llm/machinery.js';
import { createInitialFronts } from '../src/engine/fronts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
try {
    const envText = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
} catch { /* explicit env only */ }
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY missing.'); process.exit(2); }
const RUNS = Math.max(1, Math.min(4, Number(process.env.QF_EVAL_RUNS) || 3));
const DM = { provider: 'gemini', apiKey: KEY, model: process.env.QF_EVAL_GEMINI_MODEL || 'gemini-3.8-flash' };
const OUT_DIR = path.join(repoRoot, 'test-results', 'menus');

// The rule as shipped; the BEFORE arm cuts exactly this out (and fails loudly if it moved).
const RULE = ' **NEVER OFFER OPTIONS.** The player decides what to do: the narration never closes on a question that lists their choices — not a list, not one either/or ("Do you push on, or lie low?", "Do you look inside the hatch, or wait first?") — and not because earlier turns ended that way. End on what is happening; a character may still ask their own question in their own voice.';
function toBeforePrompt(systemPrompt) {
    if (!systemPrompt.includes(RULE)) throw new Error('The NEVER OFFER OPTIONS rule was not found as shipped — the BEFORE surgery is stale.');
    return systemPrompt.replace(RULE, '');
}

const heroName = 'Astra';
const premise = buildPremiseFromStarter(findPremiseStarter('saltmere-debt'), heroName);
const LOCATION = 'Saltmere, the old sea-temple';
const hero = {
    name: heroName, race: 'human', class: 'fighter', level: 1, exp: 0, currentHP: 12, maxHP: 12, armorClass: 16,
    gold: 2, silver: 7, copper: 20, speed: 30, gender: 'woman',
    appearance: 'Tall and rope-scarred across both palms, salt-bleached brown hair cut short, a chipped front tooth.',
    background: 'Came to Saltmere two winters ago owing money and saying nothing about where from.',
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    savingThrowProficiencies: ['strength', 'constitution'], skillProficiencies: ['athletics', 'perception'],
    conditions: [], features: ['Second Wind', 'Fighting Style'], fightingStyle: 'defense',
    classResources: { secondWind: { used: 0, max: 1 } },
};
const inventory = [
    { id: 'item-armor', name: 'Chain Mail', type: 'armor', armorType: 'heavy', baseAC: 16, equipped: true },
    { id: 'item-sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true },
];
const fronts = createInitialFronts({ premise, character: hero, location: LOCATION });

// The habit already in the conversation: two exchanges whose DM replies close on a narrator either/or.
const SEEDED_HISTORY = [
    { role: 'assistant', content: `Grey morning over Saltmere. ${heroName} has climbed the cliff path to the old sea-temple, roofless for a century, where the gulls nest in the broken walls. Below, the harbor is busy: a merchant ship, the Gannet's Pride, is taking on cargo at the long dock.` },
    { role: 'user', content: 'I walk into the ruined temple and look around.' },
    { role: 'assistant', content: 'Wind moves through the roofless hall. A sea-god\'s statue stands in the middle, worn smooth, and at its feet someone has left a fresh offering: a fish on a clay plate, still wet. Out past the broken wall, the lighthouse on Gannet Rock is dark.\n\nDo you inspect the offering at the statue\'s feet, or look out across the water toward the dark lighthouse?' },
    { role: 'user', content: 'I look closely at the statue.' },
    { role: 'assistant', content: 'Close up, the statue\'s chest is carved with fish scales, and behind its stone knees someone has scratched fresh charcoal marks: a row of tallies and an arrow pointing out to Gannet Rock. A small bundle wrapped in oilcloth is wedged in the gap beneath.\n\nDo you reach into the gap behind the knees, or leave the bundle undisturbed?' },
];
const PLAYER_TURNS = [
    'I take the bundle and unwrap it.',
    'I climb what is left of the stairs to the top of the temple wall and look out over the harbor.',
    'I go back down to the harbor and look over the merchant ship being loaded.',
    'I offer to help the crew get the ship ready to sail.',
    'I walk through the covered market by the customs house.',
    'I go into the harbor chapel and look around.',
];

function baseState(messages) {
    return {
        character: hero, inventory, quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e',
        customSystemPrompt: initialGameState.settings.customSystemPrompt, journal: [], npcs: [], party: [],
        currentLocation: LOCATION, combat: { active: false }, worldFacts: [], fronts, storyMemory: [], retrievedMemories: [],
        premise, recentRulings: [], recentChecks: [], paceDial: 'standard', messageCount: messages.length, messages,
    };
}

const JUDGE_SYSTEM = `You are an unvarnished editorial judge of tabletop-RPG narration. You read ONE Dungeon Master reply and judge only how it ENDS — its last two sentences. Answer exactly one of:
- "narrator_choice": the NARRATOR (not a character's quoted speech) closes on a question that lists two or more alternative actions for the player ("Do you push on, or lie low?", "Do you look inside the hatch, or wait first?", a list of options).
- "character_choice": a CHARACTER, in quoted speech, poses an either/or to the player's hero ("You getting in, or am I shoving off alone?", "Buying or selling?").
- "open": anything else — an open question ("What do you do?", "What are you looking for?"), a demand, an offer of one thing, or the situation simply left as it stands.
Reply with ONLY a JSON object: {"ending": "narrator_choice" | "character_choice" | "open"}.`;
async function judge(text) {
    const raw = await sendMessage({ provider: 'gemini', apiKey: KEY, model: MACHINERY_MODEL, fallbackModel: MACHINERY_FALLBACK_MODEL, systemPrompt: JUDGE_SYSTEM, messageHistory: [], userMessage: text, temperature: 0, thinkingBudget: 0, maxOutputTokens: 200, timeoutMs: 60000 });
    const parsed = parseJsonObjectLoose(String(raw || ''));
    if (!parsed || !['narrator_choice', 'character_choice', 'open'].includes(parsed.ending)) return { error: `unparseable: ${String(raw).slice(0, 100)}` };
    return { ending: parsed.ending };
}

async function runArm(variant, run) {
    const history = SEEDED_HISTORY.map(m => ({ ...m }));
    const turns = [];
    for (let i = 0; i < PLAYER_TURNS.length; i += 1) {
        const userMessage = PLAYER_TURNS[i];
        const messages = history.map(m => ({ role: m.role, content: m.content }));
        let systemPrompt = buildSystemPrompt(baseState(messages));
        if (variant === 'before') systemPrompt = toBeforePrompt(systemPrompt);
        let text = '';
        let error = null;
        try {
            text = String(parseResponse(await sendMessage({ ...DM, systemPrompt, messageHistory: history, userMessage })).narrative || '').trim();
        } catch (e) { error = String(e?.message || e); }
        const score = text ? await judge(text).catch(e => ({ error: String(e?.message || e) })) : { error: error || 'empty' };
        turns.push({ index: i + 1, userMessage, text, ending: score.ending || null, judgeError: score.error || null, error });
        history.push({ role: 'user', content: userMessage });
        history.push({ role: 'assistant', content: text || '(no response)' });
        process.stderr.write(`  ${variant} #${run} turn ${i + 1}: ${score.ending || score.error}\n`);
    }
    return { variant, run, turns };
}

const arms = [];
for (let run = 1; run <= RUNS; run += 1) for (const variant of ['before', 'after']) arms.push(await runArm(variant, run));
const tally = variant => {
    const turns = arms.filter(a => a.variant === variant).flatMap(a => a.turns).filter(t => t.ending);
    const count = kind => turns.filter(t => t.ending === kind).length;
    return `${count('narrator_choice')} of ${turns.length} turns close on the narrator's either/or; ${count('character_choice')} on a character's; ${count('open')} open`;
};
const lastLines = text => text.split(/(?<=[.!?”"])\s+/).slice(-2).join(' ');
const lines = [
    `# Offered-choice endings, ${new Date().toISOString()}`,
    '',
    `DM ${DM.model}, default campaign prompt, a history seeded with two narrator either/or endings, then ${PLAYER_TURNS.length} chained turns × ${RUNS} run(s) per arm; judge ${MACHINERY_MODEL} reads each turn's ending.`,
    '',
    `- before: ${tally('before')}`,
    `- after: ${tally('after')}`,
    '',
    '## Endings',
    ...arms.flatMap(a => a.turns.map(t => `- ${a.variant} #${a.run} t${t.index} **${t.ending || t.judgeError}**: ${lastLines(t.text || t.error || '').slice(0, 300)}`)),
];
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join(OUT_DIR, stamp);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'raw.json'), JSON.stringify(arms, null, 1));
console.log(lines.slice(0, 7).join('\n'));
console.log(`\nReport: ${path.relative(repoRoot, dir)}`);
