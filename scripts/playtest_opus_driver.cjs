/**
 * The external-player driver (2026-10-27): a persistent browser session over
 * the PRODUCTION build, controlled through a tiny local HTTP API so a player
 * agent outside the process (Claude, playing turn by turn) writes every line,
 * rolls or challenges every check, and fights every round itself. The DM is a
 * real provider (Gemini Flash by default); the machinery is the app's own.
 *
 *   npm run build && npx vite preview --port 4173      (or the launch.json "quest-forge-preview")
 *   node scripts/playtest_opus_driver.cjs <label> [provider] [model]
 *
 * Env: QF_CLASS / QF_RACE / QF_NAME / QF_GENDER / QF_SKILLS (comma) /
 * QF_APPEARANCE / QF_PREMISE (the premise text) / QF_PORT (default 4777).
 *
 * API (localhost only, JSON):
 *   POST /say    { text }          type and send a line; waits for the turn and the background lanes
 *   POST /click  { text, scope?, twice? }  click the first <button> whose text includes `text` (scope = CSS selector; twice = click again 600 ms later, for the ✕ confirm)
 *   GET  /view                     what the player sees now: the newest rows, the check card, the fight
 *   GET  /debug                    the full engine snapshot (fronts, regions, tally, interlude …) — for JUDGING
 *   POST /reload                   autosave flush, reload, Continue
 *   POST /stop                     save everything and exit
 *
 * Output: test-results/opus-play/<label>/ — transcript.jsonl (every call and
 * its result), prompts/turn-NNN.txt (the DM system prompt + history rows the
 * provider received), scribe.jsonl, directors.jsonl, console.jsonl. Keys come
 * from .env and are never printed.
 */
const puppeteer = require('puppeteer-core');
const http = require('http');
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

const runLabel = process.argv[2];
const provider = process.argv[3] || 'gemini';
const model = process.argv[4] || 'gemini-3.8-flash';
if (!runLabel) {
    console.error('Usage: node scripts/playtest_opus_driver.cjs <label> [provider] [model]');
    process.exit(1);
}
if (provider === 'xai') {
    console.error('Grok is excluded from playtests by standing instruction (2026-09-14).');
    process.exit(1);
}
const GEMINI_API_KEY = envKey('GEMINI_API_KEY');
const dmKey = provider === 'openai' ? envKey('OPENAI_API_KEY') : GEMINI_API_KEY;
if (!dmKey || !GEMINI_API_KEY) {
    console.error('Missing API key(s) (env or .env).');
    process.exit(1);
}

const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:4173/?debugState=1';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.QF_PORT || 4777);
const OUT_DIR = path.resolve(`test-results/opus-play/${runLabel}`);
const PROMPT_DIR = path.join(OUT_DIR, 'prompts');
fs.mkdirSync(PROMPT_DIR, { recursive: true });

const HERO = {
    cls: process.env.QF_CLASS || 'Fighter',
    race: process.env.QF_RACE || 'Human',
    name: process.env.QF_NAME || 'Aino Halme',
    gender: process.env.QF_GENDER || 'woman',
    skills: (process.env.QF_SKILLS || 'Athletics,Perception').split(','),
    appearance: process.env.QF_APPEARANCE || 'Tall and broad-shouldered, pale skin weathered brown, dark hair cropped short.',
    premise: process.env.QF_PREMISE || '',
};

const delay = ms => new Promise(r => setTimeout(r, ms));
const append = (file, row) => fs.appendFileSync(path.join(OUT_DIR, file), `${JSON.stringify({ t: new Date().toISOString(), ...row })}\n`);

// ---------------------------------------------------------------------------
// Capture: every provider POST's system prompt + history rows; Scribe and
// director replies; console lines the app logs.
// ---------------------------------------------------------------------------
const captured = [];
const replyWatch = new WeakMap();

