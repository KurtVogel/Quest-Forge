/**
 * Resume a finished grand run's campaign and finish its last chapter (2026-10-03).
 *
 * The 10-03 GPT-6.1 Sol grand run left its hero dead inside a staged fight
 * nobody drove (a harness sequencing bug, since fixed): `isDead` was true but
 * END_COMBAT never ran, so the epitaph, the ending card, and the epilogue never
 * came. This script reopens that run's Chrome profile (its IndexedDB holds the
 * autosave), presses Continue, ends the fight through the engine's own
 * END_COMBAT (a manual End Combat on a dead hero is still a death — the
 * reducer's rule), and then walks the ending card: What became of them → the
 * Flash judge, Close the last chapter → the Chronicle. An epilogue request a
 * previous pass left UNANSWERED (the browser closed mid-stream) is soft-deleted
 * through DELETE_MESSAGE — the card derives "asked" from non-deleted rows — and
 * asked again. Nothing in src/ is touched; the harness's debug dispatch gate
 * (`?debugState=1`) is the only door.
 *
 *   node scripts/playtest_resume_ending.cjs <run label>
 *
 * Requires the production build served on 4173 and GEMINI_API_KEY in .env (judge).
 * Output: test-results/recall-wonder/<label>/ending-resume.json (+ screenshots).
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const label = process.argv[2];
if (!label) { console.error('Usage: node scripts/playtest_resume_ending.cjs <run label>'); process.exit(1); }
const OUT_DIR = path.resolve(`test-results/recall-wonder/${label}`);
const PROFILE_DIR = path.join(OUT_DIR, 'profile');
if (!fs.existsSync(PROFILE_DIR)) { console.error(`No profile at ${PROFILE_DIR}`); process.exit(1); }
const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:4173/?debugState=1';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const JUDGE_MODEL = 'gemini-3.7-flash';
const JUDGE_FALLBACK_MODEL = 'gemini-3-flash-preview';
const EPILOGUE_WAIT_MS = 300000;
function envKey(name) {
    try {
        const match = fs.readFileSync(path.resolve('.env'), 'utf8').match(new RegExp(`${name}\\s*=\\s*["']?([^"'\\r\\n]+)`));
        if (match) return match[1];
    } catch { /* fall through */ }
    return process.env[name] || '';
}
const GEMINI_API_KEY = envKey('GEMINI_API_KEY');
const delay = ms => new Promise(r => setTimeout(r, ms));
const log = [];
function note(kind, message) { log.push({ t: new Date().toISOString(), kind, message }); console.log(`[${kind}] ${String(message).slice(0, 300)}`); }

async function flash(prompt) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const model = attempt >= 2 ? JUDGE_FALLBACK_MODEL : JUDGE_MODEL;
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
                body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } } }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            const text = (body.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
            return JSON.parse(text.replace(/^```json\s*|```$/g, '').trim());
        } catch (err) {
            if (attempt === 3) { note('judge-fail', String(err).slice(0, 200)); return null; }
            await delay(2500 * (attempt + 1));
        }
    }
    return null;
}
const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
async function clickByText(page, selector, text) {
    return await page.evaluate(({ selector, text }) => {
        const el = Array.from(document.querySelectorAll(selector)).find(e => e.textContent.includes(text));
        if (el) { el.click(); return true; }
        return false;
    }, { selector, text });
}
const snap = (page) => page.evaluate(() => {
    const s = window.__QF_STATE__; if (!s) return null;
    const c = s.character || {}; const msgs = s.messages || [];
    return {
        msgCount: msgs.length, hp: c.currentHP, isDead: !!c.isDead, dying: !!c.dying, level: c.level,
        combat: s.combat?.active ? { phase: s.combat.phase, enemies: (s.combat.enemies || []).map(e => `${e.name}:${e.hp}`) } : null,
        heroDeath: s.session?.heroDeath || null,
        epitaph: msgs.filter(m => m.kind === 'epitaph').map(m => m.content),
        skull: msgs.filter(m => /☠/.test(String(m.content || ''))).map(m => String(m.content).slice(0, 200)),
        party: (s.party || []).map(p => p.name), quests: (s.quests || []).filter(q => q.status === 'active').map(q => q.name),
        purse: { gold: c.gold, silver: c.silver, copper: c.copper }, inventory: (s.inventory || []).map(i => i.name).sort(),
        chapterCloseSuggested: s.session?.chapterCloseSuggested || null,
    };
}).catch(() => null);
/** The rows after the death: role / kind / id / deleted / content. */
const tailAfterDeath = (page, s) => page.evaluate((from) => (window.__QF_STATE__?.messages || []).slice(from).map(m => ({ id: m.id, role: m.role, kind: m.kind || null, hidden: !!m.hidden, deleted: !!m.deleted, content: String(m.content || '').slice(0, 1600) })), Math.max(0, (s.heroDeath?.atMessage ?? s.msgCount - 12) - 2));
const epilogueButton = (page) => page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ending-card button')).find(x => x.textContent.includes('What became of them'));
    return b ? { present: true, disabled: !!b.disabled } : { present: false, disabled: null };
});

