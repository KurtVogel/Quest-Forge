#!/usr/bin/env node
/**
 * Real-provider eval of the item audits without a word rule (identity by
 * reference, lane 5, 2026-11-07). Runs the real `runScribe` on hand-built turns
 * and asks one question per case: did the Scribe link or copy what it was
 * shown, so the engine's exact compare lands the right movement?
 *
 *   drift      an applied or recent item narrated in other words: no grant, and
 *              ideally no card (a card is the visible cost, not a failure of
 *              the double guard)
 *   new        a genuinely new item that reads like a recent one: it should be
 *              granted, or asked about on a card, never silently lost
 *   copy       a handoff or loss narrated loosely: the Scribe must copy the
 *              inventory row and the companion's full name
 *
 *   npm.cmd run eval:itemlinks
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:itemlinks
 *
 * Key from the environment or the git-ignored .env (GEMINI_API_KEY). Writes a
 * markdown report + raw JSON to test-results/itemlinks/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScribe } from '../src/llm/scribe.js';

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
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(repoRoot, 'test-results', 'itemlinks');
const settings = { llmProvider: 'gemini', apiKey: key, geminiApiKey: key };

const arrived = (name, atMessage = 1) => ({ kind: 'item', status: 'applied', cp: 0, movedCp: 0, itemsMoved: true, itemsIn: [{ name, itemKey: '', quantity: 1 }], itemsOut: [], sourceId: `msg-${atMessage}`, atMessage, lane: 'dm' });
const row = (id, name, quantity = 1, type = 'gear') => ({ id, name, quantity, type });
const kaarina = { id: 'c1', name: 'Kaarina Tammi', status: 'healthy', ac: 12, weapon: 'Dagger', hp: 9, maxHp: 9 };
const emptyEvents = { itemsFound: [], purchases: [], sells: [], startingItems: [], itemsLost: [] };

const CASES = [
    { id: 'evented-manifest', kind: 'drift',
        player: 'I lift the papers from the dead courier.',
        narrative: 'You slide the transit manifest stamped with Factor Vane\'s running-hound seal out of the courier\'s coat and tuck it inside your own.',
        events: { ...emptyEvents, itemsFound: [{ name: 'Syndicate cargo manifest' }] },
        inventory: [row('i1', 'Syndicate cargo manifest')] },
    { id: 'evented-token', kind: 'drift',
        player: 'I take the toll marker.',
        narrative: 'The toll-keeper drops a heavy brass token stamped with the three-arched bridge of Merrow into your palm.',
        events: { ...emptyEvents, itemsFound: [{ name: 'Brass toll-token' }] },
        inventory: [row('i1', 'Brass toll-token')] },
    { id: 'evented-potion', kind: 'drift',
        player: 'I buy the healer\'s remedy.',
        narrative: 'The herbwife presses a stoppered vial of restorative draft into your hand and pockets your coin.',
        events: { ...emptyEvents, purchases: [{ name: 'Potion of Healing', priceCp: 5000 }] },
        inventory: [row('i1', 'Potion of Healing')] },
    { id: 'recent-token', kind: 'drift',
        player: 'I check my pockets.',
        narrative: 'You take out the heavy brass token you were handed at the bridge, turn it over once, and tuck it safely away again.',
        ledger: [arrived('Brass toll-token')], inventory: [row('i1', 'Brass toll-token')] },
    { id: 'recent-pages', kind: 'drift',
        player: 'I put the letters somewhere safe.',
        narrative: 'You fold the sheaf of the steward\'s letters and tuck them inside your jerkin.',
        ledger: [arrived('Steward\'s correspondence')], inventory: [row('i1', 'Steward\'s correspondence')] },
    { id: 'recent-key', kind: 'drift',
        player: 'I test the key in my hand.',
        narrative: 'You turn the cold iron key you took from the warden over in your fingers and slip it back onto your belt.',
        ledger: [arrived('Warden\'s iron key')], inventory: [row('i1', 'Warden\'s iron key')] },

    { id: 'new-second-key', kind: 'new', wanted: /cellar|iron key/i,
        player: 'I take what the cook offers.',
        narrative: 'The cook unhooks a second iron key from her apron, the one to the cellar, and hands it to you. You pocket it.',
        ledger: [arrived('Warden\'s iron key')], inventory: [row('i1', 'Warden\'s iron key')] },
    { id: 'new-other-token', kind: 'new', wanted: /token/i,
        player: 'I take the guild\'s token too.',
        narrative: 'The guildmaster presses a silver guild token into your hand, quite different from the brass one you carry. You stow it.',
        ledger: [arrived('Brass toll-token')], inventory: [row('i1', 'Brass toll-token')] },

    { id: 'handoff-sword', kind: 'copy', want: { type: 'GIVE_GEAR_TO_COMPANION', itemId: 'i1' },
        player: 'I give Kaarina my longsword.',
        narrative: 'You hold out your longsword, hilt first. Kaarina takes it, tests the balance, and straps it to her belt.',
        inventory: [row('i1', 'Longsword +1', 1, 'weapon')], party: [kaarina] },
    { id: 'handoff-cloak', kind: 'copy', want: { type: 'GIVE_GEAR_TO_COMPANION', itemId: 'i2' },
        player: 'I hand Kaarina my shield.',
        narrative: 'Kaarina accepts your battered shield with a nod and slings it onto her arm.',
        inventory: [row('i1', 'Rations (1 day)', 3), row('i2', 'Iron-rimmed Shield', 1, 'armor')], party: [kaarina] },
    { id: 'loss-rope', kind: 'copy', want: { type: 'REMOVE_ITEM_BY_NAME', name: 'Hempen Rope (50 ft)' },
        player: 'I cut the rope loose and let it fall.',
        narrative: 'You saw through your rope; it slithers away into the chasm and is gone for good.',
        inventory: [row('i1', 'Hempen Rope (50 ft)'), row('i2', 'Torch', 3)] },
    { id: 'loss-candle', kind: 'copy', want: { type: 'REMOVE_ITEM_BY_NAME', name: 'Wax Candles' },
        player: 'I burn a candle through the night.',
        narrative: 'One of your candles burns down to a puddle of wax by dawn, used up.',
        inventory: [row('i1', 'Wax Candles', 5)] },
    { id: 'loss-blade', kind: 'copy', want: { type: 'REMOVE_ITEM_BY_NAME', name: 'Longsword +1' },
        player: 'I surrender my weapon at the gate.',
        narrative: 'The gate sergeant confiscates your blade and locks it in the armoury. You will not see it again.',
        inventory: [row('i1', 'Longsword +1', 1, 'weapon'), row('i2', 'Dagger', 1, 'weapon')] },
];

const hasCard = actions => actions.some(action => JSON.stringify(action).includes('Narrated, not recorded'));

async function runCase(testCase, run) {
    const actions = [];
    const state = {
        appliedLootSourceIds: [],
        character: { name: 'Astra', class: 'fighter', gold: 5, silver: 0, copper: 0 },
        combat: { active: false },
        party: testCase.party || [],
        inventory: testCase.inventory || [],
        ledger: testCase.ledger || [],
        messages: Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: 'x' })),
    };
    const realLog = console.log;
    const realWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try {
        await runScribe({
            playerMessage: testCase.player,
            dmNarrative: testCase.narrative,
            settings,
            dispatch: action => actions.push(action),
            lootAudit: { sourceId: `eval-${testCase.id}-${run}:scribe-loot`, appliedEvents: testCase.events || emptyEvents, getState: () => state },
        });
    } finally {
        console.log = realLog;
        console.warn = realWarn;
    }
    const grants = actions.filter(action => action.type === 'ADD_ITEM').map(action => action.payload?.name);
    const gear = actions.filter(action => action.type === 'GIVE_GEAR_TO_COMPANION').map(action => action.payload);
    const companionStats = actions.filter(action => action.type === 'UPDATE_COMPANION' && action.payload?.weapon).map(action => action.payload.weapon);
    const removals = actions.filter(action => action.type === 'REMOVE_ITEM_BY_NAME').map(action => action.payload?.name ?? action.payload);
    const card = hasCard(actions);
    let outcome;
    if (testCase.kind === 'drift') {
        outcome = grants.length > 0 ? 'DOUBLE' : (card ? 'card' : 'clean');
    } else if (testCase.kind === 'new') {
        outcome = grants.some(name => testCase.wanted.test(name)) ? 'clean' : (card ? 'card' : 'LOST');
    } else if (testCase.want.type === 'GIVE_GEAR_TO_COMPANION') {
        if (gear.some(payload => payload.itemId === testCase.want.itemId)) outcome = 'clean';
        else outcome = companionStats.length > 0 ? 'COPY-MINTED' : 'MISSED';
    } else {
        outcome = removals.includes(testCase.want.name) ? 'clean' : 'MISSED';
    }
    return { outcome, grants, gear, companionStats, removals, card };
}

async function main() {
    const results = [];
    for (const testCase of CASES) {
        for (let run = 1; run <= RUNS; run += 1) {
            let row2;
            try {
                row2 = await runCase(testCase, run);
            } catch (error) {
                row2 = { outcome: 'ERROR', error: String(error?.message || error) };
            }
            results.push({ id: testCase.id, kind: testCase.kind, run, ...row2 });
            process.stdout.write(row2.outcome === 'clean' ? '.' : row2.outcome === 'card' ? 'c' : 'x');
        }
    }
    process.stdout.write('\n');
    const tally = (kind) => {
        const rows = results.filter(result => result.kind === kind);
        const counts = {};
        for (const result of rows) counts[result.outcome] = (counts[result.outcome] || 0) + 1;
        return `${rows.length} runs: ${Object.entries(counts).map(([name, n]) => `${name} ${n}`).join(', ')}`;
    };
    const report = [
        `# Item link eval, ${new Date().toISOString()}`,
        '',
        `Machinery Flash, ${CASES.length} hand-built turns, ${RUNS} run(s) each.`,
        '',
        `- drift: ${tally('drift')}`,
        `- new: ${tally('new')}`,
        `- copy: ${tally('copy')}`,
        '',
    ];
    for (const result of results) {
        report.push(`- ${result.id} #${result.run}: **${result.outcome}**${result.grants?.length ? ` grants ${JSON.stringify(result.grants)}` : ''}${result.removals?.length ? ` removes ${JSON.stringify(result.removals)}` : ''}${result.companionStats?.length ? ` stats ${JSON.stringify(result.companionStats)}` : ''}${result.card ? ' card' : ''}${result.error ? ` ${result.error}` : ''}`);
    }
    const dir = path.join(OUT_DIR, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.md'), report.join('\n'));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(report.slice(0, 7).join('\n'));
    for (const result of results.filter(row3 => !['clean'].includes(row3.outcome))) console.log(`${result.id} #${result.run} ${result.outcome} ${JSON.stringify(result.grants || [])} ${JSON.stringify(result.removals || [])}`);
    console.log(`Report: ${dir}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
