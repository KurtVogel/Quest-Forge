/**
 * Provider-comparison playtest: identical premise, hero, and scripted actions,
 * run once per DM provider/model so the transcripts and engine metrics are
 * directly comparable. The Gemini machinery (Scribe/journal/RAG) is identical
 * in every run — differences are the narrator's.
 *
 *   node scripts/playtest_provider_compare.cjs <label> <provider> <model>
 *   node scripts/playtest_provider_compare.cjs gemini gemini gemini-3.1-pro-preview
 *   node scripts/playtest_provider_compare.cjs terra  openai gpt-5.6-terra
 *
 * Requires `npm run preview` serving the production build on :4173 (the dev
 * server's devSettingsSeed would override the injected provider settings).
 * Keys are read from .env inside this process and injected into localStorage;
 * they are never printed. Output: test-results/provider_compare/<label>/.
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
    console.error('Usage: node scripts/playtest_provider_compare.cjs <label> <provider> <model>');
    process.exit(1);
}
const dmKey = provider === 'openai' ? OPENAI_API_KEY : GEMINI_API_KEY;
if (!dmKey || !GEMINI_API_KEY) {
    console.error('Missing API key(s) in .env (DM provider key + GEMINI_API_KEY for machinery).');
    process.exit(1);
}

const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:4173/?debugState=1';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve(`test-results/provider_compare/${runLabel}`);
const PROFILE_DIR = path.join(OUT_DIR, 'profile');

fs.mkdirSync(OUT_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
const notes = [];
function note(kind, message, extra = {}) {
    const entry = { t: new Date().toISOString(), kind, message, ...extra };
    notes.push(entry);
    console.log(`[${kind}] ${String(message).slice(0, 220)}`);
}
function saveNotes() {
    fs.writeFileSync(path.join(OUT_DIR, 'log.json'), JSON.stringify(notes, null, 2));
}

async function qfState(page) {
    return await page.evaluate(() => {
        const s = window.__QF_STATE__;
        if (!s) return null;
        return {
            location: s.currentLocation,
            gold: s.character?.gold, silver: s.character?.silver, copper: s.character?.copper,
            hp: s.character?.currentHP, maxHp: s.character?.maxHP, exp: s.character?.exp,
            slots: s.character?.spellSlots,
            inv: (s.inventory || []).map(i => `${i.name}${(i.quantity || 1) > 1 ? ` x${i.quantity}` : ''}`),
            msgCount: (s.messages || []).length,
            combat: s.combat?.active ? {
                phase: s.combat.phase, round: s.combat.round,
                enemies: (s.combat.enemies || []).map(e => ({ n: e.name, hp: e.hp, st: e.combatStatus, cond: e.condition })),
            } : null,
            pendingCheck: s.pendingRoleplayCheck
                ? { rolls: (s.pendingRoleplayCheck.rolls || []).map(r => `${r.skill || r.type} DC ${r.dc}${r.advantage ? ' adv' : ''}${r.disadvantage ? ' dis' : ''}`) }
                : null,
            quests: (s.quests || []).map(q => `${q.name}:${q.status}`),
            npcs: (s.npcs || []).length, worldFacts: (s.worldFacts || []).length,
            storyMemory: (s.storyMemory || []).length, journal: (s.journal || []).length,
        };
    }).catch(() => null);
}

async function lastDmText(page, max = 3000) {
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

async function clickByText(page, selector, text) {
    return await page.evaluate(({ selector, text }) => {
        const el = Array.from(document.querySelectorAll(selector)).find(e => e.textContent.includes(text));
        if (el) { el.click(); return true; }
        return false;
    }, { selector, text });
}

/** React-safe input fill: the native value setter + input event (raw el.value
 *  assignment is ignored by React's value tracker — the silent-stall bug that
 *  wasted the first pair of runs). matcher runs in the page. */
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

