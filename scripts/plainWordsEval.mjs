#!/usr/bin/env node
/**
 * Real-provider eval of PLAIN WORDS (2026-11-09, Vesa: "it's been super heavy
 * reading 2-3 paragraphs full of ancient Roman architectural words … that even
 * Google can hardly find"). Eight chained ordinary turns walk the hero through
 * places that invite jargon — temple ruins, a statue, a ship being loaded, an
 * armorer, a market arcade, a chapel's carvings — on the default campaign
 * prompt, run BEFORE (the rule cut out of the built prompt by string surgery)
 * and AFTER. A thinking-free Flash judge lists, per DM turn, every word an
 * ordinary adult reader of English (a fluent non-native reader included)
 * would have to look up; names are excluded. Local word count beside it.
 *
 *   npm.cmd run eval:plainwords
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:plainwords
 *
 * Key from the environment or the git-ignored .env (GEMINI_API_KEY). Writes a
 * markdown report + raw JSON to test-results/plainwords/.
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
const RUNS = Math.max(1, Math.min(4, Number(process.env.QF_EVAL_RUNS) || 2));
const DM = { provider: 'gemini', apiKey: KEY, model: process.env.QF_EVAL_GEMINI_MODEL || 'gemini-3.8-flash' };
const OUT_DIR = path.join(repoRoot, 'test-results', 'plainwords');

// The rule as shipped; the BEFORE arm cuts exactly these out (and fails loudly if they moved).
const PLAIN_LINE = '\n**PLAIN WORDS.** Write everyday English a reader never has to look up. At most ONE specialist or archaic term in a whole turn (architecture, sailing, armor, crafts, trade), and only when the sentence makes its meaning plain; every other time, the everyday word — candle, not tallow dip; fire basket, not brazier; dock, not quay; chain armor, not mail or hauberk; stone floor, not flagstones; pedestal, not plinth; ropes, not halyards or tackle. Vividness comes from what happens and how it feels, never from rare nouns. Names of people and places are exempt.';
const PARTICULAR_CLAUSE = ', named in plain words a reader knows — "a stone pedestal", not "a fluted plinth"; "the ship\'s ropes", not "the halyards"';
function toBeforePrompt(systemPrompt) {
    if (!systemPrompt.includes(PLAIN_LINE) || !systemPrompt.includes(PARTICULAR_CLAUSE)) throw new Error('The PLAIN WORDS rule was not found as shipped — the BEFORE surgery is stale.');
    return systemPrompt.replace(PLAIN_LINE, '').replace(PARTICULAR_CLAUSE, '');
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
const OPENING = `Grey morning over Saltmere. ${heroName} has climbed the cliff path to the old sea-temple, roofless for a century, where the gulls nest in the broken walls. Below, the harbor is busy: a merchant ship, the Gannet's Pride, is taking on cargo at the long quay.`;
const PLAYER_TURNS = [
    'I walk into the ruined temple and look around.',
    'I look closely at the big statue in the middle of the ruined hall.',
    'I climb what is left of the stairs to the top of the temple wall and look out over the harbor.',
    'I go back down to the harbor and look over the merchant ship being loaded.',
    'I offer to help the crew get the ship ready to sail.',
    'I stop at the armorer\'s stall on the quay and look at what she is selling.',
    'I walk through the covered market by the customs house.',
    'I go into the harbor chapel and look at the carvings on the walls.',
];

function baseState(messages) {
    return {
        character: hero, inventory, quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e',
        customSystemPrompt: initialGameState.settings.customSystemPrompt, journal: [], npcs: [], party: [],
        currentLocation: LOCATION, combat: { active: false }, worldFacts: [], fronts, storyMemory: [], retrievedMemories: [],
        premise, recentRulings: [], recentChecks: [], paceDial: 'standard', messageCount: messages.length, messages,
    };
}
const wordCount = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;

const JUDGE_SYSTEM = `You are an unvarnished reading-difficulty judge. You read ONE passage of fantasy-game narration and list every word or term in it that an ordinary adult reader of English — including a fluent non-native reader — would most likely have to look up to understand: specialist terms of architecture, sailing, armor and weapons, crafts, trade, religion, or archaic and literary words. Do NOT list proper names (people, places, ships), invented names, or words an ordinary reader knows. List each such word once, exactly as written. Reply with ONLY a JSON object: {"hard_words": ["..."]}.`;
async function judge(text) {
    const raw = await sendMessage({ provider: 'gemini', apiKey: KEY, model: MACHINERY_MODEL, fallbackModel: MACHINERY_FALLBACK_MODEL, systemPrompt: JUDGE_SYSTEM, messageHistory: [], userMessage: text, temperature: 0, thinkingBudget: 0, maxOutputTokens: 600, timeoutMs: 60000 });
    const parsed = parseJsonObjectLoose(String(raw || ''));
    if (!parsed || !Array.isArray(parsed.hard_words)) return { error: `unparseable: ${String(raw).slice(0, 100)}` };
    return { hardWords: [...new Set(parsed.hard_words.map(w => String(w).trim()).filter(Boolean))] };
}

async function runArm(variant, run) {
    const history = [{ role: 'assistant', content: OPENING }];
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
        turns.push({ index: i + 1, userMessage, text, words: wordCount(text), hardWords: score.hardWords || [], judgeError: score.error || null, error });
        history.push({ role: 'user', content: userMessage });
        history.push({ role: 'assistant', content: text || '(no response)' });
        process.stderr.write(`  ${variant} #${run} turn ${i + 1}: ${wordCount(text)} words, ${(score.hardWords || []).length} hard${score.error ? ' (' + score.error.slice(0, 40) + ')' : ''}\n`);
    }
    return { variant, run, turns };
}

const arms = [];
for (let run = 1; run <= RUNS; run += 1) for (const variant of ['before', 'after']) arms.push(await runArm(variant, run));
const summary = variant => {
    const turns = arms.filter(a => a.variant === variant).flatMap(a => a.turns).filter(t => t.text && !t.judgeError);
    const hard = turns.reduce((n, t) => n + t.hardWords.length, 0);
    const words = turns.reduce((n, t) => n + t.words, 0);
    return { turns: turns.length, hard, perTurn: (hard / Math.max(1, turns.length)).toFixed(2), per100: (100 * hard / Math.max(1, words)).toFixed(2), over1: turns.filter(t => t.hardWords.length > 1).length, medianWords: turns.map(t => t.words).sort((a, b) => a - b)[Math.floor(turns.length / 2)] || 0 };
};
const before = summary('before');
const after = summary('after');
const lines = [
    `# Plain words, ${new Date().toISOString()}`,
    '',
    `DM ${DM.model}, default campaign prompt, ${PLAYER_TURNS.length} chained turns × ${RUNS} run(s) per arm; judge ${MACHINERY_MODEL} lists the words an ordinary reader would look up (names excluded).`,
    '',
    '| Arm | Scored turns | Hard words | Per turn | Per 100 words | Turns with 2+ | Median words |',
    '|---|---|---|---|---|---|---|',
    `| before | ${before.turns} | ${before.hard} | ${before.perTurn} | ${before.per100} | ${before.over1} | ${before.medianWords} |`,
    `| after | ${after.turns} | ${after.hard} | ${after.perTurn} | ${after.per100} | ${after.over1} | ${after.medianWords} |`,
    '',
    '## Hard words by arm',
    ...['before', 'after'].map(v => `- ${v}: ${arms.filter(a => a.variant === v).flatMap(a => a.turns).flatMap(t => t.hardWords).join(', ')}`),
    '',
    '## Turns',
    ...arms.flatMap(a => a.turns.map(t => `### ${a.variant} #${a.run} turn ${t.index} (${t.words} words; hard: ${t.hardWords.join(', ') || '—'})\n> ${t.userMessage}\n\n${t.text || t.error || '(empty)'}\n`)),
];
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join(OUT_DIR, stamp);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'raw.json'), JSON.stringify(arms, null, 1));
console.log(lines.slice(0, 12).join('\n'));
console.log(`\nReport: ${path.relative(repoRoot, dir)}`);
