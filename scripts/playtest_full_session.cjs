/**
 * Full-session live playtest against the deployed app.
 *
 * Phased so a single run stays short; the Chrome profile persists between
 * phases (test-results/full_session/profile), which also exercises Continue.
 *
 *   node scripts/playtest_full_session.cjs create        # wipe profile, create hero, audit menus
 *   node scripts/playtest_full_session.cjs play seg1     # exploration + gated loot (--from N to resume)
 *   node scripts/playtest_full_session.cjs play seg2     # social + merchant + challenge
 *   node scripts/playtest_full_session.cjs play seg3     # combat + rest + victory loot
 *   node scripts/playtest_full_session.cjs persist       # saves, reload, legacy heal, Dynamic World upgrade
 *
 * The GEMINI_API_KEY is read from .env inside this process and injected into
 * the app's localStorage; it is never printed.
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
} catch { /* fall through to env var */ }
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || localApiKey;
if (!GEMINI_API_KEY) {
    console.error('No GEMINI_API_KEY available (env or .env). Aborting.');
    process.exit(1);
}

const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'https://quest-forge-99ab1.web.app/?debugState=1';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve('test-results/full_session');
const PROFILE_DIR = path.join(OUT_DIR, 'profile');

const phase = process.argv[2] || 'create';
const segment = process.argv[3] || '';
const fromArg = process.argv.find(a => a.startsWith('--from='));
const startFrom = fromArg ? parseInt(fromArg.split('=')[1], 10) : 0;

fs.mkdirSync(OUT_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
const notes = [];
function note(kind, message, extra = {}) {
    const entry = { t: new Date().toISOString(), kind, message, ...extra };
    notes.push(entry);
    console.log(`[${kind}] ${message}`);
}
function saveNotes(label) {
    fs.writeFileSync(path.join(OUT_DIR, `log_${label}.json`), JSON.stringify(notes, null, 2));
}
async function shot(page, name) {
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) }).catch(() => {});
}

/** Sanitized live game state via the ?debugState=1 hook. */
async function qfState(page) {
    return await page.evaluate(() => {
        const s = window.__QF_STATE__;
        if (!s) return null;
        return {
            location: s.currentLocation,
            gold: s.character?.gold, silver: s.character?.silver, copper: s.character?.copper,
            hp: s.character?.currentHP, maxHp: s.character?.maxHP, level: s.character?.level, exp: s.character?.exp,
            inv: (s.inventory || []).map(i => `${i.name}${(i.quantity || 1) > 1 ? ` x${i.quantity}` : ''}${i.equipped ? ' [E]' : ''}`),
            msgCount: (s.messages || []).length,
            fronts: (s.fronts || []).map(f => ({ id: f.id, title: f.title, clock: f.clock, stage: f.stage })),
            combat: s.combat?.active ? {
                phase: s.combat.phase, round: s.combat.round,
                enemies: (s.combat.enemies || []).map(e => ({ n: e.name, hp: e.hp, st: e.combatStatus })),
            } : null,
            pendingCheck: s.pendingRoleplayCheck ? {
                rolls: (s.pendingRoleplayCheck.rolls || []).map(r => `${r.skill || r.type} DC ${r.dc}`),
                hasLoot: !!s.pendingRoleplayCheck.loot,
            } : null,
            lootSources: (s.appliedLootSourceIds || []).length,
            quests: (s.quests || []).length, npcs: (s.npcs || []).length,
            worldFacts: (s.worldFacts || []).length, journal: (s.journal || []).length,
            storyMemory: (s.storyMemory || []).length,
        };
    }).catch(() => null);
}

async function lastDmText(page, max = 500) {
    return await page.evaluate((maxLen) => {
        const msgs = Array.from(document.querySelectorAll('.chat-message.assistant .message-text'));
        const last = msgs[msgs.length - 1];
        return last ? last.textContent.trim().slice(0, maxLen) : '';
    }, max).catch(() => '');
}

