#!/usr/bin/env node
/**
 * DM bake-off (2026-10-04): the same ten chained player turns on one saved
 * state, one DM model per run, written up BLIND for a human reader.
 *
 * Why: the 10-03 Sol grand run landed every ordinary turn in the word band,
 * but "most obedient" is not "best narrator". The eval's judge measures shape;
 * voice, range and nerve are a reader's call. This script produces that
 * reading: ten turns with range (two ordinary, a confession, two pressure beats,
 * a threat, a declared attack, a standoff, the aftermath, an eerie row out) on
 * the turn-grammar eval's Saltmere fixture, each narrator's chain its own
 * story, the narrators labeled A/B/C in a fixed random order.
 *
 *   npm.cmd run eval:bakeoff
 *   $env:QF_BAKEOFF_MODELS="gemini:gemini-3.1-pro-preview,openai:gpt-6.1-sol,openai:gpt-6-astra"
 *
 * Output: docs/DM_BAKEOFF_<date>.md (the blind doc: turns + a judge table by
 * letter) and scripts/.eval-out/bakeoff/<stamp>/ (raw replies, scores, and
 * key.json — the letter → model map; git-ignored; read the doc before the key).
 * Keys from .env (GEMINI_API_KEY for Gemini + the judge, OPENAI_API_KEY).
 * This harness has no engine: a fight-starting reply is kept as prose (its
 * combat_start is noted), the next turn continues from the prose alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
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
const KEYS = { gemini: process.env.GEMINI_API_KEY, openai: process.env.OPENAI_API_KEY, xai: process.env.XAI_API_KEY };
if (!KEYS.gemini) { console.error('GEMINI_API_KEY is required (the judge).'); process.exit(2); }

const MODEL_SPEC = process.env.QF_BAKEOFF_MODELS || 'gemini:gemini-3.1-pro-preview,openai:gpt-6.1-sol,openai:gpt-6-astra';
const DMS = MODEL_SPEC.split(',').map(s => s.trim()).filter(Boolean).map(spec => {
    const [provider, ...rest] = spec.split(':');
    const model = rest.join(':');
    if (!KEYS[provider]) { console.error(`No key for provider ${provider} (${model}).`); process.exit(2); }
    return { provider, model, apiKey: KEYS[provider] };
});
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(here, '.eval-out', 'bakeoff', stamp);
fs.mkdirSync(OUT_DIR, { recursive: true });

// --- the turn-grammar eval's Saltmere fixture (kept in step by hand; the eval does not export it) ---
const heroName = 'Astra';
const starter = findPremiseStarter('saltmere-debt');
if (!starter) { console.error('Unknown starter saltmere-debt'); process.exit(2); }
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
const fronts = createInitialFronts({ premise, character: hero, location: LOCATION });
const OPENING = `The tide-bell has just rung the seventh hour over Saltmere and the last morning of the herring run is grey and cold. ${heroName} stands on the seaward pier with the Kittiwake riding low beside it, the hold still half full. Old Tammo is at his brazier mending a net; up the quay, the lamp is already lit in Harbormaster Orsa Pellwyn's office. Beyond the breakwater the lighthouse on Gannet Rock is dark again.`;
function baseState(messages) {
    return {
        character: hero, inventory, quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e',
        customSystemPrompt: initialGameState.settings.customSystemPrompt, journal: [], npcs: [], party: [],
        currentLocation: LOCATION, combat: { active: false }, worldFacts: [], fronts, storyMemory: [], retrievedMemories: [],
        premise, recentRulings: [], recentChecks: [], paceDial: 'standard', messageCount: messages.length, messages,
    };
}

// Ten turns with RANGE — the eval's list is all ordinary on purpose; this one is not.
const PLAYER_TURNS = [
    { kind: 'ordinary', text: 'I climb down to the Kittiwake and start hauling the last of the herring crates up onto the pier.' },
    { kind: 'ordinary', text: 'I walk over to Old Tammo\'s brazier and sit on the stool he keeps for me. "Cold one," I say.' },
    { kind: 'confession', text: 'I tell Tammo the thing I have told nobody: the debt on the Kittiwake was my brother Jory\'s, and he did not drown by accident.' },
    { kind: 'pressure', text: 'I go up to the harbormaster\'s office and tell Orsa Pellwyn straight that I cannot make this month\'s payment.' },
    { kind: 'pressure', text: 'I ask her what happens to the boat if I do not pay, and I watch her face while she answers.' },
    { kind: 'threat', text: 'Back at the pier two men I do not know are standing by the Kittiwake\'s mooring. I ask them what they want with my boat.' },
    { kind: 'attack', text: 'The bigger one puts a knife to the mooring line and grins. I draw my longsword and go for him.' },
    { kind: 'standoff', text: 'I keep the sword between us and tell the other one to pick up his friend and get off my pier.' },
    { kind: 'aftermath', text: 'When they are gone I sit down on a crate with my hands shaking and look at what is left of the morning.' },
    { kind: 'eerie', text: 'I row out alone toward Gannet Rock as the light goes, and I look up at the dark lighthouse.' },
];

const wordCount = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const paraCount = text => String(text || '').trim().split(/\n\s*\n/).filter(p => p.trim()).length;

async function runDm(dm) {
    const history = [{ role: 'assistant', content: OPENING }];
    const turns = [];
    for (let i = 0; i < PLAYER_TURNS.length; i++) {
        const { kind, text: userMessage } = PLAYER_TURNS[i];
        const messages = history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
        const systemPrompt = buildSystemPrompt(baseState(messages));
        const started = Date.now();
        let raw = '';
        let error = null;
        try {
            raw = await sendMessage({ provider: dm.provider, apiKey: dm.apiKey, model: dm.model, systemPrompt, messageHistory: history, userMessage });
        } catch (e) { error = String(e?.message || e); }
        const { narrative, events } = error ? { narrative: '', events: null } : parseResponse(raw);
        const text = String(narrative || '').trim();
        const rollRequested = Array.isArray(events?.requestedRolls) && events.requestedRolls.length > 0;
        const combatStarted = !!events?.combatStart;
        turns.push({ index: i + 1, kind, userMessage, narrative: text, raw: String(raw || ''), rollRequested, combatStarted, rolls: rollRequested ? events.requestedRolls.map(r => `${r.skill || r.type || '?'} DC ${r.dc ?? '?'}`) : [], error, ms: Date.now() - started, words: wordCount(text), paras: paraCount(text) });
        history.push({ role: 'user', content: userMessage });
        history.push({ role: 'assistant', content: text || (rollRequested ? '(roll proposed)' : '(no response)') });
        process.stderr.write(`  ${dm.model} turn ${i + 1}/${PLAYER_TURNS.length} (${kind}): ${text ? wordCount(text) + 'w' : (error ? 'ERROR ' + error.slice(0, 80) : 'empty')}${rollRequested ? ' [roll]' : ''}${combatStarted ? ' [combat_start]' : ''} ${Math.round((Date.now() - started) / 1000)}s\n`);
    }
    return { ...dm, turns };
}

const JUDGE_SYSTEM = `You are an unvarnished editorial judge of tabletop-RPG narration. You score ONE Dungeon Master reply to ONE player action. Reply with ONLY a JSON object — no prose, no fences.
Rubric:
- "echo_of_action": true if the reply restates the player's own action back before or instead of its consequence.
- "particular_present": true if the reply has at least one concrete physical detail tied to THIS place or person, not generic scenery.
- "abstraction_tic": true if it leans on stock atmosphere ("the tension is palpable", "a chill runs down your spine", "silence hangs heavy", "you can feel the weight of").
- "motion_present": true if a character or the world DOES something of its own accord — acts on a want, makes an offer, changes the situation.
- "ask_shape": one of "live_question", "what_do_you_do_earned", "what_do_you_do_redundant", "stacked_menu", "no_ask".
- "register_fits_beat": true if the emotional temperature matches the beat (a confession is not answered at the same volume as directions; a knife at the mooring line raises the pulse).
- "voice": one of "lived_in" (people speak like themselves, the prose has nerve), "competent" (clean, correct, even), "stiff" (machine-like, tidy summaries of stakes, generic).
- "notes": one short sentence.
Output: {"echo_of_action":bool,"particular_present":bool,"abstraction_tic":bool,"motion_present":bool,"ask_shape":"...","register_fits_beat":bool,"voice":"...","notes":"..."}`;

async function judgeTurn(turn) {
    if (!turn.narrative) return null;
    try {
        const raw = await sendMessage({
            provider: 'gemini', apiKey: KEYS.gemini, model: MACHINERY_MODEL, fallbackModel: MACHINERY_FALLBACK_MODEL,
            systemPrompt: JUDGE_SYSTEM, messageHistory: [], userMessage: `BEAT: ${turn.kind}\nPLAYER ACTION:\n${turn.userMessage}\n\nDM REPLY:\n${turn.narrative}`,
            temperature: 0, thinkingBudget: 0, maxOutputTokens: 600, timeoutMs: 60000,
        });
        const p = parseJsonObjectLoose(raw, ['echo_of_action', 'ask_shape']);
        if (!p) return { judgeError: 'unparseable' };
        return {
            echo: p.echo_of_action === true, particular: p.particular_present === true, tic: p.abstraction_tic === true, motion: p.motion_present === true,
            ask: ['live_question', 'what_do_you_do_earned', 'what_do_you_do_redundant', 'stacked_menu', 'no_ask'].includes(p.ask_shape) ? p.ask_shape : 'unscored',
            register: p.register_fits_beat === true, voice: ['lived_in', 'competent', 'stiff'].includes(p.voice) ? p.voice : 'unscored',
            notes: String(p.notes || '').slice(0, 200),
        };
    } catch (e) { return { judgeError: String(e?.message || e).slice(0, 120) }; }
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function shuffleLetters(n) {
    // One crypto draw: the letter → DM assignment is fixed for the whole doc.
    const letters = 'ABCDEFGH'.slice(0, n).split('');
    for (let i = letters.length - 1; i > 0; i--) {
        const j = webcrypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
        [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    return letters;
}

function renderDoc(runs, letters, date) {
    const byLetter = runs.map((run, i) => ({ letter: letters[i], run })).sort((a, b) => a.letter.localeCompare(b.letter));
    const lines = [];
    lines.push(`# DM bake-off — ${date} (read blind)`);
    lines.push('');
    lines.push(`Ten chained player turns on the Saltmere fixture (a level-1 fighter, the herring debt, the dark lighthouse), the same for every narrator; each narrator's chain is its own story, so read a narrator top to bottom as well as across. Narrators are **A / B / C** in a fixed random order — the key is in the run folder (\`scripts/.eval-out/bakeoff/\`), not in this file. Read first; then ask for the key. The harness has no engine: a fight-starting reply is kept as prose (noted), and the next turn continues from the prose alone.`);
    lines.push('');
    lines.push('What to read for: does the register move with the beat (confession, knife, aftermath)? Do people speak like themselves? Is there nerve, or only competence? Would you keep playing with this voice for forty turns?');
    lines.push('');
    for (let i = 0; i < PLAYER_TURNS.length; i++) {
        const { kind, text } = PLAYER_TURNS[i];
        lines.push(`## Turn ${i + 1} — ${kind}`);
        lines.push('');
        lines.push(`> **Player:** ${text}`);
        lines.push('');
        for (const { letter, run } of byLetter) {
            const t = run.turns[i];
            const tag = t.error ? ` *(error: ${t.error.slice(0, 80)})*` : `${t.combatStarted ? ' *(fight started)*' : ''}${t.rollRequested ? ` *(roll proposed: ${t.rolls.join('; ')})*` : ''}`;
            lines.push(`### Narrator ${letter}${tag}`);
            lines.push('');
            lines.push(t.narrative ? t.narrative.split('\n').map(l => l).join('\n') : '*(no prose)*');
            lines.push('');
        }
    }
    lines.push('---');
    lines.push('');
    lines.push('## Numbers — read AFTER forming your view');
    lines.push('');
    lines.push(`Judge: \`${MACHINERY_MODEL}\`, thinking-free, temperature 0. "Voice" and "register" are the judge's reading, not yours — they are here to be argued with.`);
    lines.push('');
    lines.push('| Narrator | Median words | Range | In 60–180 | Paras > 3 | Echo ↓ | Particular ↑ | Tic ↓ | Motion ↑ | Live ask | Register fits | lived-in / competent / stiff | Rolls | Fights | Median latency | Errors |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const { letter, run } of byLetter) {
        const scored = run.turns.filter(t => t.score && !t.score.judgeError);
        const n = scored.length;
        const words = run.turns.filter(t => t.narrative).map(t => t.words);
        const c = pred => scored.filter(pred).length;
        const voice = ['lived_in', 'competent', 'stiff'].map(v => c(t => t.score.voice === v)).join(' / ');
        lines.push(`| ${letter} | ${median(words)} | ${words.length ? Math.min(...words) + '–' + Math.max(...words) : '—'} | ${pct(words.filter(w => w >= 60 && w <= 180).length, words.length)} | ${run.turns.filter(t => t.paras > 3).length} | ${pct(c(t => t.score.echo), n)} | ${pct(c(t => t.score.particular), n)} | ${pct(c(t => t.score.tic), n)} | ${pct(c(t => t.score.motion), n)} | ${pct(c(t => t.score.ask === 'live_question'), n)} | ${pct(c(t => t.score.register), n)} | ${voice} | ${run.turns.filter(t => t.rollRequested).length} | ${run.turns.filter(t => t.combatStarted).length} | ${Math.round(median(run.turns.map(t => t.ms)) / 1000)} s | ${run.turns.filter(t => t.error).length} |`);
    }
    lines.push('');
    lines.push('### Judge notes per turn');
    lines.push('');
    lines.push('| Turn | ' + byLetter.map(b => `Narrator ${b.letter}`).join(' | ') + ' |');
    lines.push('|---|' + byLetter.map(() => '---').join('|') + '|');
    for (let i = 0; i < PLAYER_TURNS.length; i++) {
        lines.push(`| ${i + 1} ${PLAYER_TURNS[i].kind} | ` + byLetter.map(({ run }) => { const s = run.turns[i].score; return s && !s.judgeError ? `${s.voice}${s.register ? '' : ', register off'}: ${s.notes.replace(/\|/g, '/')}` : '—'; }).join(' | ') + ' |');
    }
    lines.push('');
    return lines.join('\n');
}

async function main() {
    const runs = [];
    for (const dm of DMS) {
        process.stderr.write(`\n=== ${dm.provider} / ${dm.model}\n`);
        runs.push(await runDm(dm));
    }
    process.stderr.write('\nJudging…\n');
    for (const run of runs) for (const t of run.turns) t.score = await judgeTurn(t);
    const letters = shuffleLetters(runs.length);
    const date = new Date().toISOString().slice(0, 10);
    const doc = renderDoc(runs, letters, date);
    const docPath = path.join(repoRoot, 'docs', `DM_BAKEOFF_${date}.md`);
    fs.writeFileSync(docPath, doc + '\n');
    fs.writeFileSync(path.join(OUT_DIR, 'runs.json'), JSON.stringify({ date, players: PLAYER_TURNS, runs: runs.map((r, i) => ({ letter: letters[i], provider: r.provider, model: r.model, turns: r.turns })) }, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'key.json'), JSON.stringify(runs.map((r, i) => ({ letter: letters[i], provider: r.provider, model: r.model })), null, 2));
    console.error(`\nBlind doc: ${docPath}\nKey (do not read before the doc): ${path.join(OUT_DIR, 'key.json')}`);
}
main().catch(err => { console.error(err); process.exit(1); });
