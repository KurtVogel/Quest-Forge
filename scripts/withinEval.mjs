#!/usr/bin/env node
/**
 * Real-provider eval of a new place's container (2026-11-09). In the
 * megacampaign every DM name in a new port was "<spot>, Corve-in-the-South";
 * no record was the town, `within` could only copy KNOWN PLACES, and the
 * Scribe put the Exchange Arcade "within" the water-stairs — the one Corve
 * record on its list. Read from the wire (the UPDATE_LOCATION_PROFILE
 * payload's `within`), no judge, per case:
 *
 *   new-town     the town is NOT on KNOWN PLACES; a neighbouring spot of it
 *                is. Right: the town's name. NEIGHBOUR: the other spot.
 *   known-town   the town IS on KNOWN PLACES. Right: the exact copy.
 *   no-town      a road with no named container. Right: omitted. LAND: the
 *                land's name used as a container.
 *
 *   npm.cmd run eval:within
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:within
 *
 * QF_EVAL_LABEL names the arm; QF_EVAL_REPO runs the same cases against
 * another checkout (a worktree of the commit before, for the before arm).
 * Key from the environment or the git-ignored .env (GEMINI_API_KEY).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const codeRoot = process.env.QF_EVAL_REPO ? path.resolve(process.env.QF_EVAL_REPO) : repoRoot;
const { runScribe } = await import(pathToFileURL(path.join(codeRoot, 'src/llm/scribe.js')).href);
const { normalizeLocationRecord } = await import(pathToFileURL(path.join(codeRoot, 'src/engine/locationRegistry.js')).href);
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
const LABEL = process.env.QF_EVAL_LABEL || 'run';
const OUT_DIR = path.join(repoRoot, 'test-results', 'within');
const settings = { llmProvider: 'gemini', apiKey: key, geminiApiKey: key };

const record = (name, extra = {}) => normalizeLocationRecord({ name, ...extra });
const MEREN = [record('Cape Morrow', { region: 'Meren' }), record('The Salt Queen'), record("Maelis's Fish-Shanty, Cape Morrow", { region: 'Meren' })];

const CASES = [
    { id: 'arcade-new-town', want: 'Corve-in-the-South', neighbour: 'Lower water-stairs, Corve-in-the-South',
        here: 'Exchange Arcade',
        locations: [...MEREN, record('Lower water-stairs, Corve-in-the-South'), record('Exchange Arcade')],
        player: 'I head up from the water-stairs into town.',
        narrative: 'You leave the water-stairs behind and push up through the mud lanes of Corve-in-the-South until the street opens into the Exchange Arcade: a long colonnade of oak pillars where timber brokers shout prices for spruce and pitch, chalking figures on slate boards. Ketta keeps Orlo close. A broker in a saffron coat looks you over and goes back to his ledger.' },
    { id: 'inn-new-town', want: 'Corve-in-the-South', neighbour: 'Lower water-stairs, Corve-in-the-South',
        here: 'The Oak & Anchor',
        locations: [...MEREN, record('Lower water-stairs, Corve-in-the-South'), record('The Oak & Anchor')],
        player: 'We find an inn.',
        narrative: 'The Oak & Anchor stands on the riverfront of Corve-in-the-South, three storeys of black timber leaning over the quay. Inside, a fire of oak logs, a long bar, and a landlady with forearms like a smith who wants two silver a night and no trouble. Ketta pays. Orlo collapses onto a bench by the fire.' },
    { id: 'arcade-known-town', want: 'Corve-in-the-South', neighbour: 'Lower water-stairs, Corve-in-the-South',
        here: 'Exchange Arcade',
        locations: [...MEREN, record('Corve-in-the-South', { type: 'settlement' }), record('Lower water-stairs, Corve-in-the-South'), record('Exchange Arcade')],
        player: 'I head up from the water-stairs into town.',
        narrative: 'You leave the water-stairs behind and push up through the mud lanes of Corve-in-the-South until the street opens into the Exchange Arcade: a long colonnade of oak pillars where timber brokers shout prices for spruce and pitch, chalking figures on slate boards. Ketta keeps Orlo close.' },
    { id: 'road-no-town', want: null, land: 'The Green Marches',
        here: 'The Marsh Causeway',
        locations: [...MEREN, record('Corve-in-the-South', { type: 'settlement', region: 'The Green Marches' }), record('The Marsh Causeway')],
        player: 'We leave Corve on the upland road.',
        narrative: 'Corve falls behind. The Marsh Causeway runs north across the reed-flats of the Green Marches, a raised spine of logs and packed earth with black water on both sides and herons standing in it. Nobody else is on the road. Yvaine\'s charter rides in Ketta\'s coat.' },
];

async function runCase(testCase, run) {
    const actions = [];
    const real = { log: console.log, warn: console.warn, info: console.info };
    console.log = () => {}; console.warn = () => {}; console.info = () => {};
    let error = null;
    try {
        await runScribe({
            playerMessage: testCase.player,
            dmNarrative: testCase.narrative,
            settings,
            dispatch: action => actions.push(action),
            knownLocations: testCase.locations.filter(r => r.name !== testCase.here).map(r => r.name).join('; '),
            sourceMessageId: `eval-${testCase.id}-${run}`,
            memoryContext: { worldFacts: [], messageCount: 40, location: testCase.here, locations: testCase.locations, npcs: [], storyMemory: [], campaign: { sessionId: 's', loadNonce: 0 } },
        });
    } catch (e) {
        error = String(e?.message || e);
    } finally {
        Object.assign(console, real);
    }
    const profile = actions.find(a => a.type === 'UPDATE_LOCATION_PROFILE')?.payload || null;
    const within = typeof profile?.profile?.within === 'string' && profile.profile.within.trim() ? profile.profile.within.trim() : null;
    let outcome;
    if (error) outcome = 'ERROR';
    else if (!profile) outcome = 'no-profile';
    else if (testCase.want === null) outcome = within === null ? 'right' : (testCase.land && within === testCase.land ? 'LAND' : 'OTHER');
    else if (within === testCase.want) outcome = 'right';
    else if (within && within === testCase.neighbour) outcome = 'NEIGHBOUR';
    else if (within === null) outcome = 'omitted';
    else outcome = 'OTHER';
    return { outcome, within, profileName: profile?.name || null, error };
}

const results = [];
for (const testCase of CASES) {
    for (let run = 1; run <= RUNS; run += 1) {
        const row = await runCase(testCase, run);
        results.push({ id: testCase.id, run, ...row });
        process.stdout.write(row.outcome === 'right' ? '.' : row.outcome === 'omitted' || row.outcome === 'no-profile' ? '-' : 'x');
    }
}
process.stdout.write('\n');
const lines = [
    `# A new place's container, ${LABEL}, ${new Date().toISOString()}`,
    '',
    `Machinery Flash, the real \`runScribe\` from ${path.relative(repoRoot, codeRoot) || 'this checkout'}, ${CASES.length} hand-built turns × ${RUNS} run(s). Read from the UPDATE_LOCATION_PROFILE payload; no judge.`,
    '',
    ...CASES.map(c => {
        const rows = results.filter(r => r.id === c.id);
        const counts = {};
        for (const r of rows) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
        return `- ${c.id}: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')} — within as written: ${rows.map(r => JSON.stringify(r.within)).join(', ')}`;
    }),
];
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join(OUT_DIR, `${stamp}-${LABEL}`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'raw.json'), JSON.stringify(results, null, 1));
console.log(lines.join('\n'));
console.log(`\nReport: ${path.relative(repoRoot, dir)}`);
