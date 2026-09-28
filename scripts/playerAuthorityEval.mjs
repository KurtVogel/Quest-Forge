#!/usr/bin/env node
/**
 * Real-provider PLAYER AUTHORITY contrast-set eval — the proof step of the
 * 2026-09-28 Bram clause (docs/agent-dialogues/2026-09-28-vision.md, Close →
 * Recommended slice A; DECISIONS.md 2026-09-28).
 *
 * Four scripted cases, each ONE player line on a short fixed history, sampled
 * N times per DM provider and per prompt variant (BEFORE = the clause removed
 * by string surgery and the old decline examples restored; AFTER = shipped):
 *
 *   bystander      a harmless NAMED addition that grants nothing
 *                  → expect played straight OR quietly absent; never a diagnosis
 *   ally           an unearned ally / escape declared as fact
 *                  → expect declined as an attempt, stakes preserved; no diagnosis
 *   contradiction  a direct contradiction of established canon
 *                  → expect declined in-fiction; not accepted as reality; no diagnosis
 *   earned         the SAME harmless addition after the fiction has set up
 *                  fever-dreams and the hero seeing the drowned
 *                  → NPCs MAY doubt the hero (allowed, reported); the NARRATOR
 *                    never diagnoses (the pass condition)
 *
 * A thinking-free Gemini Flash judge scores each reply (JSON only). Providers
 * are Gemini Pro and GPT Terra — playtests never use the Grok DM (Vesa,
 * 2026-09-14). Keys come from the environment or the git-ignored .env
 * (GEMINI_API_KEY required — DM lane + judge; OPENAI_API_KEY optional).
 *
 *   npm.cmd run eval:authority                       # gemini + openai, 3 samples each
 *   $env:QF_EVAL_PROVIDERS="gemini"; npm.cmd run eval:authority
 *   $env:QF_EVAL_SAMPLES="1"; npm.cmd run eval:authority   # smoke
 *   $env:QF_EVAL_VARIANTS="after"; npm.cmd run eval:authority
 *
 * Writes a markdown report to docs/ and raw transcripts to QF_EVAL_OUT
 * (default scripts/.eval-out, git-ignored).
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

try {
    const envText = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
} catch { /* explicit env vars only */ }

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!GEMINI_KEY) {
    console.error('GEMINI_API_KEY is required (DM lane and the judge).');
    process.exit(2);
}

const PROVIDERS = {
    gemini: { provider: 'gemini', apiKey: GEMINI_KEY, model: process.env.QF_EVAL_GEMINI_MODEL || 'gemini-3.1-pro-preview' },
    openai: { provider: 'openai', apiKey: OPENAI_KEY, model: process.env.QF_EVAL_OPENAI_MODEL || 'gpt-5.6-terra' },
};
const wanted = (process.env.QF_EVAL_PROVIDERS || 'gemini,openai').split(',').map(s => s.trim()).filter(Boolean);
const providers = wanted.filter(name => PROVIDERS[name]?.apiKey);
for (const name of wanted) if (!PROVIDERS[name]?.apiKey) console.warn(`Skipping ${name}: no key.`);
if (providers.length === 0) process.exit(2);

const SAMPLES = Math.max(1, Math.min(10, Number(process.env.QF_EVAL_SAMPLES) || 3));
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(here, '.eval-out');
const STARTER_ID = process.env.QF_EVAL_STARTER || 'saltmere-debt';
const VARIANTS = (process.env.QF_EVAL_VARIANTS || 'before,after').split(',').map(s => s.trim()).filter(v => ['before', 'after'].includes(v));
const CASE_FILTER = (process.env.QF_EVAL_CASES || '').split(',').map(s => s.trim()).filter(Boolean);

// --- fixed fixture: the turn-grammar eval's level-1 fighter on the Saltmere starter ---
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
const fronts = createInitialFronts({ premise, character: hero, location: LOCATION });
const WORLD_FACTS = [
    { id: 'wf-1', fact: 'The lighthouse on Gannet Rock has been dark for nine nights; no boat has reached the keeper.' },
    { id: 'wf-2', fact: 'Astra owes Harbormaster Orsa Pellwyn the balance on the Kittiwake, due by spring.' },
];

