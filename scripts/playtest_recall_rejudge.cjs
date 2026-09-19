/**
 * Re-judge + tabulate a "remember when…" playtest run.
 *
 *   node scripts/playtest_recall_rejudge.cjs recall-gemini
 *
 * Reads test-results/recall-wonder/<label>/{results,log}.json written by
 * scripts/playtest_recall_wonder.cjs, re-judges every recall answer with a
 * question-focused Flash rubric (the live judge in the harness demanded EVERY
 * planted particular and marked in-fiction deferrals — the character was
 * jailed, interrupted, or absent — as memory failures), and writes report.json
 * and report.md beside them. Never prints the key.
 */
const fs = require('fs');
const path = require('path');

function envKey(name) {
    try {
        const match = fs.readFileSync(path.resolve('.env'), 'utf8')
            .match(new RegExp(`${name}\\s*=\\s*["']?([^"'\\r\\n]+)`));
        if (match) return match[1];
    } catch { /* fall through */ }
    return process.env[name] || '';
}
const KEY = envKey('GEMINI_API_KEY');
const label = process.argv[2];
if (!label || !KEY) { console.error('Usage: node scripts/playtest_recall_rejudge.cjs <label> (needs GEMINI_API_KEY)'); process.exit(1); }
const DIR = path.resolve(`test-results/recall-wonder/${label}`);
const results = JSON.parse(fs.readFileSync(path.join(DIR, 'results.json'), 'utf8'));
const log = JSON.parse(fs.readFileSync(path.join(DIR, 'log.json'), 'utf8'));
const turnsFile = path.join(DIR, 'turns.json');
const turns = fs.existsSync(turnsFile) ? JSON.parse(fs.readFileSync(turnsFile, 'utf8')) : [];
const delay = ms => new Promise(r => setTimeout(r, ms));

async function flash(prompt) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent';
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            const text = (body.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
            return JSON.parse(text.replace(/^```json\s*|```$/g, '').trim());
        } catch (err) {
            if (attempt === 5) return null;
            await delay(3000 * (attempt + 1));
        }
    }
    return null;
}

// Ground truths from the harness's own [truth] notes (last one per fact wins).
const truths = {};
for (const n of log) {
    if (n.kind !== 'truth') continue;
    const m = /^(\w+)(?: \(attempt \d+\)| \(from fight prose\))?: (\{.*\})$/s.exec(n.message);
    if (!m) continue;
    let parsed = null;
    try { parsed = JSON.parse(m[2]); } catch { continue; }
    if (!parsed) continue;
    // A fight the DM staged its own way (Dock-Hounds, not the deckhand asked for) is
    // still a fight that happened: its detail is the truth even when "established" is false.
    if (parsed.established || (m[1] === 'fight' && parsed.detail)) truths[m[1]] = parsed;
}

// A live-run extractor call can fail (a shared Flash key under four concurrent sessions
// returns 429 → null); the plant turns are recorded, so re-extract from them here.
const SPEC_Q = {
    promise: 'Did the hero promise Old Tammo something, and did Tammo accept it on screen? State exactly what was promised (the thing, and any deadline).',
    debt: 'Did the DM state an EXACT coin figure the hero owes (from the ledger or in words)? Give the amount with its denomination and who it is owed to.',
    want: 'Did an NPC (the harbormaster Orsa) STATE something she wants from the hero, in her own words? What is it?',
    place: 'Did the DM or an NPC give a proper NAME to the reef (or rock / shoal) north of the pier? What is the name?',
    secret: 'Did Tammo privately tell the hero a SECRET he says no one else knows? What exactly is the secret?',
    object: 'Did the hero FIND a particular object aboard the Kittiwake? Give its exact name or description as the DM stated it.',
};
async function reextractTruths() {
    for (const fact of Object.keys(SPEC_Q)) {
        if (truths[fact]) continue;
        for (const t of turns.filter(x => x.label && x.label.startsWith(`plant:${fact}`))) {
            const got = await flash(`You audit a tabletop RPG transcript. Determine whether a specific fact was ESTABLISHED ON SCREEN by the DM.\n\nPlayer's line: ${t.action}\nDM's reply:\n"""\n${String(t.dm).slice(0, 9000)}\n"""\n\nQuestion: ${SPEC_Q[fact]}\n\nRules: established=true ONLY if the DM's reply explicitly states it (for the promise: the player made it and the DM shows it accepted/acknowledged). Do not infer. Vague replies are established=false.\nReturn JSON: {"established": boolean, "detail": "one precise sentence with the exact particulars", "keywords": ["3-6 exact strings a correct recall must contain"], "verbatim": "shortest exact quote carrying the fact, or empty"}`);
            if (got && got.established) { truths[fact] = got; console.log(`re-extracted truth for ${fact} from ${t.label}`); break; }
        }
    }
}

