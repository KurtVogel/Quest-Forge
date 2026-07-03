const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

let localApiKey = '';
try {
    const envPath = path.resolve('.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)/);
        if (match) {
            localApiKey = match[1];
        }
    }
} catch (e) {
    console.warn("Could not read .env file:", e.message);
}
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || localApiKey;
const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:5173';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = path.resolve('test-results/playtest_looting_gated');

if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

let globalPage = null;

async function typeIntoInput(page, text) {
    await page.evaluate((val) => {
        const textarea = document.querySelector('textarea.chat-input');
        if (textarea) {
            textarea.value = val;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, text);
    await delay(300);
}

async function waitForLLMOrCheck(page) {
    console.log("Waiting for DM response...");
    await page.waitForFunction(() => {
        return !document.querySelector('.chat-stop-btn') && !document.querySelector('.typing-indicator');
    }, { timeout: 90000 });
    await delay(3000); // 3s wait for state to settle
    console.log("DM response finished.");
}

async function handleProposedChecks(page, stepLabel) {
    const checkState = await page.evaluate(() => {
        const panel = document.querySelector('.roleplay-check-panel');
        if (!panel) return { active: false };

        const title = panel.querySelector('h3')?.textContent || '';
        const rolls = Array.from(panel.querySelectorAll('.roleplay-check-roll')).map(roll => {
            const desc = roll.querySelector('.roleplay-check-title strong')?.textContent || '';
            const dc = roll.querySelector('.roleplay-check-title span')?.textContent || '';
            const reason = roll.querySelector('.roleplay-check-reasoning dd')?.textContent || '';
            return { desc, dc, reason };
        });

        const challengeButton = Array.from(panel.querySelectorAll('.roleplay-check-actions button'))
            .find(btn => btn.textContent.includes('Challenge'));

        return {
            active: true,
            title,
            rolls,
            canChallenge: !!challengeButton && !panel.querySelector('.roleplay-check-final')
        };
    });

    if (!checkState.active) {
        return false;
    }

    console.log(`\n[Gating System] Proposed Check Detected at step ${stepLabel}: "${checkState.title}"`);
    for (const roll of checkState.rolls) {
        console.log(`  - Roll: ${roll.desc} (${roll.dc})`);
        console.log(`  - Reason: ${roll.reason}`);
    }

    console.log("[Gating System] Accepting the DC check and rolling...");
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.roleplay-check-actions button'))
            .find(btn => btn.textContent.includes('Roll'));
        if (btn) btn.click();
    });
    await waitForLLMOrCheck(page);
    console.log("[Gating System] Roll submitted and narration loaded.");
    return true;
}

async function extractGameState(page) {
    return await page.evaluate(() => {
        const goldText = document.querySelector('.inv-gold')?.textContent || '0 gp';
        const silverText = document.querySelector('.inv-silver')?.textContent || '0 sp';
        const copperText = document.querySelector('.inv-copper')?.textContent || '0 cp';
        
        const itemNodes = Array.from(document.querySelectorAll('.inv-item'));
        const items = itemNodes.map(node => {
            const name = node.querySelector('.inv-item-name')?.textContent?.trim() || 'Unknown';
            const qtyText = node.querySelector('.inv-item-qty')?.textContent || '';
            const qtyMatch = qtyText.match(/x(\d+)/);
            const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
            return { name, qty };
        });

        const chatMsgs = Array.from(document.querySelectorAll('.chat-message.assistant'));
        const lastMsgText = chatMsgs.length ? chatMsgs[chatMsgs.length - 1].querySelector('.message-text')?.textContent?.trim() : '';

        return {
            gold: parseInt(goldText.replace(/[^0-9]/g, '')) || 0,
            silver: parseInt(silverText.replace(/[^0-9]/g, '')) || 0,
            copper: parseInt(copperText.replace(/[^0-9]/g, '')) || 0,
            items,
            lastMsgText
        };
    });
}

const explorationActions = [
    "I try to lockpick the heavy ornate safe in the master bedroom wall to get the treasure.",
    "I search the dusty floorboards under the rug, looking for a hidden trapdoor or floor safe.",
    "I attempt to disarm the tripwire trap guarding the velvet-lined jewelry cabinet in the study.",
    "I search the suspicious crack in the fireplace stone, looking for a hidden cache.",
    "I try to force open the jammed iron lockbox on the writing desk using my crowbar.",
    "I pick the pocket of the sleeping enforcer slumped in the salon chair to steal his keys and coin pouch.",
    "I search the drawers of the vanity table, feeling carefully for any secret compartments.",
    "I try to crack the combination lock on the heavy iron floor safe in the study.",
    "I reach my hand deep into the dark hole in the stone wall, searching for hidden items.",
    "I grab the golden goblet from the pedestal, trying to replace it with a pouch of sand of equal weight."
];

