/**
 * Commitment-preservation probe — memory-research Adoption Queue M2
 * (docs/MEMORY_RESEARCH.md, entry 2026-09-17, amended 09-17 / 09-23 / 09-30).
 *
 *   npm run eval:commitments -- [--turns 30] [--checkpoints 10,20,30]
 *                               [--dm gemini|terra] [--machinery gemini-3.7-flash|gemini-3.8-flash]
 *                               [--embed-dims 768|1536] [--label <name>] [--url <app url>]
 *
 * What it measures (NCP-Bench-shaped, MemDelta / MemTrace / MemStrata / LAPSE protocol):
 *   - a FIXED starter premise (`saltmere-debt` from data/premiseStarters.js) with
 *     STRUCTURED COMMITMENTS seeded through the player's own lines in the first
 *     turns: promises (hero → NPC, NPC → hero), debts with amounts (both ways), a
 *     stated rule, a fact with a later MARKER-FREE flip (the spare sail moves; no
 *     "actually" / "correction" text), a progressive STATE (the harbor road is
 *     flooded at the spring tide — later asked whether it persists), and a secret
 *     told to ONE NPC only (knownBy).
 *   - knowledge points per MemTrace: every probe question is tagged
 *     age (turns since the seed landed) × question type
 *     {recall, inference, flip-awareness, state-persistence, secrecy} × evidence
 *     condition {in-window, journal-only, rag-only, record, typed-block, missing},
 *     the last read off the prompt the provider ACTUALLY received (system prompt +
 *     message window, captured per request).
 *   - a Flash judge (thinking-free, JSON-only) scores every answer; every miss is
 *     RETRIEVAL (the fact was not in the captured injection) or USE (it was there
 *     and the DM ignored / contradicted it). Fact CONFLICTS (two live world facts
 *     that contradict without supersession) are counted at every checkpoint.
 *   - MemDelta columns: one embedder across arms (observed off the embed requests),
 *     the Scribe / journal / reflection write-path tokens per turn (read from
 *     `usageMetadata` on every machinery response) beside survival, and a
 *     precision / noise column per tenure (facts + cards written vs judged relevant).
 *   - arms as flags: `--machinery` swaps the machinery model for Scribe AND judge
 *     (the app's constant rides in the request URL, so the harness rewrites it
 *     through request interception — no source change); `--embed-dims` is
 *     accepted but the 1536 arm needs a dev override in src (see the report's
 *     TODO line) — the harness refuses to pretend.
 *
 * Requires a PRODUCTION build served somewhere (the dev server's devSettingsSeed
 * would override the injected provider settings when .env.local carries keys):
 *   npx vite build --outDir <dir> && npx vite preview --outDir <dir> --port 4181
 *   QUEST_FORGE_TEST_URL=http://localhost:4181/?debugState=1
 * Keys come from .env / the environment (GEMINI_API_KEY always; OPENAI_API_KEY for
 * the Terra DM). Never the Grok DM (Vesa, 2026-09-14). Keys are never printed.
 *
 * Output: test-results/commitments/<timestamp>-<label>/report.md + report.json
 * (+ turns.json, transcript.json, log.json, screenshots).
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI + environment
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const eq = a.indexOf('=');
        if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
    }
    return out;
}
const ARGS = parseArgs(process.argv.slice(2));
if (ARGS.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(0);
}

function envKey(name) {
    try {
        const match = fs.readFileSync(path.resolve('.env'), 'utf8')
            .match(new RegExp(`${name}\\s*=\\s*["']?([^"'\\r\\n]+)`));
        if (match) return match[1].trim();
    } catch { /* fall through */ }
    return process.env[name] || '';
}
const GEMINI_API_KEY = envKey('GEMINI_API_KEY');
const OPENAI_API_KEY = envKey('OPENAI_API_KEY');

const DM_ARMS = {
    gemini: { provider: 'gemini', model: 'gemini-3.1-pro-preview', label: 'Gemini Pro' },
    terra: { provider: 'openai', model: 'gpt-5.6-terra', label: 'GPT Terra' },
};
const dmArmName = String(ARGS.dm || 'gemini');
if (!DM_ARMS[dmArmName]) {
    console.error(`--dm must be one of ${Object.keys(DM_ARMS).join(' | ')} (the Grok DM is never used in playtests).`);
    process.exit(1);
}
const DM = DM_ARMS[dmArmName];
const dmKey = DM.provider === 'openai' ? OPENAI_API_KEY : GEMINI_API_KEY;
if (!dmKey || !GEMINI_API_KEY) {
    console.error('Missing API key(s) (env or .env): the DM provider key + GEMINI_API_KEY for the machinery.');
    process.exit(1);
}

/** The app's own machinery constant, read from source so a rename is noticed. */
function readAppConstant(file, name, fallback) {
    try {
        const src = fs.readFileSync(path.resolve(file), 'utf8');
        const m = src.match(new RegExp(`export const ${name}\\s*=\\s*['"\`]?([^'"\`;\\n]+)`));
        return m ? m[1].trim() : fallback;
    } catch { return fallback; }
}
const APP_MACHINERY_MODEL = readAppConstant('src/llm/machinery.js', 'MACHINERY_MODEL', 'gemini-3.7-flash');
const APP_EMBED_DIMS = Number(readAppConstant('src/llm/providers/gemini.js', 'GEMINI_EMBED_DIMENSIONS', '768')) || 768;
const MACHINERY_MODEL = String(ARGS.machinery || APP_MACHINERY_MODEL);
const EMBED_DIMS = Number(ARGS['embed-dims'] || APP_EMBED_DIMS);
const EMBED_DIMS_OVERRIDABLE = EMBED_DIMS === APP_EMBED_DIMS;
const EMBED_DIMS_TODO = 'TODO(src override): the 1536-dim arm needs `GEMINI_EMBED_DIMENSIONS` in src/llm/providers/gemini.js:14 '
    + '(and the derived `GEMINI_EMBED_SCHEMA`) to be overridable from outside src — e.g. a `?embedDims=` query flag under the '
    + '`debugState` gate — because `isEmbeddingVector` / `loadPersistedEmbeddings` reject any vector whose length differs from the constant, '
    + 'so a request-body rewrite from the harness cannot do it.';
if (!EMBED_DIMS_OVERRIDABLE) {
    console.error(`--embed-dims ${EMBED_DIMS}: not runnable without a source override.\n${EMBED_DIMS_TODO}`);
    process.exit(1);
}

const TURNS = Math.max(4, Number(ARGS.turns || 30) || 30);
const CHECKPOINTS = (() => {
    const list = String(ARGS.checkpoints || '10,20,30').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
    const kept = [...new Set(list)].filter(n => n <= TURNS).sort((a, b) => a - b);
    return kept.length ? kept : [TURNS];
})();
const STARTER_ID = String(ARGS.starter || 'saltmere-debt');
const STARTER_TITLES = { 'saltmere-debt': 'The Debt at Saltmere' };
if (!STARTER_TITLES[STARTER_ID]) {
    console.error(`The probe's seeds are written for the "saltmere-debt" starter; "${STARTER_ID}" has no seed set.`);
    process.exit(1);
}
const HERO_NAME = String(ARGS.hero || 'Kerttu Vaara');
const APP_URL = String(ARGS.url || process.env.QUEST_FORGE_TEST_URL || 'http://localhost:4181/?debugState=1');
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROXY_ARGS = process.env.HTTPS_PROXY
    ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--ssl-version-max=tls1.2']
    : [];

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RUN_LABEL = String(ARGS.label || `${dmArmName}-${MACHINERY_MODEL.replace(/^gemini-/, '')}-${EMBED_DIMS}d-t${TURNS}`);
const OUT_DIR = path.resolve(`test-results/commitments/${stamp}-${RUN_LABEL}`);
const PROFILE_DIR = path.join(OUT_DIR, 'profile');
fs.mkdirSync(OUT_DIR, { recursive: true });

const delay = ms => new Promise(r => setTimeout(r, ms));
const notes = [];
function note(kind, message, extra = {}) {
    notes.push({ t: new Date().toISOString(), kind, message, ...extra });
    console.log(`[${kind}] ${String(message).slice(0, 300)}`);
}
const turns = [];
function saveAll() {
    fs.writeFileSync(path.join(OUT_DIR, 'log.json'), JSON.stringify(notes, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'turns.json'), JSON.stringify(turns, null, 2));
}
async function shot(page, name) {
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true }).catch(() => {});
}

