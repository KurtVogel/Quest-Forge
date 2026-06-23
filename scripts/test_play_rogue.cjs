const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// Real-provider credentials must come from the shell. Never commit or paste keys here.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const XAI_API_KEY = process.env.XAI_API_KEY || 'xai-dummy'; // Bypass with dummy if missing
const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:5173';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = path.resolve(process.env.QUEST_FORGE_SCREENSHOT_DIR || 'test-results/rogue-playtest');

if (!GEMINI_API_KEY) {
    throw new Error('Set GEMINI_API_KEY in the shell before running the real-provider play-test.');
}

if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function delay(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time)
    });
}

let globalPage = null;
const consoleErrors = [];

async function assertPageInvariants(page, label) {
    const failures = await page.evaluate(() => {
        const issues = [];
        const inventorySections = Array.from(document.querySelectorAll('.inv-section'));
        const equippedSection = inventorySections.find(section =>
            section.querySelector('.inv-section-title')?.textContent.trim().toLowerCase() === 'equipped'
        );
        const equippedRows = equippedSection ? Array.from(equippedSection.querySelectorAll('.inv-item')) : [];
        const invalidEquipped = equippedRows
            .filter(row => !row.querySelector('.inv-equip-btn'))
            .map(row => row.querySelector('.inv-item-name')?.textContent.trim() || 'Unknown item');
        if (invalidEquipped.length > 0) issues.push(`non-equipment shown as equipped: ${invalidEquipped.join(', ')}`);

        const activeWeapons = equippedRows.filter(row =>
            row.querySelector('.inv-equip-btn')?.getAttribute('title')?.startsWith('Active weapon')
        );
        if (activeWeapons.length > 1) issues.push(`multiple active weapons: ${activeWeapons.length}`);

        const questNames = Array.from(document.querySelectorAll('.quest-item.active .quest-item-name'))
            .map(node => node.textContent.toLowerCase().replace(/[^a-z0-9]/g, ''))
            .filter(Boolean);
        const duplicateQuests = questNames.filter((name, index) => questNames.indexOf(name) !== index);
        if (duplicateQuests.length > 0) issues.push('duplicate active quest names');

        return issues;
    });

    if (failures.length > 0) {
        throw new Error(`Invariant failure after ${label}: ${failures.join('; ')}`);
    }
}

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