/** Throw unless the page body contains the marker — makes wizard stalls loud. */
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
    const state = await qfState(page);
    if (!state?.pendingCheck) return false;
    note('proposal', `Check proposed: ${state.pendingCheck.rolls.join('; ')} — rolling.`);
    await clickByText(page, '.roleplay-check-panel button', 'Roll');
    await waitForIdle(page);
    for (let i = 0; i < 3; i++) {
        const follow = await qfState(page);
        if (!follow?.pendingCheck) break;
        note('proposal', `Follow-up check: ${follow.pendingCheck.rolls.join('; ')} — accepting.`);
        await clickByText(page, '.roleplay-check-panel button', 'Roll');
        await waitForIdle(page);
    }
    return true;
}

/** Wizard combat: Fire Bolt is a cantrip — always castable. */
async function resolveCombat(page, maxIters = 12) {
    for (let i = 0; i < maxIters; i++) {
        const s = await qfState(page);
        if (!s?.combat) return i;
        if (s.combat.phase === 'awaiting_player') {
            const target = s.combat.enemies.find(e => e.st === 'active' && (e.hp ?? 0) > 0 && e.cond !== 'dead');
            if (!target) {
                const ended = await clickByText(page, 'button', 'End Combat');
                note('combat', ended ? 'Clicked End Combat.' : 'No living enemies and no End Combat button; waiting.');
                await waitForIdle(page);
                continue;
            }
            const action = `I cast Fire Bolt at the ${target.n}.`;
            note('combat', `Round ${s.combat.round}: ${action} (enemy hp ${target.hp})`);
            await typeAndSend(page, action);
            await waitForIdle(page);
        } else {
            await waitForIdle(page);
        }
    }
    note('warn', 'Combat did not resolve within iteration budget.');
    return maxIters;
}

async function playRound(page, label, action) {
    const before = await qfState(page);
    const startedAt = Date.now();
    note('action', `${label}: "${action}"`);
    await typeAndSend(page, action);
    await waitForIdle(page);
    await handleProposal(page);
    const combatIters = (await qfState(page))?.combat ? await resolveCombat(page) : 0;
    await delay(1500);
    const after = await qfState(page);
    const dm = await lastDmText(page);
    const secs = Math.round((Date.now() - startedAt) / 1000);
    note('round', `${label} done in ${secs}s`, {
        dm,
        coinsBefore: before ? `${before.gold}g ${before.silver}s ${before.copper}c` : null,
        coinsAfter: after ? `${after.gold}g ${after.silver}s ${after.copper}c` : null,
        hp: after ? `${after.hp}/${after.maxHp}` : null, exp: after?.exp, slots: after?.slots,
        inv: after?.inv, quests: after?.quests, combatIters,
        npcs: after?.npcs, worldFacts: after?.worldFacts, storyMemory: after?.storyMemory,
    });
}

// ---------------------------------------------------------------------------

const PREMISE = 'Ilta Kuura, a junior archivist expelled from the Collegium for copying a forbidden tide-chart, arrives in the harbour town of Greywater Reach in the coastal land of the Mistfell Shore. She carries her late mother\'s brass tide-compass on a cord around her neck. The town runs on the herring trade, and lately the catches come up wrong — fish with too many eyes, nets sliced clean. Harbourmaster Teodora Valk posts work for anyone literate: the old lighthouse keeper, Osmo Pellinen, has stopped answering his bell, and someone must climb the headland and check on him. Ilta needs coin, a roof, and a way to prove the tide-chart she copied points at something real out in the bay.';

const APPEARANCE = 'Small and wiry, ash-blonde hair cropped short, a burn scar across the back of her left hand, ink-stained fingers.';