/** Wait until the UI and combat state machine are both idle. Handles narration retry. */
async function waitForIdle(page, { timeout = 240000 } = {}) {
    const start = Date.now();
    let calm = 0;
    let retriesUsed = 0;
    while (Date.now() - start < timeout) {
        const status = await page.evaluate(() => {
            const loading = !!document.querySelector('.chat-stop-btn') || !!document.querySelector('.typing-indicator');
            const s = window.__QF_STATE__;
            const combatBusy = !!(s?.combat?.active && ['opening', 'awaiting_intent', 'awaiting_narration'].includes(s.combat.phase));
            const queued = !!(s?.combat?.active && s.combat.queuedExchange);
            const retryBtn = Array.from(document.querySelectorAll('.chat-send-btn')).some(b => b.textContent.includes('Retry'));
            return { busy: loading || combatBusy || queued, retryBtn, loading };
        }).catch(() => ({ busy: true, retryBtn: false, loading: false }));

        if (status.retryBtn && !status.loading && retriesUsed < 3) {
            retriesUsed++;
            note('retry', `Combat narration retry button visible — clicking (attempt ${retriesUsed}).`);
            await clickByText(page, '.chat-send-btn', 'Retry');
            await delay(2000);
            continue;
        }
        if (!status.busy) {
            calm++;
            if (calm >= 2) return true;
        } else {
            calm = 0;
        }
        await delay(2000);
    }
    note('warn', `waitForIdle timed out after ${Math.round((Date.now() - start) / 1000)}s.`);
    return false;
}

async function clickByText(page, selector, text) {
    return await page.evaluate(({ selector, text }) => {
        const el = Array.from(document.querySelectorAll(selector)).find(e => e.textContent.includes(text));
        if (el) { el.click(); return true; }
        return false;
    }, { selector, text });
}

