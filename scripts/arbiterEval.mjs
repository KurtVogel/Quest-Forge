#!/usr/bin/env node
/**
 * Real-provider eval of the outside-combat roll arbiter standing alone
 * (identity by reference, lane 11, 2026-11-08). Until lane 11 the regex
 * rules in engine/outOfCombatRollPolicy.js were a FLOOR under the arbiter
 * (2026-09-02: a Flash-Lite approval on "I attack the lookout" skipped the
 * attack-as-check fix). Those rules are gone from play and frozen here, so
 * this script asks the one question that decides whether the floor is
 * missed: does the machinery Flash arbiter, on its own, reject what the
 * rules rejected and allow what they allowed?
 *
 *   npm.cmd run eval:arbiter
 *   $env:QF_EVAL_RUNS="1"; npm.cmd run eval:arbiter
 *
 * Key from the environment or the git-ignored .env (GEMINI_API_KEY). Writes a
 * markdown report + raw JSON to test-results/arbiter/. No judge: the verdict
 * is read from the arbiter's own JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewOutsideCombatRolls } from '../src/engine/outOfCombatRollPolicy.js';

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
const OUT_DIR = process.env.QF_EVAL_OUT || path.join(repoRoot, 'test-results', 'arbiter');
const settings = { llmProvider: 'gemini', apiKey: key, geminiApiKey: key };

// ── The old word rules, frozen for comparison (engine/outOfCombatRollPolicy.js as of 2026-11-07) ──
const SOCIAL_SKILLS = new Set(['persuasion', 'deception', 'intimidation', 'charisma']);
const EXPLICIT_TRUTH_RE = /\b(?:i\s+(?:am\s+)?(?:telling|speaking|answering)\s+(?:you\s+)?(?:the\s+)?truth|i\s+tell\s+(?:you\s+)?(?:the\s+)?truth|truthfully|honestly|i\s+(?:am|'m)\s+not\s+lying)\b/i;
const BELIEF_ONLY_RE = /\b(?:convince|persuade|assure|prove)\b.*\b(?:truth|truthful|honest|honesty|innocen(?:t|ce)|intentions?|sincere|sincerity|believe|story|account|explanation|promise)\b/i;
const CONCRETE_CONCESSION_RE = /\b(?:release|free|let\s+(?:me|us|him|her|them)\s+(?:go|pass|enter|leave)|grant|give|hand\s+over|open|allow|permit|join|help|aid|risk|betray|stand\s+down|surrender|withdraw|hire|sell|buy|waive|lower\s+the\s+price)\b/i;
const AUTHORED_PORTRAYAL_RE = /\bi\b[^.!?]{0,100}\b(?:remain|stay|keep|act|appear|seem|am|do\s+not|don't|won't)\b[^.!?]{0,80}\b(?:calm|stoic|composed|steady|emotionless|unafraid|brave|confident|sincere|truthful|flinch|cry|tremble|panic|show\s+fear)\b/i;
const PORTRAYAL_CHECK_RE = /\b(?:remain|maintain|keep|stay|appear|seem|hide|conceal|suppress|resist)\b[^.!?]{0,100}\b(?:calm|stoic|composure|composed|emotionless|facade|façade|demeanor|fear|panic|tears|pain|flinch|trembl\w*|emotion|courage|confidence|sincerity|truthful)\b/i;
const ATTACK_DECLARATION_RE = /\b(?:i|we)\s+(?:attack|strike(?:\s+at)?|stab|shoot|slash(?:\s+at)?|charge\s+(?:at|into|the)|lunge\s+at|swing\s+(?:my|the)\s+\w+\s+at|cut\s+(?:him|her|them|it)\s+down|run\s+(?:him|her|them|it)\s+through)\b/i;
const ATTACK_RESOLUTION_RE = /\b(?:attack|strike|stab|shoot|slash|slay|kill|wound|cut\s+\w+\s+down|land\s+(?:the|a)\s+blow|blade|sword|axe|spear|dagger|bow|arrow)\b/i;
const APPROACH_SKILLS = new Set(['stealth', 'deception', 'sleightofhand', 'sleight_of_hand', 'acrobatics', 'athletics']);
function oldRulesReject(roll, playerMessage) {
    const type = String(roll?.type || 'skill_check').toLowerCase();
    const skill = String(roll?.skill || roll?.ability || '').toLowerCase();
    const description = String(roll?.description || '');
    const truthOnly = SOCIAL_SKILLS.has(skill) && EXPLICIT_TRUTH_RE.test(playerMessage) && BELIEF_ONLY_RE.test(description) && !CONCRETE_CONCESSION_RE.test(description);
    const portrayal = type !== 'saving_throw' && type !== 'death_save' && AUTHORED_PORTRAYAL_RE.test(playerMessage) && PORTRAYAL_CHECK_RE.test(description);
    const attack = type !== 'saving_throw' && type !== 'death_save' && !APPROACH_SKILLS.has(skill.replace(/\s+/g, '')) && ATTACK_DECLARATION_RE.test(playerMessage) && ATTACK_RESOLUTION_RE.test(description);
    return truthOnly || portrayal || attack;
}

// `expect`: 'reject' when the rules say a check violates player agency or stages an attack; 'allow' otherwise.
const CASES = [
    { id: 'attack-longsword', expect: 'reject', attack: true,
        player: 'I attack the lookout with my longsword.',
        narrative: 'The lookout turns as you close the distance, hand going to his horn.',
        rolls: [{ type: 'skill_check', skill: 'strength', dc: 12, description: 'Strike the lookout down before he can shout' }] },
    { id: 'attack-typo', expect: 'reject', attack: true,
        player: 'i stab the gaurd in the back befor he turns',
        narrative: 'The guard is still half turned toward the torchlight when you move.',
        rolls: [{ type: 'skill_check', skill: 'dexterity', dc: 13, description: 'Drive the dagger home between his shoulders' }] },
    { id: 'attack-charge', expect: 'reject', attack: true,
        player: 'Enough talk. I charge the bandit chief, axe high.',
        narrative: 'The chief grins and spreads his feet in the mud.',
        rolls: [{ type: 'skill_check', skill: 'athletics', dc: 14, description: 'Cleave the bandit chief with the charging axe blow' }] },
    { id: 'approach-stealth', expect: 'allow',
        player: 'I sneak up behind the lookout and then attack him.',
        narrative: 'Gravel shifts under your boots as you work along the wall toward him.',
        rolls: [{ type: 'skill_check', skill: 'stealth', dc: 12, description: 'Close the distance to the lookout unseen' }] },
    { id: 'truth-belief', expect: 'reject',
        player: 'It was my mother\'s ring. I am telling you the truth, Galdric.',
        narrative: 'Galdric weighs the ring in his palm and looks from it to you and back.',
        rolls: [{ type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Convince Galdric of your innocent intentions' }] },
    { id: 'truth-concession', expect: 'allow',
        player: 'I honestly explain everything and ask him to release me.',
        narrative: 'Galdric listens, arms folded, the cell key on his belt.',
        rolls: [{ type: 'skill_check', skill: 'persuasion', dc: 10, description: 'Convince Galdric to release you after hearing the truth' }] },
    { id: 'demeanor-stoic', expect: 'reject',
        player: 'I use all my strength to remain calm and stoic as they strap me down. I say nothing.',
        narrative: 'The leather bites at your wrists. Three men, and the fourth holds the iron.',
        rolls: [{ type: 'skill_check', skill: 'constitution', dc: 12, description: 'Maintain a stoic, emotionless facade as they strap you down' }] },
    { id: 'demeanor-reworded', expect: 'reject',
        player: 'My face gives them nothing. Not a flicker.',
        narrative: 'The inquisitor leans close, studying your eyes for the fear he expects.',
        rolls: [{ type: 'skill_check', skill: 'deception', dc: 13, description: 'Keep your composure and hide your fear from the inquisitor' }] },
    { id: 'save-fear', expect: 'allow',
        player: 'I remain calm and stoic before the apparition.',
        narrative: 'The thing in the doorway opens a mouth that is only teeth, and the cold reaches for your heart.',
        rolls: [{ type: 'saving_throw', skill: 'wisdom', dc: 12, description: 'Resist the supernatural fear the apparition radiates' }] },
    { id: 'haggle', expect: 'allow',
        player: 'I haggle with the merchant over the lantern.',
        narrative: 'The merchant names six gold with a straight face.',
        rolls: [{ type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Convince the merchant to lower the price' }] },
    { id: 'climb', expect: 'allow',
        player: 'I climb the crumbling wall before the patrol rounds the corner.',
        narrative: 'Loose mortar sifts down with every handhold.',
        rolls: [{ type: 'skill_check', skill: 'athletics', dc: 12, description: 'Climb the crumbling wall' }] },
    { id: 'mixed-batch', expect: 'reject', partial: true,
        player: 'I tell the guard the truth about the ring, then vault the fence while he thinks it over.',
        narrative: 'The guard frowns at the ring as you back toward the fence.',
        rolls: [
            { type: 'skill_check', skill: 'deception', dc: 12, description: 'Convince the guard your story and intentions are honest' },
            { type: 'skill_check', skill: 'athletics', dc: 10, description: 'Vault the fence' },
        ] },
];

async function runCase(testCase) {
    const realWarn = console.warn;
    const realLog = console.log;
    console.warn = () => {};
    console.log = () => {};
    let review;
    let error = null;
    try {
        review = await reviewOutsideCombatRolls(testCase.rolls, testCase.player, testCase.narrative, settings);
    } catch (e) {
        error = String(e?.message || e);
    } finally {
        console.warn = realWarn;
        console.log = realLog;
    }
    if (error) return { outcome: 'ERROR', error };
    const rejected = testCase.rolls.map(roll => review.rejectedRolls.includes(roll));
    const oldRejected = testCase.rolls.map(roll => oldRulesReject(roll, testCase.player));
    let outcome;
    if (testCase.partial) outcome = rejected[0] && !rejected[1] ? 'agree' : (rejected.some(Boolean) ? 'PARTIAL' : 'MISSED');
    else if (testCase.expect === 'reject') outcome = rejected.every(Boolean) ? 'agree' : 'MISSED';
    else outcome = rejected.some(Boolean) ? 'OVER-REJECTED' : 'agree';
    const attackFlag = testCase.attack ? (review.attackAsCheck ? 'attack-flag' : 'NO-ATTACK-FLAG') : '';
    return { outcome, rejected, oldRejected, attackFlag, attackAsCheck: review.attackAsCheck };
}

async function main() {
    const results = [];
    for (const testCase of CASES) {
        for (let run = 1; run <= RUNS; run += 1) {
            const row = await runCase(testCase);
            results.push({ id: testCase.id, expect: testCase.expect, run, ...row });
            process.stdout.write(row.outcome === 'agree' ? '.' : 'x');
        }
    }
    process.stdout.write('\n');
    const rejectRows = results.filter(r => r.expect === 'reject');
    const allowRows = results.filter(r => r.expect === 'allow');
    const attackRows = results.filter(r => r.attackFlag);
    const oldAgree = results.filter(r => Array.isArray(r.oldRejected) && r.rejected.every((v, i) => v === r.oldRejected[i])).length;
    const report = [
        `# Roll arbiter alone, ${new Date().toISOString()}`,
        '',
        `Machinery Flash, the real \`reviewOutsideCombatRolls\` with the regex floor removed (lane 11), ${CASES.length} hand-built turns × ${RUNS} run(s). The old word rules are frozen in this script and run on the same cases for comparison only.`,
        '',
        `- should reject (agency / attack-as-check): ${rejectRows.length} runs, arbiter agreed ${rejectRows.filter(r => r.outcome === 'agree').length}, missed ${rejectRows.filter(r => r.outcome !== 'agree').length}`,
        `- should allow: ${allowRows.length} runs, arbiter agreed ${allowRows.filter(r => r.outcome === 'agree').length}, over-rejected ${allowRows.filter(r => r.outcome !== 'agree').length}`,
        `- attack-as-check flagged for the combat correction: ${attackRows.filter(r => r.attackFlag === 'attack-flag').length} of ${attackRows.length}`,
        `- arbiter and the old word rules gave the same verdict on ${oldAgree} of ${results.length} runs`,
        '',
    ];
    for (const r of results) {
        report.push(`- ${r.id} #${r.run}: **${r.outcome}** arbiter=${JSON.stringify(r.rejected)} oldRules=${JSON.stringify(r.oldRejected)}${r.attackFlag ? ` ${r.attackFlag}` : ''}${r.error ? ` ${r.error}` : ''}`);
    }
    const dir = path.join(OUT_DIR, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.md'), report.join('\n'));
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(report.slice(0, 9).join('\n'));
    for (const r of results.filter(x => x.outcome !== 'agree' || x.attackFlag === 'NO-ATTACK-FLAG')) console.log(`${r.id} #${r.run} ${r.outcome} arbiter=${JSON.stringify(r.rejected)} old=${JSON.stringify(r.oldRejected)} ${r.attackFlag || ''}`);
    console.log(`Report: ${dir}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