const ACTIONS = [
    'I read the notice twice, then push open the harbourmaster\'s door and step into the lantern light. "Harbourmaster Valk? I\'m literate, I\'m broke, and I can climb. I\'ll check on your lighthouse keeper — what does it pay?"',
    '"We have a bargain." I shake her hand and take whatever she gives me for the job. Before I go, I ask her plainly: what was Osmo like the last time anyone saw him?',
    'Before the climb I stop at a chandlery or general store and buy a coil of hempen rope and two torches — I pay whatever they ask, out of my own coin.',
    'Outside the shop I trace the warding sigils and cast Mage Armor on myself — no sense climbing a chalk headland unguarded. Then I start up the path toward the lighthouse.',
    'No time for caution — Osmo could be dying up there. Wherever the path is at its worst, I push across it quick and light, trusting my balance.',
    'OOC: Quick table check — can you recap what I\'ve agreed to, what I\'ve spent so far, and what my current leads are? Keep it brief.',
    'I reach the lighthouse, get the door open, and step inside carefully, calling out: "Osmo Pellinen? The Harbourmaster sent me."',
    'I light one of my torches and search the lighthouse from bottom to top for any sign of what happened to Osmo, following whatever trail I find.',
    'I follow the strongest lead onward — wherever the trail of the keeper or of the thing that cuts nets like glass points, I go, torch forward and staff ready.',
    'If anything hostile shows itself, I don\'t wait — I cast Fire Bolt at it. Otherwise I press deeper toward wherever Osmo must be.',
    'I search for Osmo now with everything I have — calling his name, using my rope where the way is dangerous, until I find him or find what\'s left of him.',
    'I do whatever it takes to get Osmo (or his remains, or proof of his fate) safely back, then return to Harbourmaster Valk and deliver my full report — and I collect the payment we agreed.',
    'Over a hot meal I ask Valk to tell me honestly: what has my coming to Greywater Reach changed, and what does she remember of everything I\'ve done since I walked into her office?',
];

async function run() {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        userDataDir: PROFILE_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1500,950'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    page.on('dialog', d => d.accept().catch(() => {}));
    page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error' || msg.type() === 'warning'
            || /\[LLM timing\]|\[LLM Adapter\] Contains|\[ResponseParser\]|\[Scribe\]|\[Journal\]|\[Fronts\]|\[LivingWorld\]/.test(text)) {
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

    // ---- Creation wizard: elf wizard, identical in every run ----
    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(1000);
    await page.click('.creation-card'); // Forge a New Hero
    await delay(800);

    note('wizard', 'Identity step');
    await page.waitForSelector('.creation-input');
    if (!await reactFill(page, `el => (el.placeholder || '').startsWith('Enter your character')`, 'Ilta Kuura')) {
        throw new Error('Name input not found.');
    }
    await reactFill(page, `el => (el.placeholder || '').startsWith('Gender')`, 'woman');
    await reactFill(page, `el => (el.placeholder || '').startsWith('Appearance')`, APPEARANCE);
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Choose your race', 'after identity');

    note('wizard', 'Race: Elf');
    await clickByText(page, '.creation-card', 'Elf');
    await delay(300);
    await page.click('.char-creation-actions .btn-primary');
    await delay(900);
    await expectOnScreen(page, 'Choose your class', 'after race');

    note('wizard', 'Class: Wizard');
    await clickByText(page, '.creation-card', 'Wizard');
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

    note('wizard', 'Skills: Arcana + Investigation');
    await clickByText(page, '.skill-choice-card', 'Arcana');
    await delay(250);
    await clickByText(page, '.skill-choice-card', 'Investigation');
    await delay(250);
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await expectOnScreen(page, 'stands ready', 'hero reveal');

    note('wizard', 'Hero reveal → premise');
    await page.click('.char-creation-actions .btn-primary'); // past the reveal
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
    note('state', 'Post-opening state', { state: await qfState(page) });

    for (let i = 0; i < ACTIONS.length; i++) {
        await playRound(page, `r${i + 1}`, ACTIONS[i]);
        saveNotes(); // incremental, so a crash keeps everything so far
    }

    note('state', 'Final state', { state: await qfState(page) });
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