// ---------------------------------------------------------------------------
// The judge: the machinery arm's Flash model, thinking-free, JSON-only.
// ---------------------------------------------------------------------------
const judgeUsage = { calls: 0, promptTokens: 0, outputTokens: 0, failures: 0 };
async function flash(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MACHINERY_MODEL}:generateContent`;
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
            judgeUsage.calls += 1;
            judgeUsage.promptTokens += body.usageMetadata?.promptTokenCount || 0;
            judgeUsage.outputTokens += body.usageMetadata?.candidatesTokenCount || 0;
            const text = (body.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
            return JSON.parse(text.replace(/^```json\s*|```$/g, '').trim());
        } catch (err) {
            if (attempt === 3) { judgeUsage.failures += 1; note('judge-fail', String(err).slice(0, 200)); return null; }
            await delay(2500 * (attempt + 1));
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Request capture + the machinery-model arm (URL rewrite through interception)
// ---------------------------------------------------------------------------
const captured = [];        // { t, kind, lane, model, requestedModel, sys, window, bytes, usage, embedDims }
const byRequest = new WeakMap();
const consoleLines = [];
const observedModels = new Set();
const observedEmbedDims = new Set();

function laneOf(sys, url) {
    if (/:(batchEmbedContents|embedContent)/.test(url)) return 'embed';
    if (/meticulous game world record-keeper/i.test(sys)) return 'scribe';
    if (/meticulous chronicler summarizing/i.test(sys)) return 'journal';
    if (/private campaign continuity assistant/i.test(sys)) return 'reflection';
    if (/private wonder director/i.test(sys)) return 'wonder';
    if (/private living-world director|living-world director/i.test(sys)) return 'fronts';
    return 'other';
}

function attachCapture(page) {
    page.on('request', (req) => {
        let entry = null;
        let url = req.url();
        try {
            if (req.method() === 'POST') {
                const isGemini = url.includes('generativelanguage.googleapis.com') && /:(stream)?generateContent|:(batchEmbedContents|embedContent)/i.test(url);
                const isOpenAI = url.includes('api.openai.com/v1/chat/completions');
                if (isGemini || isOpenAI) {
                    const raw = req.postData() || '';
                    let body = {};
                    try { body = JSON.parse(raw); } catch { body = {}; }
                    let sys = '';
                    let windowText = '';
                    let reqModel = '';
                    if (isGemini) {
                        sys = body.system_instruction?.parts?.map(p => p.text).join('\n') || body.systemInstruction?.parts?.map(p => p.text).join('\n') || '';
                        windowText = (body.contents || []).map(c => `[${c.role}] ${(c.parts || []).map(p => p.text || '').join('\n')}`).join('\n\n');
                        reqModel = (url.match(/models\/([^:/?]+)/) || [])[1] || '';
                    } else {
                        const m = (body.messages || []).find(x => x.role === 'system' || x.role === 'developer');
                        sys = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content || '');
                        windowText = (body.messages || []).filter(x => x.role === 'user' || x.role === 'assistant')
                            .map(x => `[${x.role}] ${typeof x.content === 'string' ? x.content : JSON.stringify(x.content)}`).join('\n\n');
                        reqModel = body.model || '';
                    }
                    const requestedModel = reqModel;
                    const isMachinery = isGemini && reqModel === APP_MACHINERY_MODEL;
                    // The arm: the app's constant rides in the URL, so the harness swaps it here.
                    if (isMachinery && MACHINERY_MODEL !== APP_MACHINERY_MODEL) {
                        url = url.replace(`/models/${APP_MACHINERY_MODEL}:`, `/models/${MACHINERY_MODEL}:`);
                        reqModel = MACHINERY_MODEL;
                    }
                    const lane = laneOf(sys, url);
                    // The DM prompt carries the cached prefix; a background director on the DM model does not.
                    const isDmPrompt = /## CRITICAL RULES|## PLAYER CHARACTER/.test(sys);
                    const kind = lane === 'embed' ? 'embed' : (!isMachinery && reqModel === DM.model && isDmPrompt) ? 'dm' : (!isMachinery && reqModel === DM.model) ? 'director' : 'machinery';
                    let embedDims = null;
                    if (lane === 'embed') {
                        const reqs = body.requests || [body];
                        embedDims = reqs[0]?.output_dimensionality ?? reqs[0]?.outputDimensionality ?? null;
                        if (embedDims) observedEmbedDims.add(embedDims);
                    } else {
                        observedModels.add(reqModel);
                    }
                    entry = { t: Date.now(), kind, lane, model: reqModel, requestedModel, sys, window: windowText, bytes: Buffer.byteLength(raw, 'utf8'), usage: null, embedDims, status: null };
                    captured.push(entry);
                    byRequest.set(req, entry);
                }
            }
        } catch { /* capture is best-effort */ }
        if (url !== req.url()) req.continue({ url }).catch(() => {});
        else req.continue().catch(() => {});
    });
    page.on('requestfailed', (req) => { const entry = byRequest.get(req); if (entry) entry.status = -1; });
    page.on('response', async (resp) => {
        const entry = byRequest.get(resp.request());
        if (!entry) return;
        entry.status = resp.status();
        try {
            if (entry.lane === 'embed') return;
            const text = await resp.text();
            let usage = null;
            if (entry.model.startsWith('gemini')) {
                if (text.trimStart().startsWith('{')) {
                    usage = JSON.parse(text).usageMetadata || null;
                } else {
                    // SSE stream: the final data line carries usageMetadata.
                    const lines = text.split(/\r?\n/).filter(l => l.startsWith('data:'));
                    for (let i = lines.length - 1; i >= 0; i--) {
                        try {
                            const j = JSON.parse(lines[i].slice(5).trim());
                            if (j.usageMetadata) { usage = j.usageMetadata; break; }
                        } catch { /* keep looking */ }
                    }
                }
            } else if (text.trimStart().startsWith('{')) {
                usage = JSON.parse(text).usage || null;
            }
            if (usage) {
                entry.usage = {
                    prompt: usage.promptTokenCount ?? usage.prompt_tokens ?? null,
                    cached: usage.cachedContentTokenCount ?? usage.prompt_tokens_details?.cached_tokens ?? null,
                    output: usage.candidatesTokenCount ?? usage.completion_tokens ?? null,
                    thoughts: usage.thoughtsTokenCount ?? null,
                    total: usage.totalTokenCount ?? usage.total_tokens ?? null,
                };
            }
        } catch { /* best-effort */ }
    });
    page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error' || msg.type() === 'warning'
            || /\[LLM timing\]|\[ResponseParser\]|\[Scribe\]|\[Journal\]|\[Memory\]|\[Gemini embed\]/.test(text)) {
            consoleLines.push({ t: Date.now(), type: msg.type(), text: text.slice(0, 300) });
            if (msg.type() === 'error') note('console', `error: ${text.slice(0, 260)}`);
        }
    });
    page.on('pageerror', err => note('pageerror', String(err).slice(0, 300)));
}

/** The DM request (system prompt + window) for the newest DM turn since `sinceMs`. */
function dmRequestSince(sinceMs) {
    const dm = captured.filter(c => c.kind === 'dm' && c.t >= sinceMs && c.sys.length > 2000);
    return dm.length ? dm[dm.length - 1] : null;
}

// ---------------------------------------------------------------------------
// DOM / state helpers (the recall-wonder harness pattern)
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

/** Compact live snapshot: everything the probe needs, never settings / keys. */
async function snap(page) {
    return await page.evaluate(() => {
        const s = window.__QF_STATE__;
        if (!s) return null;
        const msgs = (s.messages || []).map(m => ({ role: m.role, kind: m.kind || null, hidden: !!m.hidden, deleted: !!m.deleted }));
        const c = s.character || {};
        return {
            msgCount: msgs.length,
            lastAssistantIdx: (() => { for (let i = (s.messages || []).length - 1; i >= 0; i--) { const m = s.messages[i]; if (m.role === 'assistant' && !m.hidden && !m.deleted && typeof m.content === 'string' && m.content.trim()) return i; } return -1; })(),
            location: s.currentLocation,
            purse: { gold: c.gold ?? null, silver: c.silver ?? null, copper: c.copper ?? null },
            hp: c.currentHP ?? null,
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
            },
            worldFacts: (s.worldFacts || []).map(f => ({
                id: f.id, fact: String(f.fact || ''), knownBy: f.knownBy || null,
                supersededBy: f.supersededBy || null, supersedes: f.supersedes || null, atMessage: f.atMessage ?? f.messageIndex ?? null,
            })),
            cards: (s.storyMemory || []).map(card => ({
                id: card.id, type: card.type, status: card.status, salience: card.salience,
                subject: card.subject, text: String(card.text || '').slice(0, 260), knownBy: card.knownBy || null,
            })),
            journal: (s.journal || []).map(e => ({ summary: String(e.summary || '').slice(0, 400), fallback: !!e.fallback })),
            npcs: (s.npcs || []).map(n => ({ name: n.name, secrets: String(n.secrets || '').slice(0, 200), knownFacts: n.knownFacts || null })),
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

/** Wait until the background lanes (Scribe, journal, embeds) have been quiet for `quietMs`. */
async function settleBackground(page, { quietMs = 9000, maxMs = 75000 } = {}) {
    const start = Date.now();
    let last = '';
    let lastChange = Date.now();
    while (true) {
        const s = await snap(page);
        const inflight = captured.filter(c => c.kind !== 'dm' && c.status === null && Date.now() - c.t < 120000).length;
        const sig = s ? JSON.stringify([s.counts, s.msgCount, captured.length, inflight]) : 'x';
        if (sig !== last) { last = sig; lastChange = Date.now(); }
        const quiet = Date.now() - lastChange >= quietMs && inflight === 0;
        if (quiet || Date.now() - start > maxMs) return s;
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
    if (!sent) note('warn', 'Send button not found / not clickable.');
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
            // The hero's stated rule is "never steel in the harbor" — the probe fights with fists, honoring it.
            const action = `I go at the ${target.n} with my fists, never drawing steel.`;
            note('combat', `${action} (enemy hp ${target.hp})`);
            await typeAndSend(page, action);
            await waitForIdle(page);
        } else {
            await waitForIdle(page);
        }
    }
    note('warn', 'Combat did not resolve within the iteration budget.');
    return maxIters;
}

let turnNo = 0;      // every player line (seeds, fillers, probe questions)
let playTurnNo = 0;  // seeds + fillers only — the checkpoint clock
/**
 * One full turn: send, wait, proposals, combat, background settle. Returns the
 * before/after snapshots, the DM reply, the request the provider received, and
 * the machinery telemetry the turn produced.
 */
async function playTurn(page, label, action, { countsAsPlay = true } = {}) {
    turnNo += 1;
    if (countsAsPlay) playTurnNo += 1;
    const before = await snap(page);
    const t0 = Date.now();
    const capFrom = captured.length;
    note('turn', `#${turnNo}${countsAsPlay ? ` (play ${playTurnNo})` : ''} ${label}: "${action.slice(0, 200)}"`);
    await typeAndSend(page, action);
    await waitForIdle(page);
    await handleProposal(page);
    const combatIters = (await snap(page))?.combat ? await resolveCombat(page) : 0;
    let after = await settleBackground(page);
    // Infrastructure guard (the 2026-09-19 dmFresh rule): a provider outage leaves
    // the turn without a NEW DM message; never score the previous reply as the answer.
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
        after = await settleBackground(page);
    }
    const dmFresh = (after?.lastAssistantIdx ?? -1) > beforeIdx;
    const dm = dmFresh ? await lastDmMessage(page) : '';
    const request = dmRequestSince(t0);
    const calls = captured.slice(capFrom);
    const telemetry = summarizeCalls(calls);
    const record = {
        turn: turnNo, playTurn: countsAsPlay ? playTurnNo : null, label, action, secs: Math.round((Date.now() - t0) / 1000),
        msgBefore: before?.msgCount, msgAfter: after?.msgCount, combatIters, location: after?.location || null,
        dm, dmFresh, infraRetries,
        promptChars: request ? request.sys.length : 0,
        dmUsage: request?.usage || null,
        hasRecordBlock: !!request && request.sys.includes('## THE RECORD'),
        counts: after?.counts || null,
        telemetry,
    };
    turns.push(record);
    saveAll();
    return { before, after, dm, request, record };
}

