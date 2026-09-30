#!/usr/bin/env node
/**
 * Real-provider "promise in the outcome" eval — the proof step of the
 * 2026-09-16 wow audit (checks-and-consequence, W1: the card's failure stakes
 * and the roll margin ride the [ROLL RESULT] line into the post-roll prompt).
 * Built 2026-09-30 as one of the six unrun WOW proofs.
 *
 * Ten FAILED out-of-combat checks, each with the ruling's publicly stated
 * failure stakes, sampled per DM provider and per variant: BEFORE (the old
 * result line — "FAILURE", no stakes, no margin) and AFTER (the shipped line
 * from formatRollSummary — margin band + "The ruling promised on failure: …").
 * The post-roll user message is the resolver's own SYSTEM text. A thinking-free
 * Gemini Flash judge scores each narration (JSON only):
 *
 *   matches_stakes      the consequence narrated IS the one the ruling promised
 *   single_consequence  one proportionate consequence, no cascade of extra punishments
 *   no_second_check     no new roll requested for the same objective (also read from events)
 *   competence_kept     the hero is not made clumsy, cowardly, stammering, or inarticulate
 *   live_choice         the narration ends on a live choice / open question
 *
 * PASS = matches_stakes && single_consequence && no_second_check && competence_kept.
 * Providers: Gemini Pro + GPT Terra (never Grok). Keys from env / .env.
 *
 *   npm.cmd run eval:consequence
 *   $env:QF_EVAL_PROVIDERS="gemini"; npm.cmd run eval:consequence
 *   $env:QF_EVAL_VARIANTS="after"; npm.cmd run eval:consequence
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
import { MACHINERY_MODEL } from '../src/llm/machinery.js';
import { createInitialFronts } from '../src/engine/fronts.js';
import { formatRollSummary } from '../src/engine/rollResolver.js';

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
const VARIANTS = (process.env.QF_EVAL_VARIANTS || 'before,after').split(',').map(s => s.trim()).filter(v => ['before', 'after'].includes(v));
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(here, '.eval-out');

// --- fixture: the level-1 fighter on the Saltmere starter (the turn-grammar eval's) ---
const heroName = 'Astra';
const starter = findPremiseStarter('saltmere-debt');
const premise = buildPremiseFromStarter(starter, heroName);
const LOCATION = 'Saltmere, seaward pier';
const hero = {
    name: heroName, race: 'human', class: 'fighter', level: 1, exp: 0, currentHP: 12, maxHP: 12, armorClass: 16,
    gold: 0, silver: 7, copper: 20, speed: 30, gender: 'woman',
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
    { id: 'item-rope', name: 'Hempen Rope (50 ft)', type: 'gear', quantity: 1 },
];
const fronts = createInitialFronts({ premise, character: hero, location: LOCATION });
const OPENING = `The tide-bell has just rung the seventh hour over Saltmere and the last morning of the herring run is grey and cold. ${heroName} stands on the seaward pier with the Kittiwake riding low beside it, the hold still half full. Old Tammo is at his brazier mending a net; up the quay, the lamp is already lit in Harbormaster Orsa Pellwyn's office. Beyond the breakwater the lighthouse on Gannet Rock is dark again.`;

// Ten failed checks. `approach` is the player's line; `setup` the DM's withheld
// setup (re-injected exactly as the resolver does); the roll fields are what
// resolvePlayerRoll returns. Margins span the bands: near miss, mid, wide, natural 1.
const CHECKS = [
    { id: 'orsa-extension', skill: 'persuasion', dc: 12, rolled: 10, margin: -2,
      approach: 'I put the tally on Orsa\'s desk and ask her, straight, for one more month on the Kittiwake before the gales.',
      setup: 'Orsa Pellwyn does not look up from the brass-cornered ledger. "One more month," she repeats, as if tasting something gone off. The pen stops.',
      objective: 'Persuade Orsa Pellwyn to grant a month\'s extension on the Kittiwake debt',
      stakes: 'Orsa refuses and adds a late-fee of two silver to the ledger, in front of the tallymen' },
    { id: 'bell-keeper-rumor', skill: 'persuasion', dc: 10, rolled: 4, margin: -6,
      approach: 'I ask the bell-keeper to tell me what he really saw out at Gannet Rock, and press him gently when he hesitates.',
      setup: 'The bell-keeper wipes his hands on his apron and glances at the door before he answers.',
      objective: 'Get the bell-keeper to say what he saw at Gannet Rock',
      stakes: 'He clams up and tells the harbor you are asking questions about the lighthouse' },
    { id: 'lift-the-crate', skill: 'athletics', dc: 12, rolled: 11, margin: -1,
      approach: 'I get under the sodden salt-crate alone and try to heave it up the last three steps of the landing.',
      setup: 'The crate is heavier than it looks, salt-swollen and slick.',
      objective: 'Carry the salt-crate up the landing steps alone',
      stakes: 'The crate slips and splits on the steps; a third of the salt is lost to the water' },
    { id: 'insight-orsa', skill: 'insight', dc: 12, rolled: 8, margin: -4,
      approach: 'I watch Orsa\'s face while she talks about the keeper and try to work out what she is not saying.',
      setup: 'Orsa keeps her eyes on the ledger and her voice level.',
      objective: 'Read what Orsa is hiding about the lighthouse keeper',
      stakes: 'You misread her: you come away sure she is frightened of the keeper, when she is not' },
    { id: 'sneak-the-larder', skill: 'stealth', dc: 12, rolled: 1, margin: -11, naturalOne: true,
      approach: 'I slip into the tally-house larder while the clerk is out the back, keeping low behind the barrels.',
      setup: 'The larder door sticks. Inside, the barrels stand in a row under a single shuttered window.',
      objective: 'Get into the tally-house larder unseen',
      stakes: 'The clerk finds you in the larder and marches you to Orsa' },
    { id: 'haggle-rope', skill: 'persuasion', dc: 10, rolled: 7, margin: -3,
      approach: 'I tell the chandler his rope is fraying at the bight and offer him six silver for the coil instead of ten.',
      setup: 'The chandler turns the coil over in his hands, unhurried.',
      objective: 'Talk the chandler down to six silver for the rope',
      stakes: 'He keeps the price at ten and will not sell you the good coil at all today' },
    { id: 'climb-breakwater', skill: 'athletics', dc: 12, rolled: 6, margin: -6,
      approach: 'I climb the wet face of the breakwater to reach the ledge where the gull-eggs are.',
      setup: 'The breakwater stones are green with weed below the tide line and the wind is up.',
      objective: 'Climb the breakwater to the gull-egg ledge',
      stakes: 'You fall into the surf: you lose the lantern and take a bruising, and the eggs stay where they are' },
    { id: 'deceive-tallyman', skill: 'deception', dc: 12, rolled: 11, margin: -1,
      approach: 'I tell the tallyman the second cart is Tammo\'s and already counted, and keep walking.',
      setup: 'The tallyman looks from the cart to you and back.',
      objective: 'Get the second cart past the tallyman uncounted',
      stakes: 'He does not believe you, counts the cart, and notes your name beside it' },
    { id: 'perception-fog', skill: 'perception', dc: 12, rolled: 9, margin: -3,
      approach: 'I stand at the end of the pier and try to make out whether there is a light or a boat anywhere near Gannet Rock.',
      setup: 'The fog is thick past the breakwater; the bell buoy sounds somewhere out in it.',
      objective: 'Spot a light or boat near Gannet Rock through the fog',
      stakes: 'You see nothing, and while you stare out to sea someone lifts the coil of rope from beside your boots' },
    { id: 'intimidate-dockhand', skill: 'intimidation', dc: 12, rolled: 7, margin: -5,
      approach: 'I step in close to the dockhand who has been mouthing off and tell him quietly that the next word costs him teeth.',
      setup: 'The dockhand is bigger than you remembered, and two of his friends have stopped working to watch.',
      objective: 'Make the dockhand back down',
      stakes: 'He laughs it off in front of his friends and the story of it is around the pier by noon' },
];

function baseState(messages) {
    return {
        character: hero, inventory, quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e',
        customSystemPrompt: initialGameState.settings.customSystemPrompt, journal: [], npcs: [], party: [],
        currentLocation: LOCATION, combat: { active: false }, worldFacts: [], fronts, storyMemory: [], retrievedMemories: [],
        premise, recentRulings: [], recentChecks: [], paceDial: 'standard', messageCount: messages.length, messages,
    };
}

/** The resolver's own post-roll SYSTEM text (rollResolver.js), minus the hp/loot/correction notes this fixture never carries. */
function outcomeMessage(summary, setup) {
    const setupNote = `\n\n[CONTEXT — your own setup narration for this beat, which the player NEVER saw (it was withheld pending these dice): """${setup}""" Re-establish the scene elements and any new fiction it introduced (arrivals, terrain, discoveries, dialogue) in your outcome narration so nothing is lost — but the ROLL RESULT lines are the sole authority on success or failure.]`;
    return `[SYSTEM: Dice rolled — results below. Narrate the outcome in ONE cohesive, vivid pass that reads naturally on its own. Weave in just enough of the action for context, but do NOT retell at length or repeat beats you have already narrated. RULES: (1) Respect the dice exactly — a roll below the DC is a failure. (2) Do NOT re-request these same rolls. (3) If a result already shows "HIT for N damage", the damage is done — do NOT request a damage roll for it. (4) Never narrate a result that is not supported by the rolls below. (5) If the result starts combat, declare combat_start; active combat actions use combat_exchange rather than requested_rolls. (6) Do NOT re-emit coin, loot, XP, purchase, or rest events that were already applied on this or earlier turns — recapping money or rewards already handled is narration only, never an event.]${setupNote}\n\n${summary}`;
}

