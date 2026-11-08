#!/usr/bin/env node
/**
 * Real-provider eval of the story-card lane (identity by reference, lane 8,
 * 2026-11-08). The reducer no longer folds two cards by their words: the
 * Scribe is shown KNOWN STORY CARDS — the cards for the people in the
 * exchange and the cards nearest in meaning to it — and asked to echo the id
 * of the card a beat continues; the cadence reflection is shown pairs of
 * cards that MAY be one beat (possibleSameCard) and folds a pair by id in
 * merge_cards. This script runs the real `runScribe` and the real
 * `runNpcFrontReflection` on hand-built turns and reads the wire:
 *
 *   echo     a recorded beat restated in other words, its card listed by its
 *            person: did story_memory carry that card's id? "id" right ·
 *            "WRONG-ID" another card's id · "TWIN" a card with no id (a
 *            duplicate the old rungs would have folded) · "none" no card
 *   near     the same, but the card is listed ONLY by nearest meaning (its
 *            people are not named this turn)
 *   new      a genuinely new beat beside listed cards: "clean" = a card with
 *            no id · "WRONG-ID" pinned to a listed card · "none"
 *   merge    the reflection shown a true duplicate pair AND a two-beats pair
 *            (a trust and a slap): "merge" folds the duplicate alone ·
 *            "WRONG-MERGE" touched the two-beats pair · "MISSED" left the
 *            duplicate
 *
 *   npm.cmd run eval:cardid
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:cardid
 *
 * Key from the environment or the git-ignored .env (GEMINI_API_KEY). Writes a
 * markdown report + raw JSON to test-results/cardid/. No judge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKnownStoryCards, runNpcFrontReflection, runScribe } from '../src/llm/scribe.js';

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
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(repoRoot, 'test-results', 'cardid');
const settings = { llmProvider: 'gemini', apiKey: key, geminiApiKey: key };

const card = (id, type, subject, text, linkedNpcNames = [], extra = {}) => ({ id, type, subject, text, linkedNpcNames, status: 'active', salience: 3, emotionalCharge: 2, source: 'scribe', firstSeenMessage: 10, lastSeenMessage: 10, ...extra });
const POOL = [
    card('c-gannet', 'promise', 'the Gannet Rock vow', 'Kerttu promised Old Tammo to row out to Gannet Rock and find out why the light has gone dark before the autumn gales.', ['Old Tammo']),
    card('c-berth', 'promise', 'the berth debt', 'The hero owes Harbormaster Orsa Pellwyn eleven silver and four copper for the berth and net-cord, due by tomorrow\'s tide-bell.', ['Orsa Pellwyn']),
    card('c-secret', 'relationship', 'the brother\'s bond', 'Tammo swore to keep the hero\'s secret about buying her brother\'s bond from the debtors\' cells at Varrowgate.', ['Old Tammo'], { knownBy: ['the hero', 'Old Tammo'] }),
    card('c-steel', 'playerCanon', 'the harbor rule', 'Kerttu\'s rule: fists if they must, never steel inside Saltmere harbor.', []),
    card('c-sail', 'callback', 'the spare sail', 'The Kittiwake\'s spare sail is lashed beneath the foredeck, clear of the bilge.', []),
];
const poolState = { storyMemory: POOL };

const CASES = [
    { id: 'echo-gannet', kind: 'echo', want: 'c-gannet',
        player: 'I remind Tammo I have not forgotten the light.',
        narrative: 'Old Tammo does not look up from the net. "Two days to the gales," he says. "You swore you\'d row out to the Rock and see why she\'s dark. I\'m holding you to it." He knots the twine and bites it off.' },
    { id: 'echo-berth', kind: 'echo', want: 'c-berth',
        player: 'I ask Orsa what I still owe.',
        narrative: 'Orsa Pellwyn reads it off the ledger without looking. "Eleven silver, four copper. Berth and net-cord. Tide-bell tomorrow, or the Kittiwake sits where she is." She closes the book.' },
    { id: 'echo-secret', kind: 'echo', want: 'c-secret',
        player: 'I catch Tammo\'s eye when Orsa mentions Varrowgate.',
        narrative: 'Tammo\'s face does not change. "Never been," he tells Orsa, and goes on mending. Later, alone, he says to the hero: "Your brother\'s business stays between us. I said so and I meant it."' },
    // The card's person is not named: only the nearest-meaning line can put it on the list.
    { id: 'near-gannet', kind: 'near', want: 'c-gannet', near: ['c-gannet'],
        player: 'I look out at the dark headland.',
        narrative: 'The headland is a black shape against a blacker sky, and no light moves on it. Three nights now. The hero remembers the promise made by the brazier: to row out and learn why the lamp there has died before the gales come.' },
    { id: 'near-sail', kind: 'near', want: 'c-sail', near: ['c-sail'],
        player: 'I check the boat before the weather turns.',
        narrative: 'Under the foredeck the canvas is where it was left, lashed tight and dry, well clear of the bilge water slopping below. The spare will serve if the main tears.' },
    { id: 'new-oilskin', kind: 'new',
        player: 'I tell young Tammo Reed he can have my spare oilskin when the gales come.',
        narrative: 'Tammo Reed, the lanky net-mender at the slip, grins. "You mean it? Mine\'s more hole than coat." He makes the hero shake on it, solemn as a magistrate. Old Tammo, across the quay, pretends not to watch.' },
    { id: 'new-dice', kind: 'new',
        player: 'I ask Tammo about the three silver from midsummer.',
        narrative: 'Old Tammo spits into the coals. "The dice game. Aye." He digs three silver out of his coat and sets them on the rail one by one. "Paid. Before the gales, like I said." The debt is done with.' },
    { id: 'merge-duplicate-vs-two-beats', kind: 'merge' },
];

const MERGE_POOL = [
    card('c-gannet', 'promise', 'the Gannet Rock vow', 'Kerttu promised Old Tammo to row out to Gannet Rock and find out why the light has gone dark before the autumn gales.', ['Old Tammo'], { firstSeenMessage: 10, lastSeenMessage: 10 }),
    card('c-gannet-2', 'promise', 'the dark light', 'The hero swore to Tammo by the brazier to row out to Gannet Rock before the gales and learn why the light went dark.', ['Old Tammo'], { firstSeenMessage: 40, lastSeenMessage: 44 }),
    card('c-trust', 'relationship', 'Tammo and the hero', 'Tammo trusted the hero with the key to his net-loft and the spare sail stowed there.', ['Old Tammo'], { firstSeenMessage: 12, lastSeenMessage: 12 }),
    card('c-slap', 'relationship', 'Tammo and the hero', 'Tammo struck the hero across the face by his net-loft when she joked about the spare sail.', ['Old Tammo'], { firstSeenMessage: 30, lastSeenMessage: 46 }),
];

async function runMergeCase(run) {
    const dispatched = [];
    const state = {
        settings, npcs: [{ id: 'npc-tammo', name: 'Old Tammo', rosterTier: 'character', kind: 'character', disposition: 'neutral', lastNotes: 'Mends nets by the brazier.', lastSeenMessage: 44 }], fronts: [],
        journal: [{ summary: 'The hero promised Old Tammo by the brazier to row out to Gannet Rock before the gales and learn why the light went dark. Tammo trusted her with his loft key; later he struck her when she joked about the sail.' }],
        worldFacts: [], storyMemory: MERGE_POOL, messages: [], party: [], currentLocation: 'Saltmere', session: { id: `eval-cards-${run}` },
    };
    const realLog = console.log; const realWarn = console.warn; const realInfo = console.info;
    console.log = () => {}; console.warn = () => {}; console.info = () => {};
    let error = null;
    try {
        await runNpcFrontReflection({ state, dispatch: action => dispatched.push(action), cadence: null });
    } catch (e) {
        error = String(e?.message || e);
    } finally {
        console.log = realLog; console.warn = realWarn; console.info = realInfo;
    }
    const merges = dispatched.filter(a => a.type === 'MERGE_STORY_CARDS').map(a => `${a.payload.keepId}<${a.payload.dropId}`);
    const duplicateMerged = merges.some(m => m === 'c-gannet<c-gannet-2' || m === 'c-gannet-2<c-gannet');
    const beatsMerged = merges.some(m => m.includes('c-trust') || m.includes('c-slap'));
    let outcome;
    if (error) outcome = 'ERROR';
    else if (beatsMerged) outcome = 'WRONG-MERGE';
    else if (duplicateMerged) outcome = 'merge';
    else outcome = 'MISSED';
    return { outcome, cards: [], merges, error };
}

async function runCase(testCase, run) {
    if (testCase.kind === 'merge') return runMergeCase(run);
    const actions = [];
    const knownStoryCards = buildKnownStoryCards(poolState, testCase.player, testCase.narrative, { near: testCase.near || [] });
    const realLog = console.log; const realWarn = console.warn; const realInfo = console.info;
    console.log = () => {}; console.warn = () => {}; console.info = () => {};
    let error = null;
    try {
        await runScribe({
            playerMessage: testCase.player,
            dmNarrative: testCase.narrative,
            settings,
            dispatch: action => actions.push(action),
            knownStoryCards,
            memoryContext: { worldFacts: [], messageCount: 60, location: 'Saltmere', npcs: [], storyMemory: POOL, campaign: null },
            sourceMessageId: `eval-${testCase.id}-${run}`,
        });
    } catch (e) {
        error = String(e?.message || e);
    } finally {
        console.log = realLog; console.warn = realWarn; console.info = realInfo;
    }
    const cards = actions.filter(a => a.type === 'ADD_STORY_MEMORY_CARDS').flatMap(a => a.payload || []).map(c => ({
        id: typeof c?.id === 'string' && POOL.some(p => p.id === c.id) ? c.id : null, type: String(c?.type || ''), text: String(c?.text || '').slice(0, 140),
    }));
    let outcome;
    if (error) outcome = 'ERROR';
    else if (testCase.kind === 'echo' || testCase.kind === 'near') {
        if (cards.some(c => c.id === testCase.want)) outcome = 'id';
        else if (cards.some(c => c.id)) outcome = 'WRONG-ID';
        else if (cards.length > 0) outcome = 'TWIN';
        else outcome = 'none';
    } else {
        if (cards.length === 0) outcome = 'none';
        else if (cards.some(c => c.id)) outcome = 'WRONG-ID';
        else outcome = 'clean';
    }
    return { outcome, cards, knownStoryCards, error };
}

async function main() {
    const results = [];
    for (const testCase of CASES) {
        for (let run = 1; run <= RUNS; run += 1) {
            const row = await runCase(testCase, run);
            results.push({ id: testCase.id, kind: testCase.kind, want: testCase.want || null, run, ...row });
            process.stdout.write(['id', 'clean', 'merge'].includes(row.outcome) ? '.' : row.outcome === 'none' ? '-' : 'x');
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
        `# Story cards by id, ${new Date().toISOString()}`,
        '',
        `Machinery Flash, the real \`runScribe\` and \`runNpcFrontReflection\`, ${CASES.length} hand-built turns × ${RUNS} run(s), a five-card pool. No judge: read from the ADD_STORY_MEMORY_CARDS and MERGE_STORY_CARDS payloads.`,
        '',
        `- echo (a listed beat restated: "id" right, "WRONG-ID" another card, "TWIN" no id = a duplicate the old rungs folded, "none" not reported): ${tally('echo')}`,
        `- near (the card listed only by nearest meaning, its people unnamed): ${tally('near')}`,
        `- new (a new beat: "clean" no id, "WRONG-ID" pinned to a listed card, "none"): ${tally('new')}`,
        `- merge (the reflection shown a duplicate pair AND a trust-and-slap pair: "merge" folds the duplicate alone, "WRONG-MERGE" touched the two beats, "MISSED" left the duplicate): ${tally('merge')}`,
        '',
    ];
    for (const r of results) {
        report.push(`- ${r.id} #${r.run}: **${r.outcome}**${r.cards.length ? ' cards ' + r.cards.map(c => `[${c.id || 'no id'}] ${c.type}: ${c.text}`).join(' · ') : ''}${r.merges?.length ? ' merges ' + r.merges.join(', ') : ''}${r.error ? ` ${r.error}` : ''}`);
    }
    const dir = path.join(OUT_DIR, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.md'), report.join('\n'));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(report.slice(0, 9).join('\n'));
    for (const r of results.filter(x => !['id', 'clean', 'merge'].includes(x.outcome))) console.log(`${r.id} #${r.run} ${r.outcome} ${JSON.stringify(r.cards)} ${JSON.stringify(r.merges || [])}`);
    console.log(`Report: ${dir}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
