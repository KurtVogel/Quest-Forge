const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:5173';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = path.resolve('test-results/play-test-manor');

if (!GEMINI_API_KEY) {
    throw new Error('Set GEMINI_API_KEY in the shell before running the playtest.');
}

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

    // Let's challenge the first proposed check to test the negotiation flow, and roll otherwise
    if (checkState.canChallenge && String(stepLabel).startsWith('action_1')) {
        console.log("[Gating System] Decision: Challenging the DM's check proposal...");
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('.roleplay-check-actions button'))
                .find(btn => btn.textContent.includes('Challenge'));
            if (btn) btn.click();
        });
        await delay(500);

        const challengeText = "I am speaking honestly about being interested in books and trying to sound like a polite noble. There is no active threat or suspicion yet, so a check shouldn't be needed just for casual conversation.";
        console.log(`[Gating System] Submitting challenge text: "${challengeText}"`);

        await page.evaluate((val) => {
            const textarea = document.getElementById('roleplay-check-challenge');
            if (textarea) {
                textarea.value = val;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, challengeText);
        await delay(500);

        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('.roleplay-check-actions button'))
                .find(btn => btn.textContent.includes('Send challenge'));
            if (btn) btn.click();
        });

        await waitForLLMOrCheck(page);
        console.log("[Gating System] DM responded to the challenge.");
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${stepLabel}_after_challenge.png`) });

        // Recurse once to see if the DM revised, upheld, or withdrew the check
        const resolved = await handleProposedChecks(page, `${stepLabel}_resolved`);
        if (!resolved) {
            console.log("[Gating System] Check successfully resolved/withdrawn by DM! Continuing story.");
        }
    } else {
        console.log("[Gating System] Decision: Accepting the DC check and rolling...");
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('.roleplay-check-actions button'))
                .find(btn => btn.textContent.includes('Roll'));
            if (btn) btn.click();
        });
        await waitForLLMOrCheck(page);
        console.log("[Gating System] Roll submitted and narration loaded.");
    }

    return true;
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
    await page.type('.creation-input', 'Jack the Slick');
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

    console.log("Step 5: Choosing skills (4 for Rogue)...");
    await page.waitForSelector('.skill-choice-card');
    const skillsToSelect = ['Stealth', 'Acrobatics', 'Sleight of Hand', 'Deception'];
    for (const skill of skillsToSelect) {
        await page.evaluate((s) => {
            const card = Array.from(document.querySelectorAll('.skill-choice-card'))
                .find(c => c.textContent.includes(s) && !c.classList.contains('selected'));
            if (card) {
                card.click();
                console.log(`Clicked skill card: ${s}`);
            }
        }, skill);
        await delay(500);
    }
    // Fallback: if not enough skills selected, click any available unselected cards
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.skill-choice-card'));
        const selectedCount = cards.filter(c => c.classList.contains('selected')).length;
        console.log(`Currently selected skills: ${selectedCount}`);
        if (selectedCount < 4) {
            const needed = 4 - selectedCount;
            const unselected = cards.filter(c => !c.classList.contains('selected'));
            for (let i = 0; i < Math.min(needed, unselected.length); i++) {
                unselected[i].click();
                console.log(`Clicked fallback skill card: ${unselected[i].textContent}`);
            }
        }
    });
    await delay(500);
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 6: Confirming character...");
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Step 7: Setting the manor heist premise...");
    await page.waitForSelector('textarea.creation-premise');
    await page.type('textarea.creation-premise', 'Jack, a slick and silver-tongued rogue, has slipped into the opulent Manor of Lord Sterling during a grand masquerade. His goal is to find the Lord\'s ledger of bribes hidden in the study, using charm, stealth, and acrobatics to avoid guards and guests alike. Jack plans to resolve all obstacles without resorting to open combat.');
    await page.click('.char-creation-actions .btn-primary'); // Begin Adventure!
    await delay(1000);

    // Wait for DM opening narration
    console.log("Waiting for DM to set the scene...");
    await waitForLLMOrCheck(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_opening_scene.png') });

    let lastMsg = await page.evaluate(() => {
        const msgs = document.querySelectorAll('.chat-message.assistant .message-text');
        return msgs.length ? msgs[msgs.length - 1].textContent : 'None';
    });
    console.log("\n--- DM OPENING SCENE ---");
    console.log(lastMsg.trim());
    console.log("------------------------\n");

    // Action steps designed to test gating, truth policies, and composure checks
    const actions = [
        "I blend into the masquerade ballroom crowd, wearing my silver mask. I politely ask a nearby guest: 'A lovely masquerade, isn't it? Tell me, does Lord Sterling have his private library or study on the second floor? I am an avid collector of maps and books.'",
        "I tell the guest honestly: 'I speak the truth, my lady—I am simply a distant cousin from the east interested in Lord Sterling's famous book collection. I have no interest in Sterling's business.'",
        "I slip out of the ballroom, head down the quiet second-floor corridor, and hide in the shadows of an alcove. When a guard patrols past, I hold my breath, remaining absolutely calm, stoic, and motionless.",
        "I reach the door of the private study. Finding it locked, I look for an open window or a balcony ledge to climb on, aiming to enter quietly.",
        "I look around the study for the ledger of bribes, checking the desk drawers and behind bookshelves, trying to do it without leaving any trace."
    ];

    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        console.log(`\nPlayer Action ${i + 1}: "${action}"`);
        await page.waitForSelector('textarea.chat-input');
        await typeIntoInput(page, action);
        await page.click('button.chat-send-btn');
        await waitForLLMOrCheck(page);

        // Audit the check proposal (negotiation / rolling)
        const checkProposed = await handleProposedChecks(page, `action_${i + 1}`);
        if (!checkProposed) {
            console.log("[Playtest] No checks proposed. Narration continues.");
        }

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `02_action_${i + 1}_final.png`) });

        lastMsg = await page.evaluate(() => {
            const msgs = document.querySelectorAll('.chat-message.assistant .message-text');
            return msgs.length ? msgs[msgs.length - 1].textContent : 'None';
        });
        console.log("--- DM RESPONSE ---");
        console.log(lastMsg.trim());
        console.log("-------------------\n");
    }

    console.log("Playtest manor adventure successfully completed!");
    await browser.close();
}

run().catch(async err => {
    console.error("Error in playtest script:", err);
    if (globalPage) {
        const errorPath = path.join(SCREENSHOT_DIR, 'error_screenshot.png');
        await globalPage.screenshot({ path: errorPath }).catch(() => {});
        console.log(`Error screenshot captured at: ${errorPath}`);
    }
    process.exit(1);
});