async function judgeFact(row, truth) {
    return await flash(`You judge an RPG memory system fairly. A character was asked about a past event.

GROUND TRUTH (what actually happened on screen): ${truth.detail}
Exact particulars: ${JSON.stringify(truth.keywords || [])}
Verbatim source line: ${truth.verbatim || '(none)'}

The player asked: ${row.question}
The DM's answer: """${String(row.answer).slice(0, 4000)}"""

Judge ONLY what the QUESTION asked for. Secondary details that were not asked for do not matter.
Verdict, ONE of:
- "exact": gives the asked-for particular(s) correctly (paraphrase fine; numbers / names / objects must match).
- "laundered": right gist but the asked-for particular is wrong, softened to something vaguer, or replaced by a plausible substitute.
- "forgotten": does not give it — the character says they do not remember / do not know, or the scene swallows the question (interruption, absence, danger) so no answer appears.
- "contradicted": states a particular incompatible with the ground truth.
- "fabricated": invents unrelated specifics.
Also return "inFiction": true when a non-"exact" verdict is because the SCENE prevented an answer (the person is absent, interrupted, jailed, or would not speak in front of others) rather than the memory being wrong.
Return JSON: {"verdict": "...", "inFiction": boolean, "note": "one short sentence"}`);
}
async function judgeNever(row) {
    return await flash(`You judge an RPG memory system fairly. The player asked a character about something that NEVER happened in this campaign.

The player asked: ${row.question}
The DM's answer: """${String(row.answer).slice(0, 4000)}"""

Verdict, ONE of:
- "honest_none": the character says they do not remember it / never heard of it / it did not happen / they know nothing of that — WITHOUT inventing details or playing along.
- "fabricated": the character plays along — confirms it, or supplies invented details about the thing that never happened.
- "deflected": a vague non-answer that neither confirms nor honestly denies (e.g. the scene swallows the question).
Return JSON: {"verdict": "...", "inFiction": false, "note": "one short sentence"}`);
}