async function typeAndSend(page, text) {
    await page.evaluate((val) => {
        const textarea = document.querySelector('textarea.chat-input');
        if (textarea) {
            textarea.value = val;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, text);
    await delay(400);
    const sent = await clickByText(page, 'button.chat-send-btn', 'Send');
    if (!sent) note('warn', 'Send button not found/clickable.');
}

/**
 * Resolve a pending roleplay check proposal.
 * mode: 'roll' | 'challenge' | 'change'
 */
async function handleProposal(page, mode, challengeText = '') {
    const state = await qfState(page);
    if (!state?.pendingCheck) return false;
    note('proposal', `Check proposed: ${state.pendingCheck.rolls.join('; ')} (loot metadata: ${state.pendingCheck.hasLoot})`, { mode });
    await shot(page, `proposal_${Date.now()}`);

    if (mode === 'challenge') {
        await clickByText(page, '.roleplay-check-actions button, .roleplay-check-panel button', 'Challenge ruling');
        await delay(800);
        await page.evaluate((text) => {
            const panel = document.querySelector('.roleplay-check-panel');
            const ta = panel?.querySelector('textarea');
            if (ta) {
                ta.value = text;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, challengeText);
        await delay(400);
        await clickByText(page, '.roleplay-check-panel button', 'Send challenge');
        await waitForIdle(page);
        // The DM may have upheld/revised: a proposal can be active again — roll it.
        const after = await qfState(page);
        if (after?.pendingCheck) {
            note('proposal', `Post-challenge ruling still proposes: ${after.pendingCheck.rolls.join('; ')} — accepting.`);
            await clickByText(page, '.roleplay-check-panel button', 'Roll');
            await waitForIdle(page);
        } else {
            note('proposal', 'Challenge resulted in a withdrawn check (no dice).');
        }
        return true;
    }

    if (mode === 'change') {
        await clickByText(page, '.roleplay-check-panel button', 'Change approach');
        await delay(1500);
        note('proposal', 'Chose Change approach — proposal set aside without dice.');
        return true;
    }

    await clickByText(page, '.roleplay-check-panel button', 'Roll');
    await waitForIdle(page);
    // Follow-up rolls re-stage as a new proposal; accept those too (max 3 deep).
    for (let i = 0; i < 3; i++) {
        const follow = await qfState(page);
        if (!follow?.pendingCheck) break;
        note('proposal', `Follow-up check: ${follow.pendingCheck.rolls.join('; ')} — accepting.`);
        await clickByText(page, '.roleplay-check-panel button', 'Roll');
        await waitForIdle(page);
    }
    return true;
}

/** Fight until combat ends (bounded). Returns iterations used. */
async function resolveCombat(page, maxIters = 14) {
    for (let i = 0; i < maxIters; i++) {
        const s = await qfState(page);
        if (!s?.combat) return i;
        if (s.combat.phase === 'awaiting_player') {
            const target = s.combat.enemies.find(e => e.st === 'active');
            if (!target) {
                // Everyone down but combat still open — look for an End Combat control.
                const ended = await clickByText(page, 'button', 'End Combat');
                note('combat', ended ? 'Clicked End Combat.' : 'No living enemies and no End Combat button; waiting.');
                await waitForIdle(page);
                continue;
            }
            const action = `I attack the ${target.n} with my longsword.`;
            note('combat', `Round ${s.combat.round}: ${action} (enemy hp ${target.hp})`);
            await typeAndSend(page, action);
            await waitForIdle(page);
        } else {
            await waitForIdle(page);
        }
    }
    note('warn', 'Combat did not resolve within iteration budget.');
    return maxIters;
}

async function playRound(page, label, action, { proposalMode = 'roll', challengeText = '' } = {}) {
    const before = await qfState(page);
    const startedAt = Date.now();
    note('action', `${label}: "${action}"`);
    await typeAndSend(page, action);
    await waitForIdle(page);
    await handleProposal(page, proposalMode, challengeText);
    const combatIters = (await qfState(page))?.combat ? await resolveCombat(page) : 0;
    await delay(1500);
    const after = await qfState(page);
    const dm = await lastDmText(page);
    const secs = Math.round((Date.now() - startedAt) / 1000);
    note('round', `${label} done in ${secs}s`, {
        dm,
        coinsBefore: before ? `${before.gold}g ${before.silver}s ${before.copper}c` : null,
        coinsAfter: after ? `${after.gold}g ${after.silver}s ${after.copper}c` : null,
        hp: after ? `${after.hp}/${after.maxHp}` : null,
        inv: after?.inv, lootSources: after?.lootSources, combatIters,
        fronts: after?.fronts?.length, quests: after?.quests, npcs: after?.npcs,
        worldFacts: after?.worldFacts, storyMemory: after?.storyMemory, journal: after?.journal,
    });
    await shot(page, `round_${label}`);
}

/** Scroll-up-and-read test: reader must not be yanked down; Latest button must appear. */
async function testStickyScroll(page, label, action) {
    note('scroll', `Sticky-scroll test during "${action}"`);
    await typeAndSend(page, action);
    await delay(4000); // let streaming begin
    await page.evaluate(() => { document.querySelector('.chat-messages').scrollTop = 0; });
    await waitForIdle(page);
    await delay(1500);
    const result = await page.evaluate(() => {
        const el = document.querySelector('.chat-messages');
        return {
            scrollTop: el.scrollTop,
            jumpButtonVisible: !!document.querySelector('.chat-jump-latest'),
        };
    });
    note('scroll', `After completion: scrollTop=${result.scrollTop} (should stay ~0), jumpButton=${result.jumpButtonVisible}`, result);
    await shot(page, `scroll_${label}`);
    if (result.jumpButtonVisible) {
        await page.click('.chat-jump-latest');
        await delay(1500);
        const after = await page.evaluate(() => {
            const el = document.querySelector('.chat-messages');
            return { nearBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 150 };
        });
        note('scroll', `Jump-to-latest clicked → nearBottom=${after.nearBottom}`);
    }
    await handleProposal(page, 'roll');
    if ((await qfState(page))?.combat) await resolveCombat(page);
}

async function launch({ wipeProfile = false } = {}) {
    if (wipeProfile) fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        userDataDir: PROFILE_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1500,950'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    page.on('dialog', d => d.accept().catch(() => {}));
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
            note('console', `${msg.type()}: ${msg.text().slice(0, 400)}`);
        }
    });
    page.on('pageerror', err => note('pageerror', String(err).slice(0, 400)));
    await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(2500);
    return { browser, page };
}

async function continueIfStartScreen(page) {
    const onStart = await page.evaluate(() => !!document.querySelector('.start-btn.continue-btn, .new-btn'));
    if (!onStart) return;
    const clicked = await page.evaluate(() => {
        const btn = document.querySelector('.start-btn.continue-btn');
        if (btn) { btn.click(); return true; }
        return false;
    });
    if (!clicked) throw new Error('Start screen shown but no Continue button — campaign lost?');
    await delay(3500);
    note('nav', 'Continued existing campaign from start screen.');
}

// ---------------------------------------------------------------------------

async function phaseCreate() {
    const { browser, page } = await launch({ wipeProfile: true });

    note('nav', 'Fresh profile at start screen.');
    await shot(page, '00_start_screen_fresh');
    const startButtons = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(Boolean));
    note('audit', `Start screen buttons: ${JSON.stringify(startButtons)}`);

    await page.evaluate(({ apiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: 'gemini',
            apiKey,
            imageApiKey: '', // scene art out of scope
            model: 'gemini-3.1-pro-preview',
        }));
    }, { apiKey: GEMINI_API_KEY });
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2500);

    note('nav', 'Starting New Game.');
    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(1200);
    await shot(page, '01_wizard_source');
    const sourceCards = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.creation-card')).map(c => c.textContent.trim().slice(0, 80)));
    note('audit', `Hero source options: ${JSON.stringify(sourceCards)}`);
    await page.click('.creation-card'); // Forge a New Hero
    await delay(1000);

    note('wizard', 'Step: name');
    await page.waitForSelector('.creation-input');
    await page.type('.creation-input', 'Kalden Vor');
    await shot(page, '02_wizard_name');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    note('wizard', 'Step: race');
    await page.waitForSelector('.creation-card');
    const raceOptions = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.creation-card')).map(c => c.querySelector('h3, strong, .creation-card-title')?.textContent?.trim() || c.textContent.trim().slice(0, 30)));
    note('audit', `Race options: ${JSON.stringify(raceOptions)}`);
    await shot(page, '03_wizard_race');
    await clickByText(page, '.creation-card', 'Human');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    note('wizard', 'Step: class');
    const classOptions = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.creation-card')).map(c => c.querySelector('h3, strong, .creation-card-title')?.textContent?.trim() || c.textContent.trim().slice(0, 30)));
    note('audit', `Class options: ${JSON.stringify(classOptions)}`);
    await shot(page, '04_wizard_class');
    await clickByText(page, '.creation-card', 'Fighter');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    note('wizard', 'Step: ability scores');
    await page.waitForSelector('.stat-row');
    await shot(page, '05_wizard_stats');
    for (let i = 0; i < 6; i++) {
        await page.evaluate((index) => {
            document.querySelectorAll('.stat-row')[index]?.querySelector('.stat-choice')?.click();
        }, i);
        await delay(300);
    }
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    // Fighter creation may include fighting style and/or skills; handle whatever appears.
    for (let step = 0; step < 4; step++) {
        const stepInfo = await page.evaluate(() => ({
            heading: document.querySelector('.char-creation h2, .char-creation h3')?.textContent?.trim() || '',
            skillCards: document.querySelectorAll('.skill-choice-card').length,
            creationCards: document.querySelectorAll('.creation-card').length,
            premise: !!document.querySelector('textarea.creation-premise'),
            bodyText: document.body.innerText.slice(0, 60),
        }));
        if (stepInfo.premise) break;
        note('wizard', `Step: ${stepInfo.heading || '(unlabeled)'} — skillCards=${stepInfo.skillCards}, cards=${stepInfo.creationCards}`);
        await shot(page, `06_wizard_step_${step}`);
        if (stepInfo.skillCards > 0) {
            for (const skill of ['Athletics', 'Intimidation']) {
                await clickByText(page, '.skill-choice-card', skill);
                await delay(300);
            }
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

    note('wizard', 'Step: premise');
    await page.waitForSelector('textarea.creation-premise');
    const premise = 'Kalden Vor, a human fighter and former caravan guard, arrives in the river town of Brackwater carrying his last few coins and a signed letter of debt: the merchant Odo Ferrin owes him 40 gold for a season of guard work. Brackwater has a market square, the Gilded Eel tavern, warehouses along the docks, and cellars plagued by unusually bold rats. Lately shipments have been going missing and the dockhands mutter about smugglers. Kalden begins at the door of the Gilded Eel at dusk, wearing his chain mail with his longsword at his hip.';
    await page.type('textarea.creation-premise', premise);
    await shot(page, '07_wizard_premise');
    await page.click('.char-creation-actions .btn-primary');
    note('wizard', 'Begin Adventure clicked — waiting for the opening scene.');
    await waitForIdle(page, { timeout: 300000 });
    await delay(3000);
    await shot(page, '08_opening_scene');
    note('opening', await lastDmText(page, 800));
    note('state', 'Post-opening state', { state: await qfState(page) });

    // ---- Menus & panels audit (desktop layout keeps sidebars visible) ----
    note('audit', 'Auditing side panels.');
    const panelAudit = await page.evaluate(() => {
        const grab = sel => document.querySelector(sel)?.innerText?.trim().slice(0, 600) || '(not found)';
        return {
            characterSheet: grab('.sidebar-left .sidebar-section:nth-child(1)'),
            inventory: grab('.sidebar-inventory'),
            companions: grab('.sidebar-left .sidebar-section:nth-child(3)'),
            dice: grab('.sidebar-right'),
        };
    });
    note('audit', 'Panel contents captured', panelAudit);
    await shot(page, '09_desktop_layout');

    // Expand character sheet dropdown sections if present
    const dropdownCount = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('.cs-dropdown-btn'));
        btns.forEach(b => b.click());
        return btns.length;
    });
    note('audit', `Character sheet dropdown buttons clicked: ${dropdownCount}`);
    await delay(800);
    await shot(page, '10_character_sheet_expanded');
    const sheetButtons = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.sidebar-left button')).map(b => b.textContent.trim()).filter(Boolean));
    note('audit', `Character/inventory/companion buttons: ${JSON.stringify(sheetButtons)}`);

    // Journal modal
    note('audit', 'Opening World Journal.');
    await clickByText(page, '.header-btn', 'Journal');
    await delay(1200);
    await shot(page, '11_journal_modal');
    const journalTabs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t && t.length < 25));
    note('audit', `Journal modal buttons/tabs: ${JSON.stringify(journalTabs.slice(0, 30))}`);
    await page.keyboard.press('Escape');
    await clickByText(page, 'button', 'Close');
    await delay(800);

    // Settings modal
    note('audit', 'Opening Settings.');
    await clickByText(page, '.header-btn', 'Settings');
    await delay(1200);
    await shot(page, '12_settings_modal');
    const settingsAudit = await page.evaluate(() => {
        const modal = document.querySelector('.modal, .settings-modal, [class*="settings"]');
        const text = (modal || document.body).innerText.slice(0, 1500);
        const selects = Array.from(document.querySelectorAll('select')).map(s => ({
            options: Array.from(s.options).map(o => o.textContent.trim()),
            value: s.value,
        }));
        return { text, selects };
    });
    note('audit', 'Settings modal captured', settingsAudit);
    await page.keyboard.press('Escape');
    await clickByText(page, 'button', 'Close');
    await delay(500);

    saveNotes('create');
    await browser.close();
}

