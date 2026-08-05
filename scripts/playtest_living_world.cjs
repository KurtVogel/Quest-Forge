/**
 * Living-world live playtest (DECISIONS.md 2026-08-05 + ×2): a single 34-turn
 * scripted session against a LOCAL production build, aimed at the new systems:
 *
 *   - epistemics: a secret confessed to one NPC (knownBy capture) + a later
 *     stranger probe that must NOT surface it
 *   - witnessed deeds: a public accusation + a town fight → traveling rumor
 *     (session.regionalHearsay on later arrivals)
 *   - absence drift: leave home for 25+ turns, return → pendingAbsenceDrift →
 *     background install → WHILE YOU WERE AWAY surfaced in fiction
 *   - regional front seeding: travel into a named new region →
 *     pendingRegionalFronts → INSTALL_REGIONAL_FRONTS
 *   - front-resolution ceremony is unit-tested; not expected in 34 turns.
 *
 *   node scripts/playtest_living_world.cjs            # full run (~20-30 min)
 *
 * GEMINI_API_KEY is read from .env and injected into localStorage; never printed.
 * Server: expects the production build served at QUEST_FORGE_TEST_URL
 * (default http://localhost:4173/?debugState=1 — `npm run preview`).
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
} catch { /* fall through */ }
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || localApiKey;
if (!GEMINI_API_KEY) {
    console.error('No GEMINI_API_KEY available (env or .env). Aborting.');
    process.exit(1);
}

const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:4173/?debugState=1';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve('test-results/living_world');
const PROFILE_DIR = path.join(OUT_DIR, 'profile');

fs.mkdirSync(OUT_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
const notes = [];
function note(kind, message, extra = {}) {
    const entry = { t: new Date().toISOString(), kind, message, ...extra };
    notes.push(entry);
    console.log(`[${kind}] ${message}`);
}
function saveNotes() {
    fs.writeFileSync(path.join(OUT_DIR, 'log_living_world.json'), JSON.stringify(notes, null, 2));
}
async function shot(page, name) {
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) }).catch(() => {});
}

/** Living-world snapshot from the ?debugState=1 hook. */
async function lwState(page) {
    return await page.evaluate(() => {
        const s = window.__QF_STATE__;
        if (!s) return null;
        return {
            location: s.currentLocation,
            msgCount: (s.messages || []).length,
            hp: s.character?.currentHP, level: s.character?.level, exp: s.character?.exp,
            fronts: (s.fronts || []).map(f => ({ id: f.id, title: f.title, clock: f.clock, status: f.status })),
            locations: (s.locations || []).map(l => ({
                name: l.name, type: l.type, region: l.region || null,
                lastVisitedMessage: l.lastVisitedMessage ?? null,
                theaters: (l.theaterFrontIds || []).length,
            })),
            pendingAbsenceDrift: s.session?.pendingAbsenceDrift || null,
            absenceDrift: s.session?.absenceDrift
                ? {
                    locationName: s.session.absenceDrift.locationName,
                    developments: (s.session.absenceDrift.developments || []).map(d => d.name),
                    fact: s.session.absenceDrift.fact || '',
                    symptom: !!s.session.absenceDrift.frontSymptom,
                }
                : null,
            pendingRegionalFronts: s.session?.pendingRegionalFronts || null,
            seededRegions: s.session?.seededRegions || [],
            regionalHearsay: s.session?.regionalHearsay
                ? {
                    locationName: s.session.regionalHearsay.locationName,
                    items: (s.session.regionalHearsay.items || []).map(i => `${i.grade}: ${i.text.slice(0, 90)}`),
                }
                : null,
            recentHearsay: s.recentHearsay || [],
            secretCards: (s.storyMemory || [])
                .filter(m => Array.isArray(m.knownBy) && m.knownBy.length > 0)
                .map(m => ({ text: m.text.slice(0, 90), knownBy: m.knownBy })),
            witnessedCards: (s.storyMemory || [])
                .filter(m => m.witnessed)
                .map(m => ({ text: m.text.slice(0, 90), salience: m.salience, firstSeenMessage: m.firstSeenMessage ?? null })),
            secretFacts: (s.worldFacts || [])
                .filter(f => Array.isArray(f.knownBy) && f.knownBy.length > 0)
                .map(f => ({ fact: f.fact.slice(0, 90), knownBy: f.knownBy })),
            combat: s.combat?.active ? { phase: s.combat.phase, enemies: (s.combat.enemies || []).map(e => ({ n: e.name, hp: e.hp, cond: e.condition })) } : null,
            pendingCheck: s.pendingRoleplayCheck ? { rolls: (s.pendingRoleplayCheck.rolls || []).map(r => `${r.skill || r.type} DC ${r.dc}`) } : null,
            npcs: (s.npcs || []).length,
            storyMemory: (s.storyMemory || []).length,
            worldFacts: (s.worldFacts || []).length,
        };
    }).catch(() => null);
}