function summaryFor(check, variant) {
    const base = { type: 'skill_check', skill: check.skill, description: `${check.skill.charAt(0).toUpperCase() + check.skill.slice(1)} check: ${check.objective}`, dc: check.dc, rolled: check.rolled, success: false, critical: false };
    if (variant === 'before') return formatRollSummary([base]); // no margin → the old bare line
    return formatRollSummary([{ ...base, margin: check.margin, failureStakes: check.stakes, objective: check.objective, naturalOne: !!check.naturalOne }]);
}

const wordCount = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;

async function runOne({ providerName, variant, check }) {
    const cfg = PROVIDERS[providerName];
    const history = [
        { role: 'assistant', content: OPENING },
        { role: 'user', content: check.approach },
    ];
    const systemPrompt = buildSystemPrompt(baseState(history));
    const summary = summaryFor(check, variant);
    const userMessage = outcomeMessage(summary, check.setup);
    const started = Date.now();
    let raw = '';
    let error = null;
    try {
        raw = await sendMessage({ ...cfg, systemPrompt, messageHistory: history, userMessage });
    } catch (e) { error = String(e?.message || e); }
    const { narrative, events } = error ? { narrative: '', events: null } : parseResponse(raw);
    const text = String(narrative || '').trim();
    const rollRequested = Array.isArray(events?.requestedRolls) && events.requestedRolls.length > 0;
    process.stderr.write(`  ${providerName}/${variant}/${check.id}: ${text ? wordCount(text) + ' words' : (error ? 'ERROR' : 'empty')}${rollRequested ? ' [roll requested]' : ''}\n`);
    return { providerName, model: cfg.model, variant, checkId: check.id, summary, narrative: text, raw: String(raw || ''), rollRequested, error, ms: Date.now() - started, words: wordCount(text) };
}

