#!/usr/bin/env node
/**
 * Real-provider eval of the place lane (identity by reference, lane 9A,
 * 2026-11-08). The registry no longer folds two place names by their words:
 * the Scribe is shown KNOWN PLACES and asked to copy a name verbatim when the
 * hero stands in one of them, to give a new place its own proper name, and —
 * when the DM put the hero at a name no record answers to (PLACE NAMED
 * WITHOUT A RECORD) — to say in place_links which known place it IS, or
 * "new". This script runs the real `runScribe` on hand-built turns and reads
 * the wire:
 *
 *   copy      the hero ends the turn in a KNOWN place under a colloquial
 *             phrasing: did `location` copy the exact known name? "copy" ·
 *             "PHRASING" another string for the same place (a mint the old
 *             rung would have folded) · "WRONG-COPY" a different known place ·
 *             "none" no location
 *   new       a new named place beside known ones: "new" its own proper name ·
 *             "WRONG-COPY" a known name · "none"
 *   link      PLACE NAMED WITHOUT A RECORD is a known place under another
 *             phrasing: "link" is = that place · "WRONG-LINK" another known ·
 *             "MISSED" is = new · "none" no answer
 *   link-new  PLACE NAMED WITHOUT A RECORD is genuinely new: "new" ·
 *             "WRONG-LINK" is = a known place · "none"
 *   card      a story card written in a known place: "copy" its location is a
 *             known name · "omit" no location · "FREE-TEXT" another string
 *   travel    a journey between two known places: "copy" both ends exact ·
 *             "PHRASING" an end in other words · "none" no travel
 *
 *   npm.cmd run eval:placeid
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:placeid
 *
 * Key from the environment or the git-ignored .env (GEMINI_API_KEY). Writes a
 * markdown report + raw JSON to test-results/placeid/. No judge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScribe } from '../src/llm/scribe.js';
import { placeKey } from '../src/engine/locationRegistry.js';

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
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(repoRoot, 'test-results', 'placeid');
const settings = { llmProvider: 'gemini', apiKey: key, geminiApiKey: key };

const KNOWN = ['The Copper Kettle', 'Bramblecross market', 'Bramblecross', 'Larkspur Ford', 'Southern Haul Road'];
const knownLocations = KNOWN.join('; ');
const isKnown = (name) => KNOWN.some(k => placeKey(k) === placeKey(name));
const exactKnown = (name) => KNOWN.find(k => k === String(name || '').trim()) || null;

const CASES = [
    { id: 'copy-kettle', kind: 'copy', want: 'The Copper Kettle', from: 'Bramblecross market',
        player: 'I cross the square and go into the Kettle.',
        narrative: 'You leave the market stalls behind and push through the low door of the Copper Kettle. The common room is half full; the chandler\'s wife, Idra, is behind the bar with the good candles lit. "Back again," she says, and sets a cup down for you.' },
    { id: 'copy-market', kind: 'copy', want: 'Bramblecross market', from: 'The Copper Kettle',
        player: 'I step back out to the stalls.',
        narrative: 'Out of the Kettle\'s warmth and into the Bramblecross market again: fish on wet slate, a drover shouting prices, the bell over the well-house ringing the half hour. Nobody looks at you twice.' },
    { id: 'new-forge', kind: 'new', from: 'Bramblecross market',
        player: 'I follow the hammering to the smithy on the corner.',
        narrative: 'The hammering leads you off the square to a soot-black doorway under a painted horseshoe: Harl Demb\'s forge. Harl himself, broad as the door, looks up from the anvil. "If it\'s a blade, come back tomorrow. If it\'s coin, come in."' },
    { id: 'link-backroom', kind: 'link', want: 'The Copper Kettle', provisional: 'The Kettle\'s back room', from: 'The Kettle\'s back room',
        player: 'I ask Idra if we can talk somewhere quieter.',
        narrative: 'Idra lifts the bar flap and leads you through to the back room of the Copper Kettle, where the chandlery stock is stacked to the beams. She shuts the door on the common room\'s noise. "Quieter," she agrees. "Now. What is it?"' },
    { id: 'link-forge', kind: 'link-new', provisional: 'Harl Demb\'s forge', from: 'Harl Demb\'s forge',
        player: 'I ask Harl what the horseshoe sign means.',
        narrative: 'Harl Demb wipes his hands. "Means I shoe what the drovers bring and mend what the market breaks. Forge has stood on this corner forty years — my father\'s before mine." Across the square the Copper Kettle\'s shutters are going up for the evening.' },
    { id: 'card-kettle', kind: 'card', from: 'The Copper Kettle',
        player: 'I promise Idra I will bring the candle-money by the tide-bell tomorrow.',
        narrative: 'Idra holds your eye a moment across the Copper Kettle\'s bar, then nods once. "Tide-bell. I\'ll hold the good wax till then — not a bell later." She writes a mark in the chalk ledger behind her and the matter is settled, for now.' },
    { id: 'travel-ford', kind: 'travel', fromPlace: 'Bramblecross', toPlace: 'Larkspur Ford', from: 'Bramblecross',
        player: 'We take the haul road south and keep walking till the ford.',
        narrative: 'Two days on the Southern Haul Road, south out of Bramblecross with the quarry carts, and on the second evening the river shows ahead and the stockade gates of Larkspur Ford with it. The gate-warden waves the carts through and eyes you as you come in behind them.' },
];

async function runCase(testCase, run) {
    const actions = [];
    const realLog = console.log; const realWarn = console.warn; const realInfo = console.info;
    console.log = () => {}; console.warn = () => {}; console.info = () => {};
    let error = null;
    try {
        await runScribe({
            playerMessage: testCase.player,
            dmNarrative: testCase.narrative,
            settings,
            dispatch: action => actions.push(action),
            knownLocations,
            provisionalPlace: testCase.provisional || null,
            dmLocationEvent: testCase.provisional ? testCase.provisional : null,
            memoryContext: { worldFacts: [], messageCount: 60, location: testCase.from, npcs: [], storyMemory: [], campaign: null },
            sourceMessageId: `eval-${testCase.id}-${run}`,
        });
    } catch (e) {
        error = String(e?.message || e);
    } finally {
        console.log = realLog; console.warn = realWarn; console.info = realInfo;
    }
    const setLocation = actions.filter(a => a.type === 'SET_LOCATION').map(a => (typeof a.payload === 'string' ? a.payload : a.payload?.name)).filter(Boolean);
    const profile = actions.find(a => a.type === 'UPDATE_LOCATION_PROFILE')?.payload?.name || null;
    const links = actions.filter(a => a.type === 'LINK_PLACES').flatMap(a => a.payload?.links || []);
    const travel = actions.find(a => a.type === 'ADD_TRAVEL_LINK')?.payload || null;
    const cards = actions.filter(a => a.type === 'ADD_STORY_MEMORY_CARDS').flatMap(a => a.payload || []).map(c => ({ type: String(c?.type || ''), location: c?.location ?? null, text: String(c?.text || '').slice(0, 100) }));
    const wire = { setLocation, profile, links, travel: travel ? { from: travel.from, to: travel.to } : null, cards };
    let outcome;
    const location = setLocation[0] || null;
    if (error) outcome = 'ERROR';
    else if (testCase.kind === 'copy') {
        if (!location) outcome = 'none';
        else if (location === testCase.want) outcome = 'copy';
        else if (isKnown(location)) outcome = 'WRONG-COPY';
        else outcome = 'PHRASING';
    } else if (testCase.kind === 'new') {
        if (!location) outcome = 'none';
        else if (isKnown(location)) outcome = 'WRONG-COPY';
        else outcome = 'new';
    } else if (testCase.kind === 'link') {
        const mine = links.filter(l => placeKey(l.name) === placeKey(testCase.provisional));
        if (mine.length === 0) outcome = 'none';
        else if (mine.some(l => l.is === testCase.want)) outcome = 'link';
        else if (mine.some(l => l.is.toLowerCase() === 'new')) outcome = 'MISSED';
        else outcome = 'WRONG-LINK';
    } else if (testCase.kind === 'link-new') {
        const mine = links.filter(l => placeKey(l.name) === placeKey(testCase.provisional));
        if (mine.length === 0) outcome = 'none';
        else if (mine.some(l => l.is.toLowerCase() === 'new')) outcome = 'new';
        else outcome = 'WRONG-LINK';
    } else if (testCase.kind === 'card') {
        if (cards.length === 0) outcome = 'none';
        else if (cards.every(c => c.location === null || c.location === undefined || c.location === '')) outcome = 'omit';
        else if (cards.every(c => !c.location || exactKnown(c.location))) outcome = 'copy';
        else outcome = 'FREE-TEXT';
    } else if (testCase.kind === 'travel') {
        if (!travel) outcome = 'none';
        else if (travel.from === testCase.fromPlace && travel.to === testCase.toPlace) outcome = 'copy';
        else outcome = 'PHRASING';
    }
    return { outcome, wire, error };
}

async function main() {
    const results = [];
    const good = new Set(['copy', 'new', 'link', 'omit']);
    for (const testCase of CASES) {
        for (let run = 1; run <= RUNS; run += 1) {
            const row = await runCase(testCase, run);
            results.push({ id: testCase.id, kind: testCase.kind, run, ...row });
            process.stdout.write(good.has(row.outcome) ? '.' : row.outcome === 'none' ? '-' : 'x');
        }
    }
    process.stdout.write('\n');
    const tally = (kind) => {
        const rows = results.filter(r => r.kind === kind);
        const counts = {};
        for (const r of rows) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
        return `${rows.length} runs: ${Object.entries(counts).map(([name, n]) => `${name} ${n}`).join(', ')}`;
    };
    const report = [
        `# Places by exact name, ${new Date().toISOString()}`,
        '',
        `Machinery Flash, the real \`runScribe\`, ${CASES.length} hand-built turns × ${RUNS} run(s), five known places. No judge: read from the SET_LOCATION, LINK_PLACES, ADD_TRAVEL_LINK and ADD_STORY_MEMORY_CARDS payloads.`,
        '',
        `- copy (a known place under a colloquial phrasing: "copy" the exact name, "PHRASING" another string = a mint the old rung folded, "WRONG-COPY" another known place, "none"): ${tally('copy')}`,
        `- new (a new named place beside known ones: "new" its own name, "WRONG-COPY" a known name, "none"): ${tally('new')}`,
        `- link (the DM's unrecorded name IS a known place: "link", "WRONG-LINK", "MISSED" = said new, "none"): ${tally('link')}`,
        `- link-new (the DM's unrecorded name is genuinely new: "new", "WRONG-LINK", "none"): ${tally('link-new')}`,
        `- card (a card's location: "copy" a known name, "omit", "FREE-TEXT"): ${tally('card')}`,
        `- travel (both ends exact known names: "copy", "PHRASING", "none"): ${tally('travel')}`,
        '',
    ];
    for (const r of results) report.push(`- ${r.id} #${r.run}: **${r.outcome}** ${JSON.stringify(r.wire)}${r.error ? ' ERROR ' + r.error : ''}`);
    const dir = path.join(OUT_DIR, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.md'), report.join('\n'));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(report.slice(0, 11).join('\n'));
    for (const r of results.filter(x => !good.has(x.outcome))) console.log(`${r.id} #${r.run} ${r.outcome} ${JSON.stringify(r.wire)}`);
    console.log(`Report: ${dir}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
