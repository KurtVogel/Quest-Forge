#!/usr/bin/env node
/**
 * Death-count eval — the proof step for "the count is on the page" (WOW
 * 2026-09-30, death-and-stakes W1; DECISIONS.md 2026-09-30).
 *
 * Two committed exchange results, rendered through the real
 * `combatNarrationPrompt` on the real narration-only system prompt:
 *   dying  — round 2, the hero at 0 HP with 1 success / 2 failures on the clock
 *   dead   — the third failed death save; engine terminal `defeat`, hero DEAD
 * Each is narrated N times per provider per variant. BEFORE = the pre-change
 * prompt (PLAYER line HP-only, "narrate the danger briefly", "setback or
 * collapse"); AFTER = the shipped prompt (PLAYER DYING with the tally, the
 * over-the-body ending, the DIED terminal). A thinking-free Gemini Flash judge
 * scores each narration, JSON only.
 *
 * Providers: Gemini Pro + GPT Terra (never Grok). Keys from env / .env.
 *   npm run eval:death                       (both providers, 5 runs)
 *   QF_EVAL_PROVIDERS=gemini QF_EVAL_RUNS=3 npm run eval:death
 * Report: scripts/.eval-out/death-count-<date>.md (+ .json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendMessage } from '../src/llm/adapter.js';
import { buildSystemPrompt } from '../src/llm/promptBuilder.js';
import { combatNarrationPrompt } from '../src/engine/combatExchange.js';
import { parseJsonObjectLoose } from '../src/llm/utils/jsonExtractor.js';
import { initialGameState } from '../src/state/initialState.js';
import { MACHINERY_MODEL } from '../src/llm/machinery.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
try {
    const envText = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
} catch { /* explicit env vars only */ }
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!GEMINI_KEY) { console.error('GEMINI_API_KEY is required (DM lane and the judge).'); process.exit(2); }

const PROVIDERS = {
    gemini: { provider: 'gemini', apiKey: GEMINI_KEY, model: process.env.QF_EVAL_GEMINI_MODEL || 'gemini-3.1-pro-preview' },
    openai: { provider: 'openai', apiKey: OPENAI_KEY, model: process.env.QF_EVAL_OPENAI_MODEL || 'gpt-5.6-terra' },
};
const wanted = (process.env.QF_EVAL_PROVIDERS || 'gemini,openai').split(',').map(s => s.trim()).filter(Boolean);
const providers = wanted.filter(name => PROVIDERS[name]?.apiKey);
for (const name of wanted) if (!PROVIDERS[name]?.apiKey) console.warn(`Skipping ${name}: no key.`);
if (providers.length === 0) process.exit(2);
const RUNS = Math.max(1, Number(process.env.QF_EVAL_RUNS) || 5);
const VARIANTS = (process.env.QF_EVAL_VARIANTS || 'before,after').split(',').map(s => s.trim()).filter(v => ['before', 'after'].includes(v));
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(here, '.eval-out');

// --- fixture: a level-3 fighter, a companion, two goblins, the hero down ---
const hero = {
    ...initialGameState.character,
    name: 'Astra', race: 'human', class: 'fighter', level: 3, exp: 900, currentHP: 0, maxHP: 20, armorClass: 16,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    savingThrowProficiencies: ['strength', 'constitution'], skillProficiencies: ['athletics', 'intimidation'], expertiseSkills: [],
    conditions: ['Unconscious'], dying: true, deathSaves: { successes: 1, failures: 2 },
    proficiencyBonus: 2, speed: 30, traits: [], features: ['Second Wind', 'Fighting Style: Defense'],
    classResources: { secondWind: { used: 1, max: 1 } }, hitDice: { total: 3, remaining: 3, die: 10 },
    gold: 4, silver: 12, copper: 0,
};
const party = [{ id: 'companion-1', name: 'Torvald', hp: 9, maxHp: 18, ac: 15, level: 2, affinity: 60, status: 'healthy', weapon: 'Longsword', damage: '1d8+2', attackBonus: 4, role: 'ally' }];
const enemies = [
    { id: 'enemy-1', name: 'Goblin Archer', hp: 7, maxHp: 7, ac: 13, condition: 'healthy', combatStatus: 'active', conditions: [] },
    { id: 'enemy-2', name: 'Goblin Cutter', hp: 2, maxHp: 7, ac: 13, condition: 'critical', combatStatus: 'active', conditions: [] },
];
const combat = {
    active: true, round: 3, phase: 'awaiting_narration', surprise: 'none', enemies,
    turnOrder: [
        { type: 'player', name: 'Astra', initiative: 14 },
        { type: 'companion', id: 'companion-1', name: 'Torvald', initiative: 11 },
        { type: 'enemy', id: 'enemy-1', name: 'Goblin Archer', initiative: 9 },
        { type: 'enemy', id: 'enemy-2', name: 'Goblin Cutter', initiative: 6 },
    ],
    currentTurn: 0,
};
const messageHistory = [
    { role: 'user', content: 'I put myself between the archer and Torvald.' },
    { role: 'assistant', content: 'The arrow takes you under the collarbone as you step across; the world tilts and the pier boards come up to meet you. Torvald shouts your name. The cutter, bleeding from the thigh, limps toward you with its blade low; the archer nocks again from the barrels. What do you do?' },
];

