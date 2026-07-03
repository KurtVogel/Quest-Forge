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
const SCREENSHOT_DIR = path.resolve('test-results/playtest_looting');

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

async function waitForCombatToSettle(page) {
    console.log("Waiting for combat exchange to settle...");
    await page.waitForFunction(() => {
        // Not loading
        const loading = !!document.querySelector('.chat-stop-btn') || !!document.querySelector('.typing-indicator');
        if (loading) return false;

        // Check if combat is still active
        const panel = document.querySelector('.combat-panel');
        if (!panel) return true; // Combat ended

        const turnText = document.querySelector('.combat-turn')?.textContent || '';
        const isAwaitingNarration = turnText.includes('awaiting its narration');
        const hasRetryButton = document.querySelector('.chat-send-btn')?.textContent.includes('Retry');

        // If it's awaiting narration, it's only settled if the Retry button is showing (meaning the call failed and stopped)
        if (isAwaitingNarration && !hasRetryButton) {
            return false;
        }

        return true;
    }, { timeout: 90000 });
    await delay(3000); // 3s wait for state to settle
    console.log("Combat exchange settled.");
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
        // Extract coins using correct selectors from InventoryPanel
        const goldText = document.querySelector('.inv-gold')?.textContent || '0 gp';
        const silverText = document.querySelector('.inv-silver')?.textContent || '0 sp';
        const copperText = document.querySelector('.inv-copper')?.textContent || '0 cp';
        
        // Extract inventory items
        const itemNodes = Array.from(document.querySelectorAll('.inv-item'));
        const items = itemNodes.map(node => {
            const name = node.querySelector('.inv-item-name')?.textContent?.trim() || 'Unknown';
            const qtyText = node.querySelector('.inv-item-qty')?.textContent || '';
            const qtyMatch = qtyText.match(/x(\d+)/);
            const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
            return { name, qty };
        });

        // Extract last DM message
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
    "I walk into the grand foyer of Sterling Manor. I look for any cabinets or chests to search for loot.",
    "I open the drawer of the mahogany dresser in the corner of the foyer.",
    "I go into the library. I search the writing desk in the center of the library to see what is hidden in its compartments.",
    "I look behind the secret panel in the library wall bookshelf.",
    "I enter the private study of Lord Sterling. I search the small lockbox resting on the bookshelf.",
    "I try to pick the lock on the desk drawer in the study.",
    "I search the pockets of the fine coat hanging on the coat stand in the study.",
    "I make my way to the salon. I search under the cushions of the velvet sofas and look for dropped coins.",
    "I search the ornate display cabinet in the corner of the salon.",
    "I enter the master bedroom. I check the jewelry box on the vanity table.",
    "I peer under the bed to see if there is a hidden chest or bag of coins.",
    "I walk into the art gallery. I examine the pedestal drawers under the bust statues.",
    "I check behind the large landscape oil painting in the gallery for a safe or compartment.",
    "I search the display table containing antique coins in the center of the gallery.",
    "I head to the dining hall. I search the buffet sideboard drawers for silverware or coin pouches.",
    "I search the tea room. I inspect the contents of the tea caddies and drawers.",
    "I walk into the kitchen. I search the larder cabinets for copper and items.",
    "I go down into the cellar. I look around the wine racks for any chest or bag of coins.",
    "I look for a hidden floorboard in the cellar floor to search for hidden treasure.",
    "I search the old iron chest in the dark corner of the cellar.",
    "I go further down into the cellar sewers. I search the pile of debris in the corner.",
    "I investigate a sewer gate where some debris has gathered, searching for lost coins.",
    "I head out to the garden shed. I search the tool drawers and shelves for anything valuable.",
    "I enter the solar. I search the drawer of the astrolabe table.",
    "I walk to the chapel. I check the donation box and search the storage cabinets.",
    "I go down into the family crypt. I examine the sarcophagus alcoves for ancient loot.",
    "I search the armor stand chest in the crypt entrance.",
    "I enter the servant quarters. I search the small nightstand drawer.",
    "I walk to the balcony. I look for a loose brick or hidden pouch under the bench.",
    "I return to the foyer and examine the floor grates for dropped coins."
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
            imageApiKey: 'xai-dummy', // Not testing scene art
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
    await page.type('.creation-input', 'Grog the Loot Tester');
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
    // Fallback if needed
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
    const premiseText = "I am Grog the Tester, a half-orc fighter. I am a developer play-testing the game. DM, please guide me through Sterling Manor, an old mansion with many rooms (foyer, library, study, salon, bedroom, gallery, cellar, vault). Each room contains various containers (desks, chests, drawers, display cases, sacks). Please generate various looting opportunities: some containers must have only coins (gold, silver, or copper), some must have only items (like potions, rings, weapons), and some must have both coins and items. Also, populate the cellar with some super easy fights against normal rats that have swallowed gold coins, which I can defeat to loot gold coins from their bellies. I will explore and loot to test the engine's looting mechanics.";
    await page.type('textarea.creation-premise', premiseText);
    await page.click('.char-creation-actions .btn-primary'); // Begin Adventure!
    await delay(1000);

    console.log("Waiting for DM to set the scene...");
    await waitForLLMOrCheck(page);
    
    let initialState = await extractGameState(page);
    console.log(`\n=== INITIAL GAME STATE ===`);
    console.log(`Coins: Gold=${initialState.gold}, Silver=${initialState.silver}, Copper=${initialState.copper}`);
    console.log(`Inventory: ${JSON.stringify(initialState.items)}`);
    console.log(`DM Opening: ${initialState.lastMsgText}`);
    console.log(`==========================\n`);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00_initial_scene.png') });

    let actionIndex = 0;
    let turnCount = 1;
    const playtestReport = [];

    while (turnCount <= 30) {
        console.log(`\n--- PLAYTEST TURN ${turnCount}/30 ---`);

        // Check if combat is active
        const combatState = await page.evaluate(() => {
            const panel = document.querySelector('.combat-panel');
            if (!panel) return { active: false };

            const turnText = document.querySelector('.combat-turn')?.textContent || '';
            const endBtn = document.querySelector('.combat-end-btn');
            
            const enemyCards = Array.from(document.querySelectorAll('.enemy-card'));
            const enemies = enemyCards.map(c => {
                const name = c.querySelector('.enemy-name')?.textContent || 'Unknown';
                const cond = c.querySelector('.enemy-condition')?.textContent || 'Unknown';
                return { name, cond };
            });

            return {
                active: true,
                isPlayerTurn: turnText.includes('Your turn'),
                isAwaitingNarration: turnText.includes('awaiting its narration'),
                enemies,
                canEndCombat: !!endBtn
            };
        });

        let actionSent = "";
        if (combatState.active) {
            console.log("Combat is ACTIVE!");
            if (combatState.canEndCombat) {
                console.log("Victory achieved. Clicking End Combat...");
                actionSent = "[Click End Combat]";
                await page.click('.combat-end-btn');
                await delay(2000);
                await waitForCombatToSettle(page);
            } else if (combatState.isPlayerTurn) {
                const target = combatState.enemies.find(e => e.cond !== 'dead')?.name || 'rat';
                const attackPrompt = `I hit the ${target} with my greataxe, crushing it!`;
                console.log(`Player attack action: "${attackPrompt}"`);
                actionSent = attackPrompt;
                await typeIntoInput(page, attackPrompt);
                await page.click('button.chat-send-btn');
                await waitForCombatToSettle(page);
            } else if (combatState.isAwaitingNarration) {
                console.log("Combat is awaiting narration. Checking for Retry button...");
                const hasRetry = await page.evaluate(() => {
                    const btn = document.querySelector('.chat-send-btn');
                    return btn && btn.textContent.includes('Retry');
                });
                if (hasRetry) {
                    console.log("Clicking Retry Narration button...");
                    actionSent = "[Click Retry Narration]";
                    await page.click('.chat-send-btn');
                    await waitForCombatToSettle(page);
                } else {
                    console.log("No retry button found, waiting...");
                    actionSent = "[Wait]";
                    await delay(3000);
                }
            } else {
                console.log("Waiting for DM/NPC turn...");
                actionSent = "[Wait]";
                await delay(3000);
            }
        } else {
            // Outside combat: send next exploration action
            const action = explorationActions[actionIndex % explorationActions.length];
            console.log(`Player exploration action: "${action}"`);
            actionSent = action;
            await typeIntoInput(page, action);
            await page.click('button.chat-send-btn');
            await waitForLLMOrCheck(page);
            actionIndex++;
        }

        // Check and handle any proposed checks
        const checkProposed = await handleProposedChecks(page, `turn_${turnCount}`);
        if (checkProposed) {
            console.log("Handled proposed checks.");
        }

        // Wait a small moment for UI to sync
        await delay(1000);

        // Extract fresh state
        const stateAfterTurn = await extractGameState(page);
        console.log(`Coins: Gold=${stateAfterTurn.gold}, Silver=${stateAfterTurn.silver}, Copper=${stateAfterTurn.copper}`);
        console.log(`Inventory: ${JSON.stringify(stateAfterTurn.items)}`);
        
        // Take screenshot
        const screenshotFile = `turn_${String(turnCount).padStart(2, '0')}.png`;
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotFile) });

        // Record report entry
        playtestReport.push({
            turn: turnCount,
            action: actionSent,
            dmNarrative: stateAfterTurn.lastMsgText,
            gold: stateAfterTurn.gold,
            silver: stateAfterTurn.silver,
            copper: stateAfterTurn.copper,
            inventory: stateAfterTurn.items,
            screenshot: screenshotFile,
            combatActive: combatState.active
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