function summarizeCalls(calls) {
    const lanes = {};
    for (const c of calls) {
        const key = c.kind === 'dm' ? 'dm' : c.kind === 'director' ? 'director' : c.lane;
        const row = lanes[key] || (lanes[key] = { calls: 0, bytes: 0, promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, usageKnown: 0, failed: 0, models: new Set() });
        row.calls += 1;
        row.bytes += c.bytes;
        row.models.add(c.model);
        if (c.status && c.status >= 400) row.failed += 1;
        if (c.usage) {
            row.usageKnown += 1;
            row.promptTokens += c.usage.prompt || 0;
            row.outputTokens += c.usage.output || 0;
            row.thoughtTokens += c.usage.thoughts || 0;
            row.cachedTokens += c.usage.cached || 0;
        }
    }
    for (const row of Object.values(lanes)) row.models = [...row.models];
    return lanes;
}

// ---------------------------------------------------------------------------
// Wizard: the fixed starter premise
// ---------------------------------------------------------------------------
async function bootAndCreateHero(page) {
    await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(2000);
    note('setup', `Run "${RUN_LABEL}" — DM ${DM.label} (${DM.provider} / ${DM.model}); machinery ${MACHINERY_MODEL}${MACHINERY_MODEL !== APP_MACHINERY_MODEL ? ` (rewritten from ${APP_MACHINERY_MODEL} at the request)` : ''}; embed dims ${EMBED_DIMS}; turns ${TURNS}; checkpoints ${CHECKPOINTS.join('/')}.`);
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
    }, { providerName: DM.provider, modelName: DM.model, key: dmKey, geminiKey: GEMINI_API_KEY });
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2000);

    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(1000);
    await page.click('.creation-card'); // Forge a New Hero
    await delay(800);
    await page.waitForSelector('.creation-input');
    if (!await reactFill(page, `el => (el.placeholder || '').startsWith('Enter your character')`, HERO_NAME)) {
        throw new Error('Name input not found.');
    }
    await reactFill(page, `el => (el.placeholder || '').startsWith('Gender')`, 'woman');
    await reactFill(page, `el => (el.placeholder || '').startsWith('Appearance')`,
        'Wiry and weather-burned, brown skin, black hair in a tarred braid, a rope scar across the right palm.');
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
    if (!await clickByText(page, '.premise-starter-card', STARTER_TITLES[STARTER_ID])) throw new Error(`Starter card "${STARTER_TITLES[STARTER_ID]}" not found.`);
    await delay(500);
    const filled = await page.evaluate(() => (document.querySelector('textarea')?.value || '').length);
    if (filled < 100) throw new Error('Starter tap did not fill the premise box.');
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
    note('wizard', 'Begin Adventure — waiting for the opening scene.');
    const t0 = Date.now();
    await waitForIdle(page, { timeout: 300000 });
    await delay(2500);
    const opening = await settleBackground(page);
    const openingDm = await lastDmMessage(page);
    note('opening', openingDm.slice(0, 800));
    turns.push({ turn: 0, playTurn: 0, label: 'opening', action: '(premise opening)', secs: Math.round((Date.now() - t0) / 1000), dm: openingDm, dmFresh: !!openingDm, counts: opening?.counts || null, telemetry: summarizeCalls(captured) });
    return opening;
}

