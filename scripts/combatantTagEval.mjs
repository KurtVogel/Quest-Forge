#!/usr/bin/env node
/**
 * Real-provider eval of the Scribe's combatant tag (identity by reference,
 * lane 1, 2026-11-07).
 *
 * The contradiction filter no longer reads a claim's words: the Scribe tags a
 * fact / card / dossier update with the snapshot enemy's id and the fate the
 * claim states. This runs the real `runScribe` on hand-built fights and scores
 * the tag filter against the old word filter (frozen below, eval only) on the
 * SAME claims:
 *
 *   LIES     the narration contradicts the engine. A false claim on the record
 *            is the failure; the Scribe leaving it out counts as a pass.
 *   TRUTHS   a true claim the old filter could drop (namesakes, a third party,
 *            a fate that agrees). The claim missing is the failure.
 *
 *   npm.cmd run eval:combatants
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:combatants
 *
 * Key from the environment or the git-ignored .env (GEMINI_API_KEY). Writes a
 * markdown report + raw JSON to test-results/combatants/. `caught` / `kept`
 * come from a per-case regex over the claim text, a scoring aid for this eval
 * only: read the printed claims before quoting a number.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScribe } from '../src/llm/scribe.js';
import { nameTokensPresent, textWordSet } from '../src/engine/textMatch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

try {
    const envText = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
} catch { /* explicit env only */ }

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('GEMINI_API_KEY missing.'); process.exit(2); }
const RUNS = Math.max(1, Math.min(5, Number(process.env.QF_EVAL_RUNS) || 3));
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(repoRoot, 'test-results', 'combatants');
const settings = { llmProvider: 'gemini', apiKey: key, geminiApiKey: key };

const foe = (id, name, status, hp, maxHp = 30) => ({ id, name, hp, maxHp, condition: hp > 0 ? 'Wounded' : 'Dead', conditions: [], status });

const CASES = [
    // ── the narration lies; the engine's state stands ──
    { id: 'lie-active-dead', kind: 'lie', terminal: 'ongoing', enemies: [foe('enemy-worg', 'Cave-Worg', 'active', 9)],
        narrative: 'Your blade bites deep. The Cave-Worg collapses lifeless on the stones and does not rise again.',
        falseRe: /worg[^.]*\b(dead|dies|died|killed|slain|lifeless|fell|collapsed)\b|\b(killed|slew|slain|felled)\b[^.]*worg/i },
    { id: 'lie-fled-dead', kind: 'lie', terminal: 'escaped', enemies: [foe('enemy-kraul', 'Chief Kraul', 'fled', 5)],
        narrative: 'Chief Kraul dies on your spear in the mouth of the cavern, and the raid is over.',
        falseRe: /kraul[^.]*\b(dead|dies|died|killed|slain)\b|\b(killed|slew|slain)\b[^.]*kraul/i },
    { id: 'lie-surrendered-dead', kind: 'lie', terminal: 'victory', enemies: [foe('enemy-sneek', 'Sneek the Goblin', 'surrendered', 2, 12)],
        narrative: 'Sneek the Goblin throws down his knife, but you cut him down anyway. He lies dead in the mud.',
        falseRe: /sneek[^.]*\b(dead|dies|died|killed|slain)\b|\b(killed|slew|slain|cut down)\b[^.]*sneek/i },
    { id: 'lie-defeated-alive', kind: 'lie', terminal: 'victory', enemies: [foe('enemy-rusk', 'Rusk Ironjaw', 'defeated', 0)],
        narrative: 'Rusk Ironjaw staggers up from the blood, still fighting, and vows you will see him again.',
        falseRe: /rusk(?: ironjaw)? (?:is alive|survived|survives|escaped|remains|lives)/i },
    { id: 'lie-one-of-two', kind: 'lie', terminal: 'victory',
        enemies: [foe('enemy-bandit-1', 'Bandit Scout', 'defeated', 0, 12), foe('enemy-bandit-2', 'Bandit Captain Orlo', 'fled', 8)],
        narrative: 'The Bandit Scout drops with an arrow in his throat. Bandit Captain Orlo falls beside him, slain, and the road is clear.',
        falseRe: /orlo (?:is dead|was killed|was slain|died|dies|fell|falls)|\b(?:killed|slew|slain)\b[^.]*\borlo\b|both[^.]*(?:dead|slain|killed)/i },
    { id: 'lie-active-finished', kind: 'lie', terminal: 'ongoing', enemies: [foe('enemy-sarge', 'Sergeant Holt', 'active', 14)],
        narrative: 'You finish off Sergeant Holt with a thrust under the ribs; the man is destroyed.',
        falseRe: /holt[^.]*\b(dead|dies|died|killed|slain|finished|destroyed)\b|\b(killed|slew|slain|finished off)\b[^.]*holt/i },

    // ── true claims the old filter could lose ──
    { id: 'true-namesake-rat', kind: 'truth', terminal: 'ongoing', enemies: [foe('enemy-rat', 'Rat', 'active', 5, 5)],
        narrative: 'The rat snaps at your boot. Over the din a dockhand shouts that Ratcatcher Finn was killed by the mob an hour ago.',
        trueRe: /ratcatcher finn[^.]*\b(killed|dead|died|slain)\b|\bkilled\b[^.]*ratcatcher finn/i },
    { id: 'true-brother', kind: 'truth', terminal: 'ongoing', enemies: [foe('enemy-rusk', 'Rusk Ironjaw', 'active', 20)],
        narrative: 'Rusk Ironjaw spits blood. "You killed my brother Dorn Ironjaw at Hallow Ford, three winters gone!" he roars, and swings again.',
        trueRe: /\b(dorn|brother)\b[^.]*\b(killed|dead|died|slain)\b|\b(killed|slew)\b[^.]*\b(dorn|brother)\b/i },
    { id: 'true-agrees-fled', kind: 'truth', terminal: 'escaped', enemies: [foe('enemy-kraul', 'Chief Kraul', 'fled', 5)],
        narrative: 'Chief Kraul breaks away and flees into the tunnels, alive and furious, swearing he will return.',
        trueRe: /kraul[^.]*\b(fled|flees|escaped|retreated|tunnels)\b/i },
    { id: 'true-agrees-dead', kind: 'truth', terminal: 'victory', enemies: [foe('enemy-worg', 'Cave-Worg', 'defeated', 0)],
        narrative: 'The Cave-Worg shudders once and is dead at your feet. The cave falls silent.',
        trueRe: /worg[^.]*\b(dead|dies|died|killed|slain|defeated)\b|\b(killed|slew|slain)\b[^.]*worg/i },
    { id: 'true-bystander', kind: 'truth', terminal: 'ongoing', enemies: [foe('enemy-gob', 'Goblin Raider', 'active', 6, 7)],
        narrative: 'The Goblin Raider ducks behind the cart. Old Mervin the ferryman lies dead beside it; the raider killed him before you arrived.',
        trueRe: /mervin[^.]*\b(dead|killed|died|slain)\b|\bkilled\b[^.]*mervin/i },
    { id: 'true-past-self', kind: 'truth', terminal: 'ongoing', enemies: [foe('enemy-morra', 'Morra the Twice-Hanged', 'active', 22)],
        narrative: 'Morra the Twice-Hanged laughs as she circles you. The whole valley believes she died on the gallows at Ennis, and yet here she stands, blade in hand.',
        trueRe: /(gallows|ennis|believe|hang|twice)/i },
];

