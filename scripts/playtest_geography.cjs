/**
 * Geography-as-canon live playtest (DECISIONS.md 2026-09-14): one scripted
 * journey per DM provider, aimed at the travel-link system.
 *
 *   node scripts/playtest_geography.cjs <label> <provider> <model>
 *   node scripts/playtest_geography.cjs gemini gemini gemini-3.1-pro-preview
 *   node scripts/playtest_geography.cjs terra  openai gpt-5.6-terra
 *
 * Never run with the xAI/Grok provider (Vesa, 2026-09-14) — Gemini Pro and
 * GPT Terra only. The Gemini machinery (Scribe) is identical in every run.
 *
 * What the run establishes and checks:
 *   1. The premise states geography outright (bearings, a named road, a
 *      duration). The hero travels A → B → C and back to A, each leg narrated
 *      with the bearing/road/time SAID in the player's own message so the
 *      Scribe has evidence to capture.
 *   2. After each arrival the script reads `locations[].links` from the
 *      ?debugState=1 snapshot: did the arrival mint the edge, did the Scribe's
 *      `travel` report fill direction / travelTime / route, on BOTH ends?
 *   3. Two consistency probes late in the run ask the DM (through an NPC and
 *      through table talk) which way / how far a known place lies. The DM's
 *      answer is scored against the stored links: a bearing that contradicts
 *      the record is the exact failure the system exists to prevent.
 *   4. The Places tab is screenshotted at the end (Ways from here lines).
 *
 * Requires `npm run preview` serving the production build on :4173 (the dev
 * server's devSettingsSeed would override the injected provider settings).
 * Keys are read from .env or the environment and injected into localStorage;
 * they are never printed. Output: test-results/geography/<label>/.
 */
const puppeteer = require('puppeteer-core');
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

const GEMINI_API_KEY = envKey('GEMINI_API_KEY');
const OPENAI_API_KEY = envKey('OPENAI_API_KEY');

const runLabel = process.argv[2];
const provider = process.argv[3];
const model = process.argv[4];
if (!runLabel || !provider || !model) {
    console.error('Usage: node scripts/playtest_geography.cjs <label> <provider> <model>');
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
// Hosted agent sessions (2026-09-14): outbound HTTPS goes through a
// TLS-re-terminating egress proxy that cannot complete Chromium's TLS 1.3
// handshake (every tunnel died after ~1.8 KB sent / 39 B received). Capping
// the browser at TLS 1.2 — still fully verified against the proxy CA in the
// NSS store — makes both API hosts reachable. Local runs have no HTTPS_PROXY
// and get plain Chromium. CHROME_PATH there: /opt/pw-browsers/chromium-*/chrome-linux/chrome.
const PROXY_ARGS = process.env.HTTPS_PROXY
    ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--ssl-version-max=tls1.2']
    : [];
const OUT_DIR = path.resolve(`test-results/geography/${runLabel}`);
const PROFILE_DIR = path.join(OUT_DIR, 'profile');

fs.mkdirSync(OUT_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
const notes = [];
function note(kind, message, extra = {}) {
    const entry = { t: new Date().toISOString(), kind, message, ...extra };
    notes.push(entry);
    console.log(`[${kind}] ${String(message).slice(0, 260)}`);
}
function saveNotes() {
    fs.writeFileSync(path.join(OUT_DIR, 'log.json'), JSON.stringify(notes, null, 2));
}
async function shot(page, name) {
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true }).catch(() => {});
}

/** Live geography snapshot: every registry record with its links resolved to names. */
async function geoState(page) {
    return await page.evaluate(() => {
        const s = window.__QF_STATE__;
        if (!s) return null;
        const byId = new Map((s.locations || []).map(r => [r.id, r]));
        return {
            location: s.currentLocation,
            msgCount: (s.messages || []).length,
            places: (s.locations || []).map(r => ({
                name: r.name,
                region: r.region || null,
                type: r.type || null,
                visited: Number.isFinite(r.lastVisitedMessage),
                links: (r.links || []).map(l => ({
                    to: byId.get(l.id)?.name || `(missing ${l.id})`,
                    direction: l.direction, travelTime: l.travelTime, route: l.route, atMessage: l.atMessage,
                })),
            })),
            pendingCheck: s.pendingRoleplayCheck
                ? { rolls: (s.pendingRoleplayCheck.rolls || []).map(r => `${r.skill || r.type} DC ${r.dc}`) }
                : null,
            combat: s.combat?.active ? { phase: s.combat.phase, enemies: (s.combat.enemies || []).map(e => ({ n: e.name, hp: e.hp, st: e.combatStatus, cond: e.condition })) } : null,
            hp: s.character?.currentHP,
        };
    }).catch(() => null);
}

