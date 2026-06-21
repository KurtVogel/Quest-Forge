const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// Real-provider credentials must come from the shell. Never commit or paste keys here.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const XAI_API_KEY = process.env.XAI_API_KEY;
const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:5173';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = path.resolve(process.env.QUEST_FORGE_SCREENSHOT_DIR || 'test-results/play-test');

if (!GEMINI_API_KEY || !XAI_API_KEY) {
    throw new Error('Set GEMINI_API_KEY and XAI_API_KEY in the shell before running the real-provider play-test.');
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
    console.log("Waiting for LLM response...");
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
    await page.type('.creation-input', 'Vesa the Brave');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_name_input.png') });
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 2: Choosing race (Dwarf)...");
    await page.waitForSelector('.creation-card');
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.creation-card'));
        const dwarfCard = cards.find(c => c.textContent.includes('Dwarf'));
        if (dwarfCard) dwarfCard.click();
        else cards[0].click();
    });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_race_select.png') });
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

    console.log("Step 5: Choosing skills...");
    await page.waitForSelector('.skill-choice-card');
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.skill-choice-card:not(.disabled)'));
        if (cards[0]) cards[0].click();
    });
    await delay(500);
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.skill-choice-card:not(.disabled):not(.selected)'));
        if (cards[0]) cards[0].click();
    });
    await delay(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06_skills_select.png') });
    const skillCount = await page.$eval('.skill-selection-count', node => node.textContent).catch(() => '');
    if (!skillCount.includes('2 / 2')) throw new Error(`Expected two selected skills, found "${skillCount}".`);
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 6: Confirming character...");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07_confirm_character.png') });
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 7: Setting the premise...");
    await page.waitForSelector('textarea.creation-premise');
    await page.type('textarea.creation-premise', 'Vesa the Brave, a dwarf fighter with a massive warhammer, arrives at the rain-soaked frontier town of Jewelglade. Rumors say goblins and dark things haunt the Whispering Woods, and Vesa intends to clear them out to earn some coin.');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08_premise_input.png') });
    await page.click('.char-creation-actions .btn-primary'); // Begin Adventure!
    await delay(1000);

    // Wait for DM opening narration
    console.log("Waiting for DM to set the scene...");
    await waitForLLM(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09_opening_scene.png') });
    await assertPageInvariants(page, 'opening scene');

    // Print last DM narration
    let lastMsg = await page.evaluate(() => {
        const msgs = document.querySelectorAll('.chat-message.assistant .message-text');
        return msgs.length ? msgs[msgs.length - 1].textContent : 'None';
    });
    console.log("\n--- DM OPENING SCENE ---");
    console.log(lastMsg.trim());
    console.log("------------------------\n");

    // Play rounds
    const prompts = [
        "I walk up to the nearest tavern, the Rusty Goblet, to ask the locals about the Whispering Woods.",
        "I order a tankard of ale, slide a silver coin to the barkeep, and ask: 'What's the real threat in the Whispering Woods? Who's paying to clear it?'",
        "I look around the tavern for anyone who looks like they might want to join me, or maybe a merchant who was recently attacked.",
        "I thank the barkeep and head out of town toward the Whispering Woods, warhammer in hand, searching for goblin tracks.",
        "I follow the tracks deeper into the woods, staying alert and ready to draw my warhammer at any sound."
    ];

    let actionIndex = 0;
    for (const userPrompt of prompts) {
        console.log(`\nPlayer Action: "${userPrompt}"`);
        await page.waitForSelector('textarea.chat-input');
        await typeIntoInput(page, userPrompt);
        await page.click('button.chat-send-btn');
        await waitForLLM(page);
        await assertPageInvariants(page, `action ${actionIndex}`);

        const countStr = String(actionIndex + 10).padStart(2, '0');
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${countStr}_action_${actionIndex}.png`) });

        lastMsg = await page.evaluate(() => {
            const msgs = document.querySelectorAll('.chat-message.assistant .message-text');
            return msgs.length ? msgs[msgs.length - 1].textContent : 'None';
        });
        console.log("--- DM RESPONSE ---");
        console.log(lastMsg.trim());
        console.log("-------------------\n");

        // Check if combat has started
        let combatActive = await page.evaluate(() => {
            return !!document.querySelector('.combat-panel');
        });

        if (combatActive) {
            console.log("Combat detected! Entering combat loop...");
            await handleCombat(page, SCREENSHOT_DIR);
        }

        // Periodically try to visualize scene to test xAI
        if (actionIndex === 1 || actionIndex === 4) {
            await triggerVisual(page, SCREENSHOT_DIR, `visual_${actionIndex}`);
        }

        actionIndex++;
    }

    // Play more steps to ensure leveling up or deeper exploration
    console.log("Playing extra steps for deeper testing...");
    const extraPrompts = [
        "I continue following the sounds of growling or tracks in the forest, moving carefully.",
        "I challenge any creature I see, brandishing my warhammer!",
        "I return to Jewelglade, resting if wounded and checking if there are any other quests."
    ];

    for (const userPrompt of extraPrompts) {
        console.log(`\nExtra Player Action: "${userPrompt}"`);
        await page.waitForSelector('textarea.chat-input');
        await typeIntoInput(page, userPrompt);
        await page.click('button.chat-send-btn');
        await waitForLLM(page);
        await assertPageInvariants(page, `extra action ${actionIndex}`);

        const countStr = String(actionIndex + 10).padStart(2, '0');
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
    if (consoleErrors.length > 0) {
        throw new Error(`Browser logged ${consoleErrors.length} console error(s).`);
    }
    console.log("Test play session finished successfully with all invariants satisfied!");
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

            // Get enemies HP
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

        console.log(`Combat Round ${roundCount}: PlayerTurn=${combatState.isPlayerTurn}, AwaitingNarration=${combatState.isAwaitingNarration}, Enemies=${JSON.stringify(combatState.enemies)}`);

        if (combatState.canEndCombat) {
            console.log("Victory button visible! Clicking End Combat...");
            await page.click('.combat-end-btn');
            await delay(2000);
            combatFinished = true;
            break;
        }

        if (combatState.isPlayerTurn) {
            const targetEnemy = combatState.enemies.find(e => e.cond !== 'dead')?.name || 'enemy';
            const attackPrompt = `I attack the ${targetEnemy} with my warhammer, swinging hard!`;
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
                console.log("Clicking Retry Narration button...");
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
        if (roundCount > 25) {
            throw new Error('Combat exceeded the 25-round safety limit.');
        }
    }
}

async function triggerVisual(page, screenshotDir, prefix) {
    console.log("Triggering scene art visualization...");
    try {
        await page.waitForSelector('.scene-art-generate-btn', { timeout: 5000 });
        await page.click('.scene-art-generate-btn');
        console.log("Waiting for image painting to complete...");
        await page.waitForSelector('.scene-art-loading', { timeout: 5000 }).catch(() => {});
        await page.waitForFunction(() => !document.querySelector('.scene-art-loading'), { timeout: 60000 });
        await delay(2000);

        await page.screenshot({ path: path.join(screenshotDir, `screenshot_${prefix}.png`) });

        const artStatus = await page.evaluate(() => {
            const err = document.querySelector('.scene-art-error');
            const notice = document.querySelector('.scene-art-notice');
            const img = document.querySelector('.scene-art-image');
            return {
                hasImage: !!img,
                error: err ? err.textContent : null,
                notice: notice ? notice.textContent : null
            };
        });

        console.log(`Visualization result [${prefix}]: hasImage=${artStatus.hasImage}, error=${artStatus.error}, notice=${artStatus.notice}`);
        if (!artStatus.hasImage || artStatus.error || /fallback/i.test(artStatus.notice || '')) {
            throw new Error(`Scene art invariant failed: ${artStatus.error || artStatus.notice || 'no image returned'}`);
        }
    } catch (e) {
        console.error("Failed to trigger visualization:", e.message);
        throw e;
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