// ---------------------------------------------------------------------------

const SEGMENTS = {
    seg1: [
        { a: "I push open the door of the Gilded Eel and take in the room — who is here, and where can a tired guard sit with his back to the wall?" },
        { a: "I ask the barkeep about Odo Ferrin, and about these bold rats everyone mutters about, and I order a cheap ale — I'll pay what it costs." },
        { a: "I offer to clear the tavern cellar of rats in exchange for a room for the night, then head down to the cellar to deal with them." },
        { a: "With the cellar quiet, I search the shelves and the old crates down here for anything worth keeping." },
        { scroll: true, a: "I check behind the loose bricks in the cellar wall — if there's a strongbox or a stash hidden there, I want it open. I'll pry with my dagger if I must." },
        { a: "I climb back up, tell the barkeep the cellar is handled, and claim the room I was promised." },
        { a: "Before sleeping I go over my gear, count my coin, and think about how to make Odo Ferrin pay what he owes. Then I turn in for the night." },
    ],
    seg2: [
        { a: "In the morning I head to the market square and look for Odo Ferrin's stall or office." },
        {
            a: "I present Odo the signed letter of debt and tell him, politely but firmly, that I am here to collect my 40 gold.",
            proposalMode: 'challenge',
            challengeText: "Odo's own seal is on this letter — the debt itself is not in question, and I'm not asking a favor. Handing over documented money he legally owes shouldn't hinge on my charm.",
        },
        { a: "I ask Odo what he knows about the missing shipments at the docks, and who might be behind them." },
        { a: "I browse the market stalls. If anyone sells a healing potion, I buy one at the listed price. I also buy a plain dagger." },
        { scroll: true, a: "I ask around the square about work for a capable guard — any notice board, any trouble that pays?" },
        { a: "I find a quiet bench, eat something cheap, and listen to the gossip around me for anything about the smugglers or the rats." },
        { a: "I head toward the docks to look at the warehouse the dockhands mentioned, keeping my eyes open on the way." },
    ],
    seg3: [
        {
            a: "I wait for dusk and try to sneak along the warehouse wall to peek through a gap in the boards without being seen.",
            proposalMode: 'change',
        },
        { a: "Change of plan — I walk up to the warehouse openly, like a hired hand looking for work, and knock on the door." },
        { a: "Whoever answers, I press past the excuses: I tell them I know about the skimmed shipments, and I'm either paid to stay quiet or paid to leave — their choice. If they draw steel, I'm ready." },
        { a: "I search the fallen and the nearby crates for coin and for anything that ties this crew to the missing shipments." },
        { rest: 'short', a: "" },
        { a: "I take what I found to whoever passes for the watch in Brackwater and tell them exactly what happened at the warehouse." },
        { a: "I return to the Gilded Eel, order a proper meal this time, and raise a quiet toast to a job done. What's the mood in the tavern tonight?" },
    ],
};