function attachCapture(page) {
    page.on('request', async (req) => {
        try {
            if (req.method() !== 'POST') return;
            const url = req.url();
            const isGemini = url.includes('generativelanguage.googleapis.com') && /:(stream)?generateContent/i.test(url);
            const isOpenAI = url.includes('api.openai.com/v1/chat/completions');
            if (!isGemini && !isOpenAI) return;
            let raw = req.postData();
            if (!raw && req.hasPostData()) raw = await req.fetchPostData();
            if (!raw) return;
            const body = JSON.parse(raw);
            let sys = '';
            let reqModel = '';
            if (isGemini) {
                sys = body.system_instruction?.parts?.map(p => p.text).join('\n') || '';
                reqModel = (url.match(/models\/([^:/?]+)/) || [])[1] || '';
            } else {
                const m = (body.messages || []).filter(x => x.role === 'system' || x.role === 'developer');
                sys = m.map(x => (typeof x.content === 'string' ? x.content : JSON.stringify(x.content || ''))).join('\n');
                reqModel = body.model || '';
            }
            const rows = isGemini
                ? (body.contents || []).map(c => ({ role: c.role, text: (c.parts || []).map(x => x.text || '').join('') }))
                : (body.messages || []).filter(x => x.role !== 'system' && x.role !== 'developer').map(x => ({ role: x.role, text: typeof x.content === 'string' ? x.content : JSON.stringify(x.content || '') }));
            const director = /private (wonder|living-world|front|doom|aftermath|absence)[\w -]*director/i.test(sys) || /private living-world director/i.test(sys);
            const scribe = /location_profile/.test(sys);
            const kind = reqModel === model && sys.length > 2000 && !director && !scribe ? 'dm' : (director ? 'director' : (scribe ? 'scribe' : 'machinery'));
            const entry = { t: Date.now(), kind, model: reqModel, sys, rows };
            captured.push(entry);
            if (kind === 'director' || kind === 'scribe') replyWatch.set(req, kind);
        } catch { /* best-effort */ }
    });
    page.on('response', async (resp) => {
        try {
            const kind = replyWatch.get(resp.request());
            if (!kind) return;
            const text = await resp.text();
            let inner = text;
            try {
                const j = JSON.parse(text);
                inner = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || j.choices?.[0]?.message?.content || text;
            } catch { /* keep raw */ }
            append(kind === 'scribe' ? 'scribe.jsonl' : 'directors.jsonl', { text: String(inner).slice(0, 8000) });
        } catch { /* best-effort */ }
    });
    page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error' || msg.type() === 'warning' || msg.type() === 'warn'
            || /\[LLM timing\]|\[ResponseParser\]|\[Scribe\]|\[Journal\]|\[Wonder\]|\[Fronts\]|\[Recall\]|\[Memory\]|\[LivingWorld\]|\[applyEvents\]/.test(text)) {
            append('console.jsonl', { type: msg.type(), text: text.slice(0, 600) });
        }
    });
    page.on('pageerror', err => append('console.jsonl', { type: 'pageerror', text: String(err).slice(0, 600) }));
}

// ---------------------------------------------------------------------------
// DOM / state helpers
// ---------------------------------------------------------------------------
async function clickByText(page, text, scope = 'button') {
    return await page.evaluate(({ text, scope }) => {
        const pool = Array.from(document.querySelectorAll(scope === 'button' ? 'button' : `${scope} button, ${scope}`));
        const el = pool.find(e => e.tagName === 'BUTTON' && !e.disabled && e.textContent.includes(text)) || pool.find(e => e.textContent.includes(text));
        if (el) { el.click(); return el.textContent.trim().slice(0, 80); }
        return null;
    }, { text, scope });
}
async function reactFill(page, matcherSrc, value) {
    return await page.evaluate(({ matcherSrc, value }) => {
        const matcher = new Function('el', `return (${matcherSrc})(el);`);
        const el = Array.from(document.querySelectorAll('input, textarea')).find(e => matcher(e));
        if (!el) return false;
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }, { matcherSrc, value });
}
async function expectOnScreen(page, marker, label) {
    const ok = await page.evaluate((m) => document.body.innerText.includes(m), marker);
    if (!ok) throw new Error(`Expected "${marker}" on screen at "${label}".`);
}

async function msgCount(page) {
    return await page.evaluate(() => (window.__QF_STATE__?.messages || []).length).catch(() => 0);
}