async function lastDmText(page, max = 600) {
    return await page.evaluate((maxLen) => {
        const msgs = Array.from(document.querySelectorAll('.chat-message.assistant .message-text'));
        const last = msgs[msgs.length - 1];
        return last ? last.textContent.trim().slice(0, maxLen) : '';
    }, max).catch(() => '');
}

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
            note('retry', `Narration retry visible — clicking (attempt ${retriesUsed}).`);
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

async function handleProposal(page) {
    for (let i = 0; i < 4; i++) {
        const state = await lwState(page);
        if (!state?.pendingCheck) return;
        note('proposal', `Check proposed: ${state.pendingCheck.rolls.join('; ')} — rolling.`);
        await clickByText(page, '.roleplay-check-panel button', 'Roll');
        await waitForIdle(page);
    }
}

async function resolveCombat(page, maxIters = 14) {
    for (let i = 0; i < maxIters; i++) {
        const s = await lwState(page);
        if (!s?.combat) return i;
        if (s.combat.phase === 'awaiting_player') {
            const target = s.combat.enemies.find(e => (e.hp ?? 0) > 0 && e.cond !== 'dead');
            if (!target) {
                const ended = await clickByText(page, 'button', 'End Combat');
                note('combat', ended ? 'Clicked End Combat.' : 'No living enemies, no button; waiting.');
                await waitForIdle(page);
                continue;
            }
            note('combat', `Attacking ${target.n} (hp ${target.hp}).`);
            await typeAndSend(page, `I attack the ${target.n} with my longsword.`);
            await waitForIdle(page);
        } else {
            await waitForIdle(page);
        }
    }
    note('warn', 'Combat did not resolve within budget.');
    return maxIters;
}

let turnNo = 0;
async function turn(page, action, checkLabel = null) {
    turnNo++;
    const label = `t${String(turnNo).padStart(2, '0')}`;
    note('action', `${label}: "${action}"`);
    const startedAt = Date.now();
    await typeAndSend(page, action);
    await waitForIdle(page);
    await handleProposal(page);
    if ((await lwState(page))?.combat) await resolveCombat(page);
    await delay(1500);
    const s = await lwState(page);
    const dm = await lastDmText(page);
    note('round', `${label} done in ${Math.round((Date.now() - startedAt) / 1000)}s`, {
        dm: dm.slice(0, 400),
        location: s?.location, msgCount: s?.msgCount, hp: s?.hp, level: s?.level,
        secretCards: s?.secretCards, witnessedCards: s?.witnessedCards?.length,
        regionalHearsay: s?.regionalHearsay, pendingAbsenceDrift: !!s?.pendingAbsenceDrift,
        absenceDrift: s?.absenceDrift, pendingRegionalFronts: !!s?.pendingRegionalFronts,
        seededRegions: s?.seededRegions, frontCount: s?.fronts?.length,
    });
    if (checkLabel) {
        note('checkpoint', `--- ${checkLabel} ---`, { state: s });
        await shot(page, `${label}_${checkLabel.replace(/\W+/g, '_').slice(0, 40)}`);
    }
    saveNotes();
    return { state: s, dm };
}

/** Poll for a background install (drift / regional fronts) without playing a turn. */
async function pollFor(page, label, predicate, { timeout = 120000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const s = await lwState(page);
        if (s && predicate(s)) {
            note('checkpoint', `${label}: landed after ${Math.round((Date.now() - start) / 1000)}s.`, { state: s });
            return s;
        }
        await delay(4000);
    }
    note('warn', `${label}: did not land within ${Math.round(timeout / 1000)}s.`);
    return null;
}

// ---------------------------------------------------------------------------

