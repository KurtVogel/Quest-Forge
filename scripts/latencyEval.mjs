#!/usr/bin/env node
/**
 * Real-provider turn-latency eval (review queue item 2).
 *
 * How long does the player wait, per model and per thinking setting? The
 * same twenty scripted turns, one skill check and one fight round are played
 * through the app's own turn pipeline (headless, in Node), each from a saved
 * campaign state, so every model and setting answers the same line with the
 * same story behind it. The thinking / reasoning field is set on the DM
 * stream's request as it leaves; nothing under `src/` changes.
 *
 *   npm.cmd run eval:latency -- probe          # which settings each model accepts, and what they cost in thinking tokens
 *   npm.cmd run eval:latency -- record         # play the script once on the shipped default, save the states (scripts/latency/fixture.json)
 *   npm.cmd run eval:latency -- run <label>    # every cell in its own process, then the tables and the blind read
 *   npm.cmd run eval:latency -- report <dir> --docs   # rebuild the tables from saved results; --docs also writes the blind read and its key to docs/
 *
 *   $env:QF_LAT_CELLS="gemini:gemini-3.8-flash:default,gemini:gemini-3.8-flash:low"   # provider:model:setting
 *   $env:QF_LAT_TURNS="5"; $env:QF_LAT_REPS="1"                                       # a short run
 *
 * Settings: gemini default | unset | minimal | low | medium | high | budget0;
 * openai default | unset | none | low | medium | high. `default` leaves the
 * request as the app built it (the app as it ships); `unset` removes the
 * thinking field, so the provider's own default governs. Gemini Flash and GPT
 * only, never the Grok DM.
 *
 * Keys come from the environment or the git-ignored .env (GEMINI_API_KEY,
 * OPENAI_API_KEY) and are never printed or written. The Gemini key is needed
 * by every cell: the memory lookup and the roll arbiter always run on it.
 * Results go to scripts/.eval-out/latency/<label>/ (git-ignored).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installNodeShim } from './latency/nodeShim.mjs';
import { assignLetters, cellLabel, renderBlindRead, renderKey, renderTables, summarizeCell } from './latency/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const FIXTURE = path.join(here, 'latency', 'fixture.json');
const SELF = fileURLToPath(import.meta.url);

const DEFAULT_CELLS = [
    'gemini:gemini-3.8-flash:default',
    'gemini:gemini-3.8-flash:low',
    'gemini:gemini-3.8-flash:budget0',
    'gemini:gemini-3.5-flash-lite:default',
    'openai:gpt-6.1-sol:default',
    'openai:gpt-6.1-sol:low',
];

const mode = process.argv[2] || 'run';
const today = new Date().toISOString().slice(0, 10);
const say = (prefix) => (message) => process.stderr.write(`[${prefix}] ${message}\n`);

/** The app logs every turn in detail; a measured run keeps only its own lines unless asked. */
function quietAppLogs() {
    if (process.env.QF_LAT_VERBOSE === '1') return;
    console.log = () => {};
    console.info = () => {};
    console.debug = () => {};
    console.warn = () => {};
    console.error = () => {};
}

async function loadHarness() {
    installNodeShim();
    const lib = await import('./latency/headless.mjs');
    const keys = lib.loadKeys(repoRoot);
    if (!keys.gemini) {
        process.stderr.write('GEMINI_API_KEY is required (environment or .env): the memory lookup and the roll arbiter run on it for every DM.\n');
        process.exit(2);
    }
    return { lib, keys };
}

async function record() {
    const { lib, keys } = await loadHarness();
    const cell = lib.parseCell(process.env.QF_LAT_RECORD_CELL || 'gemini:gemini-3.8-flash:default');
    quietAppLogs();
    const meta = await lib.recordFixture({ cell, keys, file: FIXTURE, say: say('record') });
    process.stdout.write(`Recorded ${path.relative(repoRoot, FIXTURE)}: ${JSON.stringify(meta)}\n`);
}