async function lastDmText(page, max = 3500) {
    return await page.evaluate((maxLen) => {
        const msgs = Array.from(document.querySelectorAll('.chat-message.assistant .message-text'));
        const last = msgs[msgs.length - 1];
        return last ? last.textContent.trim().slice(0, maxLen) : '';
    }, max).catch(() => '');
}

async function dumpTranscript(page) {
    return await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.chat-message')).map(el => {
            const role = el.classList.contains('assistant') ? 'dm'
                : el.classList.contains('user') ? 'player' : 'system';
            return { role, text: (el.querySelector('.message-text') || el).textContent.trim() };
        });
    }).catch(() => []);
}

async function waitForIdle(page, { timeout = 240000 } = {}) {
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
        if (!status.busy) {
            calm++;
            if (calm >= 2) return true;
        } else {
            calm = 0;
        }
        await delay(2000);
    }
    note('warn', `waitForIdle timed out after ${Math.round((Date.now() - start) / 1000)}s.`);
    return false;
}

/** The Scribe runs after the turn settles; give it a moment before reading links. */
async function waitForScribe(page, { timeout = 45000 } = {}) {
    const start = Date.now();
    let last = null;
    while (Date.now() - start < timeout) {
        const state = await geoState(page);
        const serialized = JSON.stringify(state?.places || []);
        if (last === serialized && Date.now() - start > 8000) return state;
        last = serialized;
        await delay(2500);
    }
    return await geoState(page);
}

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
    const state = await geoState(page);
    if (!state?.pendingCheck) return false;
    note('proposal', `Check proposed: ${state.pendingCheck.rolls.join('; ')} — rolling.`);
    await clickByText(page, '.roleplay-check-panel button', 'Roll');
    await waitForIdle(page);
    for (let i = 0; i < 3; i++) {
        const follow = await geoState(page);
        if (!follow?.pendingCheck) break;
        note('proposal', `Follow-up check: ${follow.pendingCheck.rolls.join('; ')} — accepting.`);
        await clickByText(page, '.roleplay-check-panel button', 'Roll');
        await waitForIdle(page);
    }
    return true;
}

/** Fighter: attack the first living foe until the fight closes. Travel is the
 *  subject here; a wilderness ambush must not stall the journey. */