/** The word filter this lane removed, frozen for comparison (scribe.js before 2026-11-07). */
function oldFilterDrops(value, enemies) {
    const claim = String(value || '').toLowerCase();
    if (enemies.length === 0 || !claim) return false;
    const words = textWordSet(claim);
    const namesEnemy = (name) => {
        const present = nameTokensPresent(words, name);
        if (present !== null) return present;
        const phrase = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
        if (!phrase) return false;
        return ` ${claim.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ')} `.includes(` ${phrase} `);
    };
    const deathClaim = /\b(dead|dies|died|killed|slain|lifeless|destroyed|finished off)\b/i;
    const activeCombatEndedClaim = /\b(defeated|vanquished)\b/i;
    const aliveClaim = /\b(alive|survives|survived|fighting|active)\b/i;
    return enemies.some((enemy) => {
        const name = String(enemy.name || '').toLowerCase();
        if (!name || !namesEnemy(name)) return false;
        if (enemy.status === 'defeated' || (enemy.hp ?? 0) <= 0) return aliveClaim.test(claim);
        if (enemy.status === 'active') return deathClaim.test(claim) || activeCombatEndedClaim.test(claim);
        return deathClaim.test(claim);
    });
}

const NPC_TEXT_FIELDS = ['lastNotes', 'disposition', 'secrets', 'agenda', 'notes', 'stanceToPlayer', 'relationshipTension', 'openThread'];
function landedClaims(actions) {
    const out = [];
    for (const action of actions) {
        if (action.type === 'ADD_WORLD_FACTS') for (const fact of action.payload || []) out.push({ lane: 'fact', text: fact.fact });
        if (action.type === 'ADD_STORY_MEMORY_CARDS') for (const card of action.payload || []) out.push({ lane: 'card', text: card.text });
        if (action.type === 'UPDATE_NPC' || action.type === 'ADD_NPC') {
            const payload = action.payload || {};
            const fields = NPC_TEXT_FIELDS.map(field => payload[field]).filter(value => typeof value === 'string' && value);
            if (fields.length > 0) out.push({ lane: 'npc', text: `${payload.name}: ${fields.join(' ')}` });
        }
    }
    return out;
}