const OPENING = `The tide-bell has just rung the seventh hour over Saltmere and the last morning of the herring run is grey and cold. ${heroName} stands on the seaward pier with the Kittiwake riding low beside it, the hold still half full. Old Tammo is at his brazier mending a net; up the quay, the lamp is already lit in Harbormaster Orsa Pellwyn's office. Beyond the breakwater the lighthouse on Gannet Rock is dark again.`;

const ORDINARY_EXCHANGE = [
    { role: 'user', content: 'I climb down to the Kittiwake and start hauling the last of the herring crates up onto the pier.' },
    { role: 'assistant', content: 'The first crate comes up slick and heavy and you get it onto the boards before the second one tries to slide back off the gunwale. Two deckhands are working the next boat over, one of them whistling through his teeth. Tammo glances up from his net. "Orsa\'s been at her window since the bell," he says, and goes back to his knots. The crate stack grows; the hold does not empty fast.' },
];

// The EARNED history: the fiction has set up fever-dreams and the hero seeing
// the drowned before the harmless addition arrives. NPC doubt is allowed here.
const EARNED_OPENING = `${OPENING} It is the third morning since the Kittiwake came back short-handed from the reef, and the third night ${heroName} has sweated through with the wreck-fever. Twice now she has seen the two drowned deckhands standing at the end of the pier at dawn, salt running off them, and twice they were gone when she looked again. Tammo has said nothing about it, which is how Tammo says things.`;
const EARNED_EXCHANGE = [
    { role: 'user', content: 'I climb down to the Kittiwake and start hauling the last of the herring crates up onto the pier.' },
    { role: 'assistant', content: 'The first crate comes up slick and heavy and the fever makes the boards tilt under you for a breath before they steady. Tammo is watching you over his net now, not pretending otherwise. "You should be abed," he says. "Orsa can wait a morning." Up the quay, the harbormaster\'s lamp is lit; a gull walks the crate you just set down as if it were its own.' },
];

const CASES = [
    {
        id: 'bystander',
        title: 'Harmless named bystander',
        history: [{ role: 'assistant', content: OPENING }, ...ORDINARY_EXCHANGE],
        action: 'I shove past the loudmouthed deckhand, Bram Kettlewick, who\'s been crowding the crates, and tell him to mind his own boat.',
        pass: s => (s.treatment === 'played_straight' || s.treatment === 'quietly_absent') && !s.narrator_diagnoses && !s.npc_doubts_sanity,
        expect: 'played straight or quietly absent; no diagnosis; NPCs do not doubt the hero\'s mind',
    },
    {
        id: 'ally',
        title: 'Unearned ally declared as fact',
        history: [{ role: 'assistant', content: OPENING }, ...ORDINARY_EXCHANGE],
        action: 'My old friend Captain Hesk and his six marines come down the pier right then to back me — they\'ll cover what I owe Orsa, so I walk up to her office with them at my back.',
        pass: s => s.treatment === 'declined_as_attempt' && s.stakes_preserved && !s.narrator_diagnoses,
        expect: 'declined as an attempt, the debt still stands; no diagnosis',
    },
    {
        id: 'contradiction',
        title: 'Direct canon contradiction',
        history: [{ role: 'assistant', content: OPENING }, ...ORDINARY_EXCHANGE],
        action: 'I point out to Tammo that the Gannet Rock light has been burning bright every night this week — everyone on the pier saw it — so the keeper is obviously fine.',
        pass: s => s.treatment !== 'accepted_as_reality' && !s.narrator_diagnoses,
        expect: 'not accepted as reality (the light is dark, and the world says so in-fiction); no diagnosis',
    },
    {
        id: 'earned',
        title: 'The same bystander after the fiction earned doubt',
        history: [{ role: 'assistant', content: EARNED_OPENING }, ...EARNED_EXCHANGE],
        action: 'I shove past the loudmouthed deckhand, Bram Kettlewick, who\'s been crowding the crates, and tell him to mind his own boat.',
        pass: s => !s.narrator_diagnoses,
        expect: 'NPCs MAY doubt (reported, not scored); the narrator never diagnoses the hero',
    },
].filter(c => CASE_FILTER.length === 0 || CASE_FILTER.includes(c.id));

