#!/usr/bin/env node
/**
 * Real-provider eval of the people lane (identity by reference, lane 6,
 * 2026-11-08). The roster no longer guesses who a name means: the Scribe is
 * shown KNOWN NPCS with ids and asked to copy the id onto its npc_updates,
 * and a DM name the record does not know is HELD and shown to the Scribe as
 * HELD NAMES with a shortlist, to be answered in name_links. This script runs
 * the real `runScribe` on hand-built turns against a roster with short names,
 * a title variant and two people who share a first name — the 2026-07-23
 * fork and the 2026-10-13 shared-name cases — and reads the wire:
 *
 *   id       a recorded person named in other words / a short form / a title
 *            variant: did the Scribe's npc_updates carry that person's id?
 *            "id" right · "WRONG-ID" another record · "TWIN" no id (a fork)
 *            · "none" no update for them
 *   new      a person not on record: "clean" = an update with no id ·
 *            "WRONG-ID" pinned to a recorded person · "none"
 *   link     a HELD NAME with its shortlist: did name_links name the right
 *            id ("link"), or "new" where the person is new ("new")?
 *            "WRONG-LINK" another id · "MISSED" no answer
 *   died     (lane 6C) a recorded person dies: did their update carry
 *            died: true ("died")? "LIVING-MARKED" = someone else marked dead ·
 *            "none" = no death recorded. A death they caused or mourned must
 *            mark nobody ("clean").
 *   tie      (lane 6C) one listed person shows a regard for another: did the
 *            tie carry the other's id ("tie-id")? "tie-name" = the name only ·
 *            "WRONG-TIE" another id · "none"
 *   merge    (lane 6C) the reflection is shown possibleSamePerson pairs: a true
 *            fork should merge ("merge"), two distinct people must not
 *            ("kept-apart"); "WRONG-MERGE" merged the distinct pair · "MISSED"
 *            left the fork
 *
 *   npm.cmd run eval:npcid
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:npcid
 *
 * Key from the environment or the git-ignored .env (GEMINI_API_KEY). Writes a
 * markdown report + raw JSON to test-results/npcid/. No judge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHeldNames, buildKnownNpcIds, runNpcFrontReflection, runScribe } from '../src/llm/scribe.js';

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
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(repoRoot, 'test-results', 'npcid');
const settings = { llmProvider: 'gemini', apiKey: key, geminiApiKey: key };

const person = (id, name, extra = {}) => ({ id, name, rosterTier: 'character', kind: 'character', disposition: 'neutral', lastNotes: 'On record.', lastSeenMessage: 4, ...extra });
const ROSTER = [
    person('npc-saima', 'Saima Aallotar', { stanceToPlayer: 'Amused by the hero, and warming.', aliases: ['Saima'] }),
    person('npc-reed', 'Saima Reed', { lastNotes: 'The net-mender on the north quay.' }),
    person('npc-anselm', 'Brother Anselm', { lastNotes: 'The chapel keeper.' }),
    person('npc-tammo', 'Old Tammo', { lastNotes: 'Mends nets by the brazier.' }),
    person('npc-orsa', 'Orsa Pellwyn', { lastNotes: 'The harbormaster.' }),
    person('npc-ketta', 'Ketta Mor', { stanceToPlayer: 'Lover.', lastNotes: 'Shares the hero\'s bed.' }),
];

const CASES = [
    { id: 'alias-saima', kind: 'id', want: 'npc-saima',
        player: 'I ask Saima whether the Kittiwake can sail tonight.',
        narrative: 'Saima Aallotar does not look up from the chart. "Not tonight. The bar is running white." She taps the sounding with a chewed pencil and, for the first time this week, lets the hero see her smile.' },
    { id: 'short-saima-scene', kind: 'id', want: 'npc-saima',
        player: 'I bring Saima the lamp oil she asked for.',
        narrative: 'Saima takes the jar and weighs it in her palm. "Aallotar never forgets a debt," she says, and tucks it under the chart table. Her amusement is plainer than yesterday.' },
    { id: 'title-anselm', kind: 'id', want: 'npc-anselm',
        player: 'I ask the priest about the drowned bell.',
        narrative: 'Anselm sets down his broom. "The bell went down with the Marigold," the brother says. "I ring the little one at dusk so the dead know the hour." He looks tired, and older than his years.' },
    { id: 'typo-ketta', kind: 'id', want: 'npc-ketta',
        player: 'I wake beside Ketta and ask if she slept.',
        narrative: 'Ketta Nor stretches under the blanket and does not answer the question. "You talk in your sleep," she says. "Names I don\'t know." She watches the hero dress with a look that is not quite trust.' },
    { id: 'tammo-short', kind: 'id', want: 'npc-tammo',
        player: 'I help Tammo haul the net up the slip.',
        narrative: 'Tammo grunts his thanks and spits into the coals. "Knees won\'t take the ladder," the old man says. "Yours will, for a while yet." He tells the hero the north quay net-mender is cheating him on twine.' },
    { id: 'new-corren', kind: 'new',
        player: 'I ask the tavern keeper for a room.',
        narrative: 'The keeper, a bald man named Corren with a chandler\'s burn scars up both forearms, names a price twice the fair one and does not blink. "Storm rates," he says. He has decided the hero is a mark.' },
    { id: 'new-shared-first', kind: 'new',
        player: 'I ask the fishwife her name.',
        narrative: '"Saima," the fishwife says, and when the hero\'s eyebrows go up she adds, "Saima Harrow. Half this town is a Saima; my mother had no imagination." She sells the hero two herring and overcharges for the third.' },
    { id: 'link-saima-aallotar', kind: 'link', want: 'npc-saima',
        held: { said: 'the harbor-chart woman', candidates: ['npc-saima', 'npc-reed'] },
        player: 'I ask the harbor-chart woman about the tide.',
        narrative: 'Saima Aallotar runs a finger down the sounding table. "Slack water at the ninth bell. After that you are swimming." She says it to the hero the way she says everything, dry, but she says it.' },
    { id: 'link-reed', kind: 'link', want: 'npc-reed',
        held: { said: 'Saima', candidates: ['npc-saima', 'npc-reed'] },
        player: 'I bring the twine to Saima on the north quay.',
        narrative: 'Saima Reed takes the twine without a word and tests it between her teeth. "Cheap," she says. "Tammo\'s been buying cheap and blaming me." She goes back to her nets.' },
    { id: 'link-new', kind: 'link', want: 'new',
        held: { said: 'Saima', candidates: ['npc-saima', 'npc-reed'] },
        player: 'I ask the fishwife her name.',
        narrative: '"Saima Harrow," the fishwife says. "Half this town is a Saima." She is not the harbor-chart woman and not the net-mender; she is a stranger with herring to sell, and she sells the hero three.' },
    { id: 'link-widow', kind: 'link', want: 'npc-orsa',
        held: { said: 'the widow', candidates: ['npc-orsa'] },
        player: 'I ask the widow what the ledger says I still owe.',
        narrative: 'Orsa Pellwyn — widowed these six years, as everyone in Saltmere knows — reads the figure off without looking at the page. "Forty-one silver. Thirty-nine if you stop asking."' },
    // ── lane 6C ──
    { id: 'died-tammo', kind: 'died', want: 'npc-tammo',
        player: 'I run to the brazier when I hear the shout.',
        narrative: 'Old Tammo lies on his side by the overturned brazier, the net still in his fists, and does not move again. Orsa Pellwyn kneels, puts two fingers to his neck, and shakes her head. "He\'s gone," she says. The quay is very quiet.' },
    { id: 'died-not-theirs', kind: 'died', want: null,
        player: 'I ask Ketta what happened on the north road.',
        narrative: 'Ketta Mor cleans her knife on the hem of her cloak. "Two of them," she says. "Both dead. I didn\'t ask their names." She says it flat, and then she does not say anything for a long while, and the hero sees her hands are not quite steady.' },
    { id: 'tie-anselm-orsa', kind: 'tie', self: 'npc-anselm', want: 'npc-orsa',
        player: 'I ask Brother Anselm what he makes of the harbormaster.',
        narrative: 'Brother Anselm folds his hands. "Orsa Pellwyn keeps a ledger for everything, including God," he says, and there is no warmth in it at all. "She let the Marigold\'s widows wait six months for the bell fund. I do not forget that." He turns back to his broom.' },
    { id: 'merge-fork-vs-distinct', kind: 'merge' },
];

const idOf = (updates, want) => updates.find(u => u.id === want);

const MERGE_ROSTER = [
    person('npc-saima', 'Saima Aallotar', { stanceToPlayer: 'Amused by the hero, and warming.', lastNotes: 'Harbor pilot; keeps the sounding charts in the office over the chandlery.', lastSeen: 10 }),
    person('npc-saima-short', 'Saima', { lastNotes: 'The pilot with the chewed pencil; she let the hero read her charts over the chandlery.', bondMoments: [{ text: 'She let the hero read the chart over her shoulder.', kind: 'other', salience: 3 }], lastSeen: 20 }),
    person('npc-maren-t', 'Maren Tull', { lastNotes: 'The smith at the forge by the east gate; owes the hero for the ore.' }),
    person('npc-maren-a', 'Maren Ashford', { lastNotes: 'The innkeeper of the Gull; wary of the hero since the brawl.' }),
];

async function runMergeCase(run) {
    const dispatched = [];
    const state = {
        settings, npcs: MERGE_ROSTER, fronts: [], journal: [{ summary: 'The hero read the sounding charts with the pilot Saima Aallotar over the chandlery, then drank at the Gull under Maren Ashford\'s eye and paid Maren Tull for the ore.' }],
        worldFacts: [], storyMemory: [], messages: [], party: [], currentLocation: 'Saltmere', session: { id: `eval-merge-${run}` },
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
    const merges = dispatched.filter(a => a.type === 'MERGE_NPC_RECORDS').map(a => `${a.payload.keepId}<${a.payload.dropId}`);
    const forkMerged = merges.some(m => m === 'npc-saima<npc-saima-short' || m === 'npc-saima-short<npc-saima');
    const distinctMerged = merges.some(m => m.includes('npc-maren'));
    let outcome;
    if (error) outcome = 'ERROR';
    else if (distinctMerged) outcome = 'WRONG-MERGE';
    else if (forkMerged) outcome = 'merge';
    else outcome = 'MISSED';
    return { outcome, updates: [], links: [], merges, error };
}

async function runCase(testCase, run) {
    if (testCase.kind === 'merge') return runMergeCase(run);
    const actions = [];
    const session = testCase.held
        ? { heldNpcUpdates: [{ said: testCase.held.said, payload: { name: testCase.held.said }, candidates: testCase.held.candidates, passes: 0, atMessage: 4 }] }
        : { heldNpcUpdates: [] };
    const state = { npcs: ROSTER, session };
    const knownNpcIds = buildKnownNpcIds(state, testCase.player, testCase.narrative);
    const heldNames = buildHeldNames(state);
    const realLog = console.log; const realWarn = console.warn; const realInfo = console.info;
    console.log = () => {}; console.warn = () => {}; console.info = () => {};
    let error = null;
    try {
        await runScribe({
            playerMessage: testCase.player,
            dmNarrative: testCase.narrative,
            settings,
            dispatch: action => actions.push(action),
            knownNpcIds,
            heldNames,
            sourceMessageId: `eval-${testCase.id}-${run}`,
        });
    } catch (e) {
        error = String(e?.message || e);
    } finally {
        console.log = realLog; console.warn = realWarn; console.info = realInfo;
    }
    const updates = actions.filter(a => a.type === 'UPDATE_NPC').map(a => ({
        id: typeof a.payload?.id === 'string' ? a.payload.id : null, name: String(a.payload?.name || ''),
        died: a.payload?.died === true || a.payload?.died === 'true',
        ties: Array.isArray(a.payload?.ties) ? a.payload.ties.map(t => ({ id: typeof t?.id === 'string' ? t.id : null, name: String(t?.name || '') })) : [],
    }));
    const links = actions.filter(a => a.type === 'LINK_HELD_NPCS').flatMap(a => a.payload?.links || []);
    let outcome;
    if (error) outcome = 'ERROR';
    else if (testCase.kind === 'id') {
        if (idOf(updates, testCase.want)) outcome = 'id';
        else if (updates.some(u => u.id && ROSTER.some(n => n.id === u.id))) outcome = 'WRONG-ID';
        else if (updates.length > 0) outcome = 'TWIN';
        else outcome = 'none';
    } else if (testCase.kind === 'new') {
        if (updates.length === 0) outcome = 'none';
        else if (updates.some(u => u.id && ROSTER.some(n => n.id === u.id))) outcome = 'WRONG-ID';
        else outcome = 'clean';
    } else if (testCase.kind === 'died') {
        const marked = updates.filter(u => u.died);
        if (testCase.want === null) outcome = marked.length === 0 ? 'clean' : 'LIVING-MARKED';
        else if (marked.some(u => u.id === testCase.want)) outcome = marked.length === 1 ? 'died' : 'LIVING-MARKED';
        else if (marked.length > 0) outcome = 'LIVING-MARKED';
        else outcome = 'none';
    } else if (testCase.kind === 'tie') {
        const self = updates.find(u => u.id === testCase.self);
        const tie = self?.ties?.[0];
        if (!tie) outcome = 'none';
        else if (tie.id === testCase.want) outcome = 'tie-id';
        else if (tie.id && ROSTER.some(n => n.id === tie.id)) outcome = 'WRONG-TIE';
        else outcome = 'tie-name';
    } else {
        const answer = links.find(l => l.said.toLowerCase() === testCase.held.said.toLowerCase());
        if (!answer) outcome = 'MISSED';
        else if (testCase.want === 'new') outcome = answer.id.toLowerCase() === 'new' ? 'new' : 'WRONG-LINK';
        else outcome = answer.id === testCase.want ? 'link' : 'WRONG-LINK';
    }
    return { outcome, updates, links, knownNpcIds, error };
}

async function main() {
    const results = [];
    for (const testCase of CASES) {
        for (let run = 1; run <= RUNS; run += 1) {
            const row = await runCase(testCase, run);
            results.push({ id: testCase.id, kind: testCase.kind, want: testCase.want || null, run, ...row });
            process.stdout.write(['id', 'clean', 'link', 'new', 'died', 'tie-id', 'merge'].includes(row.outcome) ? '.' : ['none', 'tie-name'].includes(row.outcome) ? '-' : 'x');
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
        `# People by id, ${new Date().toISOString()}`,
        '',
        `Machinery Flash, the real \`runScribe\`, ${CASES.length} hand-built turns × ${RUNS} run(s), a six-person roster with two Saimas, a title variant, a one-letter slip and an alias. No judge: read from the UPDATE_NPC and LINK_HELD_NPCS payloads.`,
        '',
        `- id (a recorded person in other words: "id" right, "WRONG-ID" another record, "TWIN" no id = a fork, "none" not reported): ${tally('id')}`,
        `- new (a person not on record: "clean" no id, "WRONG-ID" pinned to someone, "none"): ${tally('new')}`,
        `- link (a HELD NAME answered in name_links: "link" / "new" right, "WRONG-LINK", "MISSED"): ${tally('link')}`,
        `- died (lane 6C — a recorded person dies: "died" right; a death they caused: "clean"; "LIVING-MARKED" is the failure): ${tally('died')}`,
        `- tie (lane 6C — a regard for another listed person: "tie-id" right, "tie-name" the name only, "WRONG-TIE"): ${tally('tie')}`,
        `- merge (lane 6C — the reflection shown a fork AND two distinct Marens: "merge" folds the fork alone, "WRONG-MERGE" touched the Marens, "MISSED" left the fork): ${tally('merge')}`,
        '',
    ];
    for (const r of results) {
        report.push(`- ${r.id} #${r.run}: **${r.outcome}**${r.updates.length ? ' updates ' + r.updates.map(u => `[${u.id || 'no id'}] ${u.name}${u.died ? ' †' : ''}${u.ties?.length ? ` ties(${u.ties.map(t => `${t.id || 'no id'}:${t.name}`).join(', ')})` : ''}`).join(' · ') : ''}${r.links.length ? ' links ' + r.links.map(l => `"${l.said}"→${l.id}`).join(' · ') : ''}${r.merges?.length ? ' merges ' + r.merges.join(', ') : ''}${r.error ? ` ${r.error}` : ''}`);
    }
    const dir = path.join(OUT_DIR, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.md'), report.join('\n'));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(report.slice(0, 11).join('\n'));
    for (const r of results.filter(x => !['id', 'clean', 'link', 'new', 'died', 'tie-id', 'merge'].includes(x.outcome))) console.log(`${r.id} #${r.run} ${r.outcome} ${JSON.stringify(r.updates)} ${JSON.stringify(r.links)} ${JSON.stringify(r.merges || [])}`);
    console.log(`Report: ${dir}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