/** The player's view: the rows since `from`, the check card, the fight, the hero line. */
async function view(page, from = null) {
    return await page.evaluate((from) => {
        const s = window.__QF_STATE__;
        if (!s) return null;
        const all = s.messages || [];
        const start = from === null ? Math.max(0, all.length - 6) : from;
        const rows = all.slice(start).map((m, i) => ({ i: start + i, role: m.role, kind: m.kind || null, hidden: !!m.hidden, deleted: !!m.deleted, content: m.content }))
            .filter(m => !m.hidden && !m.deleted);
        const c = s.character || {};
        const checkPanel = document.querySelector('.roleplay-check-panel');
        const returnCard = document.querySelector('.return-card');
        const endingCard = document.querySelector('.ending-card');
        const buttons = Array.from(document.querySelectorAll('.roleplay-check-panel button, .combat-panel button, .return-card button, .ending-card button, .chat-send-btn'))
            .map(b => b.textContent.trim()).filter(Boolean).slice(0, 20);
        return {
            msgCount: all.length,
            rows,
            hero: `${c.name} L${c.level} ${c.race}/${c.class} HP ${c.currentHP}/${c.maxHP} AC ${c.armorClass} XP ${c.exp} purse ${c.gold}g ${c.silver}s ${c.copper}c${(c.conditions || []).length ? ` cond: ${c.conditions.join(', ')}` : ''}${c.dying ? ' DYING' : ''}${c.isDead ? ' DEAD' : ''}`,
            slots: c.spellSlots || null,
            location: s.currentLocation || null,
            party: (s.party || []).map(p => `${p.name} (${p.status || '?'} ${p.currentHP ?? p.hp ?? '?'}/${p.maxHP ?? p.maxHp ?? '?'})`),
            quests: (s.quests || []).filter(q => !['completed', 'failed'].includes(q.status)).map(q => q.name),
            inventory: (s.inventory || []).map(i => `${i.name}×${i.quantity ?? 1}${i.equipped ? '*' : ''}`),
            check: checkPanel ? checkPanel.innerText.slice(0, 1200) : null,
            combat: s.combat?.active ? {
                phase: s.combat.phase,
                round: s.combat.round,
                enemies: (s.combat.enemies || []).map(e => `${e.id}: ${e.name} hp ${e.hp}/${e.maxHp ?? '?'} ${e.condition || ''} ${e.combatStatus || ''} ${(e.conditions || []).join(',')}`),
            } : null,
            returnCard: returnCard ? returnCard.innerText.slice(0, 1500) : null,
            endingCard: endingCard ? endingCard.innerText.slice(0, 1500) : null,
            buttons,
        };
    }, from).catch(e => ({ error: String(e) }));
}

/** The judge's view: the engine's private state, compact. */
async function debugSnap(page) {
    return await page.evaluate(() => {
        const s = window.__QF_STATE__;
        if (!s) return null;
        return {
            msgCount: (s.messages || []).length,
            location: s.currentLocation,
            locations: (s.locations || []).map(r => ({ name: r.name, region: r.region || null, type: r.type || null, danger: r.danger || null, signature: r.signature || null, lastState: r.lastState || null, archetype: r.archetype || null, motifs: r.motifs || [], visits: r.visitCount ?? null, links: (r.links || []).length })),
            regions: s.regions || {},
            worldMotifs: s.worldMotifs || {},
            fronts: (s.fronts || []).map(f => ({ id: f.id, title: f.title, status: f.status, clock: f.clock, maxClock: f.maxClock, stage: f.stage, faction: f.faction?.name, hints: (f.publicHints || []).length })),
            worldTempo: s.worldTempo || null,
            session: {
                interlude: s.session?.interlude || null,
                interludedRegions: s.session?.interludedRegions || [],
                regionFaceAttempts: s.session?.regionFaceAttempts || [],
                seededRegions: s.session?.seededRegions || [],
                pendingRegionalFronts: s.session?.pendingRegionalFronts || null,
                pendingWonder: s.session?.pendingWonder || null,
                wonder: s.session?.wonder || null,
                relationshipBeat: s.session?.relationshipBeat || null,
                heroTellBeat: s.session?.heroTellBeat || null,
                directorFailures: s.session?.directorFailures || {},
                relationshipBeatMode: s.session?.relationshipBeat?.mode || null,
            },
            party: (s.party || []).map(p => ({ name: p.name, status: p.status, hp: p.currentHP ?? p.hp, goals: p.goals || null, agenda: p.agenda || null, keepsakes: p.keepsakes || [] })),
            npcs: (s.npcs || []).map(n => ({ name: n.name, tier: n.rosterTier || null, disposition: n.disposition, stance: n.stanceToPlayer || null, openThread: n.openThread || null, moments: (n.bondMoments || []).length, basedIn: n.basedIn || null, looks: (n.appearance || '').slice(0, 120) })),
            facts: (s.worldFacts || []).map(f => ({ fact: f.fact, aspect: f.aspect || null, pinned: !!f.pinned, superseded: !!f.supersededBy, retracted: !!f.retractedAtMessage })),
            cards: (s.storyMemory || []).map(c => ({ id: c.id, type: c.type, status: c.status, salience: c.salience, subject: c.subject, text: String(c.text || '').slice(0, 200), used: c.usedCount || 0 })),
            heroTells: (s.heroTells || []).map(t => ({ kind: t.kind, text: t.text, scenes: (t.sightings || []).length, voiced: t.voicedCount || 0, dormant: !!t.dormant })),
            quests: (s.quests || []).map(q => ({ name: q.name, status: q.status })),
            journal: (s.journal || []).map(j => ({ range: j.messageRange, summary: String(j.summary || '').slice(0, 300), location: j.location || null })),
            recentEncounters: s.recentEncounters || [],
            chronicle: (s.chronicle || []).length,
        };
    }).catch(e => ({ error: String(e) }));
}