async function runOneCell() {
    const [spec, file] = [process.argv[3], process.argv[4]];
    if (!spec || !file) {
        process.stderr.write('Usage: latencyEval.mjs cell <provider:model:setting> <outFile>\n');
        process.exit(2);
    }
    const { lib, keys } = await loadHarness();
    const cell = lib.parseCell(spec);
    if (cell.provider === 'openai' && !keys.openai) {
        process.stderr.write('OPENAI_API_KEY is required for an OpenAI cell.\n');
        process.exit(2);
    }
    const fixture = lib.readFixture(FIXTURE);
    quietAppLogs();
    const result = await lib.runCell({
        cell, keys, fixture, file,
        turns: Math.max(1, Number(process.env.QF_LAT_TURNS) || 20),
        reps: Math.max(0, process.env.QF_LAT_REPS === undefined ? 3 : Number(process.env.QF_LAT_REPS) || 0),
        say: say(`${cell.model} ${cell.setting}`),
    });
    process.exit(result.aborted ? 1 : 0);
}

function readResults(outDir) {
    return fs.readdirSync(outDir)
        .filter(name => /^cell-.*\.json$/.test(name))
        .map(name => JSON.parse(fs.readFileSync(path.join(outDir, name), 'utf8')));
}

function report(outDir, { docs = false } = {}) {
    const order = (process.env.QF_LAT_CELLS ? process.env.QF_LAT_CELLS.split(',').map(s => s.trim()) : DEFAULT_CELLS);
    const position = (result) => {
        const index = order.indexOf(result.cell.spec);
        return index === -1 ? order.length : index;
    };
    const results = readResults(outDir).sort((a, b) => position(a) - position(b) || a.cell.spec.localeCompare(b.cell.spec));
    if (results.length === 0) {
        process.stderr.write(`No cell results in ${outDir}.\n`);
        process.exit(2);
    }
    const summaries = results.map(summarizeCell);
    const tables = renderTables(summaries);
    fs.writeFileSync(path.join(outDir, 'tables.md'), `${tables}\n`);
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summaries, null, 1));

    // The letters are shuffled once per result folder and kept, so a re-render never re-letters a read in progress.
    const seedFile = path.join(outDir, 'blind-seed.json');
    const seed = fs.existsSync(seedFile) ? JSON.parse(fs.readFileSync(seedFile, 'utf8')).seed : randomInt(1, 2 ** 31 - 1);
    fs.writeFileSync(seedFile, JSON.stringify({ seed }));
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const lettered = assignLetters(results, seed);
    const date = (results[0].startedAt || today).slice(0, 10);
    const blind = renderBlindRead({ fixture, lettered, date });
    const key = renderKey({ lettered, seed, date });
    fs.writeFileSync(path.join(outDir, 'blind-read.md'), `${blind}\n`);
    fs.writeFileSync(path.join(outDir, 'blind-key.md'), key);
    if (docs) {
        fs.writeFileSync(path.join(repoRoot, 'docs', `LATENCY_EVAL_${date}_BLIND_READ.md`), `${blind}\n`);
        fs.writeFileSync(path.join(repoRoot, 'docs', `LATENCY_EVAL_${date}_KEY.md`), key);
    }
    process.stdout.write(`${tables}\n`);
    for (const result of results) if (result.aborted) process.stderr.write(`NOTE: ${cellLabel(result.cell)} stopped early: ${result.aborted}\n`);
    process.stderr.write(`\nResults: ${outDir}\n${docs ? `Blind read and key: docs/LATENCY_EVAL_${date}_BLIND_READ.md, docs/LATENCY_EVAL_${date}_KEY.md\n` : ''}`);
}