async function run() {
    console.log("Launching Chrome...");
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    globalPage = page;
    await page.setViewport({ width: 1280, height: 900 });

    page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
            console.log(`[Browser Console ${msg.type()}]`, msg.text());
        }
    });

    console.log("Navigating to app...");
    await page.goto(APP_URL);
    await delay(3000);

    console.log("Setting API keys in localStorage...");
    await page.evaluate(({ apiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: 'gemini',
            apiKey,
            imageApiKey: 'xai-dummy',
            model: 'gemini-3.1-pro-preview'
        }));
    }, { apiKey: GEMINI_API_KEY });

    console.log("Reloading page to apply settings...");
    await page.reload();
    await delay(3000);

    console.log("Clicking New Game...");
    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(1000);

    console.log("Clicking Forge a New Hero...");
    await page.waitForSelector('.creation-card');
    await page.click('.creation-card');
    await delay(1000);

    console.log("Step 1: Naming character...");
    await page.waitForSelector('.creation-input');
    await page.type('.creation-input', 'Grog the Roll Loot Tester');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 2: Choosing race (Half-Orc)...");
    await page.waitForSelector('.creation-card');
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.creation-card'));
        const halfOrcCard = cards.find(c => c.textContent.includes('Half-Orc') || c.textContent.includes('halfOrc'));
        if (halfOrcCard) halfOrcCard.click();
        else cards[0].click();
    });
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 3: Choosing class (Fighter)...");
    await page.waitForSelector('.creation-card');
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.creation-card'));
        const fighterCard = cards.find(c => c.textContent.includes('Fighter'));
        if (fighterCard) fighterCard.click();
        else cards[0].click();
    });
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 4: Assigning stats (Standard Array)...");
    await page.waitForSelector('.stat-row');
    for (let i = 0; i < 6; i++) {
        await page.evaluate((index) => {
            const row = document.querySelectorAll('.stat-row')[index];
            const choice = row.querySelector('.stat-choice');
            if (choice) choice.click();
        }, i);
        await delay(500);
    }
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 5: Choosing skills (Athletics and Intimidation)...");
    await page.waitForSelector('.skill-choice-card');
    const skillsToSelect = ['Athletics', 'Intimidation'];
    for (const skill of skillsToSelect) {
        await page.evaluate((s) => {
            const card = Array.from(document.querySelectorAll('.skill-choice-card'))
                .find(c => c.textContent.includes(s) && !c.classList.contains('selected'));
            if (card) card.click();
        }, skill);
        await delay(500);
    }
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.skill-choice-card'));
        const selectedCount = cards.filter(c => c.classList.contains('selected')).length;
        if (selectedCount < 2) {
            const needed = 2 - selectedCount;
            const unselected = cards.filter(c => !c.classList.contains('selected'));
            for (let i = 0; i < Math.min(needed, unselected.length); i++) {
                unselected[i].click();
            }
        }
    });
    await delay(500);
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 6: Confirming character...");
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 7: Setting campaign premise...");
    await page.waitForSelector('textarea.creation-premise');
    const premiseText = "I am Grog the Roll Loot Tester. I am play-testing out-of-combat looting with proposed rolls. DM, please guide me through Sterling Manor. I will explore and loot containers. Since I want to test roll gating, please always propose an interesting check (lockpick, disarm trap, search under pressure, pickpocket) for every action I take, describing the potential loot inside (coins, items, or both). Ensure that success grants the loot. I will accept the check and roll to verify the engine handles the loot correctly.";
    await page.type('textarea.creation-premise', premiseText);
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Waiting for DM to set the scene...");
    await waitForLLMOrCheck(page);
    
    let initialState = await extractGameState(page);
    console.log(`\n=== INITIAL GAME STATE ===`);
    console.log(`Coins: Gold=${initialState.gold}, Silver=${initialState.silver}, Copper=${initialState.copper}`);
    console.log(`Inventory: ${JSON.stringify(initialState.items)}`);
    console.log(`==========================\n`);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00_initial_scene.png') });

    let turnCount = 1;
    const playtestReport = [];

    for (const action of explorationActions) {
        console.log(`\n--- PLAYTEST TURN ${turnCount}/10 ---`);
        console.log(`Player action: "${action}"`);

        await typeIntoInput(page, action);
        await page.click('button.chat-send-btn');
        await waitForLLMOrCheck(page);

        // Check and handle proposed check
        const checkProposed = await handleProposedChecks(page, `turn_${turnCount}`);
        if (checkProposed) {
            console.log("Handled proposed check.");
        }

        await delay(1500);

        // Extract state
        const stateAfterTurn = await extractGameState(page);
        console.log(`Coins: Gold=${stateAfterTurn.gold}, Silver=${stateAfterTurn.silver}, Copper=${stateAfterTurn.copper}`);
        console.log(`Inventory: ${JSON.stringify(stateAfterTurn.items)}`);
        
        const screenshotFile = `turn_${String(turnCount).padStart(2, '0')}.png`;
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotFile) });

        playtestReport.push({
            turn: turnCount,
            action,
            dmNarrative: stateAfterTurn.lastMsgText,
            gold: stateAfterTurn.gold,
            silver: stateAfterTurn.silver,
            copper: stateAfterTurn.copper,
            inventory: stateAfterTurn.items,
            screenshot: screenshotFile,
            checkProposed
        });

        turnCount++;
    }

    console.log("\nSaving playtest report json...");
    fs.writeFileSync(
        path.join(SCREENSHOT_DIR, 'playtest_report.json'),
        JSON.stringify(playtestReport, null, 2)
    );

    console.log("Playtest finished successfully!");
    await browser.close();
}

run().catch(async err => {
    console.error("Error running playtest:", err);
    if (globalPage) {
        const errorPath = path.join(SCREENSHOT_DIR, 'error_screenshot.png');
        await globalPage.screenshot({ path: errorPath }).catch(() => {});
        console.log(`Captured error screenshot at ${errorPath}`);
    }
    process.exit(1);
});
