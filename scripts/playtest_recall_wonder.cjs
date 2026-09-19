/**
 * Real-provider playtest for the two 2026-09-18 features (DECISIONS.md ×2):
 *
 *   PROBE 1 — "remember when…" answered from the RECORD (llm/recallIntent.js +
 *             engine/recallDossier.js + the orchestrator's recall lane).
 *   PROBE 2 — the wonder die (engine/wonder.js + llm/wonderDirector.js).
 *
 *   node scripts/playtest_recall_wonder.cjs recall gemini gemini gemini-3.1-pro-preview
 *   node scripts/playtest_recall_wonder.cjs wonder gemini gemini gemini-3.1-pro-preview
 *   node scripts/playtest_recall_wonder.cjs wonder terra  openai gpt-5.6-terra
 *
 * Never the xAI/Grok DM (Vesa, 2026-09-14) — Gemini Pro and GPT Terra only.
 * The Gemini Flash machinery (Scribe, journal, embeddings) is identical in every
 * run; Flash is ALSO the script's own ground-truth extractor and judge.
 *
 * Requires `npm run build && npx vite preview --port 4173` (the production
 * build: the dev server's devSettingsSeed would override the injected provider
 * settings). Keys come from .env / the environment, are injected into
 * localStorage, and are never printed. Output: test-results/recall-wonder/<label>/
 * (log.json, turns.json, results.json, transcript.json, screenshots).
 *
 * How the harness sees inside the app without touching source:
 *   - window.__QF_STATE__  (?debugState=1) — live state minus settings/user.
 *   - Puppeteer request capture — every DM / wonder-director / machinery POST's
 *     system prompt is recorded, so "## THE RECORD" and "## SOMETHING STRANGE
 *     ARRIVES" are checked in the prompt the provider actually received. The
 *     director's own response is captured too (all hooks, not only the die's pick).
 *   - The Memory Inspector modal (Settings memoryInspector flag) — the recall
 *     dossier lines the engine assembled.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function envKey(name) {
    try {
        const match = fs.readFileSync(path.resolve('.env'), 'utf8')
            .match(new RegExp(`${name}\\s*=\\s*["']?([^"'\\r\\n]+)`));
        if (match) return match[1];
    } catch { /* fall through */ }
    return process.env[name] || '';
}

const GEMINI_API_KEY = envKey('GEMINI_API_KEY');
const OPENAI_API_KEY = envKey('OPENAI_API_KEY');

const PROBE = process.argv[2];
const runLabel = process.argv[3];
const provider = process.argv[4];
const model = process.argv[5];
if (!['recall', 'wonder'].includes(PROBE) || !runLabel || !provider || !model) {
    console.error('Usage: node scripts/playtest_recall_wonder.cjs <recall|wonder> <label> <provider> <model>');
    process.exit(1);
}
if (provider === 'xai') {
    console.error('Grok is excluded from playtests by standing instruction (2026-09-14).');
    process.exit(1);
}
const dmKey = provider === 'openai' ? OPENAI_API_KEY : GEMINI_API_KEY;
if (!dmKey || !GEMINI_API_KEY) {
    console.error('Missing API key(s) (env or .env): DM provider key + GEMINI_API_KEY for machinery.');
    process.exit(1);
}

const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:4173/?debugState=1';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROXY_ARGS = process.env.HTTPS_PROXY
    ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--ssl-version-max=tls1.2']
    : [];
const OUT_DIR = path.resolve(`test-results/recall-wonder/${runLabel}`);
const PROFILE_DIR = path.join(OUT_DIR, 'profile');
const JUDGE_MODEL = 'gemini-3.7-flash';