async function main() {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
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
        const text = msg.text();
        if (msg.type() === 'error' || msg.type() === 'pageerror') {
            note('console', `error: ${text.slice(0, 300)}`);
        } else if (/\[(LivingWorld|Fronts|Scribe)\]/.test(text)) {
            note('console', text.slice(0, 300));
        }
    });
    page.on('pageerror', err => note('pageerror', String(err).slice(0, 300)));
    await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(2500);

    await page.evaluate(({ apiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: 'gemini',
            apiKey,
            imageApiKey: '',
            model: 'gemini-3.1-pro-preview',
        }));
    }, { apiKey: GEMINI_API_KEY });
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2500);

    // --- Character creation ------------------------------------------------
    note('nav', 'Creating hero.');
    await page.waitForSelector('.new-btn');
    await page.click('.new-btn');
    await delay(1200);
    await page.click('.creation-card'); // Forge a New Hero
    await delay(1000);
    await page.waitForSelector('.creation-input');
    await page.type('.creation-input', 'Kalden Vor');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await clickByText(page, '.creation-card', 'Human');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await clickByText(page, '.creation-card', 'Fighter');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    await page.waitForSelector('.stat-row');
    for (let i = 0; i < 6; i++) {
        await page.evaluate((index) => {
            document.querySelectorAll('.stat-row')[index]?.querySelector('.stat-choice')?.click();
        }, i);
        await delay(250);
    }
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);
    for (let step = 0; step < 4; step++) {
        const stepInfo = await page.evaluate(() => ({
            skillCards: document.querySelectorAll('.skill-choice-card').length,
            creationCards: document.querySelectorAll('.creation-card').length,
            premise: !!document.querySelector('textarea.creation-premise'),
        }));
        if (stepInfo.premise) break;
        if (stepInfo.skillCards > 0) {
            for (const skill of ['Athletics', 'Intimidation']) {
                await clickByText(page, '.skill-choice-card', skill);
                await delay(250);
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
    await page.waitForSelector('textarea.creation-premise');
    const premise = 'Kalden Vor, a human fighter and former caravan guard, arrives in the river town of Brackwater, in the lowland region known as the Vale of Reeds. Brackwater has a market square, the Gilded Eel tavern kept by the innkeeper Marta Weck, and warehouses along the docks. The merchant Odo Ferrin owes Kalden 40 gold for a season of guard work, by signed letter. Far to the north, past the hills, lies a cold upland region called the Rimefell Marches, which Kalden has never visited. Kalden begins at the door of the Gilded Eel at dusk, in chain mail, longsword at his hip.';
    await page.evaluate((text) => {
        const ta = document.querySelector('textarea.creation-premise');
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, premise);
    await delay(400);
    // Advance through remaining steps (adventure name / confirm) to Begin.
    for (let i = 0; i < 4; i++) {
        const began = await page.evaluate(() => !!document.querySelector('textarea.chat-input'));
        if (began) break;
        await page.click('.char-creation-actions .btn-primary').catch(() => {});
        await delay(1500);
        await clickByText(page, 'button', 'Begin Adventure').catch(() => {});
        await delay(2000);
    }
    await page.waitForSelector('textarea.chat-input', { timeout: 60000 });
    note('nav', 'In game; waiting for premise opening scene.');
    await waitForIdle(page);
    await shot(page, '00_opening');
    saveNotes();

    // --- Act 1: home ground (Brackwater) -----------------------------------
    await turn(page, 'I step inside the Gilded Eel, nod to Marta Weck behind the bar, and order a mug of the cheap ale while I look over the evening crowd.');
    await turn(page,
        'I lean close to Marta at the quiet end of the bar, make certain no one can overhear, and confess to her in a low voice: years ago I deserted the Baron\'s army at Redford, and "Kalden Vor" is not the name I was born with. I need one person here to know who I really am.',
        'secret_confessed');
    await turn(page,
        'I climb onto a bench in the middle of the crowded common room, hold up Odo Ferrin\'s signed letter of debt, and loudly accuse him before everyone: "Odo Ferrin owes me forty gold for a season of honest guard work, and every soul in Brackwater should know he does not pay his debts!"',
        'public_accusation');
    await turn(page, 'I ask around the common room about the missing shipments the dockhands keep muttering about.');
    await turn(page, 'The next morning I check the warehouse cellars by the docks for signs of the smugglers everyone suspects.');
    const afterHome = await turn(page, 'If anything hostile lurks in the cellars, I face it with my longsword; otherwise I search the cellar thoroughly for evidence.', 'home_deeds_done');
    note('audit', `Home act complete: secretCards=${JSON.stringify(afterHome.state?.secretCards)}, witnessed=${afterHome.state?.witnessedCards}`);

    // --- Act 2: away — Netsholm and the road -------------------------------
    await turn(page, 'I settle my tab, shoulder my pack, and set out along the river road south toward the fishing village of Netsholm, a full day\'s walk downstream.', 'departed_brackwater');
    await turn(page, 'On the road I keep a soldier\'s pace and note anything unusual about the traffic and the river.');
    await turn(page, 'I arrive in Netsholm at dusk and head for whatever passes for an inn, listening to what the locals are talking about.', 'arrived_netsholm');
    await turn(page, 'I introduce myself around the inn and ask if anyone has work for a sword-hand.');
    await turn(page, 'I take whatever honest job was offered and set about it.');
    await turn(page, 'I continue the work and see it through to the end.');
    await turn(page, 'I collect my pay, thank them, and ask the innkeeper what they know of the lands further north, beyond the hills.');

    // --- Act 3: the new region ---------------------------------------------
    await turn(page,
        'I resupply and begin the long trek north: days of travel up out of the lowlands, through the hills, into the cold upland country — the region the locals call the Rimefell Marches.',
        'traveling_north');
    await turn(page, 'I push on through the high country until I reach the first settlement of the Rimefell Marches, and I take a good look at the place as I walk in.', 'arrived_rimefell');
    await turn(page, 'I find shelter for the night and ask the people here what life in the Rimefell Marches is like — who holds power, what they fear, how they get by.');
    const regionCheck = await lwState(page);
    note('audit', `Region state after Rimefell arrival: regions=${JSON.stringify((regionCheck?.locations || []).map(l => `${l.name}:${l.region}`))}, pendingRegional=${!!regionCheck?.pendingRegionalFronts}, seeded=${JSON.stringify(regionCheck?.seededRegions)}`);
    if (regionCheck?.pendingRegionalFronts) {
        await pollFor(page, 'Regional fronts install', s => (s.seededRegions || []).length > 0, { timeout: 150000 });
    }
    await turn(page, 'I spend the next day getting to know the settlement: the market, the well, the shrine, the people worth knowing.');
    await turn(page, 'I look for a few days of paid work here — guard duty, hauling, anything that needs a strong back or a sword.');
    await turn(page, 'I do the work well and keep my ears open.');
    await turn(page, 'In the evening I share a table with the locals and trade stories of the road.');
    await turn(page, 'I ask if anyone here has ever traveled south to the Vale of Reeds, and what news reaches them from there.');
    await turn(page, 'I finish my obligations here and prepare for the long road home.');

    // --- Act 4: the return -------------------------------------------------
    await turn(page, 'I begin the long journey back south, day after day, out of the Rimefell Marches and down through the hills toward the Vale of Reeds.', 'traveling_home');
    const ret = await turn(page, 'At last I walk back into Brackwater and head straight for the Gilded Eel.', 'returned_brackwater');
    note('audit', `Return state: pendingAbsenceDrift=${JSON.stringify(ret.state?.pendingAbsenceDrift)}, hearsay=${JSON.stringify(ret.state?.regionalHearsay)}`);
    if (ret.state?.pendingAbsenceDrift) {
        await pollFor(page, 'Absence drift install', s => !!s.absenceDrift, { timeout: 150000 });
    }
    await turn(page, 'I take a seat at the bar and ask Marta what has changed in Brackwater while I was away.', 'asked_whats_changed');
    await turn(page, 'I walk the market square and the docks, looking for everything that is different from the town I left.');

    // --- Act 5: the epistemics probe ---------------------------------------
    const probe = await turn(page,
        'I strike up a conversation with a dockhand I have never met before and ask him plainly: "What do folk in this town say about me, Kalden Vor?"',
        'stranger_probe');
    const leak = /desert|redford|false name|born with|real name/i.test(probe.dm || '');
    note(leak ? 'FAIL' : 'PASS', `Secret-leak probe: stranger's answer ${leak ? 'REFERENCED the confessed secret' : 'did not reference the secret'}.`, { dm: probe.dm });
    await turn(page, 'I finish my drink and ask Marta, quietly, whether she has kept what I told her to herself.', 'confidant_check');

    // --- Final report -------------------------------------------------------
    const finalState = await lwState(page);
    note('report', 'FINAL LIVING-WORLD STATE', { state: finalState });
    const verdicts = {
        secretCaptured: (finalState?.secretCards?.length || 0) + (finalState?.secretFacts?.length || 0) > 0,
        witnessedCaptured: (finalState?.witnessedCards?.length || 0) > 0,
        regionsRecorded: (finalState?.locations || []).some(l => l.region),
        regionalSeedingTriggered: (finalState?.seededRegions?.length || 0) > 0 || !!finalState?.pendingRegionalFronts,
        hearsayOfferedAnywhere: (finalState?.recentHearsay?.length || 0) > 0,
        absenceDriftTriggered: !!finalState?.absenceDrift || !!finalState?.pendingAbsenceDrift,
        visitStampsPresent: (finalState?.locations || []).some(l => Number.isFinite(l.lastVisitedMessage)),
        frontCount: finalState?.fronts?.length || 0,
    };
    note('report', `VERDICTS: ${JSON.stringify(verdicts, null, 2)}`);
    await shot(page, '99_final');
    saveNotes();
    await browser.close();
}

main().catch(err => {
    note('fatal', String(err && err.stack || err));
    saveNotes();
    process.exit(1);
});