async function phasePlay(segName) {
    const actions = SEGMENTS[segName];
    if (!actions) throw new Error(`Unknown segment "${segName}"`);
    const { browser, page } = await launch();
    await continueIfStartScreen(page);
    note('state', `Segment ${segName} starting state`, { state: await qfState(page) });

    for (let i = startFrom; i < actions.length; i++) {
        const step = actions[i];
        const label = `${segName}_r${i + 1}`;
        if (step.rest) {
            note('action', `${label}: clicking ${step.rest} rest button on the character sheet.`);
            await page.evaluate(() => {
                Array.from(document.querySelectorAll('.cs-dropdown-btn')).forEach(b => b.click());
            });
            await delay(600);
            const clicked = await clickByText(page, '.cs-rest-btn', step.rest === 'short' ? 'Short Rest' : 'Long Rest');
            note('rest', clicked ? 'Rest button clicked.' : 'Rest button NOT found.');
            await waitForIdle(page);
            await shot(page, `round_${label}`);
            note('round', `${label} rest done`, { state: await qfState(page), dm: await lastDmText(page) });
            continue;
        }
        if (step.scroll) {
            await testStickyScroll(page, label, step.a);
            note('round', `${label} (scroll test) done`, { state: await qfState(page), dm: await lastDmText(page) });
            continue;
        }
        await playRound(page, label, step.a, {
            proposalMode: step.proposalMode || 'roll',
            challengeText: step.challengeText || '',
        });
    }

    // Save-toast honesty spot check: a recent state change should show the local toast.
    const toast = await page.evaluate(() => document.querySelector('.save-toast')?.textContent || null);
    if (toast) note('toast', `Save toast visible: "${toast}"`);

    note('state', `Segment ${segName} final state`, { state: await qfState(page) });
    saveNotes(`play_${segName}`);
    await browser.close();
}

