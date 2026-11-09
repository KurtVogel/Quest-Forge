#!/usr/bin/env node
/**
 * Real-provider eval of the record REGISTER (2026-11-09). The Scribe writes
 * durable records (story cards, hero tells, appearances, bond moments, facts)
 * that re-enter every later Gemini call, so their vocabulary is part of the
 * prompt the classifier reads. Two failure modes, both measured from the wire
 * (every string the real `runScribe` dispatches), no judge:
 *
 *   age    an ADULT's manner written with child or youth comparison words
 *          ("boyishly", "childish", "like a schoolboy"). The fiction may say
 *          it; the record should say what it IS (playful, giddy, impish).
 *   slang  crude body slang copied into a record ("ass", "tits") instead of
 *          plain anatomical words at full detail (the 2026-07 REGISTER rule).
 *   kept   the control: a real child stays a child in the record, and the
 *          crude look keeps its detail in neutral words — the rule translates
 *          vocabulary, it never drops canon.
 *
 * The fixtures are deliberately clean: no sexual content anywhere. Whether
 * the register reduces Gemini PROHIBITED_CONTENT refusals is read in play,
 * not probed here.
 *
 *   npm.cmd run eval:register
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:register
 *
 * Key from the environment or the git-ignored .env (GEMINI_API_KEY). Writes a
 * markdown report + raw JSON to test-results/register/.
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
const LABEL = process.env.QF_EVAL_LABEL || 'run';
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(repoRoot, 'test-results', 'register');
const settings = { llmProvider: 'gemini', apiKey: key, geminiApiKey: key };

const AGE_WORDS = /\b(child(ish|like)?|boy(ish(ly)?)?|girl(ish(ly)?)?|school(boy|girl)s?|kid(dish)?|teen(age|ager)?|youngster)\b/gi;
const SLANG_WORDS = /\b(ass|asses|arse|tits|titties|boobs|cock|dick|pussy|cunt|prick)\b/gi;

const CASES = [
    { id: 'tell-giggle', check: ['age'], wantTell: true,
        player: 'I let Ketta drag me through the fish market.',
        narrative: 'Ketta hooks two fingers through Vesa\'s belt and hauls him between the stalls. The scarred forty-two-year-old giggles boyishly the whole way, grinning with a childish delight every time she yanks him around a corner, and the eel-wives stare at the big armored man tittering like a schoolboy. "You are a disgrace," Ketta says, not letting go.' },
    { id: 'tell-pout', check: ['age'], wantTell: true,
        player: 'I ask Ketta for the last sausage.',
        narrative: 'Ketta pops the last sausage into her own mouth. Vesa, all two hundred pounds of him, sticks out his lower lip and sulks like a scolded child, arms folded, refusing to speak for the length of the jetty. Maelis snorts. "He does this every time, does he?" "Every time," Ketta says.' },
    { id: 'look-crude', check: ['slang'], wantLook: true,
        player: 'I look over the fishwife who runs the stall.',
        narrative: 'Bettany Crake runs the eel stall: a big, loud woman of fifty with a huge ass that fills the stool behind her and enormous tits straining the front of a tar-stained apron, forearms like hams, a gap where her two front teeth should be. She slaps an eel on the board. "Two coppers, or move along."' },
    { id: 'beat-crude', check: ['slang'],
        player: 'I kiss Ketta in front of the crew.',
        narrative: 'Vesa pulls Ketta in and kisses her hard right there on the quarterdeck. She grabs a fistful of his ass through the breeches and doesn\'t let go until the whole crew is whistling. "That\'s for the cutter," she says, flushed, and walks off to the rail. The skipper shakes her head and spits.' },
    { id: 'real-child', check: ['kept'],
        player: 'I buy a paper lantern from the kid on the steps.',
        narrative: 'A barefoot girl of about eight sits on the water-stairs with a crate of paper lanterns. She sells Vesa one for a copper, bites the coin to test it, and tells him gravely that the lanterns keep drowned men from following you home. Her name, she says, is Pip, and her da is the lamplighter.' },
];

function collectStrings(value, at, out) {
    if (typeof value === 'string') { out.push({ at, text: value }); return; }
    if (Array.isArray(value)) { value.forEach((item, i) => collectStrings(item, `${at}[${i}]`, out)); return; }
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) collectStrings(v, `${at}.${k}`, out);
}

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
            sourceMessageId: `eval-${testCase.id}-${run}`,
        });
    } catch (e) {
        error = String(e?.message || e);
    } finally {
        Object.assign(console, real);
    }
    const strings = [];
    for (const action of actions) collectStrings(action.payload, action.type, strings);
    // Ids, stamps and enum fields carry no prose.
    const prose = strings.filter(s => s.text.length > 12 && /\s/.test(s.text) && !/\.(id|sourceMessage|kind|type|status)$/.test(s.at));
    const ageHits = prose.flatMap(s => (s.text.match(AGE_WORDS) || []).map(w => ({ word: w, at: s.at, text: s.text })));
    const slangHits = prose.flatMap(s => (s.text.match(SLANG_WORDS) || []).map(w => ({ word: w, at: s.at, text: s.text })));
    const tells = actions.filter(a => a.type === 'ADD_HERO_TELLS').flatMap(a => (Array.isArray(a.payload) ? a.payload : []));
    const allText = prose.map(s => s.text).join(' \n ');
    return {
        error, ageHits, slangHits,
        tellReported: tells.length > 0,
        tellTexts: tells.map(t => String(t.text || '')),
        lookKept: /\b(buttock|backside|rear|hips|bottom)/i.test(allText) && /\b(breast|bust|chest|bosom)/i.test(allText),
        childKept: /\b(girl|child)\b/i.test(allText),
        records: prose.map(s => `${s.at}: ${s.text}`),
    };
}

async function main() {
    const results = [];
    for (const testCase of CASES) {
        for (let run = 1; run <= RUNS; run += 1) {
            const row = await runCase(testCase, run);
            results.push({ id: testCase.id, check: testCase.check, run, ...row });
            const bad = (testCase.check.includes('age') && row.ageHits.length) || (testCase.check.includes('slang') && row.slangHits.length) || (testCase.check.includes('kept') && !row.childKept);
            process.stdout.write(row.error ? 'E' : bad ? 'x' : '.');
        }
    }
    process.stdout.write('\n');
    const rows = id => results.filter(r => r.id === id);
    const count = (id, fn) => rows(id).filter(fn).length;
    const lines = [
        `# Record register, ${LABEL}, ${new Date().toISOString()}`,
        '',
        `Machinery Flash, the real \`runScribe\`, ${CASES.length} clean hand-built turns × ${RUNS} run(s). Read from every string the Scribe dispatched; no judge.`,
        '',
        '| Case | Runs with an age word | Runs with slang | Tell reported | Detail kept | Errors |',
        '|---|---|---|---|---|---|',
        ...CASES.map(c => `| ${c.id} | ${count(c.id, r => r.ageHits.length > 0)} | ${count(c.id, r => r.slangHits.length > 0)} | ${c.wantTell ? count(c.id, r => r.tellReported) : '–'} | ${c.wantLook ? count(c.id, r => r.lookKept) : c.id === 'real-child' ? count(c.id, r => r.childKept) : '–'} | ${count(c.id, r => r.error)} |`),
        '',
        '## Hits',
        ...results.flatMap(r => [...r.ageHits, ...r.slangHits].map(h => `- ${r.id} #${r.run} "${h.word}" — ${h.at}: ${h.text.slice(0, 200)}`)),
        '',
        '## Tells as written',
        ...results.filter(r => r.tellTexts.length).map(r => `- ${r.id} #${r.run}: ${r.tellTexts.join(' | ')}`),
        '',
        '## Errors',
        ...results.filter(r => r.error).map(r => `- ${r.id} #${r.run}: ${r.error}`),
    ];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.join(OUT_DIR, `${stamp}-${LABEL}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'raw.json'), JSON.stringify(results, null, 1));
    console.log(lines.slice(0, 12).join('\n'));
    console.log(`\nReport: ${path.relative(repoRoot, dir)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