/** Ask "What became of them" and wait for the DM's reply row (not the typing indicator — the composer is gone). */
async function askEpilogue(page, s) {
    const msgBefore = s.msgCount;
    const t0 = Date.now();
    await clickByText(page, '.ending-card button', 'What became of them');
    let epilogue = '';
    let errorLine = '';
    while (Date.now() - t0 < EPILOGUE_WAIT_MS) {
        await delay(3000);
        const rows = await page.evaluate((from) => (window.__QF_STATE__?.messages || []).slice(from).map(m => ({ role: m.role, kind: m.kind || null, content: String(m.content || '') })), msgBefore);
        const reply = rows.filter(r => r.role === 'assistant').map(r => r.content).join('\n\n');
        const err = rows.find(r => r.kind === 'error');
        const streaming = await page.evaluate(() => !!document.querySelector('.chat-stop-btn') || !!document.querySelector('.typing-indicator'));
        if (err) { errorLine = err.content; break; }
        if (reply && !streaming) { epilogue = reply; await delay(2500); break; }
    }
    const after = await snap(page);
    const button = await epilogueButton(page);
    const judge = epilogue ? await flash(`A solo fantasy RPG campaign has just ended with the hero's death (epitaph: ${JSON.stringify(s.epitaph)}). The player asked the DM "what became of them" — the people and places the hero leaves behind. Companions at the end: ${JSON.stringify(s.party)} (a former companion, Dunstan Reeve, had parted ways earlier). Open quests: ${JSON.stringify(s.quests)}. Judge the epilogue below. Return JSON {"per_companion": boolean (a paragraph or clear passage for each companion or former companion), "people": boolean (at least two other people with their attitude toward the hero), "quests": boolean (says what became of the open quests), "places": boolean (places a season later), "revives_hero": boolean (the hero is somehow alive or plays on — must be false), "events_feel": "one sentence", "stiff_or_machine_like": boolean (does the prose read stiff, generic, or mechanical rather than lived-in), "words": number}\n\nEPILOGUE:\n${epilogue.slice(0, 8000)}`) : null;
    const mechanicsMoved = JSON.stringify(after?.purse) !== JSON.stringify(s.purse) || JSON.stringify(after?.inventory) !== JSON.stringify(s.inventory);
    return { words: words(epilogue), secs: Math.round((Date.now() - t0) / 1000), disabledAfter: button.disabled, mechanicsMoved, errorLine, judge, text: epilogue };
}

