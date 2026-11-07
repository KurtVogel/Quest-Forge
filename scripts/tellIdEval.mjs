#!/usr/bin/env node
/**
 * Real-provider eval of the hero-tell id echo (identity by reference, lane 2,
 * 2026-11-07). With the fuzzy `isSameTell` rung gone, an id-less re-report
 * of a known tell mints a twin instead of adding a sighting. This script
 * runs the real `runScribe` on hand-built turns with a tell record on file
 * (shown as KNOWN HERO TELLS exactly as the game shows it) and asks, per case:
 *
 *   held     the narrative shows a RECORDED pattern in other words. The
 *            Scribe should echo that tell's id ("id"). "exact" = no id but
 *            the held text character for character (still lands). "TWIN" =
 *            no id, other words: the lane's cost, a second row. "WRONG-ID" =
 *            another tell's id: a sighting on the wrong record. "none" = no
 *            tell reported (a missed sighting, not this lane's concern).
 *   voiced   a character NAMES a recorded pattern aloud: the same scoring,
 *            plus whether `voiced` rode along.
 *   new      a pattern NOT on record: "clean" = reported with no id;
 *            "WRONG-ID" = pinned to a recorded tell; "none" = not reported.
 *
 *   npm.cmd run eval:tellid
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:tellid
 *
 * Key from the environment or the git-ignored .env (GEMINI_API_KEY). Writes a
 * markdown report + raw JSON to test-results/tellid/. No judge: every number
 * is read from the wire (the ADD_HERO_TELLS payload) before the reducer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKnownHeroTells, runScribe } from '../src/llm/scribe.js';

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
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(repoRoot, 'test-results', 'tellid');
const settings = { llmProvider: 'gemini', apiKey: key, geminiApiKey: key };

// The record on file: five tells of the hero Astra, three established (three
// scenes), two seen once — the shape KNOWN HERO TELLS sorts and prints.
const tell = (id, kind, text, sightings) => ({
    id, kind, text, witnesses: ['Old Tammo', 'Orsa Pellwyn'], public: false, sightings,
    firstSeenMessage: sightings[0], lastSeenMessage: sightings[sightings.length - 1], voicedCount: 0,
});
const HELD = [
    tell('tell-pipe', 'habit', 'digs out a clay pipe and walks off when a conversation turns on the hero', [4, 40, 76]),
    tell('tell-jokes', 'manner', 'jokes the moment things get serious', [10, 46, 82]),
    tell('tell-double', 'principle', 'pays the poor double without being asked', [16, 52, 88]),
    tell('tell-first', 'principle', 'never draws first', [58]),
    tell('tell-coin', 'habit', 'turns a copper coin over the knuckles while listening', [94]),
];
const knownHeroTells = buildKnownHeroTells({ heroTells: HELD });

const CASES = [
    { id: 'pipe-reworded', kind: 'held', want: 'tell-pipe',
        player: 'I ask Orsa what she knows about my debt, and she turns it around and asks where I came from before Saltmere.',
        narrative: 'Orsa Pellwyn sets down her quill. "Two winters here and nobody knows your harbor. Where did the Kittiwake\'s money go before you, Astra?" Astra says nothing. She fishes the clay pipe out of her coat, lights it off the lamp, and walks out of the office and down the quay without a word. Old Tammo, mending his net by the brazier, watches her go and spits into the coals.' },
    { id: 'jokes-surgeon', kind: 'held', want: 'tell-jokes',
        player: 'I let the barber-surgeon look at the leg.',
        narrative: 'The barber-surgeon, Hesper Vane, peels the bandage back and sucks her teeth. "If the rot has taken the bone, the leg comes off at the knee. I\'ll know by morning." Astra grins up at her from the table. "Do I get a discount on one boot?" Old Tammo, holding the lamp, does not laugh. Hesper does, once, and reaches for the knife.' },
    { id: 'double-beggar', kind: 'held', want: 'tell-double',
        player: 'I walk past the beggar at the chapel steps.',
        narrative: 'The beggar on the chapel steps holds out a cracked bowl and asks for a copper for bread. Astra drops two whole silver into it without slowing and is past him before he can speak. Brother Anselm, sweeping the step above, raises an eyebrow and says nothing.' },
    { id: 'first-mercenary', kind: 'held', want: 'tell-first',
        player: 'I stand my ground.',
        narrative: 'The drunk mercenary drags his sword out of its sheath and levels it at Astra\'s chest. She keeps both hands open at her sides, her own blade still sheathed, and waits. He swings. Only then does the longsword come out, and his sword is on the floor a breath later. Corren the taverner stares from behind the bar.' },
    { id: 'coin-harbormaster', kind: 'held', want: 'tell-coin',
        player: 'I listen to what Orsa has to say about the lighthouse.',
        narrative: 'Orsa Pellwyn talks for a long while about Gannet Rock, the dark lamp, and the keeper nobody has seen in a week. The whole time a copper walks across Astra\'s knuckles, over and back, over and back, never falling. Orsa\'s eyes flick to it twice. "Are you listening?" "Every word."' },
    { id: 'jokes-odds', kind: 'held', want: 'tell-jokes',
        player: 'I count the smugglers on the beach with Bran.',
        narrative: 'Bran Holt counts under his breath and goes pale. "Eight of them, Astra. Eight, and two of us." Astra checks the strap of her shield. "Good. I hate even odds." Bran looks at her as though she has lost her mind.' },
    { id: 'double-apple', kind: 'held', want: 'tell-double',
        player: 'I buy an apple from the orphan girl.',
        narrative: 'The orphan girl at the market edge holds up a bruised apple and asks half a copper. Astra takes it, presses a whole silver piece into the child\'s palm, closes the small fingers over it, and walks on eating. Maren Ashe, at the next stall, sees it and says nothing.' },
    { id: 'pipe-voiced', kind: 'voiced', want: 'tell-pipe',
        player: 'I ask Tammo about his daughter.',
        narrative: '"My daughter?" Old Tammo looks up from the net. "Ask me about yours first, girl." Astra\'s hand is already moving toward her coat. Tammo barks a laugh. "Let me guess — the pipe again? Every time a question turns your way, out comes that pipe and off you go." Astra stops with the pipe half out, and for once sits back down.' },
    { id: 'jokes-voiced', kind: 'voiced', want: 'tell-jokes',
        player: 'I tell Maren the plan for tonight.',
        narrative: 'Maren Ashe listens to the plan, then folds her arms. "And when it goes wrong, you\'ll make one of your jokes. You always do, the moment it gets serious. I\'ve watched you." Astra opens her mouth, and Maren holds up a finger. "Don\'t." Astra closes it again.' },
    { id: 'new-doors', kind: 'new',
        player: 'I take the room at the inn and turn in.',
        narrative: 'The room at the Gull is small and smells of tar. Before Astra lies down she checks the bolt on the door, then the shutter latch, then the bolt again, and only then unbuckles the sword belt. Corren, bringing up the lamp, waits in the hall until she is done.' },
    { id: 'new-praise', kind: 'new',
        player: 'I report to the captain of the watch.',
        narrative: 'Captain Idra Stane hears Astra out and nods slowly. "That was well done. Few would have gone out to the rock alone." Astra looks at the floorboards and asks about the tide tables instead. The captain notices, and lets it pass.' },
    { id: 'new-mercy', kind: 'new',
        player: 'I have the smuggler at my feet. I let him up.',
        narrative: 'The smuggler lies in the shingle with Astra\'s boot on his wrist and her sword at his throat. She steps back and lets him scramble up. "Go. Tell whoever sent you the beach is watched." He runs. Bran Holt, panting, stares at her. "You had him."' },
];

async function runCase(testCase, run) {
    const actions = [];
    const realLog = console.log;
    const realWarn = console.warn;
    const realInfo = console.info;
    console.log = () => {};
    console.warn = () => {};
    console.info = () => {};
    let error = null;
    try {
        await runScribe({
            playerMessage: testCase.player,
            dmNarrative: testCase.narrative,
            settings,
            dispatch: action => actions.push(action),
            knownHeroTells,
            sourceMessageId: `eval-${testCase.id}-${run}`,
        });
    } catch (e) {
        error = String(e?.message || e);
    } finally {
        console.log = realLog;
        console.warn = realWarn;
        console.info = realInfo;
    }
    const reports = actions.filter(a => a.type === 'ADD_HERO_TELLS').flatMap(a => (Array.isArray(a.payload) ? a.payload : []));
    const wire = reports.map(r => ({
        id: r.id || null, text: String(r.text || ''), kind: r.kind || null,
        voiced: r.voiced === true || r.voiced === 'true', witnesses: r.witnesses || [],
        onRecord: !!r.id && HELD.some(h => h.id === r.id),
        exactText: HELD.some(h => h.text.toLowerCase() === String(r.text || '').replace(/\s+/g, ' ').trim().toLowerCase()),
    }));
    let outcome;
    if (error) outcome = 'ERROR';
    else if (testCase.kind === 'new') {
        if (wire.length === 0) outcome = 'none';
        else if (wire.some(w => w.onRecord || w.exactText)) outcome = 'WRONG-ID';
        else outcome = 'clean';
    } else {
        const hit = wire.find(w => w.id === testCase.want);
        if (hit) outcome = 'id';
        else if (wire.some(w => w.onRecord)) outcome = 'WRONG-ID';
        else if (wire.some(w => w.exactText)) outcome = 'exact';
        else if (wire.length > 0) outcome = 'TWIN';
        else outcome = 'none';
    }
    const voicedOk = testCase.kind === 'voiced' ? wire.some(w => w.id === testCase.want && w.voiced) : null;
    return { outcome, wire, voicedOk, error };
}

async function main() {
    const results = [];
    for (const testCase of CASES) {
        for (let run = 1; run <= RUNS; run += 1) {
            const row = await runCase(testCase, run);
            results.push({ id: testCase.id, kind: testCase.kind, want: testCase.want || null, run, ...row });
            process.stdout.write(['id', 'clean', 'exact'].includes(row.outcome) ? '.' : row.outcome === 'none' ? '-' : 'x');
        }
    }
    process.stdout.write('\n');
    const tally = (kind) => {
        const rows = results.filter(r => r.kind === kind);
        const counts = {};
        for (const r of rows) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
        return `${rows.length} runs: ${Object.entries(counts).map(([name, n]) => `${name} ${n}`).join(', ')}`;
    };
    const voicedRows = results.filter(r => r.kind === 'voiced' && r.outcome === 'id');
    const report = [
        `# Hero tell id echo, ${new Date().toISOString()}`,
        '',
        `Machinery Flash, the real \`runScribe\`, ${CASES.length} hand-built turns × ${RUNS} run(s), five tells on record (three established). No judge: read from the ADD_HERO_TELLS payload.`,
        '',
        '- held (a recorded pattern shown in other words — "id" is right, "exact" lands, "TWIN" is the lane\'s cost, "WRONG-ID" a sighting on the wrong record, "none" a missed sighting): ' + tally('held'),
        '- voiced (a character names a recorded pattern aloud): ' + tally('voiced') + ` — \`voiced\` rode the id on ${voicedRows.filter(r => r.voicedOk).length} of ${voicedRows.length}`,
        '- new (a pattern not on record — "clean" is right, "WRONG-ID" pins it to a recorded tell): ' + tally('new'),
        '',
    ];
    for (const r of results) {
        report.push(`- ${r.id} #${r.run}: **${r.outcome}**${r.wire.length ? ' ' + r.wire.map(w => `[${w.id || 'no id'}${w.voiced ? ', voiced' : ''}] "${w.text.slice(0, 90)}"`).join(' · ') : ''}${r.error ? ` ${r.error}` : ''}`);
    }
    const dir = path.join(OUT_DIR, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.md'), report.join('\n'));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(report.slice(0, 8).join('\n'));
    for (const r of results.filter(x => !['id', 'clean', 'exact'].includes(x.outcome))) console.log(`${r.id} #${r.run} ${r.outcome} ${JSON.stringify(r.wire.map(w => [w.id, w.text.slice(0, 60)]))}`);
    console.log(`Report: ${dir}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
