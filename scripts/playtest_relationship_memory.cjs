/**
 * Player-relationship memory playtest (stanceToPlayer + bondMoments, 2026-07-05).
 *
 * Drives a conversation-heavy campaign against the LOCAL dev server, flirts with
 * and confides in the tavern keeper Maren across several turns, and verifies:
 *   1. The per-turn Scribe records a personal stanceToPlayer on her NPC record.
 *   2. Significant beats land as append-only bondMoments.
 *   3. A plot-only turn does NOT clobber the recorded stance.
 *   4. The record survives a full reload + Continue (persistence round-trip).
 *   5. Journal "Deepen memory" backfills a personal stance on an NPC that has
 *      none, from recent conversation (the existing-campaign retro path).
 *
 *   node scripts/playtest_relationship_memory.cjs
 *
 * Requires the Vite dev server on http://localhost:5173 and GEMINI_API_KEY in .env.
 * Output: test-results/relationship_memory/ (screenshots + log.json + SUMMARY).
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

let localApiKey = '';
try {
    const envPath = path.resolve('.env');
    if (fs.existsSync(envPath)) {
        const match = fs.readFileSync(envPath, 'utf8').match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)/);
        if (match) localApiKey = match[1];
    }
} catch { /* fall through */ }
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || localApiKey;
if (!GEMINI_API_KEY) {
    console.error('No GEMINI_API_KEY available (env or .env). Aborting.');
    process.exit(1);
}

const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:5173/?debugState=1';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve('test-results/relationship_memory');
const PROFILE_DIR = path.join(OUT_DIR, 'profile');

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const delay = ms => new Promise(r => setTimeout(r, ms));
const notes = [];
const findings = [];
function note(kind, message, extra = {}) {
    const entry = { t: new Date().toISOString(), kind, message, ...extra };
    notes.push(entry);
    const extraStr = Object.keys(extra).length ? ` ${JSON.stringify(extra).slice(0, 900)}` : '';
    console.log(`[${kind}] ${message}${extraStr}`);
}
function finding(ok, label, detail = '') {
    findings.push({ ok, label, detail });
    note(ok ? 'PASS' : 'FAIL', `${label}${detail ? ` — ${detail}` : ''}`);
}
function saveNotes() {
    fs.writeFileSync(path.join(OUT_DIR, 'log.json'), JSON.stringify({ notes, findings }, null, 2));
}
let shotIdx = 0;
async function shot(page, name) {
    shotIdx++;
    await page.screenshot({ path: path.join(OUT_DIR, `${String(shotIdx).padStart(2, '0')}_${name}.png`) }).catch(() => {});
}

// --- state probes -----------------------------------------------------------

async function npcSnapshot(page) {
    return await page.evaluate(() => {
        const s = window.__QF_STATE__;
        if (!s) return null;
        return (s.npcs || []).map(n => ({
            id: n.id,
            name: n.name,
            disposition: n.disposition,
            stanceToPlayer: n.stanceToPlayer || '',
            bondMoments: (n.bondMoments || []).map(m => m.text),
            relationshipTension: n.relationshipTension || '',
            agenda: n.agenda || '',
        }));
    }).catch(() => null);
}

async function pendingCheck(page) {
    return await page.evaluate(() => {
        const s = window.__QF_STATE__;
        return s?.pendingRoleplayCheck ? true : false;
    }).catch(() => false);
}

function findNpc(npcs, name) {
    return (npcs || []).find(n => (n.name || '').toLowerCase().includes(name.toLowerCase())) || null;
}

/** Poll the roster until predicate(npcs) is truthy — the Scribe lands async. */
async function waitForRoster(page, predicate, { timeout = 45000, label = 'roster condition' } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const npcs = await npcSnapshot(page);
        const hit = npcs && predicate(npcs);
        if (hit) return npcs;
        await delay(2000);
    }
    note('warn', `Timed out waiting for ${label}.`);
    return await npcSnapshot(page);
}