(async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, userDataDir: PROFILE_DIR, args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1500,950'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    page.on('dialog', d => d.accept().catch(() => {}));
    page.on('pageerror', err => note('pageerror', String(err).slice(0, 300)));
    page.on('console', msg => { if (msg.type() === 'error' || /\[LLM Adapter\]/.test(msg.text())) note('console', `${msg.type()}: ${msg.text().slice(0, 240)}`); });
    const out = {};
    try {
        await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await delay(2500);
        const hasContinue = await page.evaluate(() => !!document.querySelector('.continue-btn'));
        note('resume', `Continue button: ${hasContinue}`);
        if (!hasContinue) throw new Error('no Continue button — is the preview serving the right profile?');
        await page.click('.continue-btn');
        await delay(4000);
        let s = await snap(page);
        out.onLoad = s;
        note('resume', `loaded: ${s?.msgCount} messages, hp ${s?.hp}, isDead ${s?.isDead}, combat ${JSON.stringify(s?.combat)}, epitaph ${s?.epitaph?.length}`);
        if (s?.combat) {
            // The engine's own exit: END_COMBAT on a dead hero writes the ☠ line and the epitaph.
            await page.evaluate(() => window.__QF_DISPATCH__?.({ type: 'END_COMBAT', payload: { defeat: true } }));
            await delay(2500);
            s = await snap(page);
            note('resume', `after END_COMBAT: combat ${JSON.stringify(s?.combat)}, isDead ${s?.isDead}, epitaph ${JSON.stringify(s?.epitaph)}, skull ${JSON.stringify(s?.skull)}`);
        }
        out.afterEnd = s;
        await delay(3000);
        const ending = await page.evaluate(() => ({ card: !!document.querySelector('.ending-card'), composer: !!document.querySelector('textarea.chat-input'), text: document.querySelector('.ending-card')?.innerText?.slice(0, 1500) || '' }));
        out.ending = ending;
        note('resume', `ending card ${ending.card}, composer gone ${!ending.composer}`);
        await page.screenshot({ path: path.join(OUT_DIR, 'resume-ending-card.png'), fullPage: true }).catch(() => {});
        if (!ending.card) throw new Error('no ending card');
        let button = await epilogueButton(page);
        if (button.disabled) {
            // A previous pass asked and the browser closed before the reply landed:
            // the request row stands unanswered. Soft-delete it (the card derives
            // "asked" from non-deleted rows) and ask again.
            const tail = await tailAfterDeath(page, s);
            out.tailBefore = tail;
            const request = [...tail].reverse().find(m => m.role === 'user' && !m.deleted && /My hero is dead and the story is over/.test(m.content));
            const answered = request && tail.some(m => m.role === 'assistant' && !m.deleted && tail.indexOf(m) > tail.indexOf(request));
            note('resume', `epilogue already asked; answered=${!!answered}; request id ${request?.id || 'none'}`);
            if (request && !answered) {
                await page.evaluate((id) => window.__QF_DISPATCH__?.({ type: 'DELETE_MESSAGE', payload: { id } }), request.id);
                await delay(1500);
                button = await epilogueButton(page);
                note('resume', `unanswered request soft-deleted; button disabled now: ${button.disabled}`);
            }
        }
        if (button.present && !button.disabled) {
            s = await snap(page);
            out.epilogue = await askEpilogue(page, s);
            note('resume', `epilogue: ${out.epilogue.words}w in ${out.epilogue.secs}s disabledAfter=${out.epilogue.disabledAfter} mechanicsMoved=${out.epilogue.mechanicsMoved} error=${JSON.stringify(out.epilogue.errorLine)} judge=${JSON.stringify(out.epilogue.judge)}`);
            await page.screenshot({ path: path.join(OUT_DIR, 'resume-epilogue.png'), fullPage: true }).catch(() => {});
        }
        await clickByText(page, '.ending-card button', 'Close the last chapter');
        await delay(1500);
        out.chronicleOpen = await page.evaluate(() => !!document.querySelector('.chronicle-write-btn') || /Chronicle/.test(document.querySelector('.journal-tab.active')?.textContent || ''));
        note('resume', `Close the last chapter opens the Chronicle: ${out.chronicleOpen}`);
        // Let the debounced autosave land before the browser closes.
        await delay(4000);
    } catch (err) {
        note('error', String(err).slice(0, 400));
        out.error = String(err);
    } finally {
        fs.writeFileSync(path.join(OUT_DIR, 'ending-resume.json'), JSON.stringify({ log, ...out }, null, 2));
        await browser.close().catch(() => {});
    }
})();