// ---------------------------------------------------------------------------
// SEEDS — the structured commitments (NCP-Bench shape), planted through the
// player's own lines. Each seed is a knowledge point with a ground-truth
// extractor question; `followUps` re-press an NPC that answered vaguely.
// ---------------------------------------------------------------------------
const SEEDS = [
    {
        id: 'P1', kind: 'promise-hero-to-npc', label: 'Hero promises Tammo the Gannet Rock row-out before the gales',
        line: 'I sit on the stool by Tammo\'s brazier and say it plainly: "Tammo, I promise you this — before the autumn gales I will row out to Gannet Rock myself and find out why the light has gone dark. You have my word." Then I wait for him to answer.',
        followUps: ['"Do you accept that, Tammo? Say it back to me so we both know what I have sworn."'],
        truthQ: 'Did the hero promise Old Tammo something, and did Tammo acknowledge or accept it on screen? State exactly what was promised (the thing and the deadline).',
    },
    {
        id: 'F1a', kind: 'fact-before-flip', label: 'The spare sail is stowed in the net-loft rafters',
        line: 'I climb into Tammo\'s net-loft and stow the Kittiwake\'s spare sail up on the rafters, out of the damp, then tell Tammo it is there so he knows.',
        followUps: ['I point up at the rafters: "There, Tammo — the Kittiwake\'s spare sail. Remember where it is."'],
        truthQ: 'Is the location of the Kittiwake\'s spare sail established on screen (the DM shows it stowed, and where)? State where it is.',
    },
    {
        id: 'D1', kind: 'debt-hero-owes', label: 'The hero\'s ledger line at Orsa\'s (an exact figure)',
        line: 'I go to Orsa Pellwyn at her ledger. "Read me my line, Harbormaster. By my own count I owe you eleven silver and four copper for the Kittiwake\'s berth and the net-cord. Is that the figure in your book?"',
        followUps: ['I press her: "The number, Orsa — to the copper. What does the ledger say I owe you?"', '"Read the ledger line aloud, Harbormaster. The exact figure."'],
        truthQ: 'Did the DM (through Orsa or the ledger) state an EXACT coin figure the hero owes? Give the amount with its denomination(s) and who it is owed to.',
    },
    {
        id: 'K1', kind: 'secret-one-npc', label: 'The secret told to Tammo alone (the brother\'s bond at Varrowgate)',
        line: 'I leave Orsa and her ledger, walk back out to the seaward pier, and draw Tammo aside by his brazier where nobody else can hear. "This stays between us, Tammo — no one else, not Orsa. The coin I am scraping together is not for the ledger. My brother sits in the debtors\' cells at Varrowgate and I am buying his bond. Swear you will keep it."',
        followUps: ['"Swear it, Tammo. My brother, the cells at Varrowgate, the bond — nobody hears it from you."'],
        truthQ: 'Did the hero tell Tammo a secret PRIVATELY (nobody else present), and did Tammo take it? State the secret\'s particulars exactly as established, and whether anyone else was shown to overhear.',
    },
    {
        id: 'R1', kind: 'rule-vow', label: 'The hero\'s rule: never steel inside Saltmere harbor',
        line: 'I tell Tammo my rule, the one I keep whatever comes: "I never draw a blade inside Saltmere harbor. Not for a thief, not for a drunk, not for Orsa\'s bailiffs. Fists if I must — never steel." I want him to remember that about me.',
        followUps: ['"You heard me, old man? Never steel in this harbor. Say it back so I know it stuck."'],
        truthQ: 'Did the hero state a personal rule or vow, and did the DM show Tammo hearing / acknowledging it? State the rule exactly.',
    },
    {
        id: 'D2', kind: 'debt-npc-owes', label: 'Tammo owes the hero three silver from midsummer dice',
        line: 'I lean on the pier rail beside Tammo. "And you still owe me the three silver from the dice at midsummer, old man — I have not forgotten. Will you pay it before the gales?"',
        followUps: ['"Say it, Tammo: three silver, owed to me since midsummer. When do I see it?"'],
        truthQ: 'Did Tammo acknowledge owing the hero a SPECIFIC amount (and from what)? Give the amount and any promised payment time.',
    },
    {
        id: 'T1', kind: 'transient-state', label: 'The harbor road is flooded at the spring tide (a state, not a fact)',
        line: 'I walk to the top of the harbor road. The spring tide has it under a foot of water again — the carts are waiting at the top for it to drain. I tell the carter I will come back when it is dry.',
        followUps: ['I look down the harbor road again: still under water at this tide? I ask the carter how long it usually takes to drain.'],
        truthQ: 'Did the DM establish the harbor road as currently FLOODED (under water) — a state tied to the tide? State what was established about it, including anything about when it drains.',
    },
    {
        id: 'P2', kind: 'promise-npc-to-hero', label: 'Orsa\'s conditional promise about the spring haul',
        line: '"Orsa — if I settle every copper of my line by the tide-bell tomorrow, promise me the Kittiwake\'s first spring haul is mine to sell, not yours. I want your word on it, here, in front of the ledger."',
        followUps: ['"Your word, Harbormaster. Say it plainly: settle by the tide-bell, and the first spring haul is mine. Yes or no?"'],
        truthQ: 'Did Orsa make a SPECIFIC promise to the hero (what she will do or grant, on what condition) — either the one asked for or a concrete counter-offer she committed to? State it exactly. A refusal with no commitment is established=false.',
    },
    {
        id: 'F1b', kind: 'fact-flip', label: 'The spare sail moves aboard the Kittiwake, under the foredeck (marker-free flip of F1a)',
        line: 'I fetch the spare sail down from the net-loft rafters and lash it aboard the Kittiwake, under the foredeck, where I can reach it in a blow.',
        followUps: ['I check the lashing on the spare sail under the Kittiwake\'s foredeck one more time and tell Tammo it is aboard now.'],
        truthQ: 'Is the Kittiwake\'s spare sail now established as being ABOARD the Kittiwake (under the foredeck), no longer in the net-loft? State where it is now.',
    },
];

const truths = {}; // seed id -> { established, detail, keywords, verbatim, plantedTurn, attempts } | null

async function extractTruth(seed, playerLine, dmText) {
    const prompt = `You audit a tabletop RPG transcript. Determine whether a specific fact was ESTABLISHED ON SCREEN by the DM.

Player's line: ${playerLine}
DM's reply:
"""
${String(dmText).slice(0, 9000)}
"""

Question: ${seed.truthQ}

Rules: established=true ONLY if the DM's reply explicitly shows it (for a promise: it is made and the other party acknowledges it; for a debt: an exact figure is stated; for a stored object: the DM shows where it now is). Do not infer. If the DM was vague ("a large sum", "somewhere safe") with no concrete particular, established=false.
Return JSON: {"established": boolean, "detail": "one precise sentence with the exact particulars (names, numbers, places, objects, conditions)", "keywords": ["3-6 exact strings a correct later recall must contain (numbers, proper names, the object) — never the hero's own name"], "verbatim": "the shortest exact quote from the DM's reply that carries the fact, or empty"}`;
    return await flash(prompt);
}

/** Plant one seed, retrying with follow-up lines until the DM states it concretely. */
async function plantSeed(page, seed) {
    const lines = [seed.line, ...seed.followUps];
    let lastTruth = null;
    for (let attempt = 0; attempt < lines.length; attempt++) {
        const { dm, record } = await playTurn(page, `seed:${seed.id}${attempt ? `:retry${attempt}` : ''}`, lines[attempt]);
        if (!record.dmFresh) { note('warn', `Seed ${seed.id}: no DM reply this attempt.`); continue; }
        const truth = await extractTruth(seed, lines[attempt], dm);
        lastTruth = truth;
        note('truth', `${seed.id} (attempt ${attempt + 1}): ${JSON.stringify(truth)}`);
        if (truth?.established) {
            truths[seed.id] = { ...truth, plantedTurn: turnNo, plantedPlayTurn: playTurnNo, attempts: attempt + 1, line: lines[attempt] };
            return true;
        }
    }
    note('warn', `Seed "${seed.id}" was never concretely established after ${lines.length} attempt(s).`);
    truths[seed.id] = { established: false, detail: lastTruth?.detail || null, keywords: lastTruth?.keywords || [], plantedTurn: turnNo, plantedPlayTurn: playTurnNo, attempts: lines.length, line: seed.line };
    return false;
}

const FILLERS = [
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
    'I walk the length of the breakwater and back, checking the mooring rings.',
    'I sit by Tammo\'s brazier and let him tell one of his long stories about the old harbor.',
    'I haggle with the salt-seller over a half-sack and settle for a fair price.',
    'I splice a frayed halyard for one of the other boats and take a cup of fish soup as thanks.',
    'I climb the tide-bell tower steps to look at the weather coming in from the west.',
    'I help a fisherwoman unload her catch and learn the names of her children.',
    'I wash the salt out of my braid at the pump and rest my feet.',
    'I sort the good herring from the bruised on the sorting table by the barrels.',
    'I sweep out the Kittiwake\'s hold and lay fresh straw in the fish-well.',
    'I share a pipe with the carter at the top of the road and talk about the roads inland.',
    'I check the Kittiwake\'s mooring lines against the swell before dark.',
    'I bring Tammo a jug of small beer and sit a while without saying much.',
    'I oil the Kittiwake\'s tholes and tiller and stow the oars neatly.',
    'I watch the gulls fight over the gutting-scraps and stretch my back.',
    'I ask the tide-bell keeper what hour the tide turns tomorrow.',
];