async function runAll() {
    if (!fs.existsSync(FIXTURE)) {
        process.stderr.write('No fixture yet. Run: npm.cmd run eval:latency -- record\n');
        process.exit(2);
    }
    const label = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = process.env.QF_LAT_OUT || path.join(here, '.eval-out', 'latency', label);
    fs.mkdirSync(outDir, { recursive: true });
    const specs = (process.env.QF_LAT_CELLS ? process.env.QF_LAT_CELLS.split(',') : DEFAULT_CELLS).map(s => s.trim()).filter(Boolean);
    const parallel = Math.max(1, Number(process.env.QF_LAT_PARALLEL) || specs.length);
    process.stderr.write(`Latency run "${label}": ${specs.length} cells, ${parallel} at a time.\n`);
    // Cells run side by side on purpose: every setting is then measured under the same provider load.
    let next = 0;
    const failures = [];
    const worker = async () => {
        while (next < specs.length) {
            const spec = specs[next];
            next += 1;
            const file = path.join(outDir, `cell-${spec.replace(/[^a-z0-9.-]+/gi, '_')}.json`);
            const code = await new Promise((resolve) => {
                const child = spawn(process.execPath, [SELF, 'cell', spec, file], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
                child.on('exit', resolve);
                child.on('error', () => resolve(1));
            });
            if (code !== 0) failures.push(spec);
        }
    };
    const workers = [];
    for (let i = 0; i < parallel; i += 1) {
        workers.push(worker());
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    await Promise.all(workers);
    if (failures.length > 0) process.stderr.write(`Cells that stopped early or failed: ${failures.join(', ')}\n`);
    report(outDir, { docs: process.argv.includes('--docs') });
}

/** One small call per model and setting: is the setting accepted, and how many thinking tokens does it spend? */
async function probe() {
    installNodeShim();
    const { loadKeys, scrubKeys, WIRE_SETTINGS } = await import('./latency/headless.mjs');
    const keys = loadKeys(repoRoot);
    const SYSTEM = 'You are the Dungeon Master of a low-fantasy tabletop RPG. Narrate in second person, plain words, about 120 words. Never roll dice.';
    const USER = 'I try to convince the harbormaster to forgive half my debt by pointing out the lighthouse has been dark for a week and I am the only one willing to row out there.';
    const models = {
        gemini: (process.env.QF_LAT_PROBE_GEMINI || 'gemini-3.8-flash,gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-3.1-flash-lite').split(','),
        openai: (process.env.QF_LAT_PROBE_OPENAI || 'gpt-6.1-sol,gpt-6-luna').split(','),
    };
    const jobs = [];
    for (const provider of ['gemini', 'openai']) {
        if (!keys[provider]) continue;
        for (const model of models[provider]) {
            for (const [setting, wire] of Object.entries(WIRE_SETTINGS[provider])) jobs.push({ provider, model, setting, wire });
        }
    }
    const call = async ({ provider, model, wire }) => {
        const startedAt = performance.now();
        const gemini = provider === 'gemini';
        const response = await fetch(gemini ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` : 'https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(gemini ? { 'x-goog-api-key': keys.gemini } : { Authorization: `Bearer ${keys.openai}` }) },
            body: JSON.stringify(gemini
                ? { system_instruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: USER }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 4096, ...(wire ? { thinkingConfig: wire } : {}) } }
                : { model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }], max_completion_tokens: 4096, ...(wire || {}) }),
            signal: AbortSignal.timeout(120000),
        });
        const ms = Math.round(performance.now() - startedAt);
        const text = await response.text();
        let data = null;
        try { data = JSON.parse(text); } catch { data = null; }
        if (!response.ok) return `HTTP ${response.status} after ${ms} ms: ${scrubKeys(data?.error?.message || text, keys).slice(0, 160)}`;
        const thinking = gemini ? (data?.usageMetadata?.thoughtsTokenCount ?? 0) : (data?.usage?.completion_tokens_details?.reasoning_tokens ?? 0);
        return `ok, ${ms} ms, ${thinking} thinking tokens`;
    };
    let next = 0;
    const lines = [];
    await Promise.all(Array.from({ length: 6 }, async () => {
        while (next < jobs.length) {
            const index = next;
            next += 1;
            const job = jobs[index];
            let outcome;
            try { outcome = await call(job); } catch (error) { outcome = `failed: ${scrubKeys(error?.message, keys).slice(0, 160)}`; }
            lines[index] = `${job.model.padEnd(24)} ${job.setting.padEnd(8)} ${outcome}`;
        }
    }));
    process.stdout.write(`${lines.join('\n')}\n`);
}

const modes = { probe, record, cell: runOneCell, run: runAll, report: async () => report(path.resolve(process.argv[3] || ''), { docs: process.argv.includes('--docs') }) };
if (!modes[mode]) {
    process.stderr.write(`Unknown mode "${mode}". One of: ${Object.keys(modes).join(', ')}.\n`);
    process.exit(2);
}
modes[mode]().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
});
