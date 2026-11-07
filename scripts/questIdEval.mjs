#!/usr/bin/env node
/**
 * Real-provider proof of the quest id echo (DECISIONS.md 2026-11-06, night)
 * and, since lane 3 (2026-11-07), of the id-less leftovers: with the fuzzy
 * name rung gone, does the DM re-announce a live quest as a `new` in new
 * words (two active rows), and does an id-less move still land by exact name?
 *
 * The format example asks for `id` on an updated / completed / failed
 * quest and the engine lets that id decide. This script plays one scripted
 * Saltmere scene through the REAL reducer (gameReducer + applyEvents) so the
 * ACTIVE QUESTS line carries engine-minted ids, and reports, per DM turn:
 * which quest_updates came back, whether each carried an id, whether that id
 * named a live row, and what the record did (rows, ◆ / ✦ / ⚖ lines). Two
 * `reaffirm` turns restate the lighthouse deal in the player's own new words
 * while it is live: a `new` on those turns is the re-announce the lane risks.
 *
 *   npm.cmd run eval:questid                    # gemini, 2 runs
 *   $env:QF_EVAL_PROVIDERS="gemini,openai"; npm.cmd run eval:questid
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:questid
 *
 * Keys from the environment or the git-ignored .env (GEMINI_API_KEY,
 * OPENAI_API_KEY). Writes a markdown report + raw JSON to test-results/questid/.
 * No judge: every number is read from the wire and the record.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendMessage } from '../src/llm/adapter.js';
import { buildSystemPrompt } from '../src/llm/promptBuilder.js';
import { parseResponse } from '../src/llm/responseParser.js';
import { applyEvents } from '../src/state/applyEvents.js';
import { gameReducer, initialGameState } from '../src/state/gameReducer.js';
import { normalizeRefToken } from '../src/state/handlers/shared.js';
import { buildPremiseFromStarter, findPremiseStarter } from '../src/data/premiseStarters.js';
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

const PROVIDERS = {
    gemini: { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: process.env.QF_EVAL_GEMINI_MODEL || 'gemini-3.8-flash' },
    openai: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: process.env.QF_EVAL_OPENAI_MODEL || 'gpt-6.1-sol' },
    xai: { provider: 'xai', apiKey: process.env.XAI_API_KEY, model: process.env.QF_EVAL_XAI_MODEL || 'grok-4.3' },
};
const wanted = (process.env.QF_EVAL_PROVIDERS || 'gemini').split(',').map(s => s.trim()).filter(Boolean);
const providers = wanted.filter(name => PROVIDERS[name]?.apiKey);
for (const name of wanted) if (!PROVIDERS[name]?.apiKey) console.warn(`Skipping ${name}: no key.`);
if (providers.length === 0) { console.error('No provider has a key.'); process.exit(2); }
const RUNS = Math.max(1, Math.min(5, Number(process.env.QF_EVAL_RUNS) || 2));
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(repoRoot, 'test-results', 'questid');

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
const OPENING = `The tide-bell has just rung the seventh hour over Saltmere and the last morning of the herring run is grey and cold. ${heroName} stands on the seaward pier with the Kittiwake riding low beside it, the hold still half full. Old Tammo is at his brazier mending a net; up the quay, the lamp is already lit in Harbormaster Orsa Pellwyn's office. Beyond the breakwater the lighthouse on Gannet Rock is dark again.`;

// The scene. `expect` is what the scenario MEANS the record to do after the
// DM's reply; the report scores against it. `arc` names the job in the words
// the player used, so the report can tell which row moved.
const TURNS = [
    { say: 'I go up to the harbormaster\'s office, put the herring tally on Orsa Pellwyn\'s desk and ask her straight: what would she knock off the Kittiwake\'s debt if I rowed out to Gannet Rock and found out why the light has gone dark?', expect: 'offer' },
    { say: '"Done." I give her my hand on it. "I row out at first light and bring you word of the light, and you strike twenty silver from the ledger." Then I leave the office.', expect: 'new', arc: 'light' },
    { say: 'On my way down the quay I stop at Tammo\'s brazier. He asks me to carry his mended net down to the Kittiwake\'s hold before the boat is hauled up — his knees won\'t take the ladder. I say yes and shoulder the net.', expect: 'new', arc: 'net' },
    // The re-announce bait (lane 3): the live deal restated in the player's
    // own new words. The right wire is nothing, or an `updated` with the id.
    { say: 'While I shoulder the net I tell Tammo about the bargain I just struck up the quay — I\'m to row out to the dark lighthouse and bring Orsa word of it, and she strikes twenty silver off the Kittiwake\'s debt for it. I ask him what he knows about Gannet Rock.', expect: 'reaffirm', arc: 'light' },
    { say: 'I carry the net down the ladder, stow it properly in the Kittiwake\'s hold, climb back up and tell Tammo it\'s done.', expect: 'completed', arc: 'net' },
    { say: 'Before I sleep I go back up to the harbormaster\'s office and make sure we are agreed, in plain words: I find out why the Gannet Rock light went dark and tell her, and twenty silver comes off what the Kittiwake owes. I want to hear her say it back.', expect: 'reaffirm', arc: 'light' },
    { say: 'At first light I borrow a skiff from the pier and row out to Gannet Rock. I tie up at the landing and climb the stair to the lamp room.', expect: 'none' },
    { say: 'I search the lamp room properly — the lamp, the oil store, the keeper\'s bunk, the log book — for the keeper or for whatever put the light out.', expect: 'updated', arc: 'light' },
    { say: 'I row back to Saltmere, go straight up to Orsa\'s office and tell her everything I found out there about the light. "That\'s the word you wanted. Strike the twenty silver."', expect: 'completed', arc: 'light' },
    { say: 'I ask Orsa to read me back, from the ledger, exactly what I still owe on the Kittiwake now.', expect: 'none' },
];

function promptFor(state) {
    return buildSystemPrompt({
        ...state,
        preset: state.settings.preset,
        ruleset: state.settings.ruleset,
        customSystemPrompt: state.settings.customSystemPrompt,
        messageCount: state.messages.length,
    });
}

async function runOnce({ providerName, run }) {
    const cfg = PROVIDERS[providerName];
    const fronts = createInitialFronts({ premise, character: hero, location: LOCATION });
    let state = {
        ...initialGameState,
        character: hero, inventory, currentLocation: LOCATION, premise, fronts,
        messages: [{ id: 'm-opening', role: 'assistant', content: OPENING, timestamp: Date.now() }],
    };
    const dispatch = action => { state = gameReducer(state, action); };
    const history = [{ role: 'assistant', content: OPENING }];
    const turns = [];
    for (let i = 0; i < TURNS.length; i++) {
        const { say, expect, arc } = TURNS[i];
        const before = { quests: state.quests.map(q => ({ id: q.id, name: q.name, status: q.status })), rows: state.messages.length };
        const activeIds = new Set(before.quests.filter(q => q.status === 'active').map(q => q.id));
        const activeNames = new Set(before.quests.filter(q => q.status === 'active').map(q => normalizeRefToken(q.name)));
        const systemPrompt = promptFor(state);
        dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: say } });
        let raw = '';
        let error = null;
        try {
            raw = await sendMessage({ ...cfg, systemPrompt, messageHistory: history, userMessage: say });
        } catch (e) {
            error = String(e?.message || e);
        }
        const { narrative, events } = error ? { narrative: '', events: null } : parseResponse(raw);
        const text = String(narrative || '').trim();
        const dmRow = { role: 'assistant', content: text || '(no response)' };
        dispatch({ type: 'ADD_MESSAGE', payload: dmRow });
        const updates = (events?.questUpdates || []).map(u => ({
            status: u.status, id: u.id || null, name: u.name || null,
            idOnLive: !!u.id && activeIds.has(u.id),
            idOnAny: !!u.id && before.quests.some(q => q.id === u.id),
            // An id-less report lands only by exact (normalized) name since lane 3.
            nameOnLive: !!u.name && activeNames.has(normalizeRefToken(u.name)),
            // A `new` on a reaffirm turn is the re-announce; so is any `new`
            // beyond the scene's two jobs (read the names before counting it).
            reannounce: u.status === 'new' && expect === 'reaffirm',
        }));
        if (events) {
            try { applyEvents(events, dispatch, () => state, { sourceMessageId: `dm-${i + 1}` }); } catch (e) { error = `applyEvents: ${String(e?.message || e)}`; }
        }
        const newRows = state.messages.slice(before.rows + 2).map(m => String(m.content || ''));
        const after = state.quests.map(q => ({ id: q.id, name: q.name, status: q.status }));
        turns.push({
            index: i + 1, say, expect, arc, narrative: text, raw: String(raw || ''), error, updates,
            before: before.quests, after,
            taken: newRows.filter(r => r.startsWith('◆')), done: newRows.filter(r => /^[✦✕]/.test(r)), refused: newRows.filter(r => r.startsWith('⚖')),
        });
        history.push({ role: 'user', content: say });
        history.push(dmRow);
        process.stderr.write(`  ${providerName} run ${run} turn ${i + 1}/${TURNS.length} [${expect}]: ${updates.length ? updates.map(u => `${u.status}${u.id ? ` id=${u.idOnLive ? 'LIVE' : (u.idOnAny ? 'closed' : 'UNKNOWN')}` : (u.nameOnLive ? ' no-id exact-name' : ' no-id')}${u.reannounce ? ' RE-ANNOUNCE' : ''}`).join(', ') : 'no quest events'}${error ? ` ERROR ${error.slice(0, 80)}` : ''}\n`);
    }
    return { providerName, model: cfg.model, run, turns, quests: state.quests.map(q => ({ id: q.id, name: q.name, status: q.status, outcome: q.outcome || '' })), exp: state.character.exp };
}

function scoreRun(r) {
    const moves = r.turns.flatMap(t => t.updates.filter(u => u.status !== 'new'));
    const withId = moves.filter(u => u.id);
    const live = moves.filter(u => u.idOnLive);
    const opens = r.turns.flatMap(t => t.updates.filter(u => u.status === 'new'));
    const noId = moves.filter(u => !u.id);
    const noIdExact = noId.filter(u => u.nameOnLive);
    const reaffirmTurns = r.turns.filter(t => t.expect === 'reaffirm');
    const reannounced = r.turns.flatMap(t => t.updates.filter(u => u.reannounce));
    const refused = r.turns.reduce((n, t) => n + t.refused.length, 0);
    const errors = r.turns.filter(t => t.error).length;
    return {
        moves: moves.length, withId: withId.length, live: live.length, noId: noId.length, noIdExact: noIdExact.length,
        opens: opens.length, reaffirmTurns: reaffirmTurns.length, reannounced: reannounced.length,
        rows: r.quests.length, activeAtEnd: r.quests.filter(q => q.status === 'active').length,
        closed: r.quests.filter(q => q.status !== 'active').map(q => q.name), refused, errors, exp: r.exp,
    };
}

function report(runs, stamp) {
    const lines = [`# Quest id echo — real-provider proof (${stamp})`, '',
        'Does the DM copy the `[id: …]` from ACTIVE QUESTS onto an updated / completed / failed quest, and does the right arc move? Since lane 3 (2026-11-07) there is no fuzzy name rung: an id-less move lands by exact name or is refused with a ⚖ line, and a `new` on a **reaffirm** turn (the live deal restated in new words) is a re-announce that leaves two active rows. The scene has exactly two jobs, so "Rows at end" above 2 means a twin or an invented job — read the names. No judge: read from the wire and the record.', '',
        '| Provider | Run | Moves (upd/compl/fail) | With id | Id named a LIVE row | No id | No id, exact name | Opens | Reaffirm turns | Re-announced as new | Rows at end | Active at end | Closed | ⚖ refusals | Errors | XP |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
    for (const r of runs) {
        const s = scoreRun(r);
        lines.push(`| ${r.providerName} (${r.model}) | ${r.run} | ${s.moves} | ${s.withId} | ${s.live} | ${s.noId} | ${s.noIdExact} | ${s.opens} | ${s.reaffirmTurns} | ${s.reannounced} | ${s.rows} | ${s.activeAtEnd} | ${s.closed.join('; ') || '—'} | ${s.refused} | ${s.errors} | ${s.exp} |`);
    }
    for (const r of runs) {
        lines.push('', `## ${r.providerName} (${r.model}) run ${r.run}`, '');
        for (const t of r.turns) {
            lines.push(`### Turn ${t.index} — expected: ${t.expect}${t.arc ? ` (${t.arc})` : ''}`, '', `> ${t.say}`, '');
            if (t.error) lines.push(`**ERROR:** ${t.error}`, '');
            lines.push(t.updates.length
                ? t.updates.map(u => `- wire: \`${u.status}\` ${u.id ? `id=\`${u.id}\` (${u.idOnLive ? 'a live row' : (u.idOnAny ? 'a closed row' : 'unknown')})` : `NO id (${u.nameOnLive ? 'exact name of a live row' : 'no exact name'})`} name="${u.name || ''}"${u.reannounce ? ' **RE-ANNOUNCE**' : ''}`).join('\n')
                : '- wire: no quest_updates');
            for (const row of [...t.taken, ...t.done, ...t.refused]) lines.push(`- record: ${row}`);
            lines.push(`- quests after: ${t.after.map(q => `${q.name} [${q.status}]`).join(' · ') || 'none'}`, '');
            lines.push(`<details><summary>narration</summary>\n\n${t.narrative || '(none)'}\n\n</details>`, '');
        }
    }
    return lines.join('\n');
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.mkdirSync(OUT_DIR, { recursive: true });
const runs = [];
for (const providerName of providers) {
    for (let run = 1; run <= RUNS; run++) {
        process.stderr.write(`\n${providerName} (${PROVIDERS[providerName].model}) run ${run}/${RUNS}\n`);
        runs.push(await runOnce({ providerName, run }));
    }
}
const md = report(runs, stamp);
fs.writeFileSync(path.join(OUT_DIR, `${stamp}.md`), md);
fs.writeFileSync(path.join(OUT_DIR, `${stamp}.json`), JSON.stringify(runs, null, 2));
console.log(md.split('\n').slice(0, 6 + runs.length).join('\n'));
console.log(`\nReport: ${path.join(OUT_DIR, `${stamp}.md`)}`);