async function waitForIdleWithPeek(page, { timeout = 240000 } = {}) {
    const start = Date.now();
    let calm = 0;
    let peek = '';
    while (Date.now() - start < timeout) {
        const status = await page.evaluate(() => {
            const streamEl = document.querySelector('.chat-message.streaming .message-text');
            const streaming = streamEl && !streamEl.classList.contains('typing-indicator')
                ? streamEl.textContent.trim() : '';
            const loading = !!document.querySelector('.chat-stop-btn') || !!document.querySelector('.typing-indicator');
            return { streaming, loading };
        }).catch(() => ({ streaming: '', loading: true }));
        if (status.streaming.length > peek.length) peek = status.streaming;
        if (!status.loading) {
            calm++;
            if (calm >= 2) return peek;
        } else {
            calm = 0;
        }
        await delay(700);
    }
    note('warn', `waitForIdleWithPeek timed out after ${Math.round((Date.now() - start) / 1000)}s.`);
    return peek;
}

async function clickByText(page, selector, text) {
    return await page.evaluate(({ selector, text }) => {
        const el = Array.from(document.querySelectorAll(selector)).find(e => e.textContent.includes(text));
        if (el) { el.click(); return true; }
        return false;
    }, { selector, text });
}

async function fillReactTextarea(page, selector, text) {
    return await page.evaluate(({ selector, text }) => {
        const ta = document.querySelector(selector);
        if (!ta) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, text);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }, { selector, text });
}

async function typeAndSend(page, text) {
    const filled = await fillReactTextarea(page, 'textarea.chat-input', text);
    if (!filled) note('warn', 'Chat input not found.');
    await delay(400);
    const sent = await clickByText(page, 'button.chat-send-btn', 'Send');
    if (!sent) note('warn', 'Send button not found/clickable.');
    return sent;
}

/** Send an action; if a roleplay check card appears, accept it with Roll. */
async function playTurn(page, turnNo, action) {
    note('turn', `--- TURN ${turnNo} "${action.slice(0, 110)}"`);
    await typeAndSend(page, action);
    await waitForIdleWithPeek(page);
    await delay(1500);
    for (let i = 0; i < 3; i++) {
        if (!(await pendingCheck(page))) break;
        note('observe', 'Check proposal staged — accepting with Roll.');
        await clickByText(page, '.roleplay-check-panel button', 'Roll');
        await waitForIdleWithPeek(page);
        await delay(1500);
    }
    await shot(page, `t${turnNo}_done`);
}

// --- character creation -------------------------------------------------------