async function waitForLLM(page) {
    console.log("Waiting for LLM response to start...");
    try {
        await page.waitForSelector('.chat-stop-btn', { timeout: 10000 });
        console.log("LLM response started (stop button appeared).");
    } catch (e) {
        console.log("Stop button did not appear within 10s. It might have finished instantly or failed to start.");
    }
    
    console.log("Waiting for LLM response to finish...");
    await page.waitForFunction(() => {
        return !document.querySelector('.chat-stop-btn') && !document.querySelector('.typing-indicator');
    }, { timeout: 90000 });
    
    await delay(3000); // 3s wait for state to settle
    console.log("LLM response finished.");
}

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

    // Capture console errors
    page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
        if (msg.type() === 'error' || msg.type() === 'warning') {
            console.log(`[Browser Console ${msg.type()}]`, msg.text());
        }
    });

    console.log("Navigating to app...");
    await page.goto(APP_URL);
    await delay(3000);

    console.log("Setting API keys in localStorage...");
    await page.evaluate(({ apiKey, imageApiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: 'gemini',
            apiKey,
            imageApiKey,
            model: 'gemini-3.1-pro-preview'
        }));
    }, { apiKey: GEMINI_API_KEY, imageApiKey: XAI_API_KEY });

    console.log("Reloading page to apply settings...");
    await page.reload();
    await delay(3000);

    console.log("Taking start screen screenshot...");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_start_screen.png') });

    console.log("Clicking New Game...");
    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(1000);

    console.log("Clicking Forge a New Hero...");
    await page.waitForSelector('.creation-card');
    await page.click('.creation-card'); // First card is forge new hero
    await delay(1000);

    console.log("Step 1: Naming character...");
    await page.waitForSelector('.creation-input');
    await page.type('.creation-input', 'Sariel the Silent');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_name_input.png') });
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 2: Choosing race (Elf)...");
    await page.waitForSelector('.creation-card');
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.creation-card'));
        const elfCard = cards.find(c => c.textContent.includes('Elf'));
        if (elfCard) elfCard.click();
        else cards[0].click();
    });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_race_select.png') });
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 3: Choosing class (Rogue)...");
    await page.waitForSelector('.creation-card');
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.creation-card'));
        const rogueCard = cards.find(c => c.textContent.includes('Rogue'));
        if (rogueCard) rogueCard.click();
        else cards[0].click();
    });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_class_select.png') });
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
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_stats_assign.png') });
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 5: Choosing Rogue skills & Expertise...");
    await page.waitForSelector('.skill-choice-card');
    // Choose 4 skills
    for (let i = 0; i < 4; i++) {
        await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('.skill-choice-card:not(.disabled):not(.selected)'));
            if (cards[0]) cards[0].click();
        });
        await delay(500);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06_skills_select.png') });

    // Choose 2 expertise skills
    console.log("Choosing Expertise skills...");
    await page.waitForSelector('.expertise-selection');
    for (let i = 0; i < 2; i++) {
        await page.evaluate(() => {
            const section = document.querySelector('.expertise-selection');
            if (section) {
                const cards = Array.from(section.querySelectorAll('.skill-choice-card:not(.disabled):not(.selected)'));
                if (cards[0]) cards[0].click();
            }
        });
        await delay(500);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07_expertise_select.png') });
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 6: Confirming Rogue character...");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08_confirm_character.png') });
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 7: Setting the premise...");
    await page.waitForSelector('textarea.creation-premise');
    await page.type('textarea.creation-premise', 'Sariel the Silent, an elf rogue armed with a deadly dagger, arrives at the rain-soaked frontier town of Jewelglade. Goblins under a chief named Kraul have been raiding the outskirts from their hideout in the Whispering Woods. Sariel intends to track them down, slip into their lair undetected, and backstab their leader to claim the bounty.');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09_premise_input.png') });
    await page.click('.char-creation-actions .btn-primary'); // Begin Adventure!
    await delay(1000);

    console.log("Waiting for DM to set the scene...");
    await waitForLLM(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '10_opening_scene.png') });
    await assertPageInvariants(page, 'opening scene');

    let lastMsg = await page.evaluate(() => {
        const msgs = document.querySelectorAll('.chat-message.assistant .message-text');
        return msgs.length ? msgs[msgs.length - 1].textContent : 'None';
    });
    console.log("\n--- DM OPENING SCENE ---");
    console.log(lastMsg.trim());
    console.log("------------------------\n");

    // Let's sneak to Whispering Woods
    const prompts = [
        "I walk quietly into the local tavern, keeping low, and look for anyone talking about Chief Kraul.",
        "I slip out of town into the Whispering Woods, drawing my dagger and using Stealth to blend into the shadows.",
        "I follow the tracks deeper into the forest, looking for the entrance to their hideout.",
        "I spot the hideout entrance. I sneak past any guard and prepare to perform a backstab attack on the first goblin I see!"
    ];

    let actionIndex = 0;
    for (const userPrompt of prompts) {
        console.log(`\nPlayer Action: "${userPrompt}"`);
        await page.waitForSelector('textarea.chat-input');
        await typeIntoInput(page, userPrompt);
        await page.click('button.chat-send-btn');
        await waitForLLM(page);
        
        // Handle out-of-combat roleplay checks if proposed by the DM Scribe/Rules
        let checkPanelVisible = await page.evaluate(() => {
            return !!document.querySelector('.roleplay-check-panel');
        });
        while (checkPanelVisible) {
            console.log("Pending roleplay check detected. Clicking Roll...");
            await page.click('.roleplay-check-actions button.btn-primary');
            await waitForLLM(page);
            checkPanelVisible = await page.evaluate(() => {
                return !!document.querySelector('.roleplay-check-panel');
            });
        }

        await assertPageInvariants(page, `action ${actionIndex}`);

        const countStr = String(actionIndex + 11).padStart(2, '0');
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${countStr}_action_${actionIndex}.png`) });

        lastMsg = await page.evaluate(() => {
            const msgs = document.querySelectorAll('.chat-message.assistant .message-text');
            return msgs.length ? msgs[msgs.length - 1].textContent : 'None';
        });
        console.log("--- DM RESPONSE ---");
        console.log(lastMsg.trim());
        console.log("-------------------\n");

        let combatActive = await page.evaluate(() => {
            return !!document.querySelector('.combat-panel');
        });

        if (combatActive) {
            console.log("Combat detected! Entering combat loop...");
            await handleCombat(page, SCREENSHOT_DIR);
        }

        actionIndex++;
    }

    await assertPageInvariants(page, 'test completion');
    console.log("Rogue playtest session finished successfully with all invariants satisfied!");
    await browser.close();
}

async function handleCombat(page, screenshotDir) {
    let combatFinished = false;
    let roundCount = 1;

    while (!combatFinished) {
        await waitForLLM(page);
        await assertPageInvariants(page, `combat round ${roundCount}`);

        await page.screenshot({ path: path.join(screenshotDir, `combat_round_${roundCount}.png`) });

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
                isAwaitingNarration: turnText.includes('awaiting its narration') || document.querySelector('.chat-send-btn')?.textContent.includes('Retry'),
                enemies,
                canEndCombat: !!endBtn
            };
        });

        if (!combatState.active) {
            console.log("Combat is no longer active.");
            break;
        }

        console.log(`Combat Round ${roundCount}: PlayerTurn=${combatState.isPlayerTurn}, Enemies=${JSON.stringify(combatState.enemies)}`);

        if (combatState.canEndCombat) {
            console.log("Victory button visible! Clicking End Combat...");
            await page.click('.combat-end-btn');
            await delay(2000);
            combatFinished = true;
            break;
        }

        if (combatState.isPlayerTurn) {
            const targetEnemy = combatState.enemies.find(e => e.cond !== 'dead')?.name || 'enemy';
            // Declare a backstab attack! Sneak Attack qualifies because of Stealth / hiding.
            const attackPrompt = `I slip behind the ${targetEnemy} and strike them in the back with my dagger, seeking a sneak attack backstab!`;
            console.log(`Player Combat Action: "${attackPrompt}"`);
            await typeIntoInput(page, attackPrompt);
            await page.click('button.chat-send-btn');
            await waitForLLM(page);
        } else if (combatState.isAwaitingNarration) {
            console.log("Awaiting combat narration...");
            const hasRetry = await page.evaluate(() => {
                const btn = document.querySelector('.chat-send-btn');
                return btn && btn.textContent.includes('Retry');
            });
            if (hasRetry) {
                await page.click('.chat-send-btn');
                await waitForLLM(page);
            } else {
                await delay(3000);
            }
        } else {
            console.log("Waiting for NPC/Enemy turn or narration...");
            await delay(3000);
        }

        roundCount++;
        if (roundCount > 15) {
            throw new Error('Combat exceeded safety limit.');
        }
    }
}

run().catch(async err => {
    console.error("Error in test play script:", err);
    if (globalPage) {
        try {
            const errorPath = path.join(SCREENSHOT_DIR, 'error_screenshot.png');
            await globalPage.screenshot({ path: errorPath });
            console.log(`Error screenshot captured at: ${errorPath}`);
        } catch (e) {
            console.error("Failed to capture error screenshot:", e.message);
        }
    }
    process.exit(1);
});