// ---------------------------------------------------------------------------
// QUESTIONS — the knowledge points (MemTrace: age × type × evidence condition)
// ---------------------------------------------------------------------------
const QUESTIONS = [
    { id: 'P1-recall', seed: 'P1', type: 'recall', text: 'I sit with Tammo. "Remind me, old man — what exactly did I swear to you, and by when?"',
      rule: 'Correct if the answer names the row-out to Gannet Rock / the dark light AND the deadline (before the autumn gales).' },
    { id: 'P1-inference', seed: 'P1', type: 'inference', text: 'The wind is backing north and the fishermen say the first gale of autumn is two days off. I think about what that means for the thing I swore to Tammo.',
      rule: 'Correct if the answer connects the coming gale to the promise — the Gannet Rock row-out must happen NOW / before the gale, or is about to fall due. Partial if the promise is remembered but not connected to the deadline.' },
    { id: 'D1-recall', seed: 'D1', type: 'recall', text: '"Orsa, what is my line in the ledger today — the figure, to the copper?"',
      rule: 'Correct if the exact figure and denomination(s) match the ground truth (unless the transcript shows a later payment; none was made). Wrong figure = incorrect.' },
    { id: 'D1-inference', seed: 'D1', type: 'inference', text: '"Orsa, if I put one gold coin on this ledger tomorrow, would that clear my line, or would I still be short — and by how much?"',
      rule: 'One gold = 10 silver, one silver = 10 copper. Correct if the arithmetic against the ground-truth figure is right (e.g. 11 silver 4 copper owed: one gold leaves the hero 1 silver 4 copper short). Partial if the debt is remembered but the arithmetic is wrong or dodged.' },
    { id: 'D2-recall', seed: 'D2', type: 'recall', text: '"Tammo — how much do you still owe me, and from what?"',
      rule: 'Correct if the answer matches the ground-truth STATE of the debt: three silver from the midsummer dice still owed — or, if the ground truth says Tammo already paid it, that it was paid (three silver) and nothing is owed. A wrong amount, a forgotten debt, or a paid debt re-owed is incorrect.' },
    { id: 'R1-recall', seed: 'R1', type: 'recall', text: '"Tammo, you know my rule about steel in this harbor. Say it back to me."',
      rule: 'Correct if the rule is stated: never draw a blade inside Saltmere harbor (fists if needed).' },
    { id: 'R1-inference', seed: 'R1', type: 'inference', text: 'A drunk deckhand shoves me on the quay and reaches for my collar. I keep to the rule I told Tammo about — what do I do, and what does Tammo expect of me?',
      rule: 'Correct if the narration honors the rule (no blade drawn; fists / restraint / walking away) and Tammo\'s expectation matches. Incorrect if the hero draws steel or the rule is absent / contradicted.' },
    { id: 'P2-recall', seed: 'P2', type: 'recall', text: '"Orsa, remind me what you promised me about the spring haul, and on what condition."',
      rule: 'Correct if Orsa\'s promise and its condition match the ground truth (or, if she refused on record, the answer says she promised nothing).' },
    { id: 'F1-recall', seed: 'F1b', type: 'recall', text: '"Tammo, where is the Kittiwake\'s spare sail right now? I want to be sure."',
      rule: 'Correct ONLY if the answer places the sail aboard the Kittiwake (under the foredeck). "In the net-loft / on the rafters" is the SUPERSEDED location and is incorrect (contradicted).' },
    { id: 'F1-flip', seed: 'F1b', type: 'flip-awareness', text: '"Was the spare sail always aboard the Kittiwake, Tammo? Where did I keep it before?"',
      rule: 'Correct if the answer knows BOTH states in order: it was in the net-loft rafters before and is aboard under the foredeck now. Partial if only one state is known.' },
    { id: 'T1-state', seed: 'T1', type: 'state-persistence', text: 'I look up toward the harbor road. Is it still under water, or has the tide let it drain by now?',
      rule: 'Correct if the answer treats the flooding as a TIDE-BOUND, transient state — it has drained, or is under water again at this tide, or someone checks — i.e. it is not asserted as a standing permanent fact and not denied ever having happened. Incorrect if the DM asserts the road is flooded as a timeless unchanged fact with no reference to tide/time, or denies it was ever flooded.' },
    { id: 'K1-secrecy', seed: 'K1', type: 'secrecy', text: '"Orsa, you have watched me count every copper for weeks. Tell me straight — do you know what I actually need the coin for?"',
      rule: 'Correct if Orsa shows NO knowledge of the secret\'s particulars (the brother, the debtors\' cells at Varrowgate, the bond) — she may guess wrong, shrug, or not care. Incorrect if Orsa states any particular of the secret (a leak). Partial if she hints at it in a way that could only come from the secret.' },
    { id: 'K1-recall', seed: 'K1', type: 'recall', text: 'I catch Tammo\'s eye when Orsa has gone. "What I told you, about why I need the coin — you still remember it? Say it low."',
      rule: 'Correct if Tammo recalls the particulars (the brother, the debtors\' cells at Varrowgate, buying his bond).' },
];

// ---------------------------------------------------------------------------
// Evidence: where in the prompt the provider ACTUALLY received did the fact sit?
// ---------------------------------------------------------------------------
const SECTION_HEADERS = [
    ['record', '## THE RECORD'],
    ['rag', '## RETRIEVED MEMORIES'],
    ['journal', '## SESSION HISTORY'],
    ['facts', '## WORLD FACTS'],
    ['cards', '## DRAMATIC CALLBACK OPPORTUNITIES'],
    ['npcs', '## KNOWN NPCs'],
    ['quests', '## ACTIVE QUESTS'],
    ['premise', '## CAMPAIGN PREMISE'],
];
function splitSections(sys) {
    const marks = [];
    for (const [key, header] of SECTION_HEADERS) {
        const at = sys.indexOf(header);
        if (at !== -1) marks.push({ key, at });
    }
    marks.sort((a, b) => a.at - b.at);
    const out = {};
    for (let i = 0; i < marks.length; i++) {
        const start = marks[i].at;
        // A section runs until the next "\n## " header (any header, not only the ones we track).
        const nextHeader = sys.indexOf('\n## ', start + 4);
        const end = nextHeader === -1 ? sys.length : nextHeader;
        out[marks[i].key] = sys.slice(start, end);
    }
    return out;
}
function keywordHits(line, keywords) {
    const lower = line.toLowerCase();
    return keywords.filter(k => k && lower.includes(String(k).toLowerCase())).length;
}
function findEvidence(request, keywords) {
    if (!request) return { sections: [], snippets: [], condition: 'no-request' };
    const kws = (keywords || []).map(k => String(k)).filter(k => k.length >= 3);
    const minHits = kws.length <= 2 ? 1 : 2;
    const snippets = [];
    const sections = new Set();
    const scan = (key, text) => {
        for (const rawLine of String(text || '').split(/\n+/)) {
            const line = rawLine.trim();
            if (!line) continue;
            const hits = keywordHits(line, kws);
            if (hits >= minHits) {
                sections.add(key);
                snippets.push({ section: key, hits, text: line.slice(0, 320) });
            }
        }
    };
    scan('window', request.window);
    const sys = splitSections(request.sys);
    for (const [key, text] of Object.entries(sys)) scan(key, text);
    snippets.sort((a, b) => b.hits - a.hits);
    const has = k => sections.has(k);
    let condition = 'missing';
    if (has('window')) condition = 'in-window';
    else if (has('journal') && !has('rag')) condition = 'journal-only';
    else if (has('rag') && !has('journal')) condition = 'rag-only';
    else if (has('journal') && has('rag')) condition = 'journal+rag';
    else if (has('record')) condition = 'record';
    else if (has('facts') || has('cards') || has('npcs') || has('quests')) condition = 'typed-block';
    else if (has('premise')) condition = 'premise';
    return { sections: [...sections], snippets: snippets.slice(0, 14), condition };
}

async function judgeAnswer(question, truth, answer, evidence) {
    const prompt = `You judge whether a tabletop-RPG DM's answer preserved a commitment / fact established earlier in the same campaign.

GROUND TRUTH (established on screen ${truth.plantedTurn} turns into the campaign): ${truth.detail}
Keywords a correct answer should carry: ${JSON.stringify(truth.keywords || [])}
Question type: ${question.type}
Scoring rule for this question: ${question.rule}

The player's line (the question): ${question.text}
The DM's answer:
"""
${String(answer).slice(0, 6000)}
"""

EVIDENCE the DM's prompt actually contained about this fact (lines pulled from the prompt by keyword; section = where in the prompt):
${evidence.snippets.length ? evidence.snippets.map(s => `- [${s.section}] ${s.text}`).join('\n') : '(no line of the prompt carried the keywords)'}

Return JSON:
{"correct": "yes" | "partial" | "no",
 "evidence_present": boolean  (true ONLY if the evidence lines above actually carry the ground-truth particulars — a line that merely shares a name is not evidence),
 "contradicted": boolean (the answer states something incompatible with the ground truth),
 "leak": boolean (secrecy questions only: the NPC revealed a particular they could not know; otherwise false),
 "note": "one short sentence: what the answer said about the fact"}`;
    return await flash(prompt);
}

