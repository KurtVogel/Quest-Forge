/**
 * Money-traffic playtest, 20 rounds (2026-09-02).
 *
 * Drives the real app (dev server + headless Chrome) through a scenario built
 * around coin and item movement — vendor purchases and sales at premise-fixed
 * prices, two trivial fights with lootable corpses, a bounty, a delivery fee,
 * a toll, alms, an inn room, and recap turns that tempt the DM into
 * re-granting or re-charging — and records the purse + inventory after every
 * turn (with a 16s watch window so the async Scribe audit shows up as its own
 * delta). Each turn carries the coin delta the premise's fixed prices imply, so
 * the verdict can flag every turn whose purse movement disagrees with the
 * fiction, every double charge/grant, purse drift between turns, and duplicate
 * inventory rows.
 *
 * Reads GEMINI_API_KEY from .env (git-ignored). Requires the dev server on
 * :5173 (or QUEST_FORGE_TEST_URL) and local Chrome.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

function readEnvKey(name) {
    if (process.env[name]) return process.env[name];
    try {
        const envPath = path.resolve('.env');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const match = envContent.match(new RegExp(`${name}\\s*=\\s*["']?([^"'\\r\\n]+)`));
            if (match) return match[1];
        }
    } catch (e) {
        console.warn('Could not read .env file:', e.message);
    }
    return '';
}
// PLAYTEST_PROVIDER=gemini|openai picks the DM; the Gemini key is ALWAYS required
// because the memory machinery (RAG/Scribe/audits) is Gemini-only.
const PROVIDER = (process.env.PLAYTEST_PROVIDER || 'gemini').toLowerCase();
const DEFAULT_MODELS = { gemini: 'gemini-3.1-pro-preview', openai: 'gpt-5.6-terra' };
const MODEL = process.env.PLAYTEST_MODEL || DEFAULT_MODELS[PROVIDER];
const GEMINI_API_KEY = readEnvKey('GEMINI_API_KEY');
const DM_API_KEY = PROVIDER === 'openai' ? readEnvKey('OPENAI_API_KEY') : GEMINI_API_KEY;
const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:5173';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve(process.env.PLAYTEST_OUT_DIR || `test-results/playtest_money_20_${PROVIDER}`);

if (!GEMINI_API_KEY || !DM_API_KEY || !MODEL) {
    console.error(`Missing key or model for provider ${PROVIDER} (GEMINI_API_KEY is always required) — aborting.`);
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
        { timeout: 180000 }
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
    }, { timeout: 180000 });
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
const fmtPurse = p => `${p.gold}g/${p.silver}s/${p.copper}c`;

async function readInventory(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('.inv-item')).map(node => {
        const name = node.querySelector('.inv-item-name')?.textContent?.trim() || 'Unknown';
        const qtyText = node.querySelector('.inv-item-qty')?.textContent || '';
        const qty = parseInt(qtyText.replace(/[^0-9]/g, ''), 10) || 1;
        return { name, qty, equipped: node.classList.contains('equipped') };
    }));
}

async function readMessages(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('.chat-message')).map(m => ({
        role: m.classList.contains('system') ? 'system' : (m.classList.contains('assistant') ? 'assistant' : 'user'),
        text: (m.querySelector('.message-text')?.textContent || m.textContent || '').trim().slice(0, 900),
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

async function handleProposedCheck(page, log) {
    const active = await page.evaluate(() => !!document.querySelector('.roleplay-check-panel'));
    if (!active) return false;
    log('  [check] Roll proposal detected — accepting and rolling.');
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
            const collapseBtn = panel.querySelector('.combat-collapse-btn');
            if (collapseBtn && collapseBtn.getAttribute('aria-expanded') === 'false') collapseBtn.click();
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
            const target = combat.enemies.find(e => e.cond !== 'dead')?.name || 'enemy';
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

const PREMISE = 'Brannock is a half-orc fighter who has just walked into Wexbridge, a sleepy little river town, on a quiet afternoon with coin in his pouch and nothing pressing to do. '
    + 'Wexbridge is entirely peaceful and lawless in the gentlest way: it has NO guards, NO watch, NO magistrate, NO jail, and NO toll-guard of any kind; nobody in town is ever arrested or detained, and the townsfolk never interfere with anything Brannock does. '
    + 'These facts about Wexbridge are established canon, known to everyone in town: '
    + '(1) Marla runs the general-goods stall on the square. Her fixed prices, which she never changes: 50 feet of hempen rope for exactly 1 gold, torches for exactly 1 copper each, a watered-down local healing potion (a real potion, just a cheap one) for exactly 10 gold each, and rations for exactly 5 silver per day. Marla also BUYS goods back at whatever price she names and always pays on the spot, and she will buy a tarnished silver ring for exactly 5 silver. '
    + '(2) Hesper, the innkeeper of The Blackened Pike, is plagued by a single giant rat nesting in her cellar. She has publicly offered a bounty of exactly 3 silver to whoever kills it. The rat is weak (a few hit points) and its nest contains exactly 7 copper coins and one tarnished silver ring. A room at The Blackened Pike costs exactly 5 copper a night. '
    + '(3) At the crossroads just outside town, a starving, sickly cutpurse named Dodd sits in plain view on the old milestone, waylaying lone travellers. He ALWAYS attacks anyone who walks up to the crossroads, without exception. He is pitifully weak: about 4 hit points, armed only with a rusty knife, attacking once per round, and he dies to a single solid blow. He carries a purse of exactly 2 gold and 5 silver, a dagger, and one healing potion. '
    + '(4) Old Tamsin collects the bridge toll: exactly 2 silver to cross. She is a frail toll collector, not a guard. (5) A blind beggar sits by the bridge. '
    + '(6) Across the bridge lives the miller, Rook. Marla has a small wrapped parcel waiting on her stall that needs delivering to Rook, and Rook pays exactly 1 gold to whoever brings it. '
    + 'Keep every price exactly as stated and keep the two fights trivial. Open with Brannock arriving on the square with Marla\'s stall in view.';

// expectCp: the coin delta the premise's fixed prices imply, or null when the
// turn should move no coin. expectItems: names expected to be gained (+) or lost (-).
const TURN_SCRIPT = [
    { label: '01-opening-look', action: 'I take a slow look around Wexbridge and count the coins in my pouch.', expectCp: 0 },
    { label: '02-buy-rope', action: 'I go to Marla\'s stall and buy 50 feet of hempen rope, paying her 1 gold.', expectCp: -100, gain: ['rope'] },
    { label: '03-buy-3-torches', action: 'I buy three torches from Marla and pay her 3 copper.', expectCp: -3, gain: ['torch'] },
    { label: '04-sell-2-torches', action: 'I change my mind and sell two of the torches back to Marla for 1 copper each.', expectCp: 2 },
    { label: '05-rat-fight', action: 'I walk into The Blackened Pike, tell Hesper I will take her rat bounty, climb down into her cellar and attack the giant rat with my longsword!', expectCp: 0, combat: true },
    { label: '06-loot-rat-nest', action: 'I search the rat\'s nest and take the 7 copper coins and the tarnished silver ring.', expectCp: 7, gain: ['ring'] },
    { label: '07-claim-bounty', action: 'I climb back up and tell Hesper the rat is dead, and collect the 3 silver bounty from her.', expectCp: 30 },
    { label: '08-sell-ring', action: 'I sell the tarnished silver ring to Marla for 5 silver.', expectCp: 50, lose: ['ring'] },
    { label: '09-recap-marla', action: 'I chat with Marla about the rat bounty Hesper paid me and the ring Marla bought from me, thank her for the coin, and ask for the parcel she needs carried to Rook the miller. I tuck it into my pack.', expectCp: 0 },
    { label: '10-bandit-fight', action: 'I walk out to the crossroads. Dodd the cutpurse is sitting on the milestone. I stride straight at him and attack him with my longsword before he can draw his knife!', expectCp: 0, combat: true },
    { label: '11-loot-bandit', action: 'I search the corpse of Dodd the cutpurse and take his purse of 2 gold and 5 silver, his dagger, and his healing potion.', expectCp: 250, gain: ['dagger', 'potion'] },
    { label: '12-recap-innkeeper', action: 'I walk back into town and tell Hesper about the cutpurse I killed and the purse of 2 gold and 5 silver I took from his body.', expectCp: 0 },
    { label: '13-buy-potion', action: 'I go back to Marla and buy one of her cheap healing potions for 10 gold.', expectCp: -1000, gain: ['potion'] },
    { label: '14-inn-room-rest', action: 'I pay Hesper 5 copper for a room and take a long rest for the night.', expectCp: -5 },
    { label: '15-morning-count', action: 'In the morning I carefully count out all my coins on the table.', expectCp: 0 },
    { label: '16-pay-toll', action: 'I walk to the bridge and pay Old Tamsin the 2 silver toll.', expectCp: -20 },
    { label: '17-give-beggar', action: 'Before crossing, I give the old beggar by the bridge 1 gold piece.', expectCp: -100 },
    { label: '18-deliver-parcel', action: 'I cross the bridge, carry the parcel from Marla to Rook the miller, hand it over, and collect the 1 gold delivery fee.', expectCp: 100 },
    { label: '19-recap-miller', action: 'I chat with Rook about the parcel I just delivered and the 1 gold he paid me for it.', expectCp: 0 },
    { label: '20-buy-rations', action: 'I return to Marla, tell her the parcel is delivered, and buy 2 days of rations for 1 gold.', expectCp: -100, gain: ['ration'] },
];

async function run() {
    const log = (...args) => console.log(...args);
    log('Launching Chrome...');
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
        if (/applyEvents|Scribe|Duplicate|coin|payment|ledger|audit/i.test(text)) {
            log(`  [browser] ${text.slice(0, 220)}`);
        }
    });

    log('Navigating to app...');
    await page.goto(APP_URL);
    await delay(3000);

    log('Setting API key in localStorage...');
    log(`DM provider: ${PROVIDER} / ${MODEL}`);
    await page.evaluate(({ provider, apiKey, geminiApiKey, model }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: provider,
            apiKey,
            geminiApiKey,
            imageApiKey: 'xai-dummy',
            model,
        }));
    }, { provider: PROVIDER, apiKey: DM_API_KEY, geminiApiKey: GEMINI_API_KEY, model: MODEL });
    await page.reload();
    await delay(3000);

    log('Creating character...');
    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(1000);
    await page.waitForSelector('.creation-card');
    await page.click('.creation-card'); // Forge a New Hero
    await delay(1000);
    await page.waitForSelector('.creation-input');
    await page.type('.creation-input', 'Brannock the Coin Tester');
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
    log('Waiting for the opening scene...');
    await waitForLLM(page);

    const report = [];
    let messageCount = (await readMessages(page)).length;
    const opening = await readPurse(page);
    const openingInventory = await readInventory(page);
    log(`\nOpening purse: ${fmtPurse(opening)}; inventory: ${openingInventory.map(i => `${i.name}${i.qty > 1 ? ' x' + i.qty : ''}`).join(', ')}\n`);

    let lastAfter = opening;
    for (const turn of TURN_SCRIPT) {
        log(`--- TURN ${turn.label} ---`);
        await resolveCombatIfActive(page, log);
        const purseBefore = await readPurse(page);
        const driftCp = purseCp(purseBefore) - purseCp(lastAfter);
        const invBefore = await readInventory(page);
        await typeIntoInput(page, turn.action);
        await page.click('button.chat-send-btn');
        if (turn.combat) {
            await waitForCombatToSettle(page);
        } else {
            await waitForLLM(page);
        }
        // A dropped stream leaves an error line and a Retry button; one retry
        // keeps a transient provider hiccup from voiding the whole beat.
        for (let attempt = 0; attempt < 2; attempt++) {
            const dropped = await page.evaluate(() => {
                const last = Array.from(document.querySelectorAll('.chat-message')).pop();
                const text = last?.textContent || '';
                return /connection dropped|Please retry|reply is incomplete/i.test(text) && !document.querySelector('.combat-panel');
            });
            if (!dropped) break;
            log('  [retry] Stream dropped — re-sending the action.');
            await typeIntoInput(page, turn.action);
            await page.click('button.chat-send-btn');
            if (turn.combat) await waitForCombatToSettle(page); else await waitForLLM(page);
        }
        await resolveCombatIfActive(page, log);
        if (await handleProposedCheck(page, log)) {
            await resolveCombatIfActive(page, log);
        }
        const timeline = await monitorPurse(page, 16);
        const allMessages = await readMessages(page);
        const newMessages = allMessages.slice(messageCount);
        messageCount = allMessages.length;
        const purseAfter = await readPurse(page);
        const invAfter = await readInventory(page);
        const systemLines = newMessages.filter(m => m.role === 'system').map(m => m.text);
        const entry = {
            turn: turn.label,
            action: turn.action,
            expectCp: turn.expectCp,
            purseBefore,
            purseAfter,
            driftBeforeTurnCp: driftCp,
            netDeltaCp: purseCp(purseAfter) - purseCp(purseBefore),
            purseTimeline: timeline,
            inventoryBefore: invBefore,
            inventoryAfter: invAfter,
            systemLines,
            dmText: newMessages.filter(m => m.role === 'assistant').map(m => m.text),
        };
        report.push(entry);
        lastAfter = purseAfter;
        const mark = turn.expectCp === null || entry.netDeltaCp === turn.expectCp ? 'ok' : `MISMATCH (expected ${turn.expectCp})`;
        log(`  purse: ${fmtPurse(purseBefore)} -> ${fmtPurse(purseAfter)} (net ${entry.netDeltaCp} cp) ${mark}${driftCp ? ` [drift before turn: ${driftCp} cp]` : ''}`);
        for (const s of systemLines) log(`  [system] ${s.slice(0, 200)}`);
        for (const t of entry.dmText) log(`  [dm] ${t.replace(/\s+/g, ' ').slice(0, 700)}`);
        for (const d of timeline.filter(s => s.t > 0)) log(`  [late purse change] t=${d.t}s deltaCp=${d.deltaCp}`);
        const invSummary = invAfter.map(i => `${i.name}${i.qty > 1 ? ' x' + i.qty : ''}`).join(', ');
        log(`  inventory: ${invSummary}`);
        await page.screenshot({ path: path.join(OUT_DIR, `${turn.label}.png`) });
    }

    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'console.log'), consoleLines.join('\n'));

    log('\n================ VERDICT ================');
    let anomalies = 0;
    const lines = [];
    for (const entry of report) {
        const negatives = entry.purseTimeline.filter(s => (s.deltaCp || 0) < 0);
        const positives = entry.purseTimeline.filter(s => (s.deltaCp || 0) > 0);
        if (negatives.length >= 2) { anomalies++; lines.push(`!! ${entry.turn}: MULTIPLE negative purse deltas in one turn: ${negatives.map(n => n.deltaCp).join(', ')}`); }
        if (positives.length >= 2) { anomalies++; lines.push(`!! ${entry.turn}: MULTIPLE positive purse deltas in one turn: ${positives.map(n => n.deltaCp).join(', ')}`); }
        if (entry.expectCp !== null && entry.netDeltaCp !== entry.expectCp) { anomalies++; lines.push(`!! ${entry.turn}: net ${entry.netDeltaCp} cp, premise implies ${entry.expectCp} cp`); }
        if (entry.driftBeforeTurnCp) { anomalies++; lines.push(`!! ${entry.turn}: purse moved ${entry.driftBeforeTurnCp} cp BETWEEN turns (late audit after the watch window?)`); }
        const names = entry.inventoryAfter.map(i => i.name.toLowerCase().trim());
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        if (dupes.length) { anomalies++; lines.push(`!! ${entry.turn}: duplicate inventory rows: ${[...new Set(dupes)].join(', ')}`); }
        for (const g of entry.systemLines.filter(s => /Duplicate .*ignored|already (applied|paid|banked|granted)/i.test(s))) lines.push(`~~ ${entry.turn}: guard caught an attempt: ${g.slice(0, 160)}`);
        for (const a of entry.systemLines.filter(s => /settled from narration|recovered from narration|audit/i.test(s))) lines.push(`.. ${entry.turn}: audit acted: ${a.slice(0, 160)}`);
    }
    for (const l of lines) log(l);
    if (anomalies === 0) log('No anomalies detected across all 20 turns.');
    log(`Final purse: ${fmtPurse(lastAfter)} (opening ${fmtPurse(opening)}; premise-implied net ${TURN_SCRIPT.reduce((a, t) => a + (t.expectCp || 0), 0)} cp)`);
    log('=========================================');
    log('PLAYTEST DONE');

    await browser.close();
}

run().catch(err => {
    console.error('Playtest failed:', err);
    console.log('PLAYTEST DONE');
    process.exit(1);
});