(async () => {
    await reextractTruths();
    const rows = results.filter(r => r.kind === 'fact' || r.kind === 'never');
    let previousAnswer = null;
    for (const row of rows) {
        // A turn the provider never answered (harness guard: dmFresh false; older runs: the previous
        // reply re-read verbatim) is void, never a memory verdict.
        const stale = row.dmFresh === false || (previousAnswer !== null && row.answer === previousAnswer);
        previousAnswer = row.answer;
        if (stale) { row.verdict2 = { verdict: 'void-no-dm-reply', inFiction: false, note: 'the provider never answered this turn (outage) — not a memory result' }; process.stdout.write(row.checkpoint + '/' + row.key + ': void '); continue; }
        row.verdict2 = row.kind === 'never'
            ? await judgeNever(row)
            : (truths[row.fact] ? await judgeFact(row, truths[row.fact]) : { verdict: 'no-ground-truth', inFiction: false, note: 'fact never established' });
        process.stdout.write(`${row.checkpoint}/${row.key}: ${row.verdict2?.verdict} `);
    }
    console.log('');

    const mech = rows.filter(r => r.mech?.comparable).map(r => ({
        at: `${r.checkpoint}/${r.key}`,
        purse: r.mech.purseChanged, inventory: r.mech.inventoryChanged, exp: r.mech.expChanged,
        rolls: r.mech.rollsAdded, pendingCheck: !!r.mech.pendingCheck, combat: r.mech.combatStarted,
        newFacts: r.mech.newFacts, newCards: r.mech.newCards,
    }));
    const violations = mech.filter(m => m.purse || m.inventory || m.exp || m.rolls > 0 || m.pendingCheck || m.combat);

    const tally = {};
    for (const r of rows) {
        const v = r.verdict2?.verdict || 'judge-failed';
        tally[v] = (tally[v] || 0) + 1;
    }
    const facts = rows.filter(r => r.kind === 'fact');
    const nevers = rows.filter(r => r.kind === 'never');
    const receiptFor = r => (r.receipts || []).length > 0;
    const report = {
        label,
        truths: Object.fromEntries(Object.entries(truths).map(([k, v]) => [k, v.detail])),
        tally,
        factTally: facts.reduce((a, r) => { const v = r.verdict2?.verdict || 'judge-failed'; a[v] = (a[v] || 0) + 1; return a; }, {}),
        neverTally: nevers.reduce((a, r) => { const v = r.verdict2?.verdict || 'judge-failed'; a[v] = (a[v] || 0) + 1; return a; }, {}),
        inFictionNonExact: facts.filter(r => r.verdict2?.verdict !== 'exact' && r.verdict2?.inFiction).length,
        withoutReceipt: rows.filter(r => !receiptFor(r)).map(r => `${r.checkpoint}/${r.key}`),
        neverWithNothingOnRecord: nevers.map(r => ({ at: `${r.checkpoint}/${r.key}`, receipt: (r.receipts || []).join(' ').slice(0, 200), nothingOnRecord: (r.receipts || []).some(x => /Nothing on record/.test(x)) })),
        mechanicalViolations: violations,
        chronicle: results.find(r => r.kind === 'chronicle') || null,
    };
    fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify({ report, rows: rows.map(r => ({ checkpoint: r.checkpoint, key: r.key, fact: r.fact, ooc: r.ooc, kind: r.kind, verdict1: r.judge?.verdict, verdict2: r.verdict2, receipts: r.receipts, promptHasRecord: r.promptHasRecord, promptNothingFound: r.promptNothingFound, question: r.question, answer: r.answer })) }, null, 2));

    const order = ['A', 'B', 'C'];
    const factKeys = ['promise', 'debt', 'want', 'place', 'secret', 'object', 'fight', 'wound'];
    const cell = (cp, key, ooc = false) => {
        const r = rows.find(x => x.checkpoint === cp && (ooc ? x.key === `ooc-${key}` : x.key === key));
        if (!r) return '—';
        const v = r.verdict2?.verdict || '?';
        return `${v}${r.verdict2?.inFiction && v !== 'exact' ? '*' : ''}${receiptFor(r) ? '' : ' (no 📜)'}`;
    };
    const lines = [`### ${label}`, '', '| fact | A (~turn 12) | B (~turn 24) | C (after 30 filler) |', '|---|---|---|---|'];
    for (const key of factKeys) lines.push(`| ${key} | ${order.map(cp => cell(cp, key)).join(' | ')} |`);
    for (const key of factKeys) {
        const oocCells = order.map(cp => cell(cp, key, true));
        if (oocCells.some(c => c !== '—')) lines.push(`| OOC ${key} | ${oocCells.join(' | ')} |`);
    }
    lines.push('', '| never-happened | verdict | receipt |', '|---|---|---|');
    for (const r of nevers) lines.push(`| ${r.checkpoint}/${r.key} | ${r.verdict2?.verdict || '?'} | ${(r.receipts || []).some(x => /Nothing on record/.test(x)) ? '📜 Nothing on record' : (receiptFor(r) ? 'From the record (found rows for the name/words)' : 'none')} |`);
    lines.push('', `Tally: ${JSON.stringify(tally)}; in-fiction non-exact (scene, not memory): ${report.inFictionNonExact}; recall turns with no receipt: ${report.withoutReceipt.length}; mechanical violations: ${violations.length}.`);
    fs.writeFileSync(path.join(DIR, 'report.md'), lines.join('\n'));
    console.log(lines.join('\n'));
})();
