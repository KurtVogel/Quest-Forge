/**
 * Keyed 20-turn memory/fronts tuning playtest.
 *
 * Requires:
 *   - Dev server at QUEST_FORGE_TEST_URL (default http://localhost:5173)
 *   - GEMINI_API_KEY in the shell
 *   - Chrome at CHROME_PATH (Windows default below)
 *
 * Writes: test-results/memory-tuning/report.json
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:5173';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const REPORT_DIR = path.resolve('test-results/memory-tuning');
const AUTOSAVE_SLOT = '__autosave__';

if (!GEMINI_API_KEY) {
    throw new Error('Set GEMINI_API_KEY in the shell before running the memory tuning playtest.');
}

if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadAutosave(page) {
    return page.evaluate(async (slotId) => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('rpg-client-saves', 2);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('saves', 'readonly');
                const store = tx.objectStore('saves');
                const getReq = store.get(slotId);
                getReq.onerror = () => reject(getReq.error);
                getReq.onsuccess = () => resolve(getReq.result || null);
            };
        });
    }, AUTOSAVE_SLOT);
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
    await page.waitForFunction(() => {
        const hasStopBtn = !!document.querySelector('.chat-stop-btn');
        const hasTyping = !!document.querySelector('.typing-indicator');
        const textarea = document.querySelector('textarea.chat-input');
        const hasCheckPanel = !!document.querySelector('.roleplay-check-panel');
        return !hasStopBtn && !hasTyping && textarea && (!textarea.disabled || hasCheckPanel);
    }, { timeout: 120000 });
    await delay(2500);
}

async function acceptRoleplayCheck(page) {
    const checkActive = await page.evaluate(() => !!document.querySelector('.roleplay-check-panel'));
    if (!checkActive) return false;
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.roleplay-check-actions button'))
            .find(b => b.textContent.includes('Roll'));
        if (btn) btn.click();
    });
    await waitForLLM(page);
    return true;
}

async function sendAction(page, text, label) {
    console.log(`\n[Turn] ${label}: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`);
    await page.waitForSelector('textarea.chat-input');
    await typeIntoInput(page, text);
    await page.click('button.chat-send-btn');
    await waitForLLM(page);
    await acceptRoleplayCheck(page);
}

async function lastAssistantText(page) {
    return page.evaluate(() => {
        const msgs = document.querySelectorAll('.chat-message.assistant .message-text');
        return msgs.length ? msgs[msgs.length - 1].textContent.trim() : '';
    });
}

function summarizeState(save) {
    if (!save || !save.state) return null;
    const state = save.state;
    return {
        location: save.location || state.currentLocation || null,
        messageCount: (state.messages || []).length,
        journalEntries: (state.journal || []).map((entry, index) => ({
            index: index + 1,
            location: entry.location || null,
            summary: String(entry.summary || '').slice(0, 220),
        })),
        storyMemory: (state.storyMemory || []).map(card => ({
            id: card.id,
            type: card.type,
            status: card.status,
            subject: card.subject,
            text: String(card.text || '').slice(0, 160),
            salience: card.salience,
            lastUsedAt: card.lastUsedAt || null,
        })),
        worldFactsCount: (state.worldFacts || []).length,
        npcCount: (state.npcs || []).length,
        fronts: (state.fronts || []).map(front => ({
            id: front.id,
            title: front.title,
            clock: front.clock,
            stage: front.stage,
            portentStage: front.portentStage,
            lastMovementReason: front.lastMovementReason || null,
        })),
        questsActive: (state.quests || []).filter(q => q.status === 'active').length,
    };
}

function scoreRecall(response, needles) {
    const lower = String(response || '').toLowerCase();
    const hits = needles.filter(n => lower.includes(n.toLowerCase()));
    return { needles, hits, hitRate: needles.length ? hits.length / needles.length : 0 };
}

const TURN_ACTIONS = [
    {
        label: '1 — orchard arrival + callback seed',
        text: 'I arrive at the Sunlit Orchard and taste a golden apple, promising the orchard-keeper I will return before harvest to help mend the broken sundial.',
    },
    {
        label: '2 — document orchard',
        text: 'I sketch the sundial\'s cracked gnomon and note how the light falls across the apple rows.',
    },
    {
        label: '3 — travel to conservatory',
        text: 'I follow the moss path east into the glass Whispering Conservatory and listen to the sapphire orchids hum a three-note chord.',
    },
    {
        label: '4 — conservatory study',
        text: 'I copy the orchid melody into my journal and ask a passing acolyte whether the plants ever fall silent.',
    },
    {
        label: '5 — leave for tower',
        text: 'I leave the conservatory and climb the spiral stairs into the Clockwork Tower library.',
    },
    {
        label: '6 — tower observation',
        text: 'I watch the brass astrolabe spin above the shelves and copy gear ratios into my notes.',
    },
    {
        label: '7 — faction symptom probe',
        text: 'I ask the tower archivist whether trade caravans from the lowlands have been arriving late — I heard rumors of road trouble.',
    },
    {
        label: '8 — NPC rapport',
        text: 'I share my orchard sketches with the archivist and ask what pressure the sanctuary valleys face this season.',
    },
    {
        label: '9 — travel observatory',
        text: 'I pack my notes and hike up to the Crystal Observatory as dusk settles.',
    },
    {
        label: '10 — observatory',
        text: 'Through the crystal lens I chart the southern constellations and listen for any distant bell from the valleys below.',
    },
    {
        label: '11 — world pressure',
        text: 'I inquire whether refugees or missing envoys have been reported near Eldoria\'s borders.',
    },
    {
        label: '12 — player canon reinforcement',
        text: 'I remind myself aloud: I am Jack the Scholar, sworn to document every landmark before the autumn council meets.',
    },
    {
        label: '13 — return path',
        text: 'I descend toward the Clockwork Tower again to compare my star charts with the tower\'s gear calendar.',
    },
    {
        label: '14 — tower revisit',
        text: 'Back in the tower, I cross-check the astrolabe reading against what I saw at the observatory.',
    },
    {
        label: '15 — social beat',
        text: 'I politely ask the archivist if the orchids\' three-note chord could mark time as reliably as tower gears.',
    },
    {
        label: '16 — callback hook',
        text: 'I mention my promise to the orchard-keeper about the broken sundial and ask whether anyone here knows a mason.',
    },
    {
        label: '17 — travel conservatory',
        text: 'I walk back down to the Whispering Conservatory to see whether the orchids change their melody at night.',
    },
    {
        label: '18 — conservatory night',
        text: 'In the conservatory I listen again and note any change in the orchids\' hum.',
    },
    {
        label: '19 — travel orchard',
        text: 'I return to the Sunlit Orchard to see whether the sundial shadow matches my earlier sketch.',
    },
    {
        label: '20 — orchard close',
        text: 'At the orchard I compare the sundial shadow to my sketch and look for the keeper I promised to help.',
    },
    {
        label: '21 — set up camp and long rest',
        text: 'Feeling exhausted from my long travels, I pitch a tent near the orchard and settle in for a long rest under the stars.',
    },
    {
        label: '22 — wake up refreshed',
        text: 'I wake up at dawn feeling fully refreshed, pack up my camp, and check if my spellbook is safe.',
    },
    {
        label: '23 — chat with keeper Lannis',
        text: 'I meet the keeper Lannis in the orchard and show him the star charts, asking if he has any advice on fixing the sundial.',
    },
    {
        label: '24 — afternoon rest',
        text: 'I spend the warm afternoon sitting by the well, taking a short rest to recharge my energy.',
    },
    {
        label: '25 — travel back to conservatory',
        text: 'I head back to the Whispering Conservatory to check if any new sapphire orchids have blossomed.',
    },
    {
        label: '26 — buy healing potion',
        text: 'I talk to the apprentice acolyte and ask if I can purchase a potion of healing to prepare for any dangers ahead.',
    },
    {
        label: '27 — study strange artifact',
        text: 'I examine a metallic, ancient sphere on the conservatory bookshelf, trying to identify its properties using my Arcana knowledge.',
    },
    {
        label: '28 — evening meditation',
        text: 'I sit quietly on a bench under the glass dome, taking a short rest to regain my focus.',
    },
    {
        label: '29 — final return to orchard',
        text: 'I return to the Sunlit Orchard, determined to inspect the sundial one last time before leaving Eldoria.',
    },
    {
        label: '30 — check into inn and rest',
        text: 'As night falls, I check into the Orchard Tavern, pay the keeper for a warm room, and take a long rest in a soft bed.',
    },
];

const RECALL_QUESTIONS = [
    {
        id: 'location_before_tower',
        prompt: 'What did I see and do in the place immediately before I first entered the Clockwork Tower?',
        needles: ['conservatory', 'orchid', 'glass', 'hum', 'melody'],
    },
    {
        id: 'callback_promise',
        prompt: 'What promise did I make to the orchard-keeper, and about what object?',
        needles: ['sundial', 'harvest', 'mend', 'promise', 'orchard'],
    },
    {
        id: 'player_canon',
        prompt: 'Who am I and what mission did I swear to complete before the autumn council?',
        needles: ['jack', 'scholar', 'document', 'landmark', 'council'],
    },
];

let browser = null;
let page = null;
const consoleErrors = [];
const turnLog = [];

async function run() {
    const startedAt = new Date().toISOString();
    console.log('Launching Chrome for memory tuning playtest…');
    browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    page.on('console', msg => {
        if (msg.type() === 'error') {
            const text = msg.text();
            consoleErrors.push(text);
            console.log('[Browser ERROR]', text);
        }
    });

    console.log(`Navigating to ${APP_URL}…`);
    await page.goto(APP_URL);
    await delay(2000);

    await page.evaluate(({ apiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: 'gemini',
            apiKey,
            imageApiKey: '',
            model: 'gemini-3.1-pro-preview',
        }));
    }, { apiKey: GEMINI_API_KEY });

    await page.reload();
    await delay(2000);

    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(800);

    await page.waitForSelector('.creation-card');
    await page.click('.creation-card');
    await delay(800);

    await page.waitForSelector('.creation-input');
    await page.type('.creation-input', 'Jack the Scholar');
    await page.click('.char-creation-actions .btn-primary');
    await delay(800);

    await page.waitForSelector('.creation-card');
    await page.evaluate(() => {
        const elf = Array.from(document.querySelectorAll('.creation-card')).find(c => c.textContent.includes('Elf'));
        if (elf) elf.click();
    });
    await page.click('.char-creation-actions .btn-primary');
    await delay(800);

    await page.waitForSelector('.creation-card');
    await page.evaluate(() => {
        const wizard = Array.from(document.querySelectorAll('.creation-card')).find(c => c.textContent.includes('Wizard'));
        if (wizard) wizard.click();
    });
    await page.click('.char-creation-actions .btn-primary');
    await delay(800);

    await page.waitForSelector('.stat-row');
    for (let i = 0; i < 6; i++) {
        await page.evaluate((index) => {
            const row = document.querySelectorAll('.stat-row')[index];
            const choice = row.querySelector('.stat-choice');
            if (choice) choice.click();
        }, i);
        await delay(300);
    }
    await page.click('.char-creation-actions .btn-primary');
    await delay(800);

    await page.waitForSelector('.skill-choice-card');
    await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.skill-choice-card'));
        const arcana = cards.find(c => c.textContent.includes('Arcana'));
        const history = cards.find(c => c.textContent.includes('History'));
        if (arcana) arcana.click();
        if (history) history.click();
    });
    await delay(400);
    await page.click('.char-creation-actions .btn-primary');
    await delay(800);
    await page.click('.char-creation-actions .btn-primary');
    await delay(800);

    const premise = [
        'Jack the Scholar documents the sanctuary valleys of Eldoria before the autumn council.',
        'Locations: Sunlit Orchard (golden apples, cracked sundial), Whispering Conservatory (glass dome, humming sapphire orchids),',
        'Clockwork Tower (brass astrolabe library), Crystal Observatory (southern star charts).',
        'Hidden pressure: lowland trade routes are failing; envoys go missing; refugee whispers reach the valleys.',
        'The sanctuary council debates whether to seal the passes. Jack wants peaceful study, not battle.',
    ].join(' ');

    await page.waitForSelector('textarea.creation-premise');
    await page.type('textarea.creation-premise', premise);
    await page.click('.char-creation-actions .btn-primary');
    await delay(800);

    console.log('Waiting for premise opening scene…');
    await waitForLLM(page);
    turnLog.push({
        turn: 0,
        label: 'opening',
        responsePreview: (await lastAssistantText(page)).slice(0, 400),
    });

    for (const action of TURN_ACTIONS) {
        await sendAction(page, action.text, action.label);
        const response = await lastAssistantText(page);
        turnLog.push({
            turn: turnLog.length,
            label: action.label,
            responsePreview: response.slice(0, 400),
        });
        if (turnLog.length === 22) {
            await page.screenshot({ path: path.join(REPORT_DIR, 'after_rest.png') }).catch(() => {});
        }
    }

    const midSave = await loadAutosave(page);
    const midSummary = summarizeState(midSave);

    const recallResults = [];
    for (const question of RECALL_QUESTIONS) {
        await sendAction(page, question.prompt, `recall — ${question.id}`);
        const response = await lastAssistantText(page);
        const scored = scoreRecall(response, question.needles);
        recallResults.push({
            id: question.id,
            prompt: question.prompt,
            responsePreview: response.slice(0, 600),
            ...scored,
        });
        console.log(`Recall ${question.id}: ${scored.hits.length}/${scored.needles.length} needles hit`);
    }

    const finalSave = await loadAutosave(page);
    const finalSummary = summarizeState(finalSave);

    const report = {
        startedAt,
        finishedAt: new Date().toISOString(),
        appUrl: APP_URL,
        turnsPlayed: TURN_ACTIONS.length,
        recallQuestions: recallResults,
        consoleErrorCount: consoleErrors.length,
        consoleErrors: consoleErrors.slice(0, 20),
        stateAfterTurns: midSummary,
        stateAfterRecall: finalSummary,
        turnLog,
        tuningNotes: [
            'Review recall hitRate — aim for natural answers without exposition dumps.',
            'Check storyMemory cards: are promises/playerCanon captured with sane salience?',
            'Check fronts clocks: any movement without player interference is a cadence bug.',
            'Journal locations should track multi-place travel across the 20 turns.',
            'consoleErrorCount should be 0.',
        ],
    };

    const reportPath = path.join(REPORT_DIR, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${reportPath}`);

    await page.screenshot({ path: path.join(REPORT_DIR, 'final.png') });
    await browser.close();

    if (consoleErrors.length > 0) {
        console.warn(`Completed with ${consoleErrors.length} browser console error(s).`);
    }

    const avgRecall = recallResults.reduce((sum, r) => sum + r.hitRate, 0) / recallResults.length;
    console.log(`Average recall needle hit rate: ${(avgRecall * 100).toFixed(0)}%`);
    console.log('Memory tuning playtest finished.');
}

run().catch(async err => {
    console.error('Memory tuning playtest failed:', err);
    if (page) {
        await page.screenshot({ path: path.join(REPORT_DIR, 'error.png') }).catch(() => {});
    }
    if (browser) {
        await browser.close().catch(() => {});
    }
    process.exit(1);
});