function systemPrompt() {
    return buildSystemPrompt({
        character: hero, inventory: [{ id: 'sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true }],
        quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e', customSystemPrompt: initialGameState.settings.customSystemPrompt,
        journal: [], npcs: [], party, currentLocation: 'Saltmere, seaward pier', combat, worldFacts: [], fronts: [], storyMemory: [], retrievedMemories: [],
        messages: messageHistory, messageCount: messageHistory.length, narrationOnly: true,
    });
}

const dyingResult = {
    exchangeId: 'exchange-3', round: 3, terminal: 'dying',
    events: [
        { type: 'death_save', natural: 4, actor: 'Astra', outcome: 'failure', successes: 1, failures: 2 },
        { type: 'attack', attacker: 'Torvald', target: 'Goblin Cutter', roll: 17, attackBonus: 4, total: 21, targetAc: 13, hit: true, damage: 6, remainingHp: 0, maxHp: 7 },
        { type: 'attack', attacker: 'Goblin Archer', target: 'Torvald', roll: 8, attackBonus: 4, total: 12, targetAc: 15, hit: false },
    ],
    postState: {
        player: { name: 'Astra', hp: 0, maxHp: 20, status: 'dying', deathSaves: { successes: 1, failures: 2 } },
        companions: [{ id: 'companion-1', name: 'Torvald', hp: 9, maxHp: 18 }],
        enemies: [
            { id: 'enemy-1', name: 'Goblin Archer', hp: 7, maxHp: 7, status: 'active', condition: 'healthy', conditions: [] },
            { id: 'enemy-2', name: 'Goblin Cutter', hp: 0, maxHp: 7, status: 'defeated', condition: 'dead', conditions: [] },
        ],
    },
};
const deadResult = {
    exchangeId: 'exchange-4', round: 4, terminal: 'defeat',
    events: [
        { type: 'death_save', natural: 6, actor: 'Astra', outcome: 'dead', successes: 1, failures: 3 },
        { type: 'attack', attacker: 'Torvald', target: 'Goblin Archer', roll: 9, attackBonus: 4, total: 13, targetAc: 13, hit: true, damage: 4, remainingHp: 3, maxHp: 7 },
    ],
    postState: {
        player: { name: 'Astra', hp: 0, maxHp: 20, status: 'dead', deathSaves: { successes: 1, failures: 3 } },
        companions: [{ id: 'companion-1', name: 'Torvald', hp: 9, maxHp: 18 }],
        enemies: [
            { id: 'enemy-1', name: 'Goblin Archer', hp: 3, maxHp: 7, status: 'active', condition: 'bloodied', conditions: [] },
            { id: 'enemy-2', name: 'Goblin Cutter', hp: 0, maxHp: 7, status: 'defeated', condition: 'dead', conditions: [] },
        ],
    },
};

/** The pre-2026-09-30 prompt, reconstructed from the shipped one (the three lines the slice changed). */
function beforeVariant(prompt, kind) {
    let out = prompt
        .replace(/^- PLAYER DYING: Astra — 0\/20 HP;[^\n]*$/m, '- PLAYER: Astra — 0/20 HP.')
        .replace(/^- PLAYER DEAD: Astra — 0\/20 HP;[^\n]*$/m, '- PLAYER: Astra — 0/20 HP.');
    if (kind === 'dying') {
        out = out.replace(/^The player remains unconscious and dying\. Narrate this round[^\n]*$/m, 'The player remains unconscious and dying. Narrate the danger briefly without ending combat.');
    } else {
        out = out.replace(/^The player has DIED[^\n]*$/m, 'The player is mechanically defeated. Narrate the setback or collapse without adding more damage.');
    }
    // The chat line inside RESOLVED EVENTS was a bare "natural N." before.
    out = out.replace(/(\*\*Death Saving Throw:\*\* natural \*\*\d+\*\*)[^\n]*/g, '$1.');
    return out;
}

const SCENARIOS = [
    { id: 'dying-round', kind: 'dying', result: dyingResult },
    { id: 'death-terminal', kind: 'dead', result: deadResult },
];

const JUDGE_SYSTEM = `You are an unvarnished editorial judge of tabletop-RPG combat narration. The engine has resolved a round in which the hero is UNCONSCIOUS AND DYING (or has just DIED). You score the DM's narration of that round. Reply with ONLY a JSON object — no prose, no fences.
- "names_count": true if the prose conveys where the death-save clock stands — how many failures or successes, or that one more failure means death, or that the hero is a breath from stable — in any wording (numbers, "one more", "twice now", "a third").
- "party_over_body": true if a living companion or foe visibly does something ABOUT the fallen hero (kneels, drags, shields, presses a wound, rushes, stands over) — not merely fights elsewhere.
- "ends_combat": true if the prose narrates the fight as finished or the scene as resolved (it must not, while dying).
- "invents_attack": true if the prose adds an attack, hit, or wound the RESOLVED EVENTS did not contain.
- "says_died": true if the prose states plainly that the hero has died / is dead (not "falls", "goes still", "darkness takes" without the death itself).
- "rescue_or_revival": true if the prose adds a rescue, a revival, a last breath that turns out fine, a healer arriving, or otherwise leaves the death in doubt.
- "notes": one short sentence.
Output shape: {"names_count":bool,"party_over_body":bool,"ends_combat":bool,"invents_attack":bool,"says_died":bool,"rescue_or_revival":bool,"notes":"..."}`;

async function judge(narrative, kind, resolved) {
    const userMessage = `SCENARIO: ${kind === 'dying' ? 'the hero is dying with 1 success and 2 failures on the death-save clock; the round continues' : 'the hero has just failed the third death save and is DEAD; the fight ends here'}\n\nRESOLVED EVENTS (authoritative):\n${resolved}\n\nDM NARRATION:\n${narrative}`;
    const raw = await sendMessage({
        provider: 'gemini', apiKey: GEMINI_KEY, model: MACHINERY_MODEL,
        systemPrompt: JUDGE_SYSTEM, messageHistory: [], userMessage,
        temperature: 0, thinkingBudget: 0, maxOutputTokens: 600, timeoutMs: 60000,
    });
    const parsed = parseJsonObjectLoose(raw, ['names_count', 'says_died']);
    if (!parsed) return { judgeError: `unparseable: ${String(raw).slice(0, 120)}` };
    const b = k => parsed[k] === true;
    return { names_count: b('names_count'), party_over_body: b('party_over_body'), ends_combat: b('ends_combat'), invents_attack: b('invents_attack'), says_died: b('says_died'), rescue_or_revival: b('rescue_or_revival'), notes: String(parsed.notes || '').slice(0, 200) };
}

const passDying = s => (s.names_count || s.party_over_body) && !s.ends_combat && !s.invents_attack;
const passDead = s => s.says_died && !s.rescue_or_revival;
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');

function render(results) {
    const date = new Date().toISOString().slice(0, 10);
    const lines = [];
    lines.push(`# Death-count eval — ${date}`);
    lines.push('');
    lines.push(`Proof step for "the count is on the page" (WOW 2026-09-30, death-and-stakes W1). Two committed exchange results — a DYING round (1 success / 2 failures) and the DEATH terminal — narrated ${RUNS}× per provider per variant through the real narration-only prompt. BEFORE = the pre-change prompt (HP-only PLAYER line, "narrate the danger briefly", "setback or collapse", bare "natural N." lines); AFTER = the shipped prompt (PLAYER DYING with the tally, the over-the-body ending, the DIED terminal, the countdown line). Judge: \`${MACHINERY_MODEL}\`, thinking-free, JSON-only, temperature 0. DYING pass = names the count OR the party acts over the body, AND does not end combat, AND invents no attack. DEATH pass = says the hero died AND adds no rescue / revival.`);
    lines.push('');
    lines.push('| Provider | Variant | Scenario | Scored | Pass ↑ | Names count | Party over body | Ends combat ↓ | Invents attack ↓ | Says died | Rescue/revival ↓ | Median words |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const providerName of providers) {
        for (const variant of VARIANTS) {
            for (const scenario of SCENARIOS) {
                const rows = results.filter(r => r.providerName === providerName && r.variant === variant && r.scenarioId === scenario.id && r.score && !r.score.judgeError);
                const n = rows.length;
                const count = key => rows.filter(r => r.score[key]).length;
                const passes = rows.filter(r => (scenario.kind === 'dying' ? passDying(r.score) : passDead(r.score))).length;
                const words = rows.map(r => r.words).sort((a, b) => a - b);
                const median = words.length ? words[Math.floor(words.length / 2)] : '—';
                lines.push(`| ${providerName} | ${variant} | ${scenario.id} | ${n} | ${pct(passes, n)} | ${pct(count('names_count'), n)} | ${pct(count('party_over_body'), n)} | ${pct(count('ends_combat'), n)} | ${pct(count('invents_attack'), n)} | ${pct(count('says_died'), n)} | ${pct(count('rescue_or_revival'), n)} | ${median} |`);
            }
        }
    }
    lines.push('');
    lines.push('## Narrations');
    for (const r of results) {
        lines.push('');
        lines.push(`### ${r.providerName} · ${r.variant} · ${r.scenarioId} · run ${r.run}`);
        if (r.error) { lines.push(`DM error: ${r.error}`); continue; }
        lines.push(`Judge: ${JSON.stringify(r.score)}`);
        lines.push('');
        lines.push(r.narrative.split('\n').map(l => `> ${l}`).join('\n'));
    }
    return lines.join('\n');
}

const results = [];
const base = systemPrompt();
for (const providerName of providers) {
    const cfg = PROVIDERS[providerName];
    for (const variant of VARIANTS) {
        for (const scenario of SCENARIOS) {
            const userMessage = combatNarrationPrompt(scenario.result, { cost: scenario.kind === 'dead' ? 'COST OF THIS FIGHT: Astra 20→0 HP (DOWN at 0 HP in round 2, 4 death saves); Torvald 18→9 HP; 4 rounds.' : null });
            const sys = variant === 'before' ? beforeVariant(base, scenario.kind) : base;
            const user = variant === 'before' ? beforeVariant(userMessage, scenario.kind) : userMessage;
            for (let run = 1; run <= RUNS; run++) {
                const r = { providerName, model: cfg.model, variant, scenarioId: scenario.id, run };
                try {
                    const text = await sendMessage({ provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model, systemPrompt: sys, messageHistory, userMessage: user, timeoutMs: 120000, maxRetries: 1 });
                    r.narrative = String(text || '').replace(/```json[\s\S]*$/m, '').trim();
                    r.words = r.narrative.split(/\s+/).filter(Boolean).length;
                    try { r.score = await judge(r.narrative, scenario.kind, user.slice(user.indexOf('RESOLVED EVENTS:'))); } catch (e) { r.score = { judgeError: String(e?.message || e).slice(0, 120) }; }
                    const s = r.score;
                    console.log(`${providerName} ${variant} ${scenario.id} #${run}: ${s.judgeError ? 'judge error' : (scenario.kind === 'dying' ? (passDying(s) ? 'PASS' : 'FAIL') : (passDead(s) ? 'PASS' : 'FAIL'))} ${JSON.stringify(s)}`);
                } catch (e) {
                    r.error = String(e?.message || e).slice(0, 200);
                    console.log(`${providerName} ${variant} ${scenario.id} #${run}: DM error ${r.error}`);
                }
                results.push(r);
            }
        }
    }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const md = render(results);
fs.writeFileSync(path.join(OUT_DIR, `death-count-${date}.md`), md);
fs.writeFileSync(path.join(OUT_DIR, `death-count-${date}.json`), JSON.stringify(results, null, 2));
console.log(`\nReport: ${path.join(OUT_DIR, `death-count-${date}.md`)}`);
console.log(md.split('\n## Narrations')[0]);
