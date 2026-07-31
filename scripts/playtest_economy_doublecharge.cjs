/**
 * Economy double-charge playtest (2026-07-31).
 *
 * Drives the real app (dev server + headless Chrome) through a money-heavy
 * scenario — kobold gold loot, giving coins away, tossing coins, buying,
 * selling, paying for a room + long rest, then recap turns — and watches the
 * purse DOM continuously after every DM response so a late async Scribe-audit
 * deduction shows up as its own delta. Built to verify the DECISIONS.md
 * 2026-07-31 "audit backstops observe, the engine reconciles" fix: no turn may
 * charge or grant the same narrated coin movement twice.
 *
 * Reads GEMINI_API_KEY from .env (git-ignored) so the key never appears in logs.
 * Requires the dev server on :5173 (or QUEST_FORGE_TEST_URL) and local Chrome.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

let localApiKey = '';
try {
    const envPath = path.resolve('.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)/);
        if (match) localApiKey = match[1];
    }
} catch (e) {
    console.warn('Could not read .env file:', e.message);
}
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || localApiKey;
const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:5173';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve('test-results/playtest_economy');

if (!GEMINI_API_KEY) {
    console.error('No GEMINI_API_KEY in env or .env — aborting.');
    process.exit(1);
}
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function typeIntoInput(page, text) {
    await page.evaluate(val => {
        const textarea = document.querySelector('textarea.chat-input');
        if (textarea) {
            textarea.value = val;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, text);
    await delay(300);
}

async function waitForLLM(page) {
    await page.waitForFunction(
        () => !document.querySelector('.chat-stop-btn') && !document.querySelector('.typing-indicator'),
        { timeout: 120000 }
    );
    await delay(1500);
}

async function waitForCombatToSettle(page) {
    await page.waitForFunction(() => {
        const loading = !!document.querySelector('.chat-stop-btn') || !!document.querySelector('.typing-indicator');
        if (loading) return false;
        const panel = document.querySelector('.combat-panel');
        if (!panel) return true;
        const turnText = document.querySelector('.combat-turn')?.textContent || '';
        const isAwaitingNarration = turnText.includes('awaiting its narration');
        const hasRetryButton = document.querySelector('.chat-send-btn')?.textContent.includes('Retry');
        if (isAwaitingNarration && !hasRetryButton) return false;
        return true;
    }, { timeout: 120000 });
    await delay(1500);
}

async function readPurse(page) {
    return page.evaluate(() => ({
        gold: parseInt((document.querySelector('.inv-gold')?.textContent || '0').replace(/[^0-9]/g, ''), 10) || 0,
        silver: parseInt((document.querySelector('.inv-silver')?.textContent || '0').replace(/[^0-9]/g, ''), 10) || 0,
        copper: parseInt((document.querySelector('.inv-copper')?.textContent || '0').replace(/[^0-9]/g, ''), 10) || 0,
    }));
}

const purseCp = p => p.gold * 100 + p.silver * 10 + p.copper;

async function readMessages(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('.chat-message')).map(m => ({
        role: m.classList.contains('system') ? 'system' : (m.classList.contains('assistant') ? 'assistant' : 'user'),
        text: (m.querySelector('.message-text')?.textContent || m.textContent || '').trim().slice(0, 600),
    })));
}

/** Watch the purse for `seconds` after a turn so the async Scribe audit's
 * deduction/grant (which lands well after the DM text) is captured as its own
 * timestamped delta. */
async function monitorPurse(page, seconds) {
    const timeline = [];
    let last = await readPurse(page);
    timeline.push({ t: 0, ...last });
    const steps = Math.ceil(seconds / 2);
    for (let i = 1; i <= steps; i++) {
        await delay(2000);
        const cur = await readPurse(page);
        if (purseCp(cur) !== purseCp(last)) {
            timeline.push({ t: i * 2, ...cur, deltaCp: purseCp(cur) - purseCp(last) });
            last = cur;
        }
    }
    return timeline;
}

async function handleProposedCheck(page) {
    const active = await page.evaluate(() => !!document.querySelector('.roleplay-check-panel'));
    if (!active) return false;
    console.log('  [check] Roll proposal detected — accepting and rolling.');
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.roleplay-check-actions button'))
            .find(b => b.textContent.includes('Roll'));
        if (btn) btn.click();
    });
    await waitForLLM(page);
    return true;
}