const JUDGE_SYSTEM = `You are an unvarnished editorial judge of tabletop-RPG narration. A player attempted something, the dice FAILED, and before the dice the table had publicly stated what failure would cost (the STAKES). You score the DM's outcome narration. Reply with ONLY a JSON object — no prose, no fences.

Rubric:
- "consequence_delivered": true if the narration lands a concrete negative consequence for the failure (not merely "it does not work").
- "matches_stakes": true if the consequence narrated IS the stated stakes (same substance — the fee, the lost salt, the story spreading…), not a different or milder penalty.
- "single_consequence": true if there is ONE proportionate consequence; false if failure cascades into extra punishments, a second setback, or a worsening spiral.
- "no_second_check": true if the narration does not ask the player to roll again for the same objective.
- "competence_kept": true if the hero is not made clumsy, cowardly, stammering, foolish, or inarticulate — the failure is external, the hero's chosen words and delivery stand.
- "live_choice": true if the narration ends on an open situation or question that hands play back to the player.
- "notes": one short sentence.

Output shape: {"consequence_delivered":bool,"matches_stakes":bool,"single_consequence":bool,"no_second_check":bool,"competence_kept":bool,"live_choice":bool,"notes":"..."}`;

async function judge(result, check) {
    if (!result.narrative) return null;
    const userMessage = `PLAYER'S APPROACH:\n${check.approach}\n\nSTATED FAILURE STAKES (public, before the dice):\n${check.stakes}\n\nDICE: ${result.summary}\n\nDM OUTCOME NARRATION:\n${result.narrative}`;
    const raw = await sendMessage({
        provider: 'gemini', apiKey: GEMINI_KEY, model: MACHINERY_MODEL,
        systemPrompt: JUDGE_SYSTEM, messageHistory: [], userMessage,
        temperature: 0, thinkingBudget: 0, maxOutputTokens: 600, timeoutMs: 60000,
    });
    const parsed = parseJsonObjectLoose(raw, ['matches_stakes', 'single_consequence']);
    if (!parsed) return { judgeError: `unparseable: ${String(raw).slice(0, 120)}` };
    const b = k => parsed[k] === true;
    return {
        consequence_delivered: b('consequence_delivered'), matches_stakes: b('matches_stakes'), single_consequence: b('single_consequence'),
        no_second_check: b('no_second_check') && !result.rollRequested, competence_kept: b('competence_kept'), live_choice: b('live_choice'),
        notes: String(parsed.notes || '').slice(0, 200),
    };
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');
const pass = s => s.matches_stakes && s.single_consequence && s.no_second_check && s.competence_kept;

function render(results) {
    const date = new Date().toISOString().slice(0, 10);
    const lines = [];
    lines.push(`# Roll-consequence eval — ${date}`);
    lines.push('');
    lines.push(`Proof step for "the promise in the outcome" (WOW 2026-09-16, checks-and-consequence W1; DECISIONS.md 2026-09-16). ${CHECKS.length} FAILED out-of-combat checks with public failure stakes, per provider per variant. BEFORE = the old bare result line ("FAILURE", no stakes or margin); AFTER = the shipped \`formatRollSummary\` line (margin band + "The ruling promised on failure: …"). The post-roll user message is the resolver's own SYSTEM text with the withheld setup re-injected. Judge: \`${MACHINERY_MODEL}\`, thinking-free, JSON-only, temperature 0. PASS = matches the stated stakes AND one consequence AND no second check AND competence kept.`);
    lines.push('');
    lines.push('| Provider | Variant | Scored | Pass ↑ | Consequence delivered | Matches stakes ↑ | Single consequence ↑ | No second check ↑ | Competence kept ↑ | Live choice ↑ | Median words |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const providerName of providers) {
        for (const variant of VARIANTS) {
            const rows = results.filter(r => r.providerName === providerName && r.variant === variant && r.score && !r.score.judgeError);
            const n = rows.length;
            const c = f => rows.filter(r => f(r.score)).length;
            const words = rows.map(r => r.words).sort((a, b) => a - b);
            const median = words.length ? words[Math.floor(words.length / 2)] : 0;
            lines.push(`| ${providerName} (${PROVIDERS[providerName].model}) | ${variant} | ${n}/${CHECKS.length} | ${pct(c(pass), n)} | ${pct(c(s => s.consequence_delivered), n)} | ${pct(c(s => s.matches_stakes), n)} | ${pct(c(s => s.single_consequence), n)} | ${pct(c(s => s.no_second_check), n)} | ${pct(c(s => s.competence_kept), n)} | ${pct(c(s => s.live_choice), n)} | ${median} |`);
        }
    }
    lines.push('');
    for (const providerName of providers) {
        for (const variant of VARIANTS) {
            lines.push(`## ${providerName} · ${variant} — per check`);
            lines.push('');
            lines.push('| Check | Words | Pass | Delivered | Matches | Single | No 2nd | Competence | Live | Judge note |');
            lines.push('|---|---|---|---|---|---|---|---|---|---|');
            for (const r of results.filter(x => x.providerName === providerName && x.variant === variant)) {
                const s = r.score;
                const yn = v => (v ? 'yes' : 'no');
                if (!s || s.judgeError) { lines.push(`| ${r.checkId} | ${r.words} | — | — | — | — | — | — | — | ${r.error ? 'DM error: ' + r.error.slice(0, 80) : s?.judgeError || 'empty'} |`); continue; }
                lines.push(`| ${r.checkId} | ${r.words} | ${yn(pass(s))} | ${yn(s.consequence_delivered)} | ${yn(s.matches_stakes)} | ${yn(s.single_consequence)} | ${yn(s.no_second_check)} | ${yn(s.competence_kept)} | ${yn(s.live_choice)} | ${s.notes.replace(/\|/g, '/')} |`);
            }
            lines.push('');
        }
    }
    lines.push('## Transcripts');
    lines.push('');
    for (const r of results) {
        if (!r.narrative) continue;
        lines.push(`### ${r.providerName} · ${r.variant} · ${r.checkId}`);
        lines.push('');
        lines.push(`> ${r.summary}`);
        lines.push('');
        lines.push(r.narrative.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n\n'));
        lines.push('');
    }
    return lines.join('\n');
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const results = [];
    await Promise.all(providers.map(async (providerName) => {
        for (const variant of VARIANTS) for (const check of CHECKS) results.push(await runOne({ providerName, variant, check }));
    }));
    for (const r of results) {
        const check = CHECKS.find(c => c.id === r.checkId);
        try { r.score = await judge(r, check); } catch (e) { r.score = { judgeError: String(e?.message || e).slice(0, 120) }; }
    }
    const report = render(results);
    fs.writeFileSync(path.join(OUT_DIR, `roll-consequence-${stamp}.json`), JSON.stringify({ variants: VARIANTS, providers, results }, null, 2));
    const reportPath = path.join(repoRoot, 'docs', `ROLL_CONSEQUENCE_EVAL_${stamp.slice(0, 10)}.md`);
    fs.writeFileSync(reportPath, report + '\n');
    console.log(report.split('\n## ')[0]);
    console.log(`\nReport: ${reportPath}`);
}
main().catch(e => { console.error(e); process.exit(1); });