// --- BEFORE variant: the pre-2026-09-28 block, rebuilt by string surgery ---
const CLAUSE_MARKER = '- HARMLESS ADDITIONS ARE COLOR, NOT CLAIMS.';
const NEW_DECLINE = '(the grasp that finds nothing, the door that is locked after all, an NPC who does not go along with it)';
const OLD_DECLINE = '(the grasp that finds nothing, a dream, an NPC\'s reaction)';

function toBeforePrompt(systemPrompt) {
    const start = systemPrompt.indexOf(CLAUSE_MARKER);
    if (start < 0 || !systemPrompt.includes(NEW_DECLINE)) {
        throw new Error('The shipped PLAYER AUTHORITY clause was not found — the eval\'s BEFORE surgery is stale.');
    }
    const end = systemPrompt.indexOf('\n', start);
    const before = systemPrompt.slice(0, start) + systemPrompt.slice(end + 1);
    return before.replace(NEW_DECLINE, OLD_DECLINE);
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
        worldFacts: WORLD_FACTS,
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

const wordCount = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;

async function runSample({ providerName, variant, testCase, sample }) {
    const cfg = PROVIDERS[providerName];
    const history = testCase.history.map(m => ({ role: m.role, content: m.content }));
    let systemPrompt = buildSystemPrompt(baseState(history));
    if (variant === 'before') systemPrompt = toBeforePrompt(systemPrompt);
    const started = Date.now();
    let raw = '';
    let error = null;
    try {
        raw = await sendMessage({ ...cfg, systemPrompt, messageHistory: history, userMessage: testCase.action });
    } catch (e) {
        error = String(e?.message || e);
    }
    const { narrative, events } = error ? { narrative: '', events: null } : parseResponse(raw);
    const text = String(narrative || '').trim();
    const rollRequested = Array.isArray(events?.requestedRolls) && events.requestedRolls.length > 0;
    const combatStarted = !!events?.combatStart;
    const npcsAdded = Array.isArray(events?.npcUpdates) ? events.npcUpdates.map(n => n?.name).filter(Boolean) : [];
    process.stderr.write(`  ${providerName}/${variant}/${testCase.id}#${sample}: ${text ? wordCount(text) + ' words' : (error ? 'ERROR' : 'empty')}${rollRequested ? ' [roll]' : ''}${combatStarted ? ' [combat]' : ''}\n`);
    return { providerName, model: cfg.model, variant, caseId: testCase.id, sample, action: testCase.action, narrative: text, raw: String(raw || ''), rollRequested, combatStarted, npcsAdded, error, ms: Date.now() - started, words: wordCount(text) };
}

// --- judge: thinking-free Flash, JSON only ---
const JUDGE_SYSTEM = `You are an unvarnished editorial judge of tabletop-RPG narration. You score ONE Dungeon Master reply to ONE player line against a fixed rubric. You are given the player's line, what the scene had established before it, and the reply. Reply with ONLY a JSON object — no prose, no fences.

The player's line ADDS something to the scene (a named person, an ally, a claim about the world). Judge how the reply treated that addition.

Rubric:
- "treatment": exactly one of
    "played_straight"      — the added person/thing/claim is simply present and real in the reply; the scene goes on with it.
    "quietly_absent"       — the reply proceeds without the addition and does NOT remark on its absence (no "there is no one there", no one questions the hero).
    "declined_as_attempt"  — the reply treats the addition as a wish, claim, or attempt that the world does not go along with: the ally does not exist / does not pay, the claim is contradicted by what is actually there, an NPC does not accept it — but WITHOUT anyone suggesting the hero is imagining things.
    "hostile_diagnosis"    — the reply (narrator or an NPC) treats the addition as evidence the hero is imagining, dreaming, drunk, feverish, mad, or "seeing things".
    "accepted_as_reality"  — a claim that contradicts what the scene established, or an advantage the hero did not earn (an ally, a debt paid), is granted as true.
    "other"                — none of the above (a roll was proposed and nothing else, an empty reply, out-of-character text).
- "narrator_diagnoses": true if the NARRATOR'S OWN VOICE (not an NPC's dialogue) asserts or implies that the hero is imagining, dreaming, hallucinating, feverish, drunk, or mad — including describing the added person as not really there in a way that means the hero saw something that was not.
- "npc_doubts_sanity": true if any NPC, in their own dialogue or visible reaction, suggests the hero is imagining things, unwell in the head, seeing ghosts, or drunk.
- "stakes_preserved": true if any advantage the player's line claimed (an ally, money, a paid debt, safety, a fact that changes the situation) was NOT granted — the situation's stakes stand as the scene had established them. For a line that claims no advantage, true.
- "notes": one short sentence.

Output shape: {"treatment":"...","narrator_diagnoses":bool,"npc_doubts_sanity":bool,"stakes_preserved":bool,"notes":"..."}`;

async function judgeSample(result, testCase) {
    if (!result.narrative) return null;
    const established = testCase.history.filter(m => m.role === 'assistant').map(m => m.content).join('\n\n');
    const userMessage = `ESTABLISHED BEFORE THE PLAYER'S LINE:\n${established}\n\nPLAYER LINE:\n${result.action}\n\nDM REPLY:\n${result.narrative}`;
    const raw = await sendMessage({
        provider: 'gemini', apiKey: GEMINI_KEY, model: MACHINERY_MODEL,
        systemPrompt: JUDGE_SYSTEM, messageHistory: [], userMessage,
        temperature: 0, thinkingBudget: 0, maxOutputTokens: 600, timeoutMs: 60000,
    });
    const parsed = parseJsonObjectLoose(raw, ['treatment', 'narrator_diagnoses']);
    if (!parsed) return { judgeError: `unparseable: ${String(raw).slice(0, 120)}` };
    const TREATMENTS = ['played_straight', 'quietly_absent', 'declined_as_attempt', 'hostile_diagnosis', 'accepted_as_reality', 'other'];
    return {
        treatment: TREATMENTS.includes(parsed.treatment) ? parsed.treatment : 'other',
        narrator_diagnoses: parsed.narrator_diagnoses === true,
        npc_doubts_sanity: parsed.npc_doubts_sanity === true,
        stakes_preserved: parsed.stakes_preserved === true,
        notes: String(parsed.notes || '').slice(0, 200),
    };
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');

function summarize(results) {
    const rows = [];
    for (const providerName of providers) {
        for (const variant of VARIANTS) {
            for (const testCase of CASES) {
                const mine = results.filter(r => r.providerName === providerName && r.variant === variant && r.caseId === testCase.id);
                const scored = mine.filter(r => r.score && !r.score.judgeError);
                const n = scored.length;
                const count = pred => scored.filter(r => pred(r.score)).length;
                rows.push({
                    provider: providerName, model: PROVIDERS[providerName].model, variant, caseId: testCase.id,
                    samples: mine.length, scored: n,
                    pass: pct(count(testCase.pass), n),
                    straight: count(s => s.treatment === 'played_straight'),
                    absent: count(s => s.treatment === 'quietly_absent'),
                    declined: count(s => s.treatment === 'declined_as_attempt'),
                    hostile: count(s => s.treatment === 'hostile_diagnosis'),
                    accepted: count(s => s.treatment === 'accepted_as_reality'),
                    other: count(s => s.treatment === 'other'),
                    narratorDx: count(s => s.narrator_diagnoses),
                    npcDoubt: count(s => s.npc_doubts_sanity),
                    stakes: pct(count(s => s.stakes_preserved), n),
                    errors: mine.filter(r => r.error).length,
                });
            }
        }
    }
    return rows;
}

function renderReport(rows, results) {
    const date = new Date().toISOString().slice(0, 10);
    const lines = [];
    lines.push(`# Player-authority contrast-set eval — ${date}`);
    lines.push('');
    lines.push(`Proof step for the 2026-09-28 Bram clause in \`## PLAYER AUTHORITY\` (\`HARMLESS ADDITIONS ARE COLOR, NOT CLAIMS\`; DECISIONS.md 2026-09-28; the Claude ↔ Codex dialogue's slice A). Four cases × ${SAMPLES} samples per provider per variant on the \`${STARTER_ID}\` starter. BEFORE = the clause removed and the old decline examples ("a dream, an NPC's reaction") restored by string surgery; AFTER = shipped. Judge: \`${MACHINERY_MODEL}\`, thinking-free, JSON-only, temperature 0.`);
    lines.push('');
    lines.push('Pass conditions per case:');
    for (const c of CASES) lines.push(`- **${c.id}** — ${c.title}: ${c.expect}.`);
    lines.push('');
    lines.push('| Provider | Variant | Case | Pass ↑ | Scored | Straight | Absent | Declined | Hostile dx ↓ | Accepted ↓ | Other | Narrator dx ↓ | NPC doubts | Stakes kept ↑ | Errors |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
        lines.push(`| ${r.provider} (${r.model}) | ${r.variant} | ${r.caseId} | ${r.pass} | ${r.scored}/${r.samples} | ${r.straight} | ${r.absent} | ${r.declined} | ${r.hostile} | ${r.accepted} | ${r.other} | ${r.narratorDx} | ${r.npcDoubt} | ${r.stakes} | ${r.errors} |`);
    }
    lines.push('');
    lines.push('"NPC doubts" is informative on the `earned` case (allowed there by design) and a failure everywhere else. A hostile diagnosis by the NARRATOR is a failure on every case.');
    lines.push('');
    for (const providerName of providers) {
        for (const variant of VARIANTS) {
            lines.push(`## ${providerName} · ${variant} — per-sample`);
            lines.push('');
            lines.push('| Case | # | Words | Treatment | Narrator dx | NPC doubts | Stakes | Judge note |');
            lines.push('|---|---|---|---|---|---|---|---|');
            for (const r of results.filter(x => x.providerName === providerName && x.variant === variant)) {
                const s = r.score;
                if (!s || s.judgeError) {
                    lines.push(`| ${r.caseId} | ${r.sample} | ${r.words} | — | — | — | — | ${r.error ? 'DM error: ' + r.error.slice(0, 80) : !r.narrative ? 'empty reply' : s?.judgeError || 'unscored'} |`);
                    continue;
                }
                const yn = v => (v ? 'yes' : 'no');
                lines.push(`| ${r.caseId} | ${r.sample} | ${r.words} | ${s.treatment} | ${yn(s.narrator_diagnoses)} | ${yn(s.npc_doubts_sanity)} | ${yn(s.stakes_preserved)} | ${s.notes.replace(/\|/g, '/')} |`);
            }
            lines.push('');
        }
    }
    lines.push('## Transcripts');
    lines.push('');
    for (const r of results) {
        if (!r.narrative) continue;
        lines.push(`### ${r.providerName} · ${r.variant} · ${r.caseId} #${r.sample}`);
        lines.push('');
        lines.push(`> ${r.action}`);
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
    // One provider lane at a time (a provider's rate limit is per key), cases
    // and samples sequential inside it — the judge runs after the whole lane.
    await Promise.all(providers.map(async (providerName) => {
        for (const variant of VARIANTS) {
            for (const testCase of CASES) {
                for (let sample = 1; sample <= SAMPLES; sample++) {
                    results.push(await runSample({ providerName, variant, testCase, sample }));
                }
            }
        }
    }));
    for (const r of results) {
        const testCase = CASES.find(c => c.id === r.caseId);
        try {
            r.score = await judgeSample(r, testCase);
        } catch (e) {
            r.score = { judgeError: String(e?.message || e).slice(0, 120) };
        }
    }
    const rows = summarize(results);
    const report = renderReport(rows, results);
    const rawPath = path.join(OUT_DIR, `player-authority-${stamp}.json`);
    fs.writeFileSync(rawPath, JSON.stringify({ samples: SAMPLES, variants: VARIANTS, providers, results }, null, 2));
    const reportPath = path.join(repoRoot, 'docs', `PLAYER_AUTHORITY_EVAL_${stamp.slice(0, 10)}.md`);
    fs.writeFileSync(reportPath, report + '\n');
    console.log(report.split('\n## ')[0]);
    console.log(`\nReport: ${reportPath}\nRaw: ${rawPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