/** Keep swinging until the combat panel is gone (victory → End Combat). */
async function resolveCombatIfActive(page, log) {
    for (let i = 0; i < 16; i++) {
        const combat = await page.evaluate(() => {
            const panel = document.querySelector('.combat-panel');
            if (!panel) return { active: false };
            const turnText = document.querySelector('.combat-turn')?.textContent || '';
            const endBtn = document.querySelector('.combat-end-btn');
            const enemies = Array.from(document.querySelectorAll('.enemy-card')).map(c => ({
                name: c.querySelector('.enemy-name')?.textContent || 'Unknown',
                cond: c.querySelector('.enemy-condition')?.textContent || '',
            }));
            return {
                active: true,
                isPlayerTurn: turnText.includes('Your turn'),
                enemies,
                canEndCombat: !!endBtn,
                hasRetry: !!document.querySelector('.chat-send-btn')?.textContent.includes('Retry'),
            };
        });
        if (!combat.active) return;
        if (combat.canEndCombat) {
            log('  [combat] Victory — clicking End Combat.');
            await page.click('.combat-end-btn');
            await waitForCombatToSettle(page);
        } else if (combat.isPlayerTurn) {
            const target = combat.enemies.find(e => e.cond !== 'dead')?.name || 'kobold';
            log(`  [combat] Attacking ${target}.`);
            await typeIntoInput(page, `I strike the ${target} down with my longsword.`);
            await page.click('button.chat-send-btn');
            await waitForCombatToSettle(page);
        } else if (combat.hasRetry) {
            log('  [combat] Retrying narration.');
            await page.click('.chat-send-btn');
            await waitForCombatToSettle(page);
        } else {
            await delay(3000);
        }
    }
}

const PREMISE = 'I am Grog, a half-orc fighter, and I am a developer play-testing this game\'s money handling. '
    + 'Set the scene in the tiny riverside hamlet of Toll Ford on market day. There is no guard or watch of any kind in Toll Ford, and the villagers never interfere with anything I do. Include: '
    + '(1) one very weak, scrawny lone kobold lurking in the reeds OUTSIDE the village palisade, away from all people; it is hostile vermin, the villagers have posted a bounty notice asking for it to be killed, and it carries a small pouch of exactly 4 gold pieces that I loot when I defeat it; '
    + '(2) an old beggar woman by the well; (3) a wishing fountain; (4) a general-goods merchant named Pol with cheap wares (torches, rope, rations) who buys and sells; '
    + '(5) a ferryman charging 2 silver per crossing; (6) a small inn where a room costs 5 copper. '
    + 'Keep fights trivial and prices exactly as stated. I will be moving coins around a lot on purpose.';

const TURN_SCRIPT = [
    { label: 'opening-look', action: 'I take a slow look around the market square, checking my coin pouch.' },
    { label: 'kobold-fight', action: 'I walk out of the village gate to the reeds and attack the scrawny kobold with my longsword!', combat: true },
    { label: 'kobold-loot', action: 'I search the kobold\'s body and take its coin pouch, then walk back into the village.' },
    { label: 'give-beggar-1gp', action: 'I walk to the well and give 1 gold piece to the old beggar woman.' },
    { label: 'toss-fountain-3cp', action: 'I toss 3 copper coins into the wishing fountain and make a wish.' },
    { label: 'buy-torch', action: 'I go to Pol\'s stall and buy one torch.' },
    { label: 'sell-torch-back', action: 'I sell the torch back to Pol.' },
    { label: 'pay-ferryman-2sp', action: 'I pay the ferryman 2 silver and cross the river.' },
    { label: 'inn-room-rest', action: 'I return to the inn, pay the innkeeper 5 copper for a room, and take a long rest for the night.' },
    { label: 'recap-count-coins', action: 'In the morning I carefully count out my remaining coins on the table.' },
    { label: 'recap-chat', action: 'I chat with the innkeeper about yesterday: the kobold I killed, the gold I gave the beggar, and the ferry toll I paid.' },
];