// ---------------------------------------------------------------------------

async function phasePersist() {
    const { browser, page } = await launch();
    await continueIfStartScreen(page);
    const snapA = await qfState(page);
    note('state', 'Snapshot A (live campaign)', { state: snapA });

    // Manual save through Settings
    note('persist', 'Opening Settings to make a manual save.');
    await clickByText(page, '.header-btn', 'Settings');
    await delay(1200);
    await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
        const nameInput = inputs.find(i => (i.placeholder || '').toLowerCase().includes('save') || (i.placeholder || '').toLowerCase().includes('name'));
        if (nameInput) {
            nameInput.value = 'playtest-manual';
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
    await delay(400);
    const savedClicked = await clickByText(page, 'button', 'Save');
    note('persist', savedClicked ? 'Save clicked.' : 'Save button not found!');
    await delay(3500);
    const savesList = await page.evaluate(() => document.body.innerText.match(/playtest-manual[^\n]*/)?.[0] || '(not listed)');
    note('persist', `Manual save row: ${savesList}`);
    await shot(page, '20_settings_saves');
    await page.keyboard.press('Escape');
    await clickByText(page, 'button', 'Close');
    await delay(600);

    // Reload → Continue → state must match
    note('persist', 'Reloading page and continuing.');
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2500);
    await shot(page, '21_start_screen_continue');
    await continueIfStartScreen(page);
    const snapB = await qfState(page);
    note('state', 'Snapshot B (after reload+Continue)', { state: snapB });
    const roundTripOk = snapA && snapB
        && snapA.gold === snapB.gold && snapA.msgCount === snapB.msgCount
        && snapA.fronts.length === snapB.fronts.length && snapA.inv.length === snapB.inv.length;
    note(roundTripOk ? 'pass' : 'fail', `Round-trip persistence: fronts ${snapA?.fronts.length}→${snapB?.fronts.length}, gold ${snapA?.gold}→${snapB?.gold}, msgs ${snapA?.msgCount}→${snapB?.msgCount}, inv ${snapA?.inv.length}→${snapB?.inv.length}`);

    // Legacy save heal: strip fronts from the autosave (pre-fix format) and reload.
    note('persist', 'Simulating a pre-fix legacy autosave (deleting fronts + saveVersion).');
    await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
            const req = indexedDB.open('rpg-client-saves', 2);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction('saves', 'readwrite');
                const store = tx.objectStore('saves');
                const get = store.get('__autosave__');
                get.onsuccess = () => {
                    const record = get.result;
                    if (record?.state) {
                        delete record.state.fronts;
                        delete record.state.saveVersion;
                        delete record.state.pendingRoleplayCheck;
                        store.put(record);
                    }
                };
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onabort = () => { db.close(); reject(tx.error); };
            };
        });
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2500);
    await continueIfStartScreen(page);
    const snapC = await qfState(page);
    note('state', 'Snapshot C (after legacy-save load)', { state: snapC });
    const healed = snapC?.fronts?.length === 1 && snapC.fronts[0].id === 'front-local-pressure';
    note(healed ? 'pass' : 'fail', `Legacy heal: fronts=${JSON.stringify(snapC?.fronts)}`);
    await shot(page, '22_after_legacy_heal');

    // Dynamic World upgrade from Settings
    note('persist', 'Attempting Settings → Dynamic World upgrade.');
    await clickByText(page, '.header-btn', 'Settings');
    await delay(1200);
    const upgradeClicked = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
            .find(b => /dynamic|living world|upgrade/i.test(b.textContent));
        if (btn) { btn.click(); return btn.textContent.trim(); }
        return null;
    });
    note('persist', upgradeClicked ? `Upgrade button clicked: "${upgradeClicked}"` : 'Upgrade button NOT found.');
    if (upgradeClicked) {
        const start = Date.now();
        let upgraded = false;
        while (Date.now() - start < 180000) {
            await delay(4000);
            const s = await qfState(page);
            if ((s?.fronts?.length || 0) >= 2) { upgraded = true; break; }
            const status = await page.evaluate(() => document.body.innerText.match(/(Upgrade failed|already has|No campaign state)[^\n]*/)?.[0] || null);
            if (status) { note('persist', `Upgrade status: ${status}`); break; }
        }
        const snapD = await qfState(page);
        note(upgraded ? 'pass' : 'fail', `Dynamic World upgrade → fronts=${JSON.stringify(snapD?.fronts)}`);
        await shot(page, '23_after_upgrade');
    }
    await page.keyboard.press('Escape');
    await clickByText(page, 'button', 'Close');
    await delay(2500);

    // Final: upgraded fronts must survive one more reload (the original P0).
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2500);
    await continueIfStartScreen(page);
    const snapE = await qfState(page);
    const persisted = (snapE?.fronts?.length || 0) >= 1;
    note(persisted ? 'pass' : 'fail', `Fronts after final reload: ${JSON.stringify(snapE?.fronts)}`);
    note('state', 'Snapshot E (final)', { state: snapE });
    await shot(page, '24_final_state');

    saveNotes('persist');
    await browser.close();
}

// ---------------------------------------------------------------------------

(async () => {
    try {
        if (phase === 'create') await phaseCreate();
        else if (phase === 'play') await phasePlay(segment);
        else if (phase === 'persist') await phasePersist();
        else throw new Error(`Unknown phase "${phase}"`);
        console.log(`\nPhase ${phase} ${segment} complete.`);
        process.exit(0);
    } catch (err) {
        console.error('Playtest phase failed:', err);
        saveNotes(`error_${phase}_${segment || 'x'}`);
        process.exit(1);
    }
})();
