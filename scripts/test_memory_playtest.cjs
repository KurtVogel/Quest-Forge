const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:5173';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = path.resolve('test-results/memory-playtest');

if (!GEMINI_API_KEY) {
    throw new Error('Set GEMINI_API_KEY in the shell before running the playtest.');
}

if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
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
    console.log("Waiting for DM response...");
    await page.waitForFunction(() => {
        return !document.querySelector('.chat-stop-btn') && !document.querySelector('.typing-indicator');
    }, { timeout: 90000 });
    await delay(3000); // 3s wait for state to settle
    console.log("DM response finished.");
}

let globalPage = null;
let globalBrowser = null;

async function run() {
    console.log("Launching Chrome...");
    globalBrowser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    globalPage = await globalBrowser.newPage();
    await globalPage.setViewport({ width: 1280, height: 900 });

    console.log("Mocking crypto.getRandomValues to guarantee natural 20 rolls...");
    await globalPage.evaluateOnNewDocument(() => {
        const origGetRandomValues = window.crypto.getRandomValues.bind(window.crypto);
        window.crypto.getRandomValues = function(typedArray) {
            if (typedArray instanceof Uint32Array) {
                for (let i = 0; i < typedArray.length; i++) {
                    typedArray[i] = 999999; // 999999 % 20 = 19 (natural 20)
                }
                return typedArray;
            }
            return origGetRandomValues(typedArray);
        };
    });

    globalPage.on('console', msg => {
        if (msg.type() === 'error') {
            console.log(`[Browser Console ERROR]`, msg.text());
        } else if (msg.type() === 'log' && msg.text().includes('[Journal]')) {
            console.log(`[Browser Log]`, msg.text());
        }
    });

    console.log("Navigating to app...");
    await globalPage.goto(APP_URL);
    await delay(3000);

    console.log("Setting API keys in localStorage...");
    await globalPage.evaluate(({ apiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: 'gemini',
            apiKey,
            imageApiKey: 'xai-dummy',
            model: 'gemini-3.1-pro-preview'
        }));
    }, { apiKey: GEMINI_API_KEY });

    console.log("Reloading page to apply settings...");
    await globalPage.reload();
    await delay(3000);

    console.log("Clicking New Game...");
    await globalPage.waitForSelector('.new-btn');
    await globalPage.click('.new-btn');
    await delay(1000);

    console.log("Clicking Forge a New Hero...");
    await globalPage.waitForSelector('.creation-card');
    await globalPage.click('.creation-card');
    await delay(1000);

    console.log("Naming character...");
    await globalPage.waitForSelector('.creation-input');
    await globalPage.type('.creation-input', 'Jack the Scholar');
    await globalPage.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Choosing race (Elf)...");
    await globalPage.waitForSelector('.creation-card');
    await globalPage.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.creation-card'));
        const elfCard = cards.find(c => c.textContent.includes('Elf'));
        if (elfCard) elfCard.click();
    });
    await globalPage.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Choosing class (Wizard)...");
    await globalPage.waitForSelector('.creation-card');
    await globalPage.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.creation-card'));
        const wizardCard = cards.find(c => c.textContent.includes('Wizard'));
        if (wizardCard) wizardCard.click();
    });
    await globalPage.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Assigning stats...");
    await globalPage.waitForSelector('.stat-row');
    for (let i = 0; i < 6; i++) {
        await globalPage.evaluate((index) => {
            const row = document.querySelectorAll('.stat-row')[index];
            const choice = row.querySelector('.stat-choice');
            if (choice) choice.click();
        }, i);
        await delay(500);
    }
    await globalPage.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Choosing skills...");
    await globalPage.waitForSelector('.skill-choice-card');
    await globalPage.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.skill-choice-card'));
        const arcana = cards.find(c => c.textContent.includes('Arcana'));
        const history = cards.find(c => c.textContent.includes('History'));
        if (arcana) arcana.click();
        if (history) history.click();
    });
    await delay(500);
    await globalPage.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Confirming character...");
    await globalPage.click('.char-creation-actions .btn-primary');
    await delay(1000);

    console.log("Setting the peaceful exploration premise...");
    await globalPage.waitForSelector('textarea.creation-premise');
    await globalPage.type('textarea.creation-premise', 'Jack the Scholar is visiting the peaceful sanctuary valleys of Eldoria to document landmarks. First, he visits the Sunlit Orchard (a quiet grove of golden apple trees). Next, he walks to the glass dome of the Whispering Conservatory (a greenhouse of singing plants). Then, he travels to the Clockwork Tower (a library of spinning gears). Finally, he arrives at the Crystal Observatory. He wants to document details of each place peacefully, resolving all encounters through study and observation.');
    await globalPage.click('.char-creation-actions .btn-primary'); // Begin Adventure!
    await delay(1000);

    console.log("Waiting for DM to set the opening scene...");
    await waitForLLM(globalPage);

    let lastMsg = await globalPage.evaluate(() => {
        const msgs = document.querySelectorAll('.chat-message.assistant .message-text');
        return msgs.length ? msgs[msgs.length - 1].textContent : 'None';
    });
    console.log("\n--- DM OPENING SCENE ---");
    console.log(lastMsg.trim());
    console.log("------------------------\n");

    // Sequence of actions designed to navigate peacefully and avoid starting combat
    const actions = [
        "I step into the Sunlit Orchard and pick one of the glowing golden apples, tasting its sweet nectar.",
        "I study the orchard's old stone sundial and write down some notes about the sun's position.",
        "I leave the orchard and walk down the grassy path, entering the glass dome of the Whispering Conservatory. Inside, I listen to the gentle melody of the sapphire singing orchids.",
        "I sit on a mossy stone bench in the conservatory and sketch the layout of the glass dome.",
        "I exit the conservatory and climb the spiral stairs of the Clockwork Tower. Inside, I watch the massive brass planetary astrolabe spinning above the bookshelves."
    ];

    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        console.log(`\n[Jack] Action ${i + 1}: "${action}"`);
        await globalPage.waitForSelector('textarea.chat-input');
        await typeIntoInput(globalPage, action);
        await globalPage.click('button.chat-send-btn');
        await waitForLLM(globalPage);

        // Handle and roll any check proposals immediately
        const checkActive = await globalPage.evaluate(() => {
            const panel = document.querySelector('.roleplay-check-panel');
            return !!panel;
        });
        if (checkActive) {
            console.log("[Jack] Adjudicated check proposed. Clicking Roll...");
            await globalPage.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('.roleplay-check-actions button'))
                    .find(btn => btn.textContent.includes('Roll'));
                if (btn) btn.click();
            });
            await waitForLLM(globalPage);
        }

        lastMsg = await globalPage.evaluate(() => {
            const msgs = document.querySelectorAll('.chat-message.assistant .message-text');
            return msgs.length ? msgs[msgs.length - 1].textContent : 'None';
        });
        console.log("--- DM RESPONSE ---");
        console.log(lastMsg.trim());
        console.log("-------------------\n");
    }

    // Now, inspect the journal entries in the state via console evaluation
    const journalState = await globalPage.evaluate(async () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('rpg-client-saves', 2);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('saves', 'readonly');
                const store = tx.objectStore('saves');
                const getReq = store.get('__autosave__');
                getReq.onerror = () => reject(getReq.error);
                getReq.onsuccess = () => resolve(getReq.result?.journal || []);
            };
        });
    });

    console.log("=== EXTRACTED JOURNAL ENTRIES ===");
    journalState.forEach((entry, idx) => {
        console.log(`Entry ${idx + 1} at [${entry.location}]: ${entry.summary}`);
    });
    console.log("=================================\n");

    // Send the final test question
    const testQuestion = "Now, I ask the DM: 'What happened right before I entered the Clockwork Tower? What did I see and do in that previous place?'";
    console.log(`\n[Jack] Test Question: "${testQuestion}"`);
    await globalPage.waitForSelector('textarea.chat-input');
    await typeIntoInput(globalPage, testQuestion);
    await globalPage.click('button.chat-send-btn');
    await waitForLLM(globalPage);

    lastMsg = await globalPage.evaluate(() => {
        const msgs = document.querySelectorAll('.chat-message.assistant .message-text');
        return msgs.length ? msgs[msgs.length - 1].textContent : 'None';
    });
    console.log("=== DM FINAL MEMORY RECALL RESPONSE ===");
    console.log(lastMsg.trim());
    console.log("=======================================\n");

    await globalPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'final_memory_check.png') });
    console.log("Screenshots captured in test-results/memory-playtest/");

    await globalBrowser.close();
}

run().catch(async err => {
    console.error("Error in playtest:", err);
    if (globalPage) {
        const errorPath = path.join(SCREENSHOT_DIR, 'error_screenshot.png');
        await globalPage.screenshot({ path: errorPath }).catch(() => {});
        console.log(`Error screenshot captured at: ${errorPath}`);
    }
    if (globalBrowser) {
        await globalBrowser.close().catch(() => {});
    }
    process.exit(1);
});