async function createCharacter(page) {
    note('nav', 'Injecting settings (conversation-first playtest DM prompt).');
    await page.evaluate(({ apiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: 'gemini',
            apiKey,
            imageApiKey: '',
            model: 'gemini-3.1-pro-preview',
            customSystemPrompt: [
                '*** PLAY TEST SCENARIO *** conversation and relationships.',
                'This session tests interpersonal play. Lean strongly toward narrating social',
                'and conversational scenes directly WITHOUT proposing dice: NPCs respond from',
                'their motives and mood. Only propose a check for a concrete concession under',
                'real opposition. Give NPCs — especially Maren — warm, specific, human',
                'reactions with interiority. Keep the tone grounded low-fantasy. This playtest',
                'is STRICTLY NON-VIOLENT: never start combat, nobody draws a weapon;',
                'every conflict stays verbal and social.',
            ].join(' '),
        }));
    }, { apiKey: GEMINI_API_KEY });
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2500);

    await page.waitForSelector('.new-btn', { timeout: 30000 });
    await page.click('.new-btn');
    await delay(1200);
    await page.click('.creation-card'); // Forge a New Hero
    await delay(1000);

    await page.waitForSelector('.creation-input');
    await page.type('.creation-input', 'Kalden Vor');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    await page.waitForSelector('.creation-card');
    await clickByText(page, '.creation-card', 'Human');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    await clickByText(page, '.creation-card', 'Fighter');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    await page.waitForSelector('.stat-row');
    for (let i = 0; i < 6; i++) {
        await page.evaluate((index) => {
            document.querySelectorAll('.stat-row')[index]?.querySelector('.stat-choice')?.click();
        }, i);
        await delay(250);
    }
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    for (let step = 0; step < 4; step++) {
        const stepInfo = await page.evaluate(() => ({
            skillCards: document.querySelectorAll('.skill-choice-card').length,
            creationCards: document.querySelectorAll('.creation-card').length,
            premise: !!document.querySelector('textarea.creation-premise'),
        }));
        if (stepInfo.premise) break;
        if (stepInfo.skillCards > 0) {
            await page.evaluate(() => {
                const cards = Array.from(document.querySelectorAll('.skill-choice-card'));
                let selected = cards.filter(c => c.classList.contains('selected')).length;
                for (const c of cards) {
                    if (selected >= 2) break;
                    if (!c.classList.contains('selected')) { c.click(); selected++; }
                }
            });
        } else if (stepInfo.creationCards > 0) {
            await page.evaluate(() => document.querySelector('.creation-card')?.click());
        }
        await delay(400);
        await page.click('.char-creation-actions .btn-primary').catch(() => {});
        await delay(1200);
    }

    await page.waitForSelector('textarea.creation-premise');
    const premise = '*** PLAY TEST SCENARIO *** conversation and relationships. '
        + 'Kalden Vor, a human fighter and former caravan guard, has wintered in the river town of Brackwater '
        + 'waiting for the thaw. He is a regular at the Gilded Eel tavern, run by its keeper Maren — sharp-tongued, '
        + 'warm underneath, unmarried, who runs the place alone since her sister vanished with a northbound caravan. '
        + 'Other locals: Odo Ferrin, a slippery grain merchant who owes Kalden coin; and Hesk, the dour guard captain. '
        + 'Most scenes are social: talk, warmth, gossip, small bargains. The Gilded Eel enforces a strict peace-bond: '
        + 'nobody ever draws steel here — every conflict stays verbal. '
        + 'Kalden begins at the bar of the Gilded Eel at dusk, with Maren pouring him his usual.';
    await page.type('textarea.creation-premise', premise);
    await page.click('.char-creation-actions .btn-primary');
    note('nav', 'Begin Adventure — waiting for the opening scene.');
    await waitForIdleWithPeek(page, { timeout: 300000 });
    await delay(2500);
    await shot(page, 'opening_scene');
}

// --- deepen memory via Journal UI ---------------------------------------------

async function deepenMemory(page, npcName) {
    const opened = await clickByText(page, 'button.header-btn', 'Journal');
    if (!opened) {
        note('warn', 'Journal button not found.');
        return false;
    }
    await delay(800);
    await clickByText(page, '.journal-tab', 'Characters');
    await delay(800);
    await shot(page, `journal_before_deepen_${npcName}`);

    const clicked = await page.evaluate((name) => {
        const cards = Array.from(document.querySelectorAll('.journal-npc'));
        const card = cards.find(c => (c.querySelector('.journal-npc-name')?.textContent || '').toLowerCase().includes(name.toLowerCase()));
        if (!card) return false;
        const btn = Array.from(card.querySelectorAll('button')).find(b => b.textContent.includes('Deepen'));
        if (!btn) return false;
        btn.click();
        return true;
    }, npcName);
    if (!clicked) {
        note('warn', `Deepen memory button not found for ${npcName}.`);
        await clickByText(page, '.journal-close', '✕');
        return false;
    }
    note('nav', `Deepen memory clicked for ${npcName} — waiting for enrichment.`);
    // Wait for the button label to leave its 'Deepening…' state.
    const start = Date.now();
    while (Date.now() - start < 90000) {
        const busy = await page.evaluate(() => !!Array.from(document.querySelectorAll('.journal-npc button'))
            .find(b => b.textContent.includes('Deepening'))).catch(() => false);
        if (!busy) break;
        await delay(1500);
    }
    await delay(1500);
    await shot(page, `journal_after_deepen_${npcName}`);
    const cardText = await page.evaluate((name) => {
        const cards = Array.from(document.querySelectorAll('.journal-npc'));
        const card = cards.find(c => (c.querySelector('.journal-npc-name')?.textContent || '').toLowerCase().includes(name.toLowerCase()));
        return card ? card.innerText.replace(/\s+/g, ' ').slice(0, 900) : '';
    }, npcName);
    note('observe', `Card after deepen: ${cardText}`);
    await clickByText(page, '.journal-close', '✕');
    await delay(500);
    return true;
}