async function run() {
    console.log('Launching Chrome...');
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const consoleLines = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLines.push(`[${msg.type()}] ${text}`);
        if (/applyEvents|Scribe|Duplicate|coin|payment|ledger/i.test(text)) {
            console.log(`  [browser] ${text.slice(0, 220)}`);
        }
    });

    console.log('Navigating to app...');
    await page.goto(APP_URL);
    await delay(3000);

    console.log('Setting API key in localStorage...');
    await page.evaluate(({ apiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: 'gemini',
            apiKey,
            imageApiKey: 'xai-dummy',
            model: 'gemini-3.1-pro-preview',
        }));
    }, { apiKey: GEMINI_API_KEY });
    await page.reload();
    await delay(3000);

    console.log('Creating character...');
    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(1000);
    await page.waitForSelector('.creation-card');
    await page.click('.creation-card'); // Forge a New Hero
    await delay(1000);
    await page.waitForSelector('.creation-input');
    await page.type('.creation-input', 'Grog the Coin Tester');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await page.waitForSelector('.creation-card');
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.creation-card'));
        (cards.find(c => /Half-Orc|halfOrc/.test(c.textContent)) || cards[0]).click();
    });
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await page.waitForSelector('.creation-card');
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.creation-card'));
        (cards.find(c => c.textContent.includes('Fighter')) || cards[0]).click();
    });
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await page.waitForSelector('.stat-row');
    for (let i = 0; i < 6; i++) {
        await page.evaluate(index => {
            document.querySelectorAll('.stat-row')[index]?.querySelector('.stat-choice')?.click();
        }, i);
        await delay(400);
    }
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await page.waitForSelector('.skill-choice-card');
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.skill-choice-card'));
        let selected = cards.filter(c => c.classList.contains('selected')).length;
        for (const card of cards) {
            if (selected >= 2) break;
            if (!card.classList.contains('selected')) { card.click(); selected++; }
        }
    });
    await delay(500);
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await page.click('.char-creation-actions .btn-primary'); // Confirm hero
    await delay(1000);
    await page.waitForSelector('textarea.creation-premise');
    await page.evaluate(text => {
        const box = document.querySelector('textarea.creation-premise');
        box.value = text;
        box.dispatchEvent(new Event('input', { bubbles: true }));
    }, PREMISE);
    await delay(300);
    await page.click('.char-creation-actions .btn-primary'); // Begin Adventure
    console.log('Waiting for the opening scene...');
    await waitForLLM(page);

    const report = [];
    let messageCount = (await readMessages(page)).length;
    const opening = await readPurse(page);
    console.log(`\nOpening purse: ${opening.gold}g ${opening.silver}s ${opening.copper}c\n`);

    for (const turn of TURN_SCRIPT) {
        console.log(`--- TURN ${turn.label} ---`);
        // Drain any combat still (or newly) active before the scripted action —
        // an unexpected fight would otherwise eat every later economy turn while
        // the engine's combat lockout (correctly) freezes coin events.
        await resolveCombatIfActive(page, console.log);
        const purseBefore = await readPurse(page);
        await typeIntoInput(page, turn.action);
        await page.click('button.chat-send-btn');
        if (turn.combat) {
            await waitForCombatToSettle(page);
        } else {
            await waitForLLM(page);
        }
        await resolveCombatIfActive(page, console.log);
        await handleProposedCheck(page);
        // 16s watch window: the async Scribe audit lands seconds after the DM text.
        const timeline = await monitorPurse(page, 16);
        const allMessages = await readMessages(page);
        const newMessages = allMessages.slice(messageCount);
        messageCount = allMessages.length;
        const purseAfter = await readPurse(page);
        const systemLines = newMessages.filter(m => m.role === 'system').map(m => m.text);
        const entry = {
            turn: turn.label,
            action: turn.action,
            purseBefore,
            purseAfter,
            netDeltaCp: purseCp(purseAfter) - purseCp(purseBefore),
            purseTimeline: timeline,
            systemLines,
            dmTail: newMessages.filter(m => m.role === 'assistant').map(m => m.text.slice(0, 300)),
        };
        report.push(entry);
        console.log(`  purse: ${purseBefore.gold}g/${purseBefore.silver}s/${purseBefore.copper}c -> ${purseAfter.gold}g/${purseAfter.silver}s/${purseAfter.copper}c (net ${entry.netDeltaCp} cp)`);
        for (const s of systemLines) console.log(`  [system] ${s.slice(0, 180)}`);
        const lateDeltas = timeline.filter(s => s.t > 0);
        if (lateDeltas.length > 0) {
            for (const d of lateDeltas) console.log(`  [late purse change] t=${d.t}s deltaCp=${d.deltaCp}`);
        }
        await page.screenshot({ path: path.join(OUT_DIR, `${String(report.length).padStart(2, '0')}_${turn.label}.png`) });
    }

    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'console.log'), consoleLines.join('\n'));

    // Automated verdict: flag any turn whose watch window shows two separate
    // negative deltas (the double-charge signature) or duplicate-guard lines.
    console.log('\n================ VERDICT ================');
    let anomalies = 0;
    for (const entry of report) {
        const negatives = entry.purseTimeline.filter(s => (s.deltaCp || 0) < 0);
        const doubleCharge = negatives.length >= 2;
        const guardCaught = entry.systemLines.filter(s => /Duplicate .*ignored/i.test(s));
        const auditActed = entry.systemLines.filter(s => /settled from narration|recovered from narration/i.test(s));
        if (doubleCharge) {
            anomalies++;
            console.log(`!! ${entry.turn}: MULTIPLE negative purse deltas in one turn: ${negatives.map(n => n.deltaCp).join(', ')}`);
        }
        for (const g of guardCaught) console.log(`~~ ${entry.turn}: guard caught an attempt: ${g.slice(0, 140)}`);
        for (const a of auditActed) console.log(`.. ${entry.turn}: audit acted: ${a.slice(0, 140)}`);
    }
    if (anomalies === 0) console.log('No double-charge signatures detected across all turns.');
    console.log('=========================================');

    await browser.close();
}

run().catch(err => {
    console.error('Playtest failed:', err);
    process.exit(1);
});
