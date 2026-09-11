#!/usr/bin/env node
/**
 * Real-provider turn-grammar eval — the proof step of the 2026-09-11 wow audit
 * (ordinary-turn, W1: `## THE ORDINARY TURN`).
 *
 * 20 chained ordinary player turns on one fixed premise starter (saltmere-debt),
 * run twice per DM provider: BEFORE (the pre-block prompt: "end by asking" step +
 * "Leave space" line + the old custom-prompt closing line) and AFTER (the shipped
 * block). Every DM turn is scored by a thinking-free Gemini Flash judge on the
 * audit's rubric — echo-of-action / particular present / abstraction tic /
 * motion present / ask shape — plus a local word count.
 *
 *   npm.cmd run eval:turns                # both providers (gemini + xai) if keys exist
 *   $env:QF_EVAL_PROVIDERS="gemini"; npm.cmd run eval:turns
 *   $env:QF_EVAL_TURNS="6"; npm.cmd run eval:turns   # shorter smoke run
 *
 * Keys come from the environment or a git-ignored .env in the repo root
 * (GEMINI_API_KEY, XAI_API_KEY). The Gemini key is also the judge's key and is
 * therefore required. Writes a markdown report to docs/ and raw transcripts to
 * the path in QF_EVAL_OUT (default: scripts/.eval-out, git-ignored).
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

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// --- .env (git-ignored) → process.env, never overriding an explicit env var ---
try {
    const envText = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
} catch { /* no .env — explicit env vars only */ }

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const XAI_KEY = process.env.XAI_API_KEY;
if (!GEMINI_KEY) {
    console.error('GEMINI_API_KEY is required (DM lane and the judge).');
    process.exit(2);
}

const PROVIDERS = {
    gemini: { provider: 'gemini', apiKey: GEMINI_KEY, model: process.env.QF_EVAL_GEMINI_MODEL || 'gemini-3.1-pro-preview' },
    xai: { provider: 'xai', apiKey: XAI_KEY, model: process.env.QF_EVAL_XAI_MODEL || 'grok-4.3' },
};
const wanted = (process.env.QF_EVAL_PROVIDERS || 'gemini,xai').split(',').map(s => s.trim()).filter(Boolean);
const providers = wanted.filter(name => PROVIDERS[name]?.apiKey);
for (const name of wanted) if (!PROVIDERS[name]?.apiKey) console.warn(`Skipping ${name}: no key.`);
if (providers.length === 0) process.exit(2);

const TURN_COUNT = Math.max(1, Math.min(20, Number(process.env.QF_EVAL_TURNS) || 20));
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(here, '.eval-out');
const STARTER_ID = process.env.QF_EVAL_STARTER || 'saltmere-debt';
const VARIANTS = (process.env.QF_EVAL_VARIANTS || 'before,after').split(',').map(s => s.trim()).filter(v => ['before', 'after'].includes(v));

// --- fixed fixture: a level-1 fighter on the Saltmere starter ---
const heroName = 'Astra';
const starter = findPremiseStarter(STARTER_ID);
if (!starter) { console.error(`Unknown starter ${STARTER_ID}`); process.exit(2); }
const premise = buildPremiseFromStarter(starter, heroName);
const LOCATION = 'Saltmere, seaward pier';