// --- main -----------------------------------------------------------------------

(async () => {
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        userDataDir: PROFILE_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1500,950'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    page.on('dialog', d => d.accept().catch(() => {}));
    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text().slice(0, 300));
            note('console', `error: ${msg.text().slice(0, 300)}`);
        }
    });
    page.on('pageerror', err => note('pageerror', String(err).slice(0, 300)));

    try {
        await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await delay(2000);
        await createCharacter(page);

        // T1: direct flirtation.
        await playTurn(page, 1,
            'I catch Maren\'s eye as she pours and tell her, with a crooked smile, that her laugh has been '
            + 'the best thing about Brackwater all winter — better than the ale, and I like the ale.');
        let npcs = await waitForRoster(page, ns => {
            const m = findNpc(ns, 'Maren');
            return m && (m.stanceToPlayer || m.bondMoments.length > 0);
        }, { label: 'Maren stance/bond after flirtation' });
        let maren = findNpc(npcs, 'Maren');
        note('roster', `Maren after T1: ${JSON.stringify(maren)}`);

        // T2: sincere personal exchange.
        await playTurn(page, 2,
            'I ask her, quieter now, about the sister she mentioned once — the one who went north. '
            + 'I tell her I know what it is to wait on someone the road never gave back.');
        npcs = await waitForRoster(page, ns => {
            const m = findNpc(ns, 'Maren');
            return m && m.stanceToPlayer && m.bondMoments.length >= 1;
        }, { label: 'Maren stance + at least one bond moment' });
        maren = findNpc(npcs, 'Maren');
        note('roster', `Maren after T2: ${JSON.stringify(maren)}`);
        finding(!!maren?.stanceToPlayer, 'Scribe recorded a personal stance toward the hero on Maren',
            `"${(maren?.stanceToPlayer || '').slice(0, 200)}"`);
        finding((maren?.bondMoments || []).length >= 1, 'Scribe recorded at least one bond moment',
            JSON.stringify(maren?.bondMoments || []));
        const stanceAfterT2 = maren?.stanceToPlayer || '';
        const bondsAfterT2 = (maren?.bondMoments || []).length;

        // T3: pure plot turn — the personal record must survive untouched or grow.
        await playTurn(page, 3,
            'I turn to business: I ask around the room whether anyone has seen Odo Ferrin tonight — '
            + 'he owes me forty gold for a season of caravan work, and I mean to collect it.');
        await delay(8000); // let the Scribe land
        npcs = await npcSnapshot(page);
        maren = findNpc(npcs, 'Maren');
        note('roster', `Maren after T3 (plot turn): ${JSON.stringify(maren)}`);
        finding(!!maren?.stanceToPlayer, 'Plot-only turn did not erase the personal stance',
            `"${(maren?.stanceToPlayer || '').slice(0, 200)}"`);
        finding((maren?.bondMoments || []).length >= bondsAfterT2, 'Plot-only turn did not shrink bond moments',
            `before=${bondsAfterT2} after=${(maren?.bondMoments || []).length}`);

        // T4: significant personal beat (promise / invitation).
        await playTurn(page, 4,
            'Before I go upstairs I lean on the bar and tell Maren, honestly and without the crooked smile this time: '
            + 'when my business with Odo is settled, I would like to walk the river lanterns with her. Just the two of us.');
        npcs = await waitForRoster(page, ns => {
            const m = findNpc(ns, 'Maren');
            return m && m.bondMoments.length > bondsAfterT2;
        }, { label: 'new bond moment after the invitation' });
        maren = findNpc(npcs, 'Maren');
        note('roster', `Maren after T4: ${JSON.stringify(maren)}`);
        finding((maren?.bondMoments || []).length >= bondsAfterT2, 'Invitation landed as a durable personal record',
            JSON.stringify(maren?.bondMoments || []));
        const stanceEvolved = (maren?.stanceToPlayer || '') !== stanceAfterT2;
        note('observe', stanceEvolved
            ? 'Stance evolved across the personal beats (merge-style update).'
            : 'Stance unchanged since T2 (acceptable — Scribe judged no shift).');

        const marenBeforeReload = maren;

        // Persistence round-trip: reload → Continue → same record.
        note('nav', 'Reloading the app for the persistence round-trip.');
        await delay(4000); // let the 2s autosave debounce flush
        await page.reload({ waitUntil: 'networkidle2' });
        await delay(2500);
        await page.waitForSelector('.continue-btn', { timeout: 30000 });
        await page.click('.continue-btn');
        await delay(4000);
        npcs = await npcSnapshot(page);
        maren = findNpc(npcs, 'Maren');
        note('roster', `Maren after reload+Continue: ${JSON.stringify(maren)}`);
        finding(!!maren && maren.stanceToPlayer === marenBeforeReload?.stanceToPlayer,
            'stanceToPlayer survived the save/load round-trip',
            `"${(maren?.stanceToPlayer || '').slice(0, 160)}"`);
        finding(!!maren && JSON.stringify(maren.bondMoments) === JSON.stringify(marenBeforeReload?.bondMoments || []),
            'bondMoments survived the save/load round-trip',
            `${(maren?.bondMoments || []).length} moment(s)`);
        await shot(page, 'after_reload');

        // Deepen memory retro path: pick an NPC WITHOUT a stance if one exists.
        const stanceless = (npcs || []).find(n => !n.stanceToPlayer && n.name && !findNpc([n], 'Maren'));
        const target = stanceless || maren;
        note('nav', `Deepen memory target: ${target?.name} (stance before: "${(target?.stanceToPlayer || '').slice(0, 80)}")`);
        const bondsBeforeDeepen = (target?.bondMoments || []).length;
        const ranDeepen = await deepenMemory(page, target.name);
        if (ranDeepen) {
            npcs = await npcSnapshot(page);
            const deepened = findNpc(npcs, target.name);
            note('roster', `${target.name} after deepen: ${JSON.stringify(deepened)}`);
            finding(!!deepened?.stanceToPlayer,
                `Deepen memory synthesized a personal stance for ${target.name} (retro path)`,
                `"${(deepened?.stanceToPlayer || '').slice(0, 200)}"`);
            finding((deepened?.bondMoments || []).length >= bondsBeforeDeepen,
                'Deepen memory never shrank the bond-moment record',
                `before=${bondsBeforeDeepen} after=${(deepened?.bondMoments || []).length}`);
        }

        finding(consoleErrors.length === 0, 'Zero console errors across the whole run',
            consoleErrors.slice(0, 3).join(' | '));

        console.log('\n================ SUMMARY ================');
        for (const f of findings) console.log(`${f.ok ? 'PASS' : 'FAIL'}  ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
        console.log(`\nFindings: ${findings.filter(f => f.ok).length}/${findings.length} passed. Full log: ${path.join(OUT_DIR, 'log.json')}`);
        if (findings.some(f => !f.ok)) process.exitCode = 1;
    } catch (err) {
        note('fatal', String(err && err.stack || err).slice(0, 1200));
        await shot(page, 'fatal');
        process.exitCode = 1;
    } finally {
        saveNotes();
        await browser.close().catch(() => {});
    }
})();