fs.mkdirSync(OUT_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
const notes = [];
function note(kind, message, extra = {}) {
    notes.push({ t: new Date().toISOString(), kind, message, ...extra });
    console.log(`[${kind}] ${String(message).slice(0, 260)}`);
}
const turns = [];
const results = [];
function saveAll() {
    fs.writeFileSync(path.join(OUT_DIR, 'log.json'), JSON.stringify(notes, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'turns.json'), JSON.stringify(turns, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
}
async function shot(page, name) {
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Flash: ground-truth extractor + judge (the script's own machinery; key never printed)
// ---------------------------------------------------------------------------
async function flash(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent`;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
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
            if (attempt === 3) { note('judge-fail', String(err).slice(0, 200)); return null; }
            await delay(2500 * (attempt + 1));
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Request / response / console capture
// ---------------------------------------------------------------------------
const captured = [];      // { t, kind: 'dm'|'director'|'machinery', model, sys }
const directorOutputs = []; // raw director responses (all hooks)
const consoleLines = [];  // { t, text }
const directorRequests = new WeakSet();

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
                const m = (body.messages || []).find(x => x.role === 'system' || x.role === 'developer');
                sys = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content || '');
                reqModel = body.model || '';
            }
            const director = /private wonder director/i.test(sys);
            const kind = director ? 'director' : (reqModel === model ? 'dm' : 'machinery');
            if (director) directorRequests.add(req);
            captured.push({ t: Date.now(), kind, model: reqModel, sys });
        } catch { /* capture is best-effort */ }
    });
    page.on('response', async (resp) => {
        try {
            if (!directorRequests.has(resp.request())) return;
            const text = await resp.text();
            let inner = text;
            try {
                const j = JSON.parse(text);
                inner = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('')
                    || j.choices?.[0]?.message?.content || text;
            } catch { /* keep raw */ }
            directorOutputs.push({ t: Date.now(), text: String(inner).slice(0, 6000) });
        } catch { /* best-effort */ }
    });
    page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error' || msg.type() === 'warning'
            || /\[LLM timing\]|\[ResponseParser\]|\[Scribe\]|\[Journal\]|\[Wonder\]|\[Fronts\]|\[Recall\]|\[Memory\]/.test(text)) {
            consoleLines.push({ t: Date.now(), text: text.slice(0, 300) });
            if (/\[Wonder\]|pageerror/i.test(text) || msg.type() === 'error') note('console', `${msg.type()}: ${text.slice(0, 260)}`);
        }
    });
    page.on('pageerror', err => note('pageerror', String(err).slice(0, 300)));
}

/** The prompt the provider received for the newest DM turn since `sinceMs`. */
function dmPromptSince(sinceMs) {
    const dm = captured.filter(c => c.kind === 'dm' && c.t >= sinceMs && c.sys.length > 2000);
    return dm.length ? dm[dm.length - 1].sys : '';
}
function recordBlockOf(sys) {
    const at = sys.indexOf('## THE RECORD');
    if (at === -1) return '';
    return sys.slice(at, at + 3500);
}

// ---------------------------------------------------------------------------
// DOM / state helpers (the geography playtest pattern)
// ---------------------------------------------------------------------------
async function clickByText(page, selector, text) {
    return await page.evaluate(({ selector, text }) => {
        const el = Array.from(document.querySelectorAll(selector)).find(e => e.textContent.includes(text));
        if (el) { el.click(); return true; }
        return false;
    }, { selector, text });
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
    if (!ok) {
        const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
        throw new Error(`Expected "${marker}" on screen at step "${label}" — got: ${body}`);
    }
}

/** Compact live snapshot: everything the checks need, never settings/keys. */
async function snap(page) {
    return await page.evaluate(() => {
        const s = window.__QF_STATE__;
        if (!s) return null;
        const msgs = (s.messages || []).map(m => ({ role: m.role, kind: m.kind || null, hidden: !!m.hidden, deleted: !!m.deleted }));
        const c = s.character || {};
        return {
            msgCount: msgs.length,
            lastAssistantIdx: (() => { for (let i = (s.messages || []).length - 1; i >= 0; i--) { const m = s.messages[i]; if (m.role === 'assistant' && !m.hidden && !m.deleted && typeof m.content === 'string' && m.content.trim()) return i; } return -1; })(),
            messages: msgs,
            location: s.currentLocation,
            purse: { gold: c.gold ?? null, silver: c.silver ?? null, copper: c.copper ?? null },
            exp: c.exp ?? null,
            level: c.level ?? null,
            hp: c.currentHP ?? null,
            maxHp: c.maxHP ?? null,
            inventory: (s.inventory || []).map(i => `${i.name}×${i.quantity ?? 1}${i.equipped ? '*' : ''}`).sort(),
            rollHistoryLen: (s.rollHistory || []).length,
            pendingCheck: s.pendingRoleplayCheck
                ? { rolls: (s.pendingRoleplayCheck.rolls || []).map(r => `${r.skill || r.type} DC ${r.dc}`) } : null,
            combat: s.combat?.active ? {
                phase: s.combat.phase,
                enemies: (s.combat.enemies || []).map(e => ({ n: e.name, hp: e.hp, st: e.combatStatus, cond: e.condition })),
                queued: !!s.combat.queuedExchange,
            } : null,
            counts: {
                worldFacts: (s.worldFacts || []).length,
                storyMemory: (s.storyMemory || []).length,
                npcs: (s.npcs || []).length,
                journal: (s.journal || []).length,
                quests: (s.quests || []).length,
                chronicle: (s.chronicle || []).length,
            },
            npcNames: (s.npcs || []).map(n => n.name),
            cards: (s.storyMemory || []).map(card => ({ id: card.id, type: card.type, salience: card.salience, status: card.status, firstSeenMessage: card.firstSeenMessage ?? null, subject: card.subject, text: String(card.text || '').slice(0, 160), tags: card.tags || [] })),
            questRows: (s.quests || []).map(q => ({ name: q.name, status: q.status, openedAtMessage: q.openedAtMessage ?? null })),
            wonderCards: (s.storyMemory || []).filter(card => (card.tags || []).includes('wonder'))
                .map(card => ({ subject: card.subject, status: card.status, text: card.text, tags: card.tags })),
            // shape measureLull / shouldRequestWonder read
            forEngine: {
                messages: msgs,
                recentEncounters: s.recentEncounters || [],
                quests: (s.quests || []).map(q => ({ openedAtMessage: q.openedAtMessage })),
                storyMemory: (s.storyMemory || []).map(card => ({ salience: card.salience, firstSeenMessage: card.firstSeenMessage })),
                fronts: (s.fronts || []).map(f => ({ id: f.id, status: f.status, clock: f.clock, stage: f.stage, resolvedAtMessage: f.resolvedAtMessage, portentStage: f.portentStage })),
                worldTempo: s.worldTempo || null,
                session: { pendingWonder: s.session?.pendingWonder || null, wonder: s.session?.wonder || null, lastWonderMessage: s.session?.lastWonderMessage ?? null },
                combat: { active: !!s.combat?.active },
                character: c,
                recentChecks: s.recentChecks || [],
            },
            pendingWonder: s.session?.pendingWonder || null,
            wonder: s.session?.wonder || null,
            lastWonderMessage: s.session?.lastWonderMessage ?? null,
            recordReceipts: (s.messages || []).map((m, i) => ({ i, kind: m.kind, content: m.content })).filter(m => m.kind === 'record'),
        };
    }).catch(() => null);
}

async function lastDmMessage(page) {
    return await page.evaluate(() => {
        const list = (window.__QF_STATE__?.messages || [])
            .filter(m => m.role === 'assistant' && !m.hidden && !m.deleted && typeof m.content === 'string');
        return list.length ? list[list.length - 1].content : '';
    }).catch(() => '');
}
async function dmMessagesSince(page, fromIndex) {
    return await page.evaluate((from) => (window.__QF_STATE__?.messages || [])
        .slice(from).filter(m => m.role === 'assistant' && !m.hidden && !m.deleted && typeof m.content === 'string')
        .map(m => m.content), fromIndex).catch(() => []);
}

async function waitForIdle(page, { timeout = 300000 } = {}) {
    const start = Date.now();
    let calm = 0;
    let retriesUsed = 0;
    while (Date.now() - start < timeout) {
        const status = await page.evaluate(() => {
            const loading = !!document.querySelector('.chat-stop-btn') || !!document.querySelector('.typing-indicator');
            const s = window.__QF_STATE__;
            const combatBusy = !!(s?.combat?.active && ['opening', 'awaiting_intent', 'awaiting_narration'].includes(s.combat.phase));
            const queued = !!(s?.combat?.active && s.combat.queuedExchange);
            const retryBtn = Array.from(document.querySelectorAll('.chat-send-btn')).some(b => b.textContent.includes('Retry'));
            return { busy: loading || combatBusy || queued, retryBtn, loading };
        }).catch(() => ({ busy: true, retryBtn: false, loading: false }));
        if (status.retryBtn && !status.loading && retriesUsed < 3) {
            retriesUsed++;
            note('retry', `Retry button visible — clicking (attempt ${retriesUsed}).`);
            await clickByText(page, '.chat-send-btn', 'Retry');
            await delay(2000);
            continue;
        }
        if (!status.busy) { calm++; if (calm >= 2) return true; } else { calm = 0; }
        await delay(2000);
    }
    note('warn', `waitForIdle timed out after ${Math.round((Date.now() - start) / 1000)}s.`);
    return false;
}

/**
 * The background lanes (Scribe, journal cadence, wonder director) run after the
 * turn settles. Wait until the observable background state has been quiet for
 * `quietMs`; when a wonder request is pending, keep waiting (up to
 * `directorWaitMs`) for the director's install so the turn it lands on is exact.
 */
async function settleBackground(page, { quietMs = 9000, maxMs = 60000, directorWaitMs = 150000 } = {}) {
    const start = Date.now();
    let last = '';
    let lastChange = Date.now();
    while (true) {
        const s = await snap(page);
        const sig = s ? JSON.stringify([s.counts, s.pendingWonder?.key || null, s.wonder?.key || null, s.msgCount]) : 'x';
        if (sig !== last) { last = sig; lastChange = Date.now(); }
        const quiet = Date.now() - lastChange >= quietMs;
        const pending = !!s?.pendingWonder && !s?.wonder;
        const elapsed = Date.now() - start;
        if (quiet && !(pending && elapsed < directorWaitMs)) return s;
        if (elapsed > (pending ? directorWaitMs : maxMs)) return s;
        await delay(2500);
    }
}

async function typeAndSend(page, text) {
    const filled = await reactFill(page, `el => el.matches('textarea.chat-input')`, text);
    if (!filled) { note('warn', 'Chat input not found.'); return; }
    await delay(400);
    const sent = await page.evaluate(() => {
        const btn = document.querySelector('button.chat-send-btn');
        if (btn && !btn.disabled) { btn.click(); return true; }
        return false;
    });
    if (!sent) note('warn', 'Send button not found/clickable.');
}

async function handleProposal(page) {
    let s = await snap(page);
    if (!s?.pendingCheck) return false;
    for (let i = 0; i < 4; i++) {
        note('proposal', `Check proposed: ${s.pendingCheck.rolls.join('; ')} — rolling.`);
        await clickByText(page, '.roleplay-check-panel button', 'Roll');
        await waitForIdle(page);
        s = await snap(page);
        if (!s?.pendingCheck) break;
    }
    return true;
}

async function resolveCombat(page, maxIters = 14) {
    for (let i = 0; i < maxIters; i++) {
        const s = await snap(page);
        if (!s?.combat) return i;
        if (s.combat.phase === 'awaiting_player') {
            const target = s.combat.enemies.find(e => e.st === 'active' && (e.hp ?? 0) > 0 && e.cond !== 'dead');
            if (!target) {
                const ended = await clickByText(page, 'button', 'End Combat');
                note('combat', ended ? 'Clicked End Combat.' : 'No living enemies and no End Combat button; waiting.');
                await waitForIdle(page);
                continue;
            }
            const action = `I attack the ${target.n} with my longsword.`;
            note('combat', `${action} (enemy hp ${target.hp})`);
            await typeAndSend(page, action);
            await waitForIdle(page);
        } else {
            await waitForIdle(page);
        }
    }
    note('warn', 'Combat did not resolve within iteration budget.');
    return maxIters;
}

let turnNo = 0;
/**
 * One full turn: send, wait, proposals, combat, background settle. Returns the
 * before/after snapshots, the DM reply, and the prompt the provider received.
 */
async function playTurn(page, label, action, { settle = {} } = {}) {
    turnNo += 1;
    const before = await snap(page);
    const t0 = Date.now();
    const consoleFrom = consoleLines.length;
    note('turn', `#${turnNo} ${label}: "${action.slice(0, 200)}"`);
    await typeAndSend(page, action);
    await waitForIdle(page);
    await handleProposal(page);
    const combatIters = (await snap(page))?.combat ? await resolveCombat(page) : 0;
    let after = await settleBackground(page, settle);
    // Infrastructure guard (2026-09-19): a provider outage (HTTP 402 across every
    // Gemini call for ~13 minutes) leaves the turn without a NEW DM message, and
    // reading "the last assistant message" then re-scores the PREVIOUS reply as if it
    // were the answer. Detect it, back off, and resend — a failed turn never counts.
    let infraRetries = 0;
    const beforeIdx = before?.lastAssistantIdx ?? -1;
    while ((after?.lastAssistantIdx ?? -1) <= beforeIdx && infraRetries < 4) {
        infraRetries += 1;
        note('infra', `Turn #${turnNo} produced no new DM message (provider outage?) — backing off 75s, resend ${infraRetries}/4.`);
        await delay(75000);
        await typeAndSend(page, action);
        await waitForIdle(page);
        await handleProposal(page);
        if ((await snap(page))?.combat) await resolveCombat(page);
        after = await settleBackground(page, settle);
    }
    const dmFresh = (after?.lastAssistantIdx ?? -1) > beforeIdx;
    const dm = dmFresh ? await lastDmMessage(page) : '';
    const sys = dmPromptSince(t0);
    const record = {
        turn: turnNo, label, action, secs: Math.round((Date.now() - t0) / 1000),
        msgBefore: before?.msgCount, msgAfter: after?.msgCount, combatIters,
        dm, dmFresh, infraRetries, promptChars: sys.length,
        hasRecordBlock: sys.includes('## THE RECORD'),
        hasNothingFound: /NOTHING FOUND/.test(sys),
        hasWonderCue: sys.includes('SOMETHING STRANGE ARRIVES'),
        console: consoleLines.slice(consoleFrom).map(c => c.text).filter(t => /\[Wonder\]|\[Journal\]/.test(t)),
    };
    turns.push(record);
    saveAll();
    return { before, after, dm, sys, record };
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------
async function bootAndCreateHero(page, { premiseMode, premiseText }) {
    await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(2000);
    note('setup', `Run "${runLabel}" (${PROBE}) — DM ${provider} / ${model}; machinery gemini (always).`);
    await page.evaluate(({ providerName, modelName, key, geminiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: providerName,
            apiKey: key,
            geminiApiKey: geminiKey,
            imageApiKey: '',
            model: modelName,
            memoryInspector: true,
            paceDial: 'standard',
        }));
    }, { providerName: provider, modelName: model, key: dmKey, geminiKey: GEMINI_API_KEY });
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2000);

    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(1000);
    await page.click('.creation-card'); // Forge a New Hero
    await delay(800);
    await page.waitForSelector('.creation-input');
    if (!await reactFill(page, `el => (el.placeholder || '').startsWith('Enter your character')`, 'Aino Halme')) {
        throw new Error('Name input not found.');
    }
    await reactFill(page, `el => (el.placeholder || '').startsWith('Gender')`, 'woman');
    await reactFill(page, `el => (el.placeholder || '').startsWith('Appearance')`,
        'Tall and broad-shouldered, pale skin weathered brown on the face and forearms, dark hair cropped to the scalp, a notched left ear.');
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Choose your race', 'after identity');
    await clickByText(page, '.creation-card', 'Human');
    await delay(300);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Choose your class', 'after race');
    await clickByText(page, '.creation-card', 'Fighter');
    await delay(300);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Assign ability scores', 'after class');
    await clickByText(page, 'button', 'Use this spread');
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Choose your skills', 'after stats');
    await clickByText(page, '.skill-choice-card', 'Athletics');
    await delay(250);
    await clickByText(page, '.skill-choice-card', 'Perception');
    await delay(250);
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await expectOnScreen(page, 'stands ready', 'hero reveal');
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Set the stage', 'premise step');
    if (premiseMode === 'starter') {
        if (!await clickByText(page, '.premise-starter-card', premiseText)) throw new Error(`Starter card "${premiseText}" not found.`);
        await delay(500);
        const filled = await page.evaluate(() => (document.querySelector('textarea')?.value || '').length);
        if (filled < 100) throw new Error('Starter tap did not fill the premise box.');
    } else if (!await reactFill(page, `el => el.tagName === 'TEXTAREA' && (el.placeholder || '').startsWith('Exiled from the city')`, premiseText)) {
        throw new Error('Premise textarea not found by placeholder.');
    }
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
    note('wizard', 'Begin Adventure — waiting for the opening scene.');
    await waitForIdle(page, { timeout: 300000 });
    await delay(2500);
    const opening = await settleBackground(page);
    note('opening', (await lastDmMessage(page)).slice(0, 1500));
    return opening;
}

// ---------------------------------------------------------------------------
// PROBE 1 — "remember when…"
// ---------------------------------------------------------------------------
const FACT_SPECS = {
    promise: {
        q: 'Did the hero promise Old Tammo something, and did Tammo accept it on screen? State exactly what was promised (the thing, and any deadline).',
        followUps: ['"Do you accept that, Tammo? Say it back to me so we both know."', '"Then it is a bargain between us, Tammo. Repeat the terms."'],
    },
    debt: {
        q: 'Did the DM state an EXACT coin figure the hero owes (from the ledger or in words)? Give the amount with its denomination and who it is owed to.',
        followUps: ['I press her: "The figure, Orsa. In coin. Exactly what I owe, to the copper."', 'I lean on the counter: "Read the ledger line aloud, Orsa — the number."'],
    },
    want: {
        q: 'Did an NPC (the harbormaster Orsa) STATE something she wants from the hero, in her own words? What is it?',
        followUps: ['"No, Orsa — set the ledger aside. Tell me plainly what you want from me."', '"Say it straight, Orsa: what is it you actually want from me this season?"'],
    },
    place: {
        q: 'Did the DM or an NPC give a proper NAME to the reef (or rock / shoal) north of the pier? What is the name?',
        followUps: ['"But what do the sailors actually CALL it, Tammo? The proper name."', '"Give me the name, old man — what is that reef called?"'],
    },
    secret: {
        q: 'Did Tammo privately tell the hero a SECRET he says no one else knows? What exactly is the secret?',
        followUps: ['"Tell me, Tammo. Whatever it is stays with me. What is the secret?"', '"You said you could not carry it alone. Say it, quietly — what is it?"'],
    },
    object: {
        q: 'Did the hero FIND a particular object aboard the Kittiwake? Give its exact name or description as the DM stated it.',
        followUps: ['I hold it up to the light: "Does this have a name, Tammo? Do you know what it is?"', 'I turn it over: "Tell me what this is, Tammo — what would you call it?"'],
    },
    fight: {
        q: 'Was there a fight with a named or described opponent on the quay? Who was it, and how did it end?',
        followUps: [],
    },
    wound: {
        q: 'Was the hero given a specific INJURY in the scuffle? Where on the body and how, as the DM narrated it?',
        followUps: ['I check myself over once the scuffle is done: "Where exactly am I hurt, Tammo — and how bad is it?"', 'I take stock of myself carefully. Where am I hurt, and how?'],
    },
};

const truths = {}; // fact -> { detail, keywords, verbatim, planted (turn) }

async function extractTruth(fact, playerLine, dmTexts) {
    const spec = FACT_SPECS[fact];
    const prompt = `You audit a tabletop RPG transcript. Determine whether a specific fact was ESTABLISHED ON SCREEN by the DM.

Player's line: ${playerLine}
DM's reply (or replies):
"""
${dmTexts.join('\n---\n').slice(0, 9000)}
"""

Question: ${spec.q}

Rules: established=true ONLY if the DM's reply explicitly states it (for the promise: the player made it and the DM shows it accepted/acknowledged). Do not infer. If the DM was vague ("a large sum", "a secret") with no concrete particular, established=false.
Return JSON: {"established": boolean, "detail": "one precise sentence with the exact particulars (names, numbers, places, objects)", "keywords": ["3-6 exact strings a correct recall must contain (numbers, proper names, the object)"], "verbatim": "the shortest exact quote from the DM's reply that carries the fact, or empty"}`;
    return await flash(prompt);
}

/** Plant one fact, retrying with follow-up lines until the DM states it concretely. */
async function plantFact(page, fact, line, { collectFrom = null } = {}) {
    const spec = FACT_SPECS[fact];
    const lines = [line, ...spec.followUps];
    for (let attempt = 0; attempt < lines.length; attempt++) {
        const fromIdx = collectFrom !== null ? collectFrom : (await snap(page)).msgCount;
        const { dm } = await playTurn(page, `plant:${fact}${attempt ? `:retry${attempt}` : ''}`, lines[attempt]);
        const dms = collectFrom !== null ? await dmMessagesSince(page, collectFrom) : [dm];
        void fromIdx;
        const truth = await extractTruth(fact, lines[attempt], dms);
        note('truth', `${fact} (attempt ${attempt + 1}): ${JSON.stringify(truth)}`);
        if (truth?.established) {
            truths[fact] = { ...truth, plantedTurn: turnNo, line: lines[attempt] };
            return true;
        }
    }
    note('warn', `Fact "${fact}" was never concretely established after ${lines.length} attempt(s).`);
    truths[fact] = null;
    return false;
}

const FILLERS_EARLY = [
    'I help Tammo mend a torn section of net while we talk about the herring run.',
    'I help count the herring barrels on the quay and tally them on my fingers.',
    'I coil the Kittiwake\'s spare lines and hang them to dry on the pier rail.',
    'I take a break, eat a heel of bread, and watch the tide turn.',
    'I scrub the Kittiwake\'s deck with a stiff brush while the gulls complain.',
    'I sharpen my knife on a whetstone and listen to the harbor sounds.',
    'I carry a few crates of salt up from the quay to the net-loft.',
    'I stop to watch the fishing boats come in, one by one, and count them.',
    'I patch a leak in the Kittiwake\'s hull with tar and oakum.',
    'I lean on the rail, chew a piece of dried fish, and think through the day.',
];
const FILLERS_TRAVEL = [
    'I shoulder my pack and take the coast road east, away from Saltmere, at an easy pace.',
    'I walk on along the coast road, watching the sea to my left.',
    'I stop at a roadside spring, drink, and refill my waterskin.',
    'I keep walking as the morning fog burns off the fields.',
    'I share the road with a farmer\'s cart for a while and trade a few words about the weather.',
    'I stop at a small chapel, sit on its bench for a moment, and rest my feet.',
    'I buy a loaf of bread from a roadside stall and eat it walking.',
    'I ford a shallow stream, taking my boots off to keep them dry.',
    'I walk the long straight stretch of road through the barley fields.',
    'As the light fades I make a small camp under a hawthorn hedge and light a fire.',
    'I cook a simple supper and sit by the fire, mending a strap.',
    'I sleep, and wake at dawn to break camp.',
    'I set off again along the road, whistling.',
    'I pass a shepherd with his flock and nod to him as I go by.',
    'I stop at a crossroads inn, buy a mug of small beer, and rest an hour.',
    'I continue along the road as the afternoon wears on.',
    'I walk through a stand of birches, listening to the wind in the leaves.',
    'I reach a small village and look for a place to buy a meal.',
    'I eat at the village\'s only tavern and listen to ordinary gossip about the harvest.',
    'I rent a bed for the night, wash, and sleep.',
    'In the morning I buy bread and cheese for the road and start walking back west.',
    'I retrace the coast road, glad of the sea wind in my face.',
    'I stop to rest at the little chapel again, and eat a few dried apples.',
    'I walk on through the late morning, one foot after another.',
    'I ford the stream again and press on toward the sea.',
    'I make good time along the road and reach the crossroads inn by noon.',
    'I keep on, the harbor smell growing stronger with every mile.',
    'From a hilltop I see Saltmere\'s roofs and the masts in the harbor, and I head down toward them.',
    'I walk into Saltmere by the harbor road and greet the first familiar faces.',
    'I make my way down to the seaward pier.',
];

const QUESTIONS = {
    A: { // turn ~12 — six facts planted (promise, debt, want, place, secret, object)
        promise: { where: 'I sit down on my usual stool beside Tammo\'s brazier.', ask: '"Tammo, remember what I promised you?"', style: 'remember-what' },
        debt: { where: 'I walk up to the harbor office to see Orsa Pellwyn.', ask: '"Harbormaster, remind me — how much do I owe you?"', style: 'how-much' },
        secret: { where: 'I find Tammo alone at his brazier.', ask: '"Tammo, remember what you told me in private, out on the pier?"', style: 'remember-what-told' },
        object: { where: 'I stay with Tammo by the brazier.', ask: '"Tammo, remember what I found aboard the Kittiwake? What was it called?"', style: 'what-name' },
    },
    B: { // turn ~24 — all eight
        promise: { where: 'I go and find Tammo at his brazier.', ask: '"Do you recall exactly what I swore I would bring you?"', style: 'do-you-recall' },
        debt: { where: 'I go to the harbor office and find Orsa.', ask: '"Orsa, what did you tell me my debt stands at? Read me the figure again."', style: 'what-did-say' },
        want: { where: 'I stay with Orsa at her counter.', ask: '"Remember when I asked what you wanted from me this season? What did you say?"', style: 'remember-when' },
        place: { where: 'I go back to Tammo on the pier.', ask: '"What was the name of that reef north of the pier, the one you told me about?"', style: 'what-name' },
        secret: { where: 'I draw Tammo aside where nobody can hear.', ask: '"Tammo, what was it you confided in me — the thing you told nobody else?"', style: 'what-did-confide' },
        object: { where: 'I stay with Tammo.', ask: '"What was the thing I dug out of the Kittiwake\'s bilge? What is it called again?"', style: 'what-name' },
        fight: { where: 'I stay with Tammo.', ask: '"Remember when I fought on the quay? Who was it, and how did it end?"', style: 'remember-when' },
        wound: { where: 'I stay with Tammo.', ask: '"Tammo, that scuffle on the quay — where did I get hurt?"', style: 'where' },
    },
    C: { // after 30 filler turns
        promise: { where: 'I return to Tammo\'s stool by the brazier.', ask: '"Old man, what was it I promised you, back before the gales?"', style: 'what-promised' },
        debt: { where: 'I go straight to the harbor office to see Orsa.', ask: '"Orsa, remember when you opened the ledger for me? How much did you say I owed, exactly?"', style: 'remember-how-much' },
        want: { where: 'I stay with Orsa.', ask: '"Tell me again what it was you said you wanted from me, Orsa."', style: 'tell-me-again' },
        place: { where: 'I go back out to Tammo on the pier.', ask: '"Old friend, what did the sailors call that reef beyond the north pier?"', style: 'what-called' },
        secret: { where: 'I draw Tammo aside again, quietly.', ask: '"Tammo, that secret you told me — I want to be sure I remember it right. What was it?"', style: 'remember-right' },
        object: { where: 'I stay with Tammo.', ask: '"Tammo, that thing I found aboard the Kittiwake — do you remember what it was?"', style: 'do-you-remember' },
        fight: { where: 'I stay with Tammo.', ask: '"Tammo, how did that fight on the quay end? Who did I fight?"', style: 'how-did' },
        wound: { where: 'I stay with Tammo.', ask: '"Do you remember where I was wounded in that brawl?"', style: 'do-you-remember' },
    },
};
const OOC_QUESTIONS = {
    B: [
        { fact: 'debt', text: 'OOC: what happened with the debt Orsa told me about? What was the figure?' },
        { fact: 'secret', text: 'OOC: what did Tammo tell me in private, exactly?' },
    ],
    C: [
        { fact: 'object', text: 'OOC: remind me what I found in the Kittiwake, and what it was called?' },
        { fact: 'want', text: 'OOC: what did Orsa say she wanted from me?' },
    ],
};
const NEVER = {
    A: [
        { id: 'never-npc-1', text: 'I sit with Tammo. "Tammo, remember Isolde Vane, the cartographer who traveled with us to the Sunken Bell? What did she say to you?"', desc: 'a cartographer named Isolde Vane and a voyage to the Sunken Bell — neither ever existed in this campaign' },
    ],
    B: [
        { id: 'never-npc-2', text: 'I find Orsa. "Orsa, remember Brother Halvard, the monk who vouched for me before the harbor council?"', desc: 'a monk named Brother Halvard vouching for the hero before a harbor council — never happened, the man does not exist' },
        { id: 'never-event-1', text: 'I stay with Orsa. "Remember the night the harbor bell was stolen by the salt-witch? What did we do?"', desc: 'the harbor bell being stolen by a salt-witch — an event that never happened' },
    ],
    C: [
        { id: 'never-npc-3', text: 'I find Tammo. "Tammo, remember Captain Wenna Marsh, who offered me a berth on her ship? What did she offer?"', desc: 'a Captain Wenna Marsh offering the hero a berth — she does not exist, it never happened' },
        { id: 'never-event-2', text: 'I stay with Tammo. "Remember when the lighthouse fell into the sea and we rescued the keeper together?"', desc: 'the lighthouse falling into the sea and a keeper being rescued — never happened' },
    ],
};

async function judgeFact(fact, question, answer, truth) {
    const prompt = `You are a strict judge of an RPG memory system. A character was asked about a past event.

GROUND TRUTH (what actually happened on screen): ${truth.detail}
Exact particulars a correct answer must carry: ${JSON.stringify(truth.keywords || [])}
Verbatim source line: ${truth.verbatim || '(none)'}

The player asked: ${question}
The DM's answer: """${answer.slice(0, 4000)}"""

Classify the answer with ONE verdict:
- "exact": states the fact with all key particulars correct (paraphrase is fine; the numbers/names/objects must match).
- "laundered": right gist but a key particular is wrong, missing, softened to something vaguer, or replaced with a plausible substitute.
- "forgotten": the character says they do not remember / do not know / it is unclear, or dodges without giving the fact.
- "contradicted": states something incompatible with the ground truth (a different number, a different object, the opposite outcome).
- "fabricated": invents unrelated specifics.
Return JSON: {"verdict": "...", "note": "one short sentence naming the exact discrepancy, if any"}`;
    return await flash(prompt);
}
async function judgeNever(question, answer, desc) {
    const prompt = `You are a strict judge of an RPG memory system. The player asked a character about something that NEVER happened in this campaign: ${desc}.

The player asked: ${question}
The DM's answer: """${answer.slice(0, 4000)}"""

Classify with ONE verdict:
- "honest_none": the character says they do not remember it / never heard of it / it did not happen / they know nothing of that, WITHOUT inventing details or playing along.
- "fabricated": the character plays along — confirms it, or supplies invented details (names, events, dialogue) about the thing that never happened.
- "deflected": a vague non-answer that neither confirms nor honestly denies.
Return JSON: {"verdict": "...", "note": "one short sentence"}`;
    return await flash(prompt);
}

/** The recall dossier lines the Memory Inspector shows for the last turn. */
async function readInspectorRecord(page) {
    const opened = await clickByText(page, 'button.header-btn', 'Memory');
    if (!opened) return { opened: false, lines: null, nothing: null };
    await delay(700);
    const data = await page.evaluate(() => {
        const h4 = Array.from(document.querySelectorAll('.mi-modal h4')).find(h => h.textContent.startsWith('The record'));
        if (!h4) return { section: false, lines: null, nothing: null, player: document.querySelector('.mi-kv')?.textContent || '' };
        const sec = h4.parentElement;
        // The dossier list is the <ul> right after the h4; the curated + retrieved lists live in the same section.
        const list = h4.nextElementSibling && h4.nextElementSibling.tagName === 'UL' ? h4.nextElementSibling : null;
        const lines = list ? Array.from(list.querySelectorAll('li .mi-text')).map(e => e.textContent.trim()) : [];
        const nothing = /Nothing on record/.test(sec.textContent);
        return { section: true, header: h4.textContent, lines, nothing };
    });
    await page.evaluate(() => document.querySelector('.mi-modal .journal-close')?.click());
    await delay(400);
    return { opened: true, ...data };
}

function mechanicalDelta(before, after) {
    if (!before || !after) return { comparable: false };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return {
        comparable: true,
        purseChanged: !same(before.purse, after.purse),
        inventoryChanged: !same(before.inventory, after.inventory),
        expChanged: before.exp !== after.exp || before.level !== after.level,
        hpChanged: before.hp !== after.hp,
        rollsAdded: after.rollHistoryLen - before.rollHistoryLen,
        pendingCheck: after.pendingCheck,
        combatStarted: !!after.combat && !before.combat,
        purse: { before: before.purse, after: after.purse },
        invDiff: {
            added: after.inventory.filter(x => !before.inventory.includes(x)),
            removed: before.inventory.filter(x => !after.inventory.includes(x)),
        },
        newFacts: after.counts.worldFacts - before.counts.worldFacts,
        newCards: after.counts.storyMemory - before.counts.storyMemory,
        newNpcs: after.counts.npcs - before.counts.npcs,
    };
}

async function recallTurn(page, checkpoint, key, text, { kind, fact = null, desc = null, style = null, ooc = false }) {
    const beforeReceipts = ((await snap(page))?.recordReceipts || []).length;
    const { before, after, dm, sys, record } = await playTurn(page, `recall:${checkpoint}:${key}`, text);
    const receiptsAll = after?.recordReceipts || [];
    const newReceipts = receiptsAll.slice(beforeReceipts).map(r => r.content);
    const inspector = await readInspectorRecord(page);
    const row = {
        checkpoint, key, kind, fact, style, ooc,
        question: text,
        answer: dm,
        receipts: newReceipts,
        promptRecordBlock: recordBlockOf(sys).slice(0, 2500),
        promptHasRecord: record.hasRecordBlock,
        promptNothingFound: record.hasNothingFound,
        dossierLines: inspector.lines,
        inspectorNothing: inspector.nothing,
        mech: mechanicalDelta(before, after),
        combatEver: !!after?.combat,
        dmFresh: record.dmFresh,
        infraRetries: record.infraRetries,
    };
    if (!record.dmFresh) row.judge = { verdict: 'void-no-dm-reply', note: 'the provider never answered this turn' };
    else if (kind === 'never') row.judge = await judgeNever(text, dm, desc);
    else if (truths[fact]) row.judge = await judgeFact(fact, text, dm, truths[fact]);
    else row.judge = { verdict: 'no-ground-truth', note: 'fact was never established concretely' };
    results.push(row);
    saveAll();
    note('recall', `${checkpoint}/${key}: ${row.judge?.verdict} | receipt: ${newReceipts.join(' ⏎ ').slice(0, 160) || '(none)'} | ${row.judge?.note || ''}`);
    return row;
}

async function runCheckpoint(page, checkpoint, { facts, ooc = [], never = [] }) {
    note('checkpoint', `=== Checkpoint ${checkpoint} (msgs ${(await snap(page)).msgCount}) ===`);
    for (const fact of facts) {
        const q = QUESTIONS[checkpoint][fact];
        await recallTurn(page, checkpoint, fact, `${q.where} ${q.ask}`, { kind: 'fact', fact, style: q.style });
    }
    for (const o of ooc) {
        await recallTurn(page, checkpoint, `ooc-${o.fact}`, o.text, { kind: 'fact', fact: o.fact, ooc: true, style: 'ooc' });
    }
    for (const n of never) {
        await recallTurn(page, checkpoint, n.id, n.text, { kind: 'never', desc: n.desc });
    }
}

async function fightAndWound(page) {
    // Deliberately start a fight with a named deckhand, then resolve it.
    const startIdx = (await snap(page)).msgCount;
    let started = false;
    const provoke = [
        'A loudmouthed deckhand named Bram Kettlewick has been swearing at Old Tammo all morning. I lose my patience, shove Bram hard against the piling, and swing my fist at his jaw.',
        'I draw my longsword and attack the deckhand Bram Kettlewick on the quay — this ends now.',
    ];
    for (let i = 0; i < provoke.length && !started; i++) {
        await playTurn(page, `fight:start${i ? `:retry${i}` : ''}`, provoke[i]);
        const s = await snap(page);
        started = !!s?.combat || (s?.rollHistoryLen ?? 0) > 0;
        const dms = await dmMessagesSince(page, startIdx);
        if (dms.some(t => /bram/i.test(t))) started = true;
    }
    const s = await snap(page);
    if (s?.combat) await resolveCombat(page);
    await settleBackground(page);
    const dms = await dmMessagesSince(page, startIdx);
    const truthFight = await extractTruth('fight', provoke[0], dms);
    note('truth', `fight: ${JSON.stringify(truthFight)}`);
    truths.fight = truthFight?.established ? { ...truthFight, plantedTurn: turnNo } : null;
    const truthWound0 = await extractTruth('wound', provoke[0], dms);
    note('truth', `wound (from fight prose): ${JSON.stringify(truthWound0)}`);
    if (truthWound0?.established) {
        truths.wound = { ...truthWound0, plantedTurn: turnNo };
    } else {
        await plantFact(page, 'wound', FACT_SPECS.wound.followUps[0].replace(/^/, ''), {});
    }
}

async function runRecallProbe(page) {
    await bootAndCreateHero(page, { premiseMode: 'starter', premiseText: 'The Debt at Saltmere' });
    saveAll();

    // Planting (turns 1–11). Each line asks the world a concrete question so the DM states a particular.
    await playTurn(page, 'warmup', 'I walk out along the seaward pier to Old Tammo and sit on the stool by his brazier, helping him with the net while we talk about the herring run.');
    await plantFact(page, 'promise', 'I tell Tammo, plainly: "I promise you I will bring you a jar of Harbormaster Pellwyn\'s good pitch before the gales come." He nods slowly, and I mean it.');
    await plantFact(page, 'debt', 'I go up to the harbor office and ask Harbormaster Orsa Pellwyn to open her brass-cornered ledger. "Exactly how much do I owe you, Orsa? Give me the figure in coin."');
    await plantFact(page, 'want', 'I ask Orsa straight out: "Setting the ledger aside — what do you want most from me this season?"');
    await playTurn(page, 'filler', FILLERS_EARLY[1]);
    await plantFact(page, 'place', 'Back on the pier I ask Tammo: "What do the old sailors call the reef out north of the pier, and who named it?"');
    await playTurn(page, 'filler', FILLERS_EARLY[0]);
    await plantFact(page, 'secret', 'I take Tammo aside, out of earshot of everyone on the pier, and ask him quietly what he has not told anyone. I swear on the Kittiwake that I will keep whatever he says to myself.');
    await playTurn(page, 'filler', FILLERS_EARLY[2]);
    await plantFact(page, 'object', 'I search the Kittiwake\'s bilge and the locker under the stern seat for anything out of the ordinary, and pull out whatever I find.');
    await playTurn(page, 'filler', FILLERS_EARLY[3]);

    // Checkpoint A — ~turn 12
    await runCheckpoint(page, 'A', { facts: ['promise', 'debt', 'secret', 'object'], never: NEVER.A });

    // Fight + wound
    await fightAndWound(page);

    // Fillers to ~turn 24
    for (let i = 4; i < FILLERS_EARLY.length; i++) await playTurn(page, 'filler', FILLERS_EARLY[i]);

    // Checkpoint B — ~turn 24
    await runCheckpoint(page, 'B', { facts: ['promise', 'debt', 'want', 'place', 'secret', 'object', 'fight', 'wound'], ooc: OOC_QUESTIONS.B, never: NEVER.B });

    // 30 filler turns of ordinary travel
    for (let i = 0; i < FILLERS_TRAVEL.length; i++) {
        const { after } = await playTurn(page, `travel:${i + 1}`, FILLERS_TRAVEL[i], { settle: { quietMs: 6000, maxMs: 40000 } });
        if (after?.combat) await resolveCombat(page);
    }

    // Checkpoint C
    await runCheckpoint(page, 'C', { facts: ['promise', 'debt', 'want', 'place', 'secret', 'object', 'fight', 'wound'], ooc: OOC_QUESTIONS.C, never: NEVER.C });

    // Chapter close: the receipt must never reach the saga.
    await chapterCloseCheck(page);
}

async function chapterCloseCheck(page) {
    note('chronicle', 'Pure check: chronicler message collection over the live transcript.');
    const state = await page.evaluate(() => window.__QF_STATE__);
    const msgs = state.messages || [];
    const receiptRows = msgs.filter(m => m.kind === 'record');
    let collectedLeak = null;
    try {
        const mod = await import(pathToFileURL(path.resolve('src/llm/chronicler.js')).href);
        const collected = mod.collectChapterMessages(msgs, 0);
        collectedLeak = collected.filter(m => /📜|From the record|Nothing on record/.test(String(m.content || ''))).length;
        note('chronicle', `collectChapterMessages: ${collected.length} rows, ${collectedLeak} carrying a receipt (want 0); transcript holds ${receiptRows.length} receipt rows.`);
    } catch (err) {
        note('warn', `Could not import chronicler in Node: ${String(err).slice(0, 200)}`);
    }
    note('chronicle', 'Real chapter close through the Journal → Chronicle tab.');
    const before = (await snap(page)).counts.chronicle;
    await clickByText(page, 'button.header-btn', 'Journal');
    await delay(800);
    await clickByText(page, '.journal-tab', 'Chronicle');
    await delay(600);
    const clicked = await clickByText(page, '.chronicle-write-btn', 'Close chapter');
    note('chronicle', `Close chapter clicked: ${clicked}`);
    const start = Date.now();
    let done = false;
    while (Date.now() - start < 30 * 60 * 1000) {
        await delay(8000);
        const s = await snap(page);
        const writing = await page.evaluate(() => /Writing/.test(document.querySelector('.chronicle-write-btn')?.textContent || ''));
        if (s && s.counts.chronicle > before && !writing) { done = true; break; }
    }
    const chapters = await page.evaluate(() => (window.__QF_STATE__?.chronicle || []).map(c => ({ title: c.title, text: c.text || '' })));
    const saga = chapters.map(c => c.text).join('\n\n');
    const leaks = ['📜', 'From the record', 'Nothing on record', 'THE RECORD'].filter(needle => saga.includes(needle));
    fs.writeFileSync(path.join(OUT_DIR, 'chronicle.txt'), saga);
    note('chronicle', `Chapter close done=${done}; ${chapters.length} chapter(s), ${saga.length} chars; receipt-string leaks: ${JSON.stringify(leaks)}`);
    results.push({ kind: 'chronicle', done, chapters: chapters.length, chars: saga.length, leaks, collectedLeak, receiptRowsInTranscript: receiptRows.length });
    await shot(page, 'chronicle');
    saveAll();
}

// ---------------------------------------------------------------------------
// PROBE 2 — the wonder die
// ---------------------------------------------------------------------------
const WAGON_PREMISE = 'Guarding a merchant\'s wagon on the road between two ordinary towns, Ashford and Dunmere. Nothing has ever happened here.';
const BORING = [
    'I check the wagon\'s wheels and the mule\'s harness, and tell the drover we can set off whenever he is ready.',
    'I walk alongside the wagon, watching the hedgerows go by.',
    'I ask the drover how long he has driven this road.',
    'I share the drover\'s bread and cheese at the noon halt.',
    'I check the lashings on the load and walk on.',
    'We come to a shallow stream ford. I lead the mule across slowly and watch the wagon over.',
    'I chat with the drover about the price of wool in Dunmere.',
    'I keep walking as the afternoon wears on, counting fence posts to pass the time.',
    'We make camp by the roadside. I gather firewood and help the drover unhitch the mule.',
    'I cook a plain stew over the fire and ask the drover about his family.',
    'I take the first watch, sitting with my back against a wagon wheel.',
    'I wake the drover for his watch and sleep until dawn.',
    'I help pack up camp, eat some hardtack, and get the wagon rolling.',
    'I ask the drover what he plans to buy in Dunmere with the profit.',
    'We stop to let the mule drink at a trough at a wayside farm. I chat with the farmwife about the weather.',
    'I walk on. The road is dusty and the day is warm. I hum an old marching tune.',
    'We reach the outskirts of Dunmere in the late afternoon. I look for the merchant\'s warehouse.',
    'I help the drover unload the crates at the warehouse and count them against the manifest.',
    'I collect our pay from the warehouse clerk and ask where a guard can get a cheap meal.',
    'I eat at a plain tavern and listen to the ordinary talk of the locals.',
    'I rent a bed at the inn, wash up, and sleep.',
    'In the morning I buy bread for the road and meet the drover at the wagon yard.',
    'I ask the warehouse clerk whether there is a return load for Ashford. We agree to guard another wagon back.',
    'We load the wagon with sacks of flour and set off west toward Ashford.',
    'I walk beside the wagon, checking the sky and the road ahead.',
    'We halt at noon. I eat some cheese and rest my feet.',
    'I mend a loose strap on the harness while the drover naps.',
    'I count the milestones as we pass them.',
    'We make camp again at the same roadside clearing. I gather wood and light the fire.',
    'I sit by the fire and sharpen my knife while the drover tells a long story about a cousin.',
    'I take the first watch and listen to the crickets.',
    'I sleep until dawn, then help hitch the mule.',
    'We roll on toward Ashford. I ask the drover what the weather will do.',
    'I walk on, the road unchanging under my boots.',
    'We stop at a wayside farm to water the mule. I buy a few apples.',
    'I eat an apple and keep walking.',
    'The hedgerows give way to open pasture. I watch the cattle graze.',
    'We reach a small hamlet with a well. I draw water for us and the mule.',
    'I walk on into the evening, tired but content.',
    'We arrive at the edge of Ashford as the lamps are lit. I look for the merchant\'s yard.',
    'I help unload the wagon at the yard and count the sacks.',
    'I collect our pay and thank the drover for the company.',
    'I find a plain tavern, eat supper, and listen to the ordinary talk.',
    'I take a bed at the inn and sleep.',
    'In the morning I ask around the yard for another guarding job on the road.',
    'The yard-master offers a run back to Dunmere. I agree and check the wagon over.',
    'We set off east along the road, the mule plodding on.',
    'I walk alongside, watching the hedgerows.',
    'We halt at the ford and let the mule rest.',
    'I chat with the drover about nothing in particular and walk on.',
];

async function judgeLanded(hook, reply) {
    const prompt = `A private "wonder" hook was handed to the DM of an RPG. Decide whether the DM's reply actually LANDED it on screen (introduced that strange thing into the scene), and judge how.

Hook: ${JSON.stringify({ register: hook.register, title: hook.title, hook: hook.hook, invitation: hook.invitation })}
DM reply: """${reply.slice(0, 4500)}"""

Return JSON:
{"landed": boolean (the hook's core strange thing is visibly present in the reply),
 "quote": "the 1–3 sentences that carry it, verbatim, or empty",
 "invitation": boolean (it arrives as something the hero may accept/refuse — a thing seen, said, offered, or opened — NOT an attack/ambush/kidnapping/threat on arrival),
 "hostileArrival": boolean,
 "concrete": boolean (particular: proper nouns / a specific object or hour, not generic "a mysterious stranger"),
 "revealedRolled": boolean (the reply says or implies it was rolled/decided by dice/the engine/the DM),
 "note": "one short sentence"}`;
    return await flash(prompt);
}
async function judgeKeptAlive(hook, replies) {
    const prompt = `The hero DECLINED a strange invitation and played on. Hook: ${JSON.stringify({ title: hook.title, hook: hook.hook, invitation: hook.invitation })}
The next DM replies (in order):
${replies.map((r, i) => `[${i + 1}] """${r.slice(0, 1800)}"""`).join('\n')}
Return JSON: {"keptAlive": boolean (some reply carries a residue/echo of the declined thing — someone remembers, it lingers, a consequence of refusing), "hostileEscalation": boolean (a reply turned the refused thing into an attack/ambush the hero did not invite), "repeatedCue": boolean (the reply re-introduces the SAME hook as if new, again, more than once), "note": "one short sentence"}`;
    return await flash(prompt);
}

let engineMod = null;
async function loadEngine() {
    engineMod = await import(pathToFileURL(path.resolve('src/engine/wonder.js')).href);
}
function lullReport(s) {
    if (!engineMod || !s) return null;
    const st = { ...s.forEngine, settings: { paceDial: 'standard' } };
    let lull = null; let should = null;
    try { lull = engineMod.measureLull(st); } catch (e) { lull = `err:${String(e).slice(0, 60)}`; }
    try { should = engineMod.shouldRequestWonder(st); } catch (e) { should = `err:${String(e).slice(0, 60)}`; }
    let onDemand = null;
    try { onDemand = engineMod.shouldRequestWonder(st, { onDemand: true }); } catch { /* ignore */ }
    return { lull, threshold: engineMod.wonderThreshold('standard'), shouldRequest: should, shouldRequestOnDemand: onDemand };
}

const wonderLog = [];
async function wonderTurn(page, label, action) {
    const { after, dm, sys, record } = await playTurn(page, label, action, { settle: { quietMs: 9000, maxMs: 60000, directorWaitMs: 150000 } });
    const lr = lullReport(after);
    const seenIds = wonderTurn.seen || (wonderTurn.seen = new Set());
    const newCards = (after?.cards || []).filter(c => !seenIds.has(c.id));
    for (const c of newCards) seenIds.add(c.id);
    let anchor = null;
    try { anchor = engineMod.lastEventMessage({ ...after.forEngine, settings: { paceDial: 'standard' } }); } catch { /* ignore */ }
    const entry = {
        anchor, newCards: newCards.map(c => ({ type: c.type, salience: c.salience, firstSeen: c.firstSeenMessage, subject: c.subject, text: c.text, tags: c.tags })),
        quest: (after?.questRows || []).map(q => `${q.name}@${q.openedAtMessage}`),
        turn: turnNo, label, msgs: after?.msgCount,
        lull: lr?.lull, threshold: lr?.threshold, shouldRequest: lr?.shouldRequest,
        pendingWonder: after?.pendingWonder ? after.pendingWonder.key : null,
        pendingOnDemand: after?.pendingWonder?.onDemand ?? null,
        wonder: after?.wonder ? { register: after.wonder.register, fits: after.wonder.fits, title: after.wonder.title, openAt: after.wonder.openAtMessage, chosenAt: after.wonder.chosenAtMessage, key: after.wonder.key } : null,
        promptHasCue: record.hasWonderCue,
        // The hook title reaching the DM through ANY block (the cue, or the residue card in DRAMATIC CALLBACKS) — a title without the cue means the timing die was bypassed.
        promptHasHookTitle: !!(after?.wonder?.title && sys.includes(after.wonder.title)),
        journal: after?.counts.journal, storyCards: after?.counts.storyMemory, quests: after?.counts.quests,
        location: after?.location,
        consoleWonder: record.console,
    };
    wonderLog.push(entry);
    note('wonder-log', `t${entry.turn} msgs=${entry.msgs} lull=${entry.lull}/${entry.threshold} should=${entry.shouldRequest} pending=${entry.pendingWonder} wonder=${entry.wonder ? `${entry.wonder.register}/${entry.wonder.fits} open@${entry.wonder.openAt}` : null} cue=${entry.promptHasCue} title=${entry.promptHasHookTitle}`);
    fs.writeFileSync(path.join(OUT_DIR, 'wonder-log.json'), JSON.stringify(wonderLog, null, 2));
    return { after, dm, entry };
}

async function runWonderProbe(page) {
    await loadEngine();
    await bootAndCreateHero(page, { premiseMode: 'custom', premiseText: WAGON_PREMISE });
    const findings = { firstPendingTurn: null, firstPendingMsgs: null, firstInstallTurn: null, landedTurn: null, hook: null, landing: null, directorHooks: null, refusal: null, surprise: null };

    let hook = null;
    let landed = false;
    let lineIdx = 0;
    const MAX_BORING = Number(process.env.MAX_BORING) || 46;
    const cueSeen = () => wonderLog.some(e => e.promptHasCue);
    // Phase 1: stay boring until the wonder arrives (or the window closes unused).
    while (lineIdx < MAX_BORING) {
        const { after, dm, entry } = await wonderTurn(page, `boring:${lineIdx + 1}`, BORING[lineIdx]);
        lineIdx += 1;
        if (entry.pendingWonder && findings.firstPendingTurn === null) { findings.firstPendingTurn = entry.turn; findings.firstPendingMsgs = entry.msgs; }
        if (!entry.pendingWonder && entry.wonder && findings.firstInstallTurn === null) {
            findings.firstInstallTurn = entry.turn;
            findings.installMsgs = entry.msgs;
            hook = after.wonder;
            findings.hook = hook;
            findings.directorHooks = directorOutputs.map(d => d.text);
            note('wonder', `Installed: ${JSON.stringify({ register: hook.register, fits: hook.fits, title: hook.title, open: hook.openAtMessage })}`);
        }
        if (hook && !landed) {
            const j = await judgeLanded(hook, dm);
            note('landing-judge', `t${entry.turn}: ${JSON.stringify(j)}`);
            if (j?.landed) {
                landed = true;
                findings.landedTurn = entry.turn;
                findings.landing = { ...j, dm, cueInPrompt: entry.promptHasCue };
                break;
            }
            // Window closed with no landing? stop waiting.
            if (after.msgCount > hook.openAtMessage + 16) { findings.landing = { landed: false, note: 'window expired without landing' }; break; }
        }
    }
    if (!hook) note('wonder', `No wonder installed within ${MAX_BORING} boring turns.`);
    await shot(page, 'after-landing');

    // Phase 2: repeat check — did the DM re-run the cue / leak the roll? (cue prompts on later turns)
    // Phase 3: refuse the invitation and play 6 turns.
    if (hook) {
        const refuse = 'I decline politely. I am here to guard the wagon, and that is what I will do. I turn back to my duty and keep the mule moving.';
        const replies = [];
        const first = await wonderTurn(page, 'refuse', refuse);
        replies.push(first.dm);
        const s0 = await snap(page);
        for (let i = 0; i < 5; i++) {
            const r = await wonderTurn(page, `post-refusal:${i + 1}`, BORING[(lineIdx + i) % BORING.length]);
            replies.push(r.dm);
        }
        lineIdx += 5;
        const sN = await snap(page);
        const alive = await judgeKeptAlive(hook, replies);
        findings.refusal = {
            residueCards: sN.wonderCards,
            residueCardAtInstall: s0.wonderCards,
            cueTurnsAfterLanding: wonderLog.filter(e => e.turn > findings.landedTurn && e.promptHasCue).map(e => e.turn),
            judge: alive,
            replies,
        };
        note('refusal', JSON.stringify({ cards: sN.wonderCards.length, judge: alive, cueTurnsAfter: findings.refusal.cueTurnsAfterLanding }));
    }

    // Phase 4: "OOC: surprise me"
    const preSurprise = await snap(page);
    const preKey = preSurprise?.wonder?.key || null;
    const surprise = await wonderTurn(page, 'ooc-surprise', 'OOC: surprise me');
    const afterAsk = surprise.after;
    let installed = afterAsk?.wonder && afterAsk.wonder.key !== preKey ? afterAsk.wonder : null;
    // If the director was still generating, settle again.
    if (!installed) {
        const s = await settleBackground(page, { quietMs: 8000, maxMs: 30000, directorWaitMs: 150000 });
        installed = s?.wonder && s.wonder.key !== preKey ? s.wonder : null;
    }
    const expiryDiag = lullReport(await snap(page));
    findings.surprise = {
        installedImmediately: !!installed, wonder: installed, guardDiag: expiryDiag,
        prevWonderOpen: preSurprise?.wonder ? (engineMod.isWonderOpen(preSurprise.wonder, preSurprise.msgCount, preSurprise.messages)) : false,
        oocAnswer: surprise.dm,
    };
    note('surprise', JSON.stringify({ installed: !!installed, prevOpen: findings.surprise.prevWonderOpen, guard: expiryDiag }));
    if (installed) {
        const next = await wonderTurn(page, 'post-surprise:1', 'I go back to walking beside the wagon and keep an eye on the road.');
        const j = await judgeLanded(installed, next.dm);
        findings.surprise.nextTurn = { cueInPrompt: next.entry.promptHasCue, judge: j, dm: next.dm, opensAtOnce: installed.openAtMessage === installed.chosenAtMessage };
        note('surprise-landing', JSON.stringify({ cue: next.entry.promptHasCue, judge: j }));
        if (!j?.landed) {
            const next2 = await wonderTurn(page, 'post-surprise:2', 'I glance around and keep walking.');
            const j2 = await judgeLanded(installed, next2.dm);
            findings.surprise.secondTurn = { cueInPrompt: next2.entry.promptHasCue, judge: j2, dm: next2.dm };
            note('surprise-landing', `second turn: ${JSON.stringify(j2)}`);
        }
    }

    results.push({ kind: 'wonder-findings', findings, directorOutputs: directorOutputs.map(d => d.text) });
    fs.writeFileSync(path.join(OUT_DIR, 'wonder-findings.json'), JSON.stringify({ findings, wonderLog, directorOutputs }, null, 2));
    saveAll();
}

// ---------------------------------------------------------------------------

async function run() {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        userDataDir: PROFILE_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1500,950', ...PROXY_ARGS],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    page.on('dialog', d => d.accept().catch(() => {}));
    attachCapture(page);
    try {
        if (PROBE === 'recall') await runRecallProbe(page);
        else await runWonderProbe(page);
    } finally {
        fs.writeFileSync(path.join(OUT_DIR, 'transcript.json'), JSON.stringify(await page.evaluate(() => (window.__QF_STATE__?.messages || []).map(m => ({ role: m.role, kind: m.kind || null, hidden: !!m.hidden, content: m.content }))).catch(() => []), null, 2));
        fs.writeFileSync(path.join(OUT_DIR, 'director-outputs.json'), JSON.stringify(directorOutputs, null, 2));
        await shot(page, 'final');
        saveAll();
        await browser.close();
    }
}

run().then(() => {
    console.log(`\nRun "${runLabel}" (${PROBE}) complete.`);
    process.exit(0);
}).catch(err => {
    console.error('Run failed:', err);
    note('fatal', String(err).slice(0, 500));
    saveAll();
    process.exit(1);
});