async function waitForIdle(page, { timeout = 420000 } = {}) {
    const start = Date.now();
    let calm = 0;
    while (Date.now() - start < timeout) {
        const busy = await page.evaluate(() => {
            const loading = !!document.querySelector('.chat-stop-btn') || !!document.querySelector('.typing-indicator');
            const s = window.__QF_STATE__;
            const combatBusy = !!(s?.combat?.active && ['opening', 'awaiting_intent', 'awaiting_narration'].includes(s.combat.phase));
            const queued = !!(s?.combat?.active && s.combat.queuedExchange);
            return loading || combatBusy || queued;
        }).catch(() => true);
        if (!busy) { calm++; if (calm >= 2) return true; } else { calm = 0; }
        await delay(1500);
    }
    return false;
}

/** The background lanes (Scribe, journal cadence, directors) after a turn: quiet for `quietMs`. */
async function settleBackground(page, { quietMs = 8000, maxMs = 90000 } = {}) {
    const start = Date.now();
    let last = '';
    let lastChange = Date.now();
    while (Date.now() - start < maxMs) {
        const sig = await page.evaluate(() => {
            const s = window.__QF_STATE__;
            if (!s) return 'x';
            return JSON.stringify([(s.messages || []).length, (s.worldFacts || []).length, (s.storyMemory || []).length, (s.npcs || []).length, (s.journal || []).length,
                (s.locations || []).length, Object.keys(s.regions || {}).length, s.session?.pendingRegionalFronts?.key || null, s.session?.pendingWonder?.key || null,
                s.session?.interlude?.key || null, (s.fronts || []).length]);
        }).catch(() => 'x');
        if (sig !== last) { last = sig; lastChange = Date.now(); }
        if (Date.now() - lastChange >= quietMs) return;
        await delay(2000);
    }
}