const hero = {
    name: heroName, race: 'human', class: 'fighter', level: 1, exp: 0, currentHP: 12, maxHP: 12, armorClass: 16,
    gold: 0, silver: 7, copper: 20, speed: 30,
    gender: 'woman',
    appearance: 'Tall and rope-scarred across both palms, salt-bleached brown hair cut short, a chipped front tooth.',
    background: 'Came to Saltmere two winters ago owing money and saying nothing about where from.',
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    savingThrowProficiencies: ['strength', 'constitution'],
    skillProficiencies: ['athletics', 'perception'],
    conditions: [],
    features: ['Second Wind', 'Fighting Style'],
    fightingStyle: 'defense',
    classResources: { secondWind: { used: 0, max: 1 } },
};
const inventory = [
    { id: 'item-armor', name: 'Chain Mail', type: 'armor', armorType: 'heavy', baseAC: 16, equipped: true },
    { id: 'item-sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true },
    { id: 'item-rope', name: 'Hempen Rope (50 ft)', type: 'gear', quantity: 1 },
];

// Twenty ORDINARY actions: talk, walk, look, small errands — the beat the block
// governs. No declared attacks, no obvious checks. The same list feeds every run.
const PLAYER_TURNS = [
    'I climb down to the Kittiwake and start hauling the last of the herring crates up onto the pier.',
    'I walk over to Old Tammo\'s brazier and sit on the stool he keeps for me. "Cold one," I say.',
    'I ask Tammo whether he\'s heard anything about the lighthouse on Gannet Rock going dark.',
    'I head up the quay toward the harbormaster\'s office with the tally of the catch.',
    'I knock, go in, and put the tally on Orsa Pellwyn\'s desk without a word.',
    'I ask Orsa what I still owe on the Kittiwake after this run.',
    'I tell her I\'ll have the rest by spring and ask what she wants done about the boat before the gales.',
    'I leave the office and stop at the fish-market stalls to see who\'s buying today.',
    'I buy a hot pie from the nearest stall and eat it watching the breakwater.',
    'I go back down to the seaward pier and start checking the Kittiwake\'s hull for rot before we haul her up.',
    'I ask the nearest deckhand to lend a shoulder getting the boat onto the rollers.',
    'I take a break and look out toward Gannet Rock. Is there anything on the water?',
    'I walk to the tide-bell tower and ask the bell-keeper if the lighthouse keeper has come ashore lately.',
    'I head to the harbor tavern and order a small beer.',
    'I listen to the talk around me for a while and then ask the barkeep about the lighthouse keeper by name, if there is one.',
    'I finish the beer, thank the barkeep, and go looking for Tammo again.',
    'I tell Tammo I\'m thinking about rowing out to Gannet Rock tomorrow and ask what he thinks of it.',
    'I check my coin and my rope and head back to my bunk to sleep before the tide turns.',
    'Next morning I get up before dawn and go down to the pier to check the weather.',
    'I ask around the pier whether anyone has a small boat they\'d let me borrow for the morning.',
];

// --- BEFORE variant: the pre-2026-09-11 prompt, rebuilt by string surgery ---
const OLD_STEP_2 = '2. You end by asking the player what they do (or by presenting a choice)';
const NEW_STEP_2 = '2. You end on the situation\'s live question (THE ORDINARY TURN below owns the shape)';
const OLD_LEAVE_SPACE = '- **Leave space for the player.** After ordinary player input, answer the immediate consequence and stop. Do not keep writing past the next meaningful choice.';
const OLD_CUSTOM_LINE = 'Then ask “What do you do?” when the scene needs the player’s next move.';
const NEW_CUSTOM_LINE = 'End on the situation’s live question; write “What do you do?” only when nothing in the scene already asks it.';

function toBeforePrompt(systemPrompt) {
    const blockStart = systemPrompt.indexOf('## THE ORDINARY TURN');
    if (blockStart < 0 || !systemPrompt.includes(NEW_STEP_2)) {
        throw new Error('The shipped ORDINARY TURN block was not found — the eval\'s BEFORE surgery is stale.');
    }
    const blockEnd = systemPrompt.indexOf('\n## ', blockStart + 1);
    const before = systemPrompt.slice(0, blockStart).replace(/\n+$/, '\n') + OLD_LEAVE_SPACE + '\n' + systemPrompt.slice(blockEnd);
    return before.replace(NEW_STEP_2, OLD_STEP_2).replace(NEW_CUSTOM_LINE, OLD_CUSTOM_LINE);
}

function baseState(messages) {
    return {
        character: hero,
        inventory,
        quests: [],
        rollHistory: [],
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        customSystemPrompt: initialGameState.settings.customSystemPrompt,
        journal: [],
        npcs: [],
        party: [],
        currentLocation: LOCATION,
        combat: { active: false },
        worldFacts: [],
        // A real campaign always carries seeded fronts, and the WORLD TEMPO
        // block (with its QUIET line) renders only when a front is active —
        // without this the DM never saw "no unprovoked new threats".
        fronts,
        storyMemory: [],
        retrievedMemories: [],
        premise,
        recentRulings: [],
        recentChecks: [],
        paceDial: 'standard',
        messageCount: messages.length,
        messages,
    };
}

const fronts = createInitialFronts({ premise, character: hero, location: LOCATION });

const OPENING = `The tide-bell has just rung the seventh hour over Saltmere and the last morning of the herring run is grey and cold. ${heroName} stands on the seaward pier with the Kittiwake riding low beside it, the hold still half full. Old Tammo is at his brazier mending a net; up the quay, the lamp is already lit in Harbormaster Orsa Pellwyn's office. Beyond the breakwater the lighthouse on Gannet Rock is dark again.`;

const wordCount = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;

/**
 * The parser exposes normalized camelCase channels (`requestedRolls`,
 * `combatStart`). A roll proposal carries little or no prose by contract and a
 * fight-starting reply is a combat-intent turn — neither is an ordinary turn.
 */
function classifyEvents(events) {
    return {
        rollRequested: Array.isArray(events?.requestedRolls) && events.requestedRolls.length > 0,
        combatStarted: !!events?.combatStart,
    };
}

async function runVariant({ providerName, variant }) {
    const cfg = PROVIDERS[providerName];
    const history = [{ role: 'assistant', content: OPENING }];
    const turns = [];
    for (let i = 0; i < TURN_COUNT; i++) {
        const userMessage = PLAYER_TURNS[i];
        const messages = history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
        let systemPrompt = buildSystemPrompt(baseState(messages));
        if (variant === 'before') systemPrompt = toBeforePrompt(systemPrompt);
        const started = Date.now();
        let raw = '';
        let error = null;
        try {
            raw = await sendMessage({ ...cfg, systemPrompt, messageHistory: history, userMessage });
        } catch (e) {
            error = String(e?.message || e);
        }
        const { narrative, events } = error ? { narrative: '', events: null } : parseResponse(raw);
        const { rollRequested, combatStarted } = classifyEvents(events);
        const text = String(narrative || '').trim();
        turns.push({ index: i + 1, userMessage, narrative: text, raw: String(raw || ''), rollRequested, combatStarted, error, ms: Date.now() - started, words: wordCount(text) });
        history.push({ role: 'user', content: userMessage });
        // The DM only ever sees its own prose back (the JSON block never rides the window).
        history.push({ role: 'assistant', content: text || (rollRequested ? '(roll proposed)' : '(no response)') });
        process.stderr.write(`  ${providerName}/${variant} turn ${i + 1}/${TURN_COUNT}: ${text ? wordCount(text) + ' words' : (error ? 'ERROR' : 'empty')}${rollRequested ? ' [roll proposed]' : ''}${combatStarted ? ' [combat started]' : ''}\n`);
    }
    return { providerName, model: cfg.model, variant, turns };
}

// --- judge: thinking-free Flash, JSON only ---
const JUDGE_SYSTEM = `You are an unvarnished editorial judge of tabletop-RPG narration. You score ONE Dungeon Master reply to ONE player action against a fixed rubric. Reply with ONLY a JSON object — no prose, no fences.

Rubric:
- "echo_of_action": true if the reply restates or narrates the player's own stated action back before (or instead of) its consequence ("You step forward and say…", "You climb down and begin hauling…"). Reporting the CONSEQUENCE of the action is not an echo.
- "particular_present": true if the reply contains at least one concrete, specific sensory or physical detail tied to THIS place or person (a named object, texture, sound, gesture, smell) — not generic scenery.
- "abstraction_tic": true if the reply leans on a stock atmosphere abstraction: "the tension is palpable", "the air is thick", "a chill runs down your spine", "silence hangs heavy", "you can feel the weight of", "an unspoken understanding", or a close variant.
- "motion_present": true if the world or a character present DOES something of their own accord during the reply — acts on a want, makes an offer, reveals something, changes the situation — rather than only reacting to or describing the player.
- "ask_shape": exactly one of "live_question" (ends on a specific open situation or an NPC's question/offer that naturally asks for the player's next move), "what_do_you_do_earned" (ends with a generic "What do you do?"-style prompt AND nothing in the scene already asked), "what_do_you_do_redundant" (a generic "What do you do?"-style prompt tacked on although the scene already asked), "stacked_menu" (two or more stacked rhetorical options: "Will you…? Or perhaps…?"), "no_ask" (trails off with no handle at all).
- "notes": one short sentence.

Output shape: {"echo_of_action":bool,"particular_present":bool,"abstraction_tic":bool,"motion_present":bool,"ask_shape":"...","notes":"..."}`;

async function judgeTurn(turn) {
    if (!turn.narrative) return null;
    const userMessage = `PLAYER ACTION:\n${turn.userMessage}\n\nDM REPLY:\n${turn.narrative}`;
    const raw = await sendMessage({
        provider: 'gemini', apiKey: GEMINI_KEY, model: MACHINERY_MODEL,
        systemPrompt: JUDGE_SYSTEM, messageHistory: [], userMessage,
        temperature: 0, thinkingBudget: 0, maxOutputTokens: 600, timeoutMs: 60000,
    });
    const parsed = parseJsonObjectLoose(raw, ['echo_of_action', 'ask_shape']);
    if (!parsed) return { judgeError: `unparseable: ${String(raw).slice(0, 120)}` };
    return {
        echo_of_action: parsed.echo_of_action === true,
        particular_present: parsed.particular_present === true,
        abstraction_tic: parsed.abstraction_tic === true,
        motion_present: parsed.motion_present === true,
        ask_shape: ['live_question', 'what_do_you_do_earned', 'what_do_you_do_redundant', 'stacked_menu', 'no_ask'].includes(parsed.ask_shape) ? parsed.ask_shape : 'unscored',
        notes: String(parsed.notes || '').slice(0, 200),
    };
}

const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');

function summarize(run) {
    const scored = run.turns.filter(t => t.score && !t.score.judgeError);
    const words = scored.map(t => t.words);
    const n = scored.length;
    const count = pred => scored.filter(pred).length;
    return {
        provider: run.providerName, model: run.model, variant: run.variant,
        turns: run.turns.length, scored: n,
        rollProposed: run.turns.filter(t => t.rollRequested).length,
        combatStarts: run.turns.filter(t => t.combatStarted).length,
        empty: run.turns.filter(t => !t.error && !t.narrative && !t.rollRequested && !t.combatStarted).length,
        errors: run.turns.filter(t => t.error).length,
        medianWords: median(words),
        minWords: words.length ? Math.min(...words) : 0,
        maxWords: words.length ? Math.max(...words) : 0,
        inBand: pct(words.filter(w => w >= 60 && w <= 180).length, words.length),
        echo: pct(count(t => t.score.echo_of_action), n),
        particular: pct(count(t => t.score.particular_present), n),
        tic: pct(count(t => t.score.abstraction_tic), n),
        motion: pct(count(t => t.score.motion_present), n),
        askLive: pct(count(t => t.score.ask_shape === 'live_question'), n),
        askEarned: pct(count(t => t.score.ask_shape === 'what_do_you_do_earned'), n),
        askRedundant: pct(count(t => t.score.ask_shape === 'what_do_you_do_redundant'), n),
        askMenu: pct(count(t => t.score.ask_shape === 'stacked_menu'), n),
        askNone: pct(count(t => t.score.ask_shape === 'no_ask'), n),
    };
}

function renderReport(summaries, runs) {
    const date = new Date().toISOString().slice(0, 10);
    const lines = [];
    lines.push(`# Turn-grammar eval — ${date}`);
    lines.push('');
    lines.push(`Proof step for the 2026-09-11 wow audit (ordinary-turn, W1: \`## THE ORDINARY TURN\`). ${TURN_COUNT} chained ordinary player turns on the \`${STARTER_ID}\` starter, BEFORE (pre-block prompt rebuilt by string surgery: "end by asking" step, "Leave space" line, old custom-prompt closing line) vs AFTER (the shipped block). Judge: \`${MACHINERY_MODEL}\`, thinking-free, JSON-only, temperature 0. Word counts are local. Rubric rows are the audit's own: echo-of-action / particular present / abstraction tic / motion present / ask shape.`);
    lines.push('');
    lines.push('| Provider | Variant | Scored | Median words | Range | In 60–180 | Echo ↓ | Particular ↑ | Tic ↓ | Motion ↑ | Ask: live | earned WDYD | redundant WDYD ↓ | menu ↓ | none ↓ | Rolls proposed | Combat starts | Empty | Errors |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const s of summaries) {
        lines.push(`| ${s.provider} (${s.model}) | ${s.variant} | ${s.scored}/${s.turns} | ${s.medianWords} | ${s.minWords}–${s.maxWords} | ${s.inBand} | ${s.echo} | ${s.particular} | ${s.tic} | ${s.motion} | ${s.askLive} | ${s.askEarned} | ${s.askRedundant} | ${s.askMenu} | ${s.askNone} | ${s.rollProposed} | ${s.combatStarts} | ${s.empty} | ${s.errors} |`);
    }
    lines.push('');
    lines.push('Arrows mark the desired direction. "Scored" excludes turns that proposed a roll with no prose, started combat (a combat-intent turn, not an ordinary one), came back empty, or errored; word statistics are over scored turns only.');
    lines.push('');
    for (const run of runs) {
        lines.push(`## ${run.providerName} · ${run.variant} — per-turn`);
        lines.push('');
        lines.push('| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |');
        lines.push('|---|---|---|---|---|---|---|---|');
        for (const t of run.turns) {
            const s = t.score;
            if (!s || s.judgeError) {
                lines.push(`| ${t.index} | ${t.words} | — | — | — | — | — | ${t.error ? 'DM error: ' + t.error.slice(0, 80) : t.combatStarted ? 'combat started (not an ordinary turn)' : t.rollRequested ? 'roll proposed (not an ordinary turn)' : !t.narrative ? 'empty reply' : s?.judgeError || 'unscored'} |`);
                continue;
            }
            const yn = v => (v ? 'yes' : 'no');
            lines.push(`| ${t.index} | ${t.words} | ${yn(s.echo_of_action)} | ${yn(s.particular_present)} | ${yn(s.abstraction_tic)} | ${yn(s.motion_present)} | ${s.ask_shape} | ${s.notes.replace(/\|/g, '/')} |`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

/**
 * QF_EVAL_RERENDER="label=path.json,label=path.json": re-derive the roll /
 * combat flags from the SAVED raw replies (no DM calls), keep the stored judge
 * scores, and print consolidated tables — used to rebuild the report after the
 * flag bug (camelCase channel names) without re-spending the DM lane.
 */
function rerenderFromFiles(spec) {
    const runs = [];
    for (const entry of spec.split(',').map(s => s.trim()).filter(Boolean)) {
        const [label, file] = entry.includes('=') ? entry.split(/=(.*)/s) : [path.basename(entry), entry];
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const run of data.runs) {
            for (const turn of run.turns) {
                if (typeof turn.raw === 'string' && turn.raw) {
                    const { events } = turn.error ? { events: null } : parseResponse(turn.raw);
                    Object.assign(turn, classifyEvents(events));
                    if (turn.combatStarted || (turn.rollRequested && turn.words < 25)) turn.score = null;
                }
            }
            runs.push({ ...run, providerName: `${run.providerName} · ${label}` });
        }
    }
    const summaries = runs.map(summarize);
    console.log(renderReport(summaries, runs));
}

async function main() {
    if (process.env.QF_EVAL_RERENDER) {
        rerenderFromFiles(process.env.QF_EVAL_RERENDER);
        return;
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const jobs = [];
    for (const providerName of providers) {
        for (const variant of VARIANTS) jobs.push({ providerName, variant });
    }
    console.error(`Running ${jobs.length} DM runs × ${TURN_COUNT} turns (${providers.join(', ')})…`);
    // DM runs in parallel across (provider, variant); each run is sequential inside.
    const runs = await Promise.all(jobs.map(runVariant));
    console.error('Judging…');
    for (const run of runs) {
        for (const turn of run.turns) {
            // Turns that only proposed a roll are not ordinary turns; do not score them.
            if (!turn.narrative || turn.error || turn.combatStarted || (turn.rollRequested && turn.words < 25)) { turn.score = null; continue; }
            try {
                turn.score = await judgeTurn(turn);
            } catch (e) {
                turn.score = { judgeError: String(e?.message || e).slice(0, 120) };
            }
        }
    }
    const summaries = runs.map(summarize);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(OUT_DIR, `turn-grammar-${stamp}.json`), JSON.stringify({ starter: STARTER_ID, turnCount: TURN_COUNT, runs, summaries }, null, 2));
    const report = renderReport(summaries, runs);
    const reportPath = path.join(repoRoot, 'docs', `TURN_GRAMMAR_EVAL_${new Date().toISOString().slice(0, 10)}.md`);
    fs.writeFileSync(reportPath, report + '\n');
    console.log(report);
    console.error(`\nReport: ${reportPath}\nTranscripts: ${OUT_DIR}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