/** The tags themselves never reach a dispatch, so the eval reads them off the wire. */
let wireTags = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
    const response = await realFetch(...args);
    response.clone().text().then((body) => {
        const flat = body.replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\s+/g, ' ');
        for (const match of flat.matchAll(/"combatants": ?(\[[^\]]*\]|\{[^}]*\})/g)) wireTags.push(match[1]);
    }).catch(() => {});
    return response;
};

async function runCase(testCase) {
    wireTags = [];
    const actions = [];
    const dropped = [];
    const realWarn = console.warn;
    const realLog = console.log;
    console.warn = (...args) => {
        const line = args.join(' ');
        const match = line.match(/^\[Scribe\] Dropped "(.*)" — contradicts/s);
        if (match) dropped.push(match[1]);
        else realWarn(...args);
    };
    console.log = () => {};
    try {
        await runScribe({
            playerMessage: 'Combat exchange',
            dmNarrative: testCase.narrative,
            settings,
            dispatch: action => actions.push(action),
            authoritativeContext: { terminal: testCase.terminal, postState: { player: { name: 'Astra', hp: 18, maxHp: 24, status: 'conscious' }, enemies: testCase.enemies, companions: [] } },
        });
    } finally {
        console.warn = realWarn;
        console.log = realLog;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    const tags = wireTags;
    const landed = landedClaims(actions);
    const allClaims = [...landed.map(claim => claim.text), ...dropped];
    const oldLanded = allClaims.filter(text => !oldFilterDrops(text, testCase.enemies));
    const pattern = testCase.kind === 'lie' ? testCase.falseRe : testCase.trueRe;
    const hit = (texts) => texts.some(text => pattern.test(text));
    return {
        landed, dropped, tags,
        newPass: testCase.kind === 'lie' ? !hit(landed.map(claim => claim.text)) : hit(landed.map(claim => claim.text)),
        oldPass: testCase.kind === 'lie' ? !hit(oldLanded) : hit(oldLanded),
        wrote: allClaims.length,
    };
}

async function main() {
    const results = [];
    for (const testCase of CASES) {
        for (let run = 1; run <= RUNS; run++) {
            let outcome;
            try {
                outcome = await runCase(testCase);
            } catch (error) {
                outcome = { error: String(error?.message || error) };
            }
            results.push({ id: testCase.id, kind: testCase.kind, run, ...outcome });
            process.stdout.write(outcome.error ? 'E' : (outcome.newPass ? '.' : 'x'));
        }
    }
    process.stdout.write('\n');

    const score = (kind, field) => {
        const rows = results.filter(row => row.kind === kind && !row.error);
        return `${rows.filter(row => row[field]).length}/${rows.length}`;
    };
    const report = [
        `# Combatant tag eval, ${new Date().toISOString()}`,
        '',
        `Machinery Flash, ${CASES.length} hand-built fights, ${RUNS} run(s) each. Regex scored: read the claims below before quoting.`,
        '',
        '| Set | Tag filter | Old word filter, same claims |',
        '|---|---|---|',
        `| Lies kept off the record | ${score('lie', 'newPass')} | ${score('lie', 'oldPass')} |`,
        `| Truths on the record | ${score('truth', 'newPass')} | ${score('truth', 'oldPass')} |`,
        `| Runs where the Scribe sent a tag | ${results.filter(row => row.tags?.length > 0).length}/${results.length} | |`,
        `| Claims dropped by the tag filter | ${results.reduce((sum, row) => sum + (row.dropped?.length || 0), 0)} | |`,
        '',
        `Failed calls: ${results.filter(row => row.error).length}`,
        '',
    ];
    for (const row of results) {
        report.push(`## ${row.id} #${row.run}: tag ${row.newPass ? 'pass' : 'FAIL'}, old ${row.oldPass ? 'pass' : 'FAIL'}`);
        if (row.error) report.push(`Error: ${row.error}`);
        for (const claim of row.landed || []) report.push(`- landed (${claim.lane}): ${claim.text}`);
        for (const text of row.dropped || []) report.push(`- DROPPED: ${text}`);
        for (const tag of row.tags || []) report.push(`- tag: ${tag}`);
        if (!row.error && row.wrote === 0) report.push('- (the Scribe wrote nothing)');
        report.push('');
    }
    const dir = path.join(OUT_DIR, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.md'), report.join('\n'));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(report.slice(0, 11).join('\n'));
    console.log(`Report: ${dir}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