// A continued run keeps numbering where the transcript left off.
let turnNo = (() => { try { return fs.readFileSync(path.join(OUT_DIR, 'transcript.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).length; } catch { return 0; } })();
function dumpPrompts(sinceMs) {
    const dm = captured.filter(c => c.t >= sinceMs && c.kind === 'dm');
    if (!dm.length) return 0;
    const lines = [];
    dm.forEach((c, n) => {
        lines.push(`===== DM CALL ${n + 1} (${c.model}) — system ${c.sys.length} chars =====`, c.sys, '', '===== HISTORY ROWS =====');
        for (const r of c.rows) lines.push(`--- ${r.role} ---`, r.text);
        lines.push('');
    });
    fs.writeFileSync(path.join(PROMPT_DIR, `turn-${String(turnNo).padStart(3, '0')}.txt`), lines.join('\n'));
    return dm.length;
}

async function act(page, kind, fn) {
    turnNo += 1;
    const from = await msgCount(page);
    const t0 = Date.now();
    const meta = await fn();
    await delay(1200);
    await waitForIdle(page);
    await settleBackground(page);
    const result = await view(page, from);
    const calls = dumpPrompts(t0);
    const out = { turn: turnNo, kind, ...meta, secs: Math.round((Date.now() - t0) / 1000), dmCalls: calls, view: result };
    append('transcript.jsonl', out);
    return out;
}

// ---------------------------------------------------------------------------
// Boot + wizard
// ---------------------------------------------------------------------------
async function bootAndCreateHero(page) {
    await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(1500);
    await page.evaluate(({ providerName, modelName, key, geminiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: providerName, apiKey: key, geminiApiKey: geminiKey, imageApiKey: '',
            model: modelName, memoryInspector: true, paceDial: 'standard',
        }));
    }, { providerName: provider, modelName: model, key: dmKey, geminiKey: GEMINI_API_KEY });
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(1500);
    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(1000);
    await page.click('.creation-card');
    await delay(800);
    await page.waitForSelector('.creation-input');
    if (!await reactFill(page, `el => (el.placeholder || '').startsWith('Enter your character')`, HERO.name)) throw new Error('Name input not found.');
    await reactFill(page, `el => (el.placeholder || '').startsWith('Gender')`, HERO.gender);
    await reactFill(page, `el => (el.placeholder || '').startsWith('Appearance')`, HERO.appearance);
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Choose your race', 'after identity');
    await clickByText(page, HERO.race, '.creation-card');
    await delay(300);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Choose your class', 'after race');
    await clickByText(page, HERO.cls, '.creation-card');
    await delay(300);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Assign ability scores', 'after class');
    await clickByText(page, 'Use this spread');
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Choose your skills', 'after stats');
    for (const sk of HERO.skills) { await clickByText(page, sk, '.skill-choice-card'); await delay(250); }
    // A Rogue's skills step grows an EXPERTISE grid once every skill is picked (2026-10-30:
    // the driver stalled at the hero reveal for a Rogue) — the first two chosen skills, by name.
    if (await page.$('.expertise-selection')) {
        for (const sk of HERO.skills.slice(0, 2)) { await clickByText(page, sk, '.expertise-selection'); await delay(250); }
    }
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await expectOnScreen(page, 'stands ready', 'hero reveal');
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Set the stage', 'premise step');
    if (HERO.premise && !await reactFill(page, `el => el.tagName === 'TEXTAREA' && (el.placeholder || '').startsWith('Exiled from the city')`, HERO.premise)) {
        throw new Error('Premise textarea not found.');
    }
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
(async () => {
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        userDataDir: path.join(OUT_DIR, 'profile'),
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1500,950'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    page.on('dialog', d => d.accept().catch(() => {}));
    attachCapture(page);

    let queue = Promise.resolve();
    const serial = fn => (queue = queue.then(fn, fn));

    // QF_LOAD_JSON=<path>: boot with the test settings and LOAD_GAME an
    // exported campaign (the ?debugState=1 dispatch hook) — a heal's check.
    const opening = process.env.QF_LOAD_JSON
        ? await act(page, 'load-json', async () => {
            await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
            await delay(1500);
            await page.evaluate(({ providerName, modelName, key, geminiKey }) => {
                localStorage.setItem('rpg-client-settings', JSON.stringify({
                    llmProvider: providerName, apiKey: key, geminiApiKey: geminiKey, imageApiKey: '',
                    model: modelName, memoryInspector: true, paceDial: 'standard',
                }));
            }, { providerName: provider, modelName: model, key: dmKey, geminiKey: GEMINI_API_KEY });
            await page.reload({ waitUntil: 'networkidle2' });
            await delay(2000);
            const payload = fs.readFileSync(path.resolve(process.env.QF_LOAD_JSON), 'utf8');
            const loaded = await page.evaluate((json) => {
                if (typeof window.__QF_DISPATCH__ !== 'function') return false;
                window.__QF_DISPATCH__({ type: 'LOAD_GAME', payload: JSON.parse(json) });
                return true;
            }, payload);
            await delay(8000);
            return { loaded };
        })
        : process.env.QF_CONTINUE === '1'
        ? await act(page, 'continue', async () => {
            await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
            await delay(2500);
            const hasContinue = await page.evaluate(() => !!document.querySelector('.continue-btn'));
            if (hasContinue) await page.click('.continue-btn');
            await delay(3000);
            return { hasContinue };
        })
        : await act(page, 'opening', async () => { await bootAndCreateHero(page); return { hero: HERO }; });
    console.log(`[driver] opening done in ${opening.secs}s — listening on http://127.0.0.1:${PORT}`);

    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => serial(async () => {
            const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj, null, 1)); };
            try {
                const input = body ? JSON.parse(body) : {};
                if (req.method === 'POST' && req.url === '/say') {
                    const text = String(input.text || '').trim();
                    if (!text) return send(400, { error: 'text required' });
                    return send(200, await act(page, 'say', async () => {
                        const filled = await reactFill(page, `el => el.matches('textarea.chat-input')`, text);
                        await delay(300);
                        const sent = filled && await page.evaluate(() => {
                            const btn = document.querySelector('button.chat-send-btn');
                            if (btn && !btn.disabled) { btn.click(); return true; }
                            return false;
                        });
                        return { text, sent };
                    }));
                }
                if (req.method === 'POST' && req.url === '/click') {
                    // `twice: true` clicks again 600 ms later — the chat row's two-click ✕ confirm
                    // resets after 4 s, longer than one /click's settle (2026-10-30 run).
                    return send(200, await act(page, 'click', async () => {
                        const clicked = await clickByText(page, String(input.text || ''), input.scope || 'button');
                        let second = null;
                        if (input.twice) { await delay(600); second = await clickByText(page, String(input.text || ''), input.scope || 'button'); }
                        return { clicked, second, wanted: input.text };
                    }));
                }
                if (req.method === 'POST' && req.url === '/fill') {
                    // Fill the first input / textarea inside `scope` (default: the check panel) — the challenge reason box.
                    const scope = input.scope || '.roleplay-check-panel';
                    const ok = await page.evaluate(({ scope, value }) => {
                        const el = document.querySelector(`${scope} textarea, ${scope} input[type=text], ${scope} input:not([type])`);
                        if (!el) return false;
                        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        return true;
                    }, { scope, value: String(input.text || '') });
                    return send(200, { filled: ok, view: await view(page) });
                }
                if (req.method === 'GET' && req.url.startsWith('/view')) return send(200, await view(page));
                if (req.method === 'GET' && req.url.startsWith('/debug')) {
                    const snapshot = await debugSnap(page);
                    append('debug.jsonl', { turn: turnNo, snapshot });
                    return send(200, snapshot);
                }
                if (req.method === 'POST' && req.url === '/reload') {
                    return send(200, await act(page, 'reload', async () => {
                        await delay(4000);
                        await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))).catch(() => {});
                        await delay(1500);
                        await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
                        await delay(2500);
                        const hasContinue = await page.evaluate(() => !!document.querySelector('.continue-btn'));
                        if (hasContinue) await page.click('.continue-btn');
                        await delay(3000);
                        return { hasContinue };
                    }));
                }
                if (req.method === 'POST' && req.url === '/stop') {
                    append('debug.jsonl', { turn: turnNo, final: await debugSnap(page) });
                    const full = await page.evaluate(() => {
                        const s = window.__QF_STATE__;
                        return s ? JSON.stringify({ ...s, messages: s.messages }) : null;
                    }).catch(() => null);
                    if (full) fs.writeFileSync(path.join(OUT_DIR, 'final-state.json'), full);
                    send(200, { ok: true });
                    setTimeout(async () => { await browser.close(); process.exit(0); }, 500);
                    return undefined;
                }
                return send(404, { error: 'unknown route' });
            } catch (e) {
                return send(500, { error: String(e?.stack || e).slice(0, 2000) });
            }
        }));
    });
    server.listen(PORT, '127.0.0.1');
})().catch((e) => {
    console.error('[driver] fatal:', e);
    process.exit(1);
});