async function judgeConflicts(facts) {
    if (facts.length < 2) return { pairs: [] };
    const listed = facts.map((f, i) => `${i + 1}. ${f.fact}`).join('\n');
    const prompt = `Below are the LIVE world facts of an RPG campaign (facts the engine treats as simultaneously true). Find every pair that CONTRADICTS — two statements that cannot both be true at once (a value flip, an object in two places, a person in two states, opposite claims). Restatements and compatible details are NOT conflicts.

${listed}

Return JSON: {"pairs": [{"a": <number>, "b": <number>, "why": "one short sentence"}]}`;
    const out = await flash(prompt);
    const pairs = Array.isArray(out?.pairs) ? out.pairs.filter(p => Number.isInteger(p.a) && Number.isInteger(p.b) && p.a >= 1 && p.b >= 1 && p.a <= facts.length && p.b <= facts.length && p.a !== p.b) : [];
    return { pairs: pairs.map(p => ({ a: facts[p.a - 1].fact, b: facts[p.b - 1].fact, why: String(p.why || '') })) };
}

async function judgePrecision(facts, cards, seedsSummary) {
    const rows = [
        ...facts.map((f, i) => ({ key: `F${i + 1}`, kind: 'fact', text: f.fact })),
        ...cards.map((c, i) => ({ key: `C${i + 1}`, kind: `card:${c.type}`, text: `${c.subject ? c.subject + ' — ' : ''}${c.text}` })),
    ];
    if (!rows.length) return { total: 0, relevant: 0, noise: [], rows: [] };
    const prompt = `An RPG memory system extracted the rows below (world facts and story-memory cards) during ${seedsSummary.turns} turns of play in a fishing harbor. The campaign's DURABLE canon that a DM will need later includes: the commitments the player seeded (${seedsSummary.list}), the premise's people and places, and any genuinely new durable development.

Judge each row: RELEVANT (durable canon a DM needs later — a commitment, a debt, a secret, a rule, a person's standing, a place's nature, a real development) or NOISE (a transient moment, scene color, a restatement of the premise or of another row, a duplicate, or trivia nobody will need).

${rows.map(r => `${r.key} [${r.kind}] ${r.text}`).join('\n')}

Return JSON: {"noise": ["<key>", ...], "notes": "one sentence on the dominant noise type, if any"}`;
    const out = await flash(prompt);
    const noise = Array.isArray(out?.noise) ? out.noise.filter(k => rows.some(r => r.key === k)) : [];
    return { total: rows.length, relevant: rows.length - noise.length, noise: noise.map(k => rows.find(r => r.key === k)), notes: String(out?.notes || ''), rows };
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------
const results = [];       // per-question rows
const checkpoints = [];   // per-checkpoint summaries (conflicts, precision, counts)

async function runCheckpoint(page, cp) {
    const s0 = await snap(page);
    note('checkpoint', `=== Checkpoint at play turn ${cp} (msgs ${s0?.msgCount}, facts ${s0?.counts.worldFacts}, cards ${s0?.counts.storyMemory}, journal ${s0?.counts.journal}) ===`);
    for (const q of QUESTIONS) {
        const truth = truths[q.seed];
        if (!truth) { note('skip', `${q.id}: seed ${q.seed} was never planted.`); continue; }
        const { dm, request, record } = await playTurn(page, `probe:${cp}:${q.id}`, q.text, { countsAsPlay: false });
        const age = turnNo - truth.plantedTurn;
        const evidence = findEvidence(request, truth.keywords);
        const secretTagged = q.type === 'secrecy' && !!request && /\[SECRET — known only to/.test(request.sys);
        const row = {
            checkpoint: cp, id: q.id, seed: q.seed, type: q.type, age, ageSincePlantPlayTurns: cp - truth.plantedPlayTurn,
            turn: turnNo, question: q.text, answer: dm, dmFresh: record.dmFresh, infraRetries: record.infraRetries,
            established: !!truth.established, truth: truth.detail, keywords: truth.keywords,
            evidenceCondition: evidence.condition, evidenceSections: evidence.sections, evidenceSnippets: evidence.snippets,
            recordBlock: record.hasRecordBlock, secretTagged,
            judge: null, verdict: null, missClass: null,
        };
        if (!record.dmFresh) {
            row.verdict = 'void'; row.judge = { note: 'the provider never answered this turn' };
        } else if (!truth.established) {
            row.verdict = 'unseeded'; row.judge = { note: 'the seed was never concretely established; the answer is not scoreable' };
        } else {
            row.judge = await judgeAnswer(q, truth, dm, evidence);
            row.verdict = row.judge?.correct || 'judge-failed';
            const present = !!row.judge?.evidence_present && evidence.condition !== 'missing';
            if (!present && evidence.condition !== 'missing') row.evidenceCondition = 'missing(judged)';
            if (row.verdict === 'no' || row.verdict === 'partial') row.missClass = present ? 'USE' : 'RETRIEVAL';
        }
        results.push(row);
        note('probe', `${cp}/${q.id} age ${age}: ${row.verdict}${row.missClass ? ` (${row.missClass})` : ''} | evidence ${row.evidenceCondition} [${evidence.sections.join(',')}] | ${row.judge?.note || ''}`);
        fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
    }
    // Conflicts + precision at this tenure.
    const s1 = await snap(page);
    const liveFacts = (s1?.worldFacts || []).filter(f => !f.supersededBy);
    const supersededCount = (s1?.worldFacts || []).filter(f => !!f.supersededBy).length;
    const conflicts = await judgeConflicts(liveFacts);
    const seedsSummary = { turns: cp, list: SEEDS.map(sd => sd.label).join('; ') };
    const precision = await judgePrecision(liveFacts, s1?.cards || [], seedsSummary);
    const summary = {
        checkpoint: cp, turn: turnNo, msgCount: s1?.msgCount, counts: s1?.counts,
        liveFacts: liveFacts.length, supersededFacts: supersededCount, conflicts: conflicts.pairs,
        precision: { total: precision.total, relevant: precision.relevant, noiseCount: precision.noise.length, noise: precision.noise, notes: precision.notes },
        facts: liveFacts, cards: s1?.cards || [], journal: s1?.journal || [],
    };
    checkpoints.push(summary);
    note('tenure', `cp ${cp}: live facts ${liveFacts.length} (superseded ${supersededCount}), conflicts ${conflicts.pairs.length}, precision ${precision.relevant}/${precision.total}`);
    fs.writeFileSync(path.join(OUT_DIR, 'checkpoints.json'), JSON.stringify(checkpoints, null, 2));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function pct(n, d) { return d ? `${Math.round((100 * n) / d)}%` : '—'; }
function md(s) { return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

function writeReport({ startedAt, finishedAt, buildInfo }) {
    const scored = results.filter(r => ['yes', 'partial', 'no'].includes(r.verdict));
    const survival = rows => { const y = rows.filter(r => r.verdict === 'yes').length; const p = rows.filter(r => r.verdict === 'partial').length; return { n: rows.length, yes: y, partial: p, no: rows.length - y - p, rate: pct(y, rows.length), rateLenient: pct(y + 0.5 * p, rows.length) }; };
    const groupBy = (rows, fn) => { const m = new Map(); for (const r of rows) { const k = fn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
    const misses = scored.filter(r => r.missClass);
    const retrieval = misses.filter(r => r.missClass === 'RETRIEVAL').length;
    const use = misses.filter(r => r.missClass === 'USE').length;

    // Telemetry per play turn (the write path = scribe + journal + reflection + embed).
    const playRows = turns.filter(t => t.playTurn && t.dmFresh);
    const laneTotals = {};
    for (const t of turns) {
        for (const [lane, row] of Object.entries(t.telemetry || {})) {
            const acc = laneTotals[lane] || (laneTotals[lane] = { calls: 0, bytes: 0, promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, usageKnown: 0, failed: 0, models: new Set() });
            acc.calls += row.calls; acc.bytes += row.bytes; acc.promptTokens += row.promptTokens; acc.outputTokens += row.outputTokens; acc.thoughtTokens += row.thoughtTokens || 0; acc.cachedTokens += row.cachedTokens; acc.usageKnown += row.usageKnown; acc.failed += row.failed;
            for (const m of row.models || []) acc.models.add(m);
        }
    }
    const writeLanes = ['scribe', 'journal', 'reflection', 'embed'];
    const perTurn = lane => {
        const rows = playRows.map(t => t.telemetry?.[lane]).filter(Boolean);
        const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
        return { calls: sum('calls'), promptTokens: sum('promptTokens'), outputTokens: sum('outputTokens'), bytes: sum('bytes'), usageKnown: sum('usageKnown') };
    };
    const writePath = Object.fromEntries(writeLanes.map(l => [l, perTurn(l)]));
    const writeTokensPerTurn = playRows.length
        ? Math.round(writeLanes.filter(l => l !== 'embed').reduce((a, l) => a + writePath[l].promptTokens + writePath[l].outputTokens, 0) / playRows.length)
        : 0;
    const embedBytesPerTurn = playRows.length ? Math.round(writePath.embed.bytes / playRows.length) : 0;
    const dmTurns = turns.filter(t => t.dmUsage && t.dmUsage.prompt);
    const dmPromptAvg = dmTurns.length ? Math.round(dmTurns.reduce((a, t) => a + t.dmUsage.prompt, 0) / dmTurns.length) : null;
    const dmCachedAvg = dmTurns.length ? Math.round(dmTurns.reduce((a, t) => a + (t.dmUsage.cached || 0), 0) / dmTurns.length) : null;
    const totalSecs = Math.round((new Date(finishedAt) - new Date(startedAt)) / 1000);
    const flashPromo = { input: 0.75, output: 3.75 }; // $/M, the promo price in MEMORY_RESEARCH.md C3 (through 2026-12-31); applies to 3.7 and 3.8 Flash alike
    const machineryTokens = { prompt: Object.entries(laneTotals).filter(([l]) => l !== 'dm' && l !== 'embed').reduce((a, [, r]) => a + r.promptTokens, 0), output: Object.entries(laneTotals).filter(([l]) => l !== 'dm' && l !== 'embed').reduce((a, [, r]) => a + r.outputTokens + (r.thoughtTokens || 0), 0) };
    const machineryCost = (machineryTokens.prompt * flashPromo.input + machineryTokens.output * flashPromo.output) / 1e6;
    const judgeCost = (judgeUsage.promptTokens * flashPromo.input + judgeUsage.outputTokens * flashPromo.output) / 1e6;

    const lines = [];
    lines.push(`# Commitment-preservation probe — ${RUN_LABEL}`);
    lines.push('');
    lines.push(`Run ${startedAt} → ${finishedAt} (${Math.round(totalSecs / 60)} min). memory-research M2 (NCP-Bench-shaped seeds; MemDelta / MemTrace / MemStrata / LAPSE protocol). Judge and Scribe on the same machinery model.`);
    lines.push('');
    lines.push('## Arm settings');
    lines.push('');
    lines.push('| Setting | Value |');
    lines.push('|---|---|');
    lines.push(`| DM | ${DM.label} — \`${DM.provider}\` / \`${DM.model}\` (observed DM models: ${[...observedModels].filter(m => m !== MACHINERY_MODEL && m !== APP_MACHINERY_MODEL).join(', ') || '—'}) |`);
    lines.push(`| Machinery model (Scribe + journal + reflection + arbiter + judge) | \`${MACHINERY_MODEL}\`${MACHINERY_MODEL !== APP_MACHINERY_MODEL ? ` — rewritten from the app's \`${APP_MACHINERY_MODEL}\` at the request URL through Puppeteer interception` : ' (the app\'s own constant)'}; observed machinery models: ${[...observedModels].filter(m => /flash/.test(m)).join(', ') || '—'} |`);
    lines.push(`| Embedder | one across arms: \`gemini-embedding-2\`, observed output_dimensionality ${[...observedEmbedDims].join('/') || '(no embed request seen)'} (requested ${EMBED_DIMS}) |`);
    lines.push(`| Starter premise | \`${STARTER_ID}\` — ${STARTER_TITLES[STARTER_ID]}; hero ${HERO_NAME}, Human Fighter |`);
    lines.push(`| Turns / checkpoints | ${TURNS} play turns (seeds + fillers); checkpoints at ${CHECKPOINTS.join(' / ')}; probe questions are extra turns (${turnNo} player lines in all) |`);
    lines.push(`| App | ${APP_URL} (${buildInfo}) |`);
    lines.push('');
    lines.push(`> ${EMBED_DIMS_TODO}`);
    lines.push('');
    lines.push('## Seeds (ground truth as established on screen)');
    lines.push('');
    lines.push('| Seed | Kind | Turn | Attempts | Established | Detail |');
    lines.push('|---|---|---|---|---|---|');
    for (const sd of SEEDS) {
        const t = truths[sd.id];
        lines.push(`| ${sd.id} | ${sd.kind} | ${t?.plantedTurn ?? '—'} | ${t?.attempts ?? '—'} | ${t?.established ? 'yes' : 'NO'} | ${md(t?.detail || sd.label)} |`);
    }
    lines.push('');
    lines.push('## Per-question table');
    lines.push('');
    lines.push('| CP | Question | Type | Age (turns) | Evidence condition | Sections | Verdict | Miss | Judge note |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of results) {
        lines.push(`| ${r.checkpoint} | ${r.id} | ${r.type} | ${r.age} | ${r.evidenceCondition} | ${r.evidenceSections.join(',') || '—'} | ${r.verdict}${r.judge?.contradicted ? ' (contradicted)' : ''}${r.judge?.leak ? ' (LEAK)' : ''} | ${r.missClass || ''} | ${md(r.judge?.note || '')} |`);
    }
    lines.push('');
    lines.push('## Survival');
    lines.push('');
    const all = survival(scored);
    lines.push(`Scored ${all.n} knowledge points: **${all.rate} correct** (${all.yes} yes / ${all.partial} partial / ${all.no} no; lenient with partial = ½: ${all.rateLenient}). Void / unseeded rows: ${results.length - scored.length}.`);
    lines.push('');
    lines.push('### By checkpoint (age band) × question type');
    lines.push('');
    const types = [...new Set(QUESTIONS.map(q => q.type))];
    lines.push(`| Checkpoint | ${types.join(' | ')} | all |`);
    lines.push(`|---|${types.map(() => '---').join('|')}|---|`);
    for (const cp of CHECKPOINTS) {
        const rows = scored.filter(r => r.checkpoint === cp);
        if (!rows.length) continue;
        lines.push(`| ${cp} | ${types.map(ty => { const s = survival(rows.filter(r => r.type === ty)); return s.n ? `${s.yes}/${s.n} (${s.rate})` : '—'; }).join(' | ')} | ${survival(rows).yes}/${rows.length} (${survival(rows).rate}) |`);
    }
    lines.push('');
    lines.push('### By evidence condition');
    lines.push('');
    lines.push('| Evidence condition | n | yes | partial | no | survival | RETRIEVAL misses | USE misses |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const [cond, rows] of groupBy(scored, r => r.evidenceCondition)) {
        const s = survival(rows);
        lines.push(`| ${cond} | ${s.n} | ${s.yes} | ${s.partial} | ${s.no} | ${s.rate} | ${rows.filter(r => r.missClass === 'RETRIEVAL').length} | ${rows.filter(r => r.missClass === 'USE').length} |`);
    }
    lines.push('');
    lines.push('### By age (turns since the seed landed)');
    lines.push('');
    lines.push('| Age band | n | survival |');
    lines.push('|---|---|---|');
    for (const [band, rows] of groupBy(scored, r => r.age < 10 ? '0–9' : r.age < 20 ? '10–19' : r.age < 30 ? '20–29' : '30+')) {
        lines.push(`| ${band} | ${rows.length} | ${survival(rows).rate} |`);
    }
    lines.push('');
    lines.push('## RETRIEVAL vs USE');
    lines.push('');
    lines.push(`${misses.length} misses (no + partial): **${retrieval} RETRIEVAL** (the fact was not in the captured injection — system prompt + message window as the provider received it) vs **${use} USE** (it was there and the DM ignored or contradicted it). Contradictions: ${scored.filter(r => r.judge?.contradicted).length}. Secret leaks: ${scored.filter(r => r.judge?.leak).length}. Record-lane turns: ${results.filter(r => r.recordBlock).length}.`);
    lines.push('');
    lines.push('## Fact conflicts + precision per tenure');
    lines.push('');
    lines.push('| Checkpoint | Live facts | Superseded | Conflicts (live, unsuperseded) | Cards | Facts+cards judged relevant | Precision | Dominant noise |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const c of checkpoints) {
        lines.push(`| ${c.checkpoint} | ${c.liveFacts} | ${c.supersededFacts} | ${c.conflicts.length} | ${c.cards.length} | ${c.precision.relevant}/${c.precision.total} | ${pct(c.precision.relevant, c.precision.total)} | ${md(c.precision.notes)} |`);
    }
    for (const c of checkpoints) {
        if (c.conflicts.length) {
            lines.push('');
            lines.push(`Conflicts at checkpoint ${c.checkpoint}:`);
            for (const p of c.conflicts) lines.push(`- "${md(p.a)}" ⟂ "${md(p.b)}" — ${md(p.why)}`);
        }
        if (c.precision.noise.length) {
            lines.push('');
            lines.push(`Noise at checkpoint ${c.checkpoint}:`);
            for (const n of c.precision.noise) lines.push(`- [${n.kind}] ${md(n.text)}`);
        }
    }
    lines.push('');
    lines.push('## Write-path tokens per play turn (MemDelta)');
    lines.push('');
    lines.push(`Play turns with a DM reply: ${playRows.length}. **Write path ≈ ${writeTokensPerTurn} tokens / turn** (Scribe + journal + reflection prompt + output, from \`usageMetadata\`), embeddings ≈ ${embedBytesPerTurn} request bytes / turn.`);
    lines.push('');
    lines.push('| Lane | Calls (run) | Prompt tokens | Output tokens | Thought tokens | Cached tokens | Request bytes | Usage read on | Failed | Models |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const [lane, r] of Object.entries(laneTotals).sort()) {
        lines.push(`| ${lane} | ${r.calls} | ${r.promptTokens} | ${r.outputTokens} | ${r.thoughtTokens || 0} | ${r.cachedTokens} | ${r.bytes} | ${r.usageKnown}/${r.calls} | ${r.failed} | ${[...r.models].join(', ')} |`);
    }
    lines.push('');
    lines.push(`DM prompt: avg ${dmPromptAvg ?? '—'} tokens, avg cached ${dmCachedAvg ?? '—'} (${dmTurns.length} turns with usage read${DM.provider === 'openai' ? '; OpenAI streams carry no usage without stream_options' : ''}).`);
    lines.push('');
    lines.push('## Cost and time');
    lines.push('');
    lines.push(`- Wall time ${Math.round(totalSecs / 60)} min for ${turnNo} player lines (${playRows.length} play, ${results.length} probes); avg ${turns.length ? Math.round(turns.reduce((a, t) => a + (t.secs || 0), 0) / turns.length) : 0} s per line including background settle.`);
    lines.push(`- Machinery (in-app, ${MACHINERY_MODEL}): ${machineryTokens.prompt} prompt + ${machineryTokens.output} output/thought tokens ≈ $${machineryCost.toFixed(3)} at the Flash promo price ($${flashPromo.input}/M in, $${flashPromo.output}/M out).`);
    lines.push(`- Judge (${MACHINERY_MODEL}): ${judgeUsage.calls} calls, ${judgeUsage.promptTokens} prompt + ${judgeUsage.outputTokens} output tokens ≈ $${judgeCost.toFixed(3)}; ${judgeUsage.failures} failures.`);
    lines.push(`- DM (${DM.model}): ${laneTotals.dm?.calls || 0} calls, ${laneTotals.dm?.promptTokens || 0} prompt tokens (${laneTotals.dm?.cachedTokens || 0} cached) + ${laneTotals.dm?.outputTokens || 0} output — priced per the provider's Pro rate (not in the research doc; tokens only).`);
    lines.push(`- Console errors: ${consoleLines.filter(c => c.type === 'error').length}; warnings: ${consoleLines.filter(c => c.type === 'warning').length}.`);
    lines.push('');
    lines.push('## Caveats');
    lines.push('');
    lines.push('- A probe question at checkpoint N puts its answer into the window for checkpoint N+10 — the evidence-condition column is read off the ACTUAL prompt, so a re-exposed fact honestly shows as in-window; age is counted from the seed, not the last mention.');
    lines.push('- Evidence detection is lexical-then-judged: keyword-bearing prompt lines are handed to the judge, which decides whether they carry the particulars; a keyword-free restatement in the prompt would read as RETRIEVAL. The captured "injection" is the full system prompt + message window the provider received (a superset of the Memory Inspector\'s retrieved + curated lists).');
    lines.push('- Seeds the DM never established concretely are reported `unseeded` and excluded from survival.');
    lines.push('');
    fs.writeFileSync(path.join(OUT_DIR, 'report.md'), lines.join('\n'));

    const raw = {
        run: { label: RUN_LABEL, startedAt, finishedAt, totalSecs, appUrl: APP_URL, buildInfo },
        arms: { dm: DM, machineryModel: MACHINERY_MODEL, appMachineryModel: APP_MACHINERY_MODEL, embedDims: EMBED_DIMS, embedDimsOverridable: EMBED_DIMS_OVERRIDABLE, embedDimsTodo: EMBED_DIMS_TODO, observedModels: [...observedModels], observedEmbedDims: [...observedEmbedDims], starter: STARTER_ID, turns: TURNS, checkpoints: CHECKPOINTS },
        seeds: SEEDS.map(sd => ({ ...sd, truth: truths[sd.id] || null })),
        questions: QUESTIONS,
        results, checkpoints,
        survival: { all, byCheckpoint: Object.fromEntries(CHECKPOINTS.map(cp => [cp, survival(scored.filter(r => r.checkpoint === cp))])), byType: Object.fromEntries(types.map(ty => [ty, survival(scored.filter(r => r.type === ty))])), byEvidence: Object.fromEntries([...groupBy(scored, r => r.evidenceCondition)].map(([k, v]) => [k, survival(v)])) },
        misses: { retrieval, use, contradicted: scored.filter(r => r.judge?.contradicted).length, leaks: scored.filter(r => r.judge?.leak).length },
        telemetry: { laneTotals: Object.fromEntries(Object.entries(laneTotals).map(([k, v]) => [k, { ...v, models: [...v.models] }])), writePath, writeTokensPerTurn, embedBytesPerTurn, dmPromptAvg, dmCachedAvg, judgeUsage, machineryCostUsd: machineryCost, judgeCostUsd: judgeCost },
        turns, console: consoleLines,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(raw, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
    const startedAt = new Date().toISOString();
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
    await page.setRequestInterception(true);
    attachCapture(page);
    let buildInfo = 'unknown build';
    try {
        await bootAndCreateHero(page);
        buildInfo = await page.evaluate(() => Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src')).find(s => /assets\//.test(s)) || 'no hashed bundle');

        // Seeds first (turns 1–9, sliding on retries), then fillers, with the
        // checkpoints on the play-turn clock.
        let seedIdx = 0;
        let fillerIdx = 0;
        const pending = [...CHECKPOINTS];
        while (playTurnNo < TURNS) {
            if (seedIdx < SEEDS.length) {
                await plantSeed(page, SEEDS[seedIdx]);
                seedIdx += 1;
            } else {
                await playTurn(page, `filler:${fillerIdx + 1}`, FILLERS[fillerIdx % FILLERS.length]);
                fillerIdx += 1;
            }
            while (pending.length && playTurnNo >= pending[0]) {
                const cp = pending.shift();
                if (seedIdx < SEEDS.length) note('warn', `Checkpoint ${cp} reached with ${SEEDS.length - seedIdx} seed(s) still unplanted (retries slid the schedule) — planting the rest first.`);
                while (seedIdx < SEEDS.length) { await plantSeed(page, SEEDS[seedIdx]); seedIdx += 1; }
                await runCheckpoint(page, cp);
            }
        }
        while (pending.length) { const cp = pending.shift(); await runCheckpoint(page, cp); }
    } finally {
        fs.writeFileSync(path.join(OUT_DIR, 'transcript.json'), JSON.stringify(await page.evaluate(() => (window.__QF_STATE__?.messages || []).map(m => ({ role: m.role, kind: m.kind || null, hidden: !!m.hidden, content: m.content }))).catch(() => []), null, 2));
        await shot(page, 'final');
        saveAll();
        writeReport({ startedAt, finishedAt: new Date().toISOString(), buildInfo });
        await browser.close();
    }
}

run().then(() => {
    console.log(`\nCommitment probe "${RUN_LABEL}" complete → ${path.join(OUT_DIR, 'report.md')}`);
    process.exit(0);
}).catch(err => {
    console.error('Commitment probe failed:', err);
    note('fatal', String(err).slice(0, 500));
    saveAll();
    process.exit(1);
});