async function resolveCombat(page, maxIters = 12) {
    for (let i = 0; i < maxIters; i++) {
        const s = await geoState(page);
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

function findPlace(state, name) {
    const lower = name.toLowerCase();
    return (state?.places || []).find(p => p.name.toLowerCase().includes(lower)) || null;
}

function linkBetween(state, fromName, toName) {
    const from = findPlace(state, fromName);
    if (!from) return null;
    return from.links.find(l => l.to.toLowerCase().includes(toName.toLowerCase())) || null;
}

/** Score a DM answer about "which way is X" against the stored bearing. */
function scoreBearing(dmText, expected) {
    const text = String(dmText || '').toLowerCase();
    const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' };
    const said = ['north', 'south', 'east', 'west'].filter(d => new RegExp(`\\b${d}(?:ward|wards|ern|erly)?\\b`).test(text));
    if (!expected) return { verdict: 'no-record', said };
    if (said.includes(expected)) return { verdict: 'consistent', said };
    if (said.includes(opposite[expected])) return { verdict: 'CONTRADICTION', said };
    return { verdict: said.length ? 'other-bearing' : 'no-bearing-stated', said };
}

async function playRound(page, label, action, { probe = null } = {}) {
    const startedAt = Date.now();
    note('action', `${label}: "${action}"`);
    await typeAndSend(page, action);
    await waitForIdle(page);
    await handleProposal(page);
    const combatIters = (await geoState(page))?.combat ? await resolveCombat(page) : 0;
    const state = await waitForScribe(page);
    const dm = await lastDmText(page);
    const secs = Math.round((Date.now() - startedAt) / 1000);
    const extra = { dm, location: state?.location, combatIters, links: (state?.places || []).filter(p => p.links.length).map(p => ({ from: p.name, links: p.links })) };
    if (probe) extra.probe = probe(dm, state);
    note('round', `${label} done in ${secs}s — at "${state?.location}"`, extra);
    if (probe) note('probe', `${label}: ${JSON.stringify(extra.probe)}`);
    return { dm, state };
}

// ---------------------------------------------------------------------------

// Geography stated outright so the fiction has something to keep consistent:
// Kettleford (home) — half a day NORTH of Brannock's Crossing by the Millrace
// Road; the Thornwater Abbey ruin — two days EAST of Brannock's Crossing along
// the river; nothing is named from the stock-name list.
const PREMISE = 'Aino Halme, a former garrison sergeant turned freight guard, has settled in Kettleford, a mill town in the Vellmark, a land of low green hills and slow brown rivers. Half a day south of Kettleford along the Millrace Road lies Brannock\'s Crossing, the ferry town where the Vellmark\'s grain is loaded onto barges. Two days east of Brannock\'s Crossing, following the river upstream, stand the ruins of Thornwater Abbey, abandoned after a fire a generation ago. Aino works for the freight-broker Hesper Dunmore, a stout widow who runs Kettleford\'s only warehouse and pays on time. Lately barges leaving Brannock\'s Crossing have been arriving downriver short a crate or two, and the bargemen blame the abbey ruin, where lights have been seen at night. Aino wants steady coin, a clean name in this new town, and, one day, a house of her own with a proper roof.';

const APPEARANCE = 'Tall and broad-shouldered, pale skin weathered brown on the face and forearms, dark hair cropped to the scalp, a notched left ear.';

const ACTIONS = [
    // r1: establish normal life + get the job.
    'I find Hesper Dunmore at the warehouse and ask her plainly what she\'ll pay to have the barge shortfalls looked into. I want the work.',
    // r2: LEG 1 — Kettleford → Brannock's Crossing. Bearing, road, and time stated in my own words.
    'I settle terms with Hesper, shoulder my pack, and take the Millrace Road south. It\'s half a day\'s walk to Brannock\'s Crossing; I want to be at the ferry landing before the evening barges load. I keep a steady pace and arrive.',
    // r3: at Brannock's Crossing — talk to a bargeman.
    'At the landing I find whichever bargeman looks like he\'s lost the most crates and buy him a drink. Which barges came up short, and what exactly did people see at the abbey?',
    // r4: LEG 2 — Brannock's Crossing → Thornwater Abbey. East, along the river, two days.
    'I take the river path east out of Brannock\'s Crossing, following the water upstream toward Thornwater Abbey. It\'s a two-day walk; I make camp once and press on until the abbey ruins are in sight, then approach carefully.',
    // r5: at the abbey — investigate.
    'I search the abbey ruins for signs of who has been lighting fires here — tracks, fresh ash, stacked crates, anything.',
    // r6: follow the lead / possible confrontation.
    'I follow the strongest lead I find in the ruins. If whoever is here shows themselves, I call out that I\'m hired by the Kettleford freight-broker and I\'m here to talk before I\'m here to fight.',
    // r7: PROBE 1 (in-character, via an NPC or the narrator): which way home, how far.
    'I take stock before heading back. I ask whoever is with me — or just say it aloud to myself as I check the sky — which way Brannock\'s Crossing lies from here, and how long the walk back will be.',
    // r8: LEG 3 — return Thornwater Abbey → Brannock's Crossing (west, downstream, two days).
    'I head back west along the river, downstream, the two days to Brannock\'s Crossing, and go straight to the ferry landing when I arrive.',
    // r9: LEG 4 — Brannock's Crossing → Kettleford (north, Millrace Road, half a day).
    'I take the Millrace Road north for the half-day walk home to Kettleford and go find Hesper Dunmore at her warehouse to report.',
    // r10: PROBE 2 (OOC): the DM's own map recap.
    'OOC: Quick geography check for my own notes — from Kettleford, which direction and how far is Brannock\'s Crossing, and which direction and how far is Thornwater Abbey from Brannock\'s Crossing? Just the bearings and travel times as established in play.',
    // r11: report + payment.
    'I give Hesper my full report on what I found at the abbey and collect whatever pay we agreed.',
];

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
    page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error' || msg.type() === 'warning'
            || /\[LLM timing\]|\[ResponseParser\]|\[Scribe\]|\[Journal\]|\[Fronts\]|\[LivingWorld\]/.test(text)) {
            note('console', `${msg.type()}: ${text.slice(0, 300)}`);
        }
    });
    page.on('pageerror', err => note('pageerror', String(err).slice(0, 300)));
    await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(2000);

    note('setup', `Run "${runLabel}" — DM provider ${provider} / ${model}; machinery gemini (always).`);
    await page.evaluate(({ providerName, modelName, key, geminiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: providerName,
            apiKey: key,
            geminiApiKey: geminiKey,
            imageApiKey: '',
            model: modelName,
        }));
    }, { providerName: provider, modelName: model, key: dmKey, geminiKey: GEMINI_API_KEY });
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2000);

    // ---- Creation wizard: human fighter, identical in every run ----
    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(1000);
    await page.click('.creation-card'); // Forge a New Hero
    await delay(800);

    note('wizard', 'Identity step');
    await page.waitForSelector('.creation-input');
    if (!await reactFill(page, `el => (el.placeholder || '').startsWith('Enter your character')`, 'Aino Halme')) {
        throw new Error('Name input not found.');
    }
    await reactFill(page, `el => (el.placeholder || '').startsWith('Gender')`, 'woman');
    await reactFill(page, `el => (el.placeholder || '').startsWith('Appearance')`, APPEARANCE);
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Choose your race', 'after identity');

    note('wizard', 'Race: Human');
    await clickByText(page, '.creation-card', 'Human');
    await delay(300);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Choose your class', 'after race');

    note('wizard', 'Class: Fighter');
    await clickByText(page, '.creation-card', 'Fighter');
    await delay(300);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Assign ability scores', 'after class');

    note('wizard', 'Stats: recommended spread');
    await clickByText(page, 'button', 'Use this spread');
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Choose your skills', 'after stats');

    note('wizard', 'Skills: Athletics + Perception');
    await clickByText(page, '.skill-choice-card', 'Athletics');
    await delay(250);
    await clickByText(page, '.skill-choice-card', 'Perception');
    await delay(250);
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await expectOnScreen(page, 'stands ready', 'hero reveal');

    note('wizard', 'Hero reveal → premise');
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Set the stage', 'premise step');
    if (!await reactFill(page, `el => el.tagName === 'TEXTAREA' && (el.placeholder || '').startsWith('Exiled from the city')`, PREMISE)) {
        throw new Error('Premise textarea not found by placeholder.');
    }
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
    note('wizard', 'Begin Adventure — waiting for the opening scene.');
    await waitForIdle(page, { timeout: 300000 });
    await delay(2500);
    note('opening', await lastDmText(page, 3000));
    note('state', 'Post-opening geography', { state: await waitForScribe(page) });

    const probes = {
        // r7 asks in-character from the abbey: expected bearing to the Crossing is WEST.
        6: (dm, state) => {
            const link = linkBetween(state, 'Thornwater', 'Brannock');
            return { question: 'Crossing from the abbey', stored: link, ...scoreBearing(dm, link?.direction || 'west') };
        },
        // r10 asks OOC from Kettleford: Crossing is SOUTH; abbey from the Crossing is EAST.
        9: (dm, state) => {
            const toCrossing = linkBetween(state, 'Kettleford', 'Brannock');
            const toAbbey = linkBetween(state, 'Brannock', 'Thornwater');
            return {
                crossingFromKettleford: { stored: toCrossing, ...scoreBearing(dm.split(/thornwater|abbey/i)[0], toCrossing?.direction || 'south') },
                abbeyFromCrossing: { stored: toAbbey, ...scoreBearing(dm.split(/thornwater|abbey/i).slice(1).join(' '), toAbbey?.direction || 'east') },
            };
        },
    };

    for (let i = 0; i < ACTIONS.length; i++) {
        await playRound(page, `r${i + 1}`, ACTIONS[i], { probe: probes[i] || null });
        saveNotes();
    }

    const finalState = await geoState(page);
    note('state', 'Final geography', { state: finalState });

    // Engine-side verdicts on the stored links.
    const legs = [
        ['Kettleford', 'Brannock', 'south'],
        ['Brannock', 'Kettleford', 'north'],
        ['Brannock', 'Thornwater', 'east'],
        ['Thornwater', 'Brannock', 'west'],
    ];
    for (const [from, to, expected] of legs) {
        const link = linkBetween(finalState, from, to);
        note('verdict', `${from} → ${to}: ${link ? `edge ${link.direction || 'bare'}${link.travelTime ? `, ${link.travelTime}` : ''}${link.route ? `, by ${link.route}` : ''} (expected ${expected}: ${link.direction === expected ? 'OK' : link.direction ? 'MISMATCH' : 'no bearing captured'})` : 'NO EDGE'}`);
    }

    // Places tab screenshot: the player-facing "Ways from here".
    const opened = await clickByText(page, 'button', 'Journal') || await clickByText(page, '.nav-btn, .tab-btn, button', 'Journal');
    await delay(800);
    const placesTab = await clickByText(page, 'button', 'Places');
    await delay(800);
    note('ui', `Journal opened: ${opened}; Places tab: ${placesTab}`);
    const ways = await page.evaluate(() => Array.from(document.querySelectorAll('.journal-place')).map(el => ({
        name: el.querySelector('.journal-place-name')?.textContent || '',
        ways: el.querySelector('.journal-place-ways')?.textContent || '',
    })));
    note('ui', 'Places tab cards', { ways });
    await shot(page, 'places-tab');

    fs.writeFileSync(path.join(OUT_DIR, 'transcript.json'), JSON.stringify(await dumpTranscript(page), null, 2));
    saveNotes();
    await browser.close();
}

run().then(() => {
    console.log(`\nRun "${runLabel}" complete.`);
    process.exit(0);
}).catch(err => {
    console.error('Run failed:', err);
    note('fatal', String(err).slice(0, 500));
    saveNotes();
    process.exit(1);
});
