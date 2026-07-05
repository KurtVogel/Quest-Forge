/**
 * Roleplay-check proposal flow playtest (2026-07-05 setup-preservation fixes).
 *
 * Drives a conversation-heavy campaign against the LOCAL dev server and exercises
 * every proposal option — Roll, Challenge (withdraw + uphold), Change approach —
 * while logging, for each turn:
 *   - what streamed BEFORE the proposal appeared (longest streaming peek)
 *   - what is visible DURING the proposal (card contents + hidden-message state)
 *   - what is visible AFTER resolution (outcome narration / revealed setup)
 *   - whether an overruled / set-aside check is re-proposed on a same-objective retry
 *
 *   node scripts/playtest_roleplay_checks.cjs
 *
 * Requires the Vite dev server on http://localhost:5173 and GEMINI_API_KEY in .env.
 * Output: test-results/roleplay_checks/ (screenshots + log.json + SUMMARY printed).
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

const APP_URL = process.env.QUEST_FORGE_TEST_URL || 'http://localhost:5173/?debugState=1';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve('test-results/roleplay_checks');
const PROFILE_DIR = path.join(OUT_DIR, 'profile');

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const delay = ms => new Promise(r => setTimeout(r, ms));
const notes = [];
const findings = [];
function note(kind, message, extra = {}) {
    const entry = { t: new Date().toISOString(), kind, message, ...extra };
    notes.push(entry);
    const extraStr = Object.keys(extra).length ? ` ${JSON.stringify(extra).slice(0, 900)}` : '';
    console.log(`[${kind}] ${message}${extraStr}`);
}
function finding(ok, label, detail = '') {
    findings.push({ ok, label, detail });
    note(ok ? 'PASS' : 'FAIL', `${label}${detail ? ` — ${detail}` : ''}`);
}
function saveNotes() {
    fs.writeFileSync(path.join(OUT_DIR, 'log.json'), JSON.stringify({ notes, findings }, null, 2));
}
let shotIdx = 0;
async function shot(page, name) {
    shotIdx++;
    await page.screenshot({ path: path.join(OUT_DIR, `${String(shotIdx).padStart(2, '0')}_${name}.png`) }).catch(() => {});
}

// --- state probes -----------------------------------------------------------

async function fullState(page) {
    return await page.evaluate(() => {
        const s = window.__QF_STATE__;
        if (!s) return null;
        return {
            msgs: (s.messages || []).map(m => ({
                id: m.id || null,
                role: m.role,
                hidden: !!m.hidden,
                revealedSetup: !!m.revealedSetup,
                content: (m.content || '').slice(0, 400),
                len: (m.content || '').length,
            })),
            rulings: (s.recentRulings || []).map(r => ({
                objective: r.objective, outcome: r.outcome, finalRuling: !!r.finalRuling,
            })),
            pending: s.pendingRoleplayCheck ? {
                id: s.pendingRoleplayCheck.id,
                challengeUsed: s.pendingRoleplayCheck.challengeUsed,
                preNarrated: s.pendingRoleplayCheck.preNarrated,
                setupMessageId: s.pendingRoleplayCheck.setupMessageId || null,
                setupNarrativeLen: (s.pendingRoleplayCheck.setupNarrative || '').length,
                setupNarrative: (s.pendingRoleplayCheck.setupNarrative || '').slice(0, 400),
                rolls: (s.pendingRoleplayCheck.rolls || []).map(r => ({
                    skill: r.skill, dc: r.dc, description: r.description,
                    advantage: !!r.advantage, disadvantage: !!r.disadvantage,
                })),
            } : null,
        };
    }).catch(() => null);
}

async function visibleAssistantTexts(page, take = 3) {
    return await page.evaluate((n) => {
        return Array.from(document.querySelectorAll('.chat-message.assistant:not(.streaming) .message-text'))
            .slice(-n).map(el => el.textContent.trim().slice(0, 400));
    }, take).catch(() => []);
}

async function proposalCardText(page) {
    return await page.evaluate(() => {
        const panel = document.querySelector('.roleplay-check-panel');
        return panel ? panel.innerText.replace(/\s+/g, ' ').trim().slice(0, 700) : '';
    }).catch(() => '');
}

/** Wait for idle while sampling the streaming bubble; returns the longest peek. */
async function waitForIdleWithPeek(page, { timeout = 240000 } = {}) {
    const start = Date.now();
    let calm = 0;
    let peek = '';
    while (Date.now() - start < timeout) {
        const status = await page.evaluate(() => {
            const streamEl = document.querySelector('.chat-message.streaming .message-text');
            const streaming = streamEl && !streamEl.classList.contains('typing-indicator')
                ? streamEl.textContent.trim() : '';
            const loading = !!document.querySelector('.chat-stop-btn') || !!document.querySelector('.typing-indicator');
            return { streaming, loading };
        }).catch(() => ({ streaming: '', loading: true }));
        if (status.streaming.length > peek.length) peek = status.streaming;
        if (!status.loading) {
            calm++;
            if (calm >= 2) return peek;
        } else {
            calm = 0;
        }
        await delay(700);
    }
    note('warn', `waitForIdleWithPeek timed out after ${Math.round((Date.now() - start) / 1000)}s.`);
    return peek;
}

async function clickByText(page, selector, text) {
    return await page.evaluate(({ selector, text }) => {
        const el = Array.from(document.querySelectorAll(selector)).find(e => e.textContent.includes(text));
        if (el) { el.click(); return true; }
        return false;
    }, { selector, text });
}

/** Fill a React-controlled textarea via the native prototype setter so the value
 *  tracker registers a change and onChange/onInput actually fire. */
async function fillReactTextarea(page, selector, text) {
    return await page.evaluate(({ selector, text }) => {
        const ta = document.querySelector(selector);
        if (!ta) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, text);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }, { selector, text });
}

async function typeAndSend(page, text) {
    const filled = await fillReactTextarea(page, 'textarea.chat-input', text);
    if (!filled) note('warn', 'Chat input not found.');
    await delay(400);
    const sent = await clickByText(page, 'button.chat-send-btn', 'Send');
    if (!sent) note('warn', 'Send button not found/clickable.');
    return sent;
}

// --- crude fiction-overlap metric -------------------------------------------

/** Fraction of distinctive setup tokens (5+ chars, deduped) that reappear in the outcome. */
function fictionOverlap(setupText, outcomeText) {
    const tokens = [...new Set((setupText.toLowerCase().match(/[a-z]{5,}/g) || []))]
        .filter(t => !['their', 'there', 'about', 'which', 'would', 'could', 'should', 'through',
            'against', 'before', 'after', 'where', 'while', 'still', 'again', 'every',
            'first', 'toward', 'towards', 'beneath', 'across', 'around'].includes(t));
    if (tokens.length === 0) return { ratio: 1, tokens: 0 };
    const outcome = outcomeText.toLowerCase();
    const hits = tokens.filter(t => outcome.includes(t)).length;
    return { ratio: hits / tokens.length, tokens: tokens.length, hits };
}

// --- turn engine --------------------------------------------------------------

const seenProposalSignatures = [];
function proposalSignature(pending) {
    return (pending?.rolls || []).map(r => `${(r.skill || '?').toLowerCase()}|dc${r.dc}|${(r.description || '').toLowerCase().slice(0, 60)}`).join(';');
}

/**
 * Send one player action, observe stream → proposal → resolution.
 * mode: 'roll' | 'challenge' | 'change' | 'challenge-then-change' | 'none'
 * Returns { proposed, pendingBefore, outcomeTexts, withdrawn, upheld }
 */
async function playTurn(page, turnNo, action, mode, { challengeText = '', reproposalProbe = null } = {}) {
    note('turn', `--- TURN ${turnNo} [want: ${mode}] "${action.slice(0, 110)}"`);
    const before = await fullState(page);
    const msgCountBefore = before?.msgs.length ?? 0;

    await typeAndSend(page, action);
    const streamPeek = await waitForIdleWithPeek(page);
    await delay(1200);

    const during = await fullState(page);
    const newMsgs = (during?.msgs || []).slice(msgCountBefore);
    const hiddenNew = newMsgs.filter(m => m.role === 'assistant' && m.hidden);
    const visibleNewAssistant = newMsgs.filter(m => m.role === 'assistant' && !m.hidden);
    note('observe', `Streamed peek (${streamPeek.length} chars): "${streamPeek.slice(0, 260)}"`);
    note('observe', `New messages after parse: ${newMsgs.map(m => `${m.role}${m.hidden ? '[HIDDEN]' : ''}(${m.len})`).join(', ') || '(none)'}`);

    const pending = during?.pending || null;
    if (pending) {
        const card = await proposalCardText(page);
        note('proposal', `Proposed: ${JSON.stringify(pending.rolls)}`, {
            challengeUsed: pending.challengeUsed,
            preNarrated: pending.preNarrated,
            setupMessageId: pending.setupMessageId,
            setupNarrativeLen: pending.setupNarrativeLen,
        });
        note('proposal', `Card shows: ${card.slice(0, 400)}`);
        await shot(page, `t${turnNo}_proposal`);

        // Was the streamed setup withheld (vanished) or kept visible?
        if (hiddenNew.length > 0) {
            note('observe', `Setup WITHHELD as designed: hidden assistant msg (${hiddenNew[0].len} chars) "${hiddenNew[0].content.slice(0, 180)}"`);
            finding(pending.setupNarrativeLen > 0, `T${turnNo}: withheld setup rides the proposal (setupNarrative present)`,
                `setupNarrativeLen=${pending.setupNarrativeLen}, setupMessageId=${pending.setupMessageId}`);
        } else if (visibleNewAssistant.length > 0) {
            note('observe', `Setup narration KEPT VISIBLE (prose-detected path): "${visibleNewAssistant[0].content.slice(0, 180)}"`);
            finding(true, `T${turnNo}: prose-detected check kept its narration visible`);
        }

        // Re-proposal probe: compare against a remembered overruled/set-aside signature.
        if (reproposalProbe) {
            const sig = proposalSignature(pending);
            const same = sig === reproposalProbe.signature;
            const sameSkillDc = pending.rolls.some(r => reproposalProbe.rolls.some(pr =>
                (pr.skill || '').toLowerCase() === (r.skill || '').toLowerCase() && pr.dc === r.dc));
            note('reproposal', same
                ? `IDENTICAL proposal returned after ${reproposalProbe.how}.`
                : sameSkillDc
                    ? `SIMILAR proposal (same skill+DC, different wording) returned after ${reproposalProbe.how}.`
                    : `Different proposal after ${reproposalProbe.how}.`,
                { probe: reproposalProbe.signature, now: sig });
        }
        seenProposalSignatures.push({ turn: turnNo, signature: proposalSignature(pending), rolls: pending.rolls });
    } else {
        note('proposal', 'No check proposed this turn.');
        if (reproposalProbe) {
            note('reproposal', `NO check re-proposed after ${reproposalProbe.how} (DM resolved without dice).`);
        }
        await shot(page, `t${turnNo}_noproposal`);
        return { proposed: false, pending: null, streamPeek };
    }

    // --- resolve per requested mode ---
    let result = { proposed: true, pending, streamPeek, withdrawn: false, upheld: false };

    if (mode === 'roll') {
        await resolveByRoll(page, turnNo, pending);
    } else if (mode === 'change') {
        await resolveByChange(page, turnNo, pending);
    } else if (mode === 'challenge' || mode === 'challenge-then-change') {
        await clickByText(page, '.roleplay-check-panel button', 'Challenge ruling');
        await delay(600);
        const filled = await fillReactTextarea(page, '.roleplay-check-panel textarea', challengeText);
        if (!filled) note('warn', 'Challenge textarea not found — challenge cannot be sent.');
        await delay(300);
        await shot(page, `t${turnNo}_challenge_typed`);
        await clickByText(page, '.roleplay-check-panel button', 'Send challenge');
        const challengePeek = await waitForIdleWithPeek(page);
        await delay(1200);

        const after = await fullState(page);
        // Harness sanity: the challenge only really fired if the app appended the
        // "**Roll challenge:**" user message. Without it, any pending proposal we see
        // is just the untouched original — do not misreport it as an upheld ruling.
        const challengeSent = (after?.msgs || []).slice(-8)
            .some(m => m.role === 'user' && m.content.startsWith('**Roll challenge:**'));
        finding(challengeSent, `T${turnNo}: harness delivered the challenge to the app`);
        if (!challengeSent) {
            note('warn', 'Challenge never reached the app — skipping ruling assertions, rolling the untouched proposal.');
            await resolveByRoll(page, turnNo, pending);
            return { proposed: true, pending, streamPeek, withdrawn: false, upheld: false };
        }
        if (after?.pending) {
            result.upheld = true;
            const finalChip = await page.evaluate(() => !!document.querySelector('.roleplay-check-final'));
            note('challenge', `Ruling UPHELD/REVISED: ${JSON.stringify(after.pending.rolls)} (finalChip=${finalChip})`);
            finding(after.pending.challengeUsed && finalChip, `T${turnNo}: upheld ruling is marked final`,
                `challengeUsed=${after.pending.challengeUsed}`);
            finding(after.pending.setupNarrativeLen === pending.setupNarrativeLen && after.pending.setupMessageId === pending.setupMessageId,
                `T${turnNo}: original setup carried forward through the challenge`,
                `before=${pending.setupNarrativeLen}/${pending.setupMessageId} after=${after.pending.setupNarrativeLen}/${after.pending.setupMessageId}`);
            await shot(page, `t${turnNo}_upheld`);
            if (mode === 'challenge-then-change') {
                await resolveByChange(page, turnNo, after.pending);
            } else {
                await resolveByRoll(page, turnNo, after.pending);
            }
        } else {
            result.withdrawn = true;
            const texts = await visibleAssistantTexts(page, 1);
            note('challenge', `Ruling WITHDRAWN — DM narrated without dice: "${(texts[0] || challengePeek).slice(0, 220)}"`);
            finding(true, `T${turnNo}: challenge produced a withdrawal (no dice)`);
            const recorded = (after?.rulings || []).some(r => r.outcome === 'withdrawn');
            finding(recorded, `T${turnNo}: withdrawal recorded in recentRulings ledger`,
                JSON.stringify(after?.rulings || []));
            await shot(page, `t${turnNo}_withdrawn`);
        }
    }
    return result;
}

async function resolveByRoll(page, turnNo, pending) {
    await clickByText(page, '.roleplay-check-panel button', 'Roll');
    await waitForIdleWithPeek(page);
    await delay(1200);
    // Accept chained follow-up proposals (max 3).
    for (let i = 0; i < 3; i++) {
        const st = await fullState(page);
        if (!st?.pending) break;
        note('proposal', `Follow-up check staged: ${JSON.stringify(st.pending.rolls)} — rolling.`,
            { setupNarrativeLen: st.pending.setupNarrativeLen });
        await clickByText(page, '.roleplay-check-panel button', 'Roll');
        await waitForIdleWithPeek(page);
        await delay(1200);
    }
    const texts = await visibleAssistantTexts(page, 1);
    const outcome = texts[0] || '';
    note('outcome', `Post-roll outcome narration: "${outcome.slice(0, 300)}"`);
    if (pending.setupNarrativeLen > 0 && outcome) {
        const ov = fictionOverlap(pending.setupNarrative, outcome);
        finding(ov.ratio >= 0.15, `T${turnNo}: outcome re-establishes withheld setup fiction`,
            `token overlap ${ov.hits}/${ov.tokens} (${Math.round(ov.ratio * 100)}%)`);
    }
    await shot(page, `t${turnNo}_after_roll`);
}

async function resolveByChange(page, turnNo, pending) {
    const beforeMsgs = (await fullState(page))?.msgs || [];
    await clickByText(page, '.roleplay-check-panel button', 'Change approach');
    await delay(1800);
    const st = await fullState(page);
    const sysLine = [...(st?.msgs || [])].reverse().find(m => m.role === 'system');
    const revealed = (st?.msgs || []).find(m => m.id && m.id === pending.setupMessageId);
    const domNote = await page.evaluate(() => {
        const el = document.querySelector('.message-setup-note');
        return el ? el.textContent.trim() : '';
    });
    note('change', `System line: "${sysLine?.content?.slice(0, 160)}"`);
    if (pending.setupMessageId && !pending.preNarrated) {
        finding(!!revealed && !revealed.hidden && revealed.revealedSetup,
            `T${turnNo}: Change approach REVEALED the withheld setup`,
            revealed ? `hidden=${revealed.hidden}, revealedSetup=${revealed.revealedSetup}, "${revealed.content.slice(0, 120)}"` : 'setup message not found');
        finding(!!domNote, `T${turnNo}: revealed message shows the marker note`, `"${domNote}"`);
        finding((sysLine?.content || '').includes('scene above stands'),
            `T${turnNo}: system line acknowledges the revealed scene`);
    } else {
        const hiddenStill = (st?.msgs || []).find(m => m.id === pending.setupMessageId);
        note('change', pending.preNarrated
            ? `Setup pre-narrated an outcome — correctly NOT revealed (hidden=${hiddenStill ? hiddenStill.hidden : 'n/a'}).`
            : 'No setupMessageId on proposal (visible prose-detected setup) — classic set-aside line expected.');
    }
    const grew = ((st?.msgs || []).length > beforeMsgs.length);
    if (!grew) note('warn', 'No system line appended after Change approach?');
    const recorded = (st?.rulings || []).some(r => r.outcome === 'set_aside');
    finding(recorded, `T${turnNo}: set-aside recorded in recentRulings ledger`,
        JSON.stringify(st?.rulings || []));
    await shot(page, `t${turnNo}_after_change`);
}

// --- character creation -------------------------------------------------------

async function createCharacter(page) {
    note('nav', 'Injecting settings (playtest DM prompt biased toward frequent check proposals).');
    await page.evaluate(({ apiKey }) => {
        localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: 'gemini',
            apiKey,
            imageApiKey: '',
            model: 'gemini-3.1-pro-preview',
            customSystemPrompt: [
                '*** PLAY TEST SCENARIO *** narration roll proposal-heavy.',
                'This session tests the out-of-combat check proposal system. Lean strongly toward',
                'proposing a requested_rolls check (with complete public adjudication fields:',
                'reason, opposition, failure_stakes, difficulty_reason) whenever the player\'s',
                'action has ANY plausible uncertainty, especially social, conversational, and',
                'investigative actions. Precede each check with 1-2 paragraphs of vivid scene',
                'narration that introduces at least one NEW concrete detail (a name, an object,',
                'a sound, an arrival). Keep the tone grounded low-fantasy. This playtest is',
                'STRICTLY NON-VIOLENT: never start combat (no combat_start, no combat_exchange,',
                'no brawls, nobody draws a weapon); every conflict stays verbal and social.',
            ].join(' '),
        }));
    }, { apiKey: GEMINI_API_KEY });
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2500);

    await page.waitForSelector('.new-btn', { timeout: 30000 });
    await page.click('.new-btn');
    await delay(1200);
    await page.click('.creation-card'); // Forge a New Hero
    await delay(1000);

    await page.waitForSelector('.creation-input');
    await page.type('.creation-input', 'Kalden Vor');
    await page.click('.char-creation-actions .btn-primary');
    await delay(1000);

    await page.waitForSelector('.creation-card');
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
    const premise = '*** PLAY TEST SCENARIO *** narration roll proposal-heavy. '
        + 'Kalden Vor, a human fighter and former caravan guard, arrives in the river town of Brackwater '
        + 'carrying a signed letter of debt: the merchant Odo Ferrin owes him 40 gold for a season of guard work. '
        + 'Brackwater is conversation-rich: the Gilded Eel tavern run by keeper Maren, dockhands who mutter about '
        + 'missing shipments, a guard captain named Hesk who controls warehouse access, and Odo Ferrin himself, '
        + 'slippery and evasive. Most scenes should be social: negotiation, persuasion, gossip, bargaining. '
        + 'The Gilded Eel enforces a strict peace-bond: nobody ever draws steel or throws a punch here — '
        + 'every conflict stays verbal. '
        + 'Kalden begins at the bar of the Gilded Eel at dusk.';
    await page.type('textarea.creation-premise', premise);
    await page.click('.char-creation-actions .btn-primary');
    note('nav', 'Begin Adventure — waiting for the opening scene.');
    await waitForIdleWithPeek(page, { timeout: 300000 });
    await delay(2500);
    await shot(page, 'opening_scene');
    const opening = await visibleAssistantTexts(page, 1);
    note('opening', (opening[0] || '').slice(0, 400));
}

// --- main -----------------------------------------------------------------------

(async () => {
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
        if (msg.type() === 'error') note('console', `error: ${msg.text().slice(0, 300)}`);
    });
    page.on('pageerror', err => note('pageerror', String(err).slice(0, 300)));

    const plan = process.argv[2] || 'full';
    try {
        await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await delay(2000);
        await createCharacter(page);

        if (plan === 'focus') {
            await runFocusPlan(page);
        } else {
            await runFullPlan(page);
        }

        await shot(page, 'final_state');
        const final = await fullState(page);
        note('state', `Final: ${final?.msgs.length} messages, ${final?.msgs.filter(m => m.hidden).length} hidden, ${final?.msgs.filter(m => m.revealedSetup).length} revealed setups.`);

        console.log('\n================ SUMMARY ================');
        for (const f of findings) console.log(`${f.ok ? 'PASS' : 'FAIL'}  ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
        const reproposals = notes.filter(n => n.kind === 'reproposal');
        console.log('\n--- Re-proposal probes (known IDEAS.md gap, informational) ---');
        for (const r of reproposals) console.log(`  ${r.message}`);
        console.log(`\nFindings: ${findings.filter(f => f.ok).length}/${findings.length} passed. Full log: ${path.join(OUT_DIR, 'log.json')}`);
    } catch (err) {
        note('fatal', String(err && err.stack || err).slice(0, 1200));
        await shot(page, 'fatal');
        process.exitCode = 1;
    } finally {
        saveNotes();
        await browser.close().catch(() => {});
    }
})();

/** Challenge + Change-approach focused pass (non-violent scenario, ~6 turns). */
async function runFocusPlan(page) {
    // F1: first proposal → CHANGE APPROACH. Core reveal test.
    const f1 = await playTurn(page, 1,
        'I quietly ask Maren what she knows about Odo Ferrin\'s debts and where he sleeps tonight.',
        'change');

    // F2: identical objective → does the set-aside check come back? Roll it.
    const probe1 = f1.proposed ? {
        signature: seenProposalSignatures.at(-1).signature,
        rolls: seenProposalSignatures.at(-1).rolls,
        how: 'Change approach (set aside)',
    } : null;
    await playTurn(page, 2,
        'I lean back in and ask Maren again about Odo Ferrin — where exactly can I find him tonight?',
        'roll', { reproposalProbe: probe1 });

    // F3: friendly gossip → CHALLENGE with strong fictional grounds (withdrawal-likely).
    const f3 = await playTurn(page, 3,
        'I buy the quiet dockhand at the end of the bar a fresh ale and casually ask what he has heard about the missing shipments.',
        'challenge', {
            challengeText: 'I bought him a drink and he is relaxed and friendly. There is no active opposition or meaningful pressure — routine friendly gossip should not need dice, or at minimum deserves an easy DC with advantage for the free ale.',
        });

    // F4: same objective after the ruling → re-proposal probe, then roll.
    const probe3 = f3.proposed ? {
        signature: seenProposalSignatures.at(-1).signature,
        rolls: seenProposalSignatures.at(-1).rolls,
        how: f3.withdrawn ? 'a successful overrule (withdrawn)' : 'an upheld/revised ruling',
    } : null;
    await playTurn(page, 4,
        'I keep talking with the same dockhand, pressing gently for the names of the crews that unload boats after midnight.',
        'roll', { reproposalProbe: probe3 });

    // F5: paid-information ask → WEAK challenge (uphold-likely), then CHANGE APPROACH on the
    // final ruling — reveal must still work with the carried-forward setup id.
    await playTurn(page, 5,
        'I slide two silver across the bar to Maren and ask her to point out anyone in the room who works the docks after midnight.',
        'challenge-then-change', {
            challengeText: 'I do not want to risk a roll on this. My hero is charming and should simply succeed.',
        });

    // F6: same objective after the set-aside final ruling → probe, then roll.
    const probe5 = seenProposalSignatures.length > 0 ? {
        signature: seenProposalSignatures.at(-1).signature,
        rolls: seenProposalSignatures.at(-1).rolls,
        how: 'Change approach on an upheld final ruling',
    } : null;
    await playTurn(page, 6,
        'I ask Maren once more, coin still on the bar, to point out the midnight dock workers.',
        'roll', { reproposalProbe: probe5 });
}

async function runFullPlan(page) {
        // T1: social ask → ROLL. Baseline: withheld setup → outcome must re-establish it.
        await playTurn(page, 1,
            'I settle at the bar, order an ale, and ask Maren what she knows about Odo Ferrin — where he drinks, who he owes, and whether he is in town tonight.',
            'roll');

        // T2: friendly pressure → CHALLENGE hoping for withdrawal.
        const t2 = await playTurn(page, 2,
            'I sit beside a dockhand nursing his ale, buy him a fresh one, and gently ask what he has heard about the missing shipments.',
            'challenge', {
                challengeText: 'I bought him a drink and he is friendly and half-drunk. There is no active opposition or pressure here — routine friendly gossip should not need dice. If anything, the free ale should grant automatic success or advantage.',
            });

        // T3: probe — same objective as T2 after the ruling. Does the same check come back?
        const probe2 = t2.proposed ? {
            signature: seenProposalSignatures.at(-1).signature,
            rolls: seenProposalSignatures.at(-1).rolls,
            how: t2.withdrawn ? 'a successful overrule (withdrawn)' : 'an upheld ruling that was rolled',
        } : null;
        await playTurn(page, 3,
            'I keep chatting with the same dockhand about those missing shipments, pressing for names of who unloads boats after midnight.',
            'roll', { reproposalProbe: probe2 });

        // T4: confront Odo → CHANGE APPROACH. Core reveal test.
        const t4 = await playTurn(page, 4,
            'I find Odo Ferrin at his corner table, lay the signed letter of debt in front of him, and demand the 40 gold he owes me for the caravan season.',
            'change');

        // T5: probe — identical demand after set-aside. IDEAS.md gap: expect re-proposal.
        const probe4 = t4.proposed ? {
            signature: seenProposalSignatures.at(-1).signature,
            rolls: seenProposalSignatures.at(-1).rolls,
            how: 'Change approach (set aside)',
        } : null;
        await playTurn(page, 5,
            'I press Odo again about the 40 gold debt, tapping the signed letter on the table.',
            'roll', { reproposalProbe: probe4 });

        // T6: ask captain Hesk for access → CHALLENGE with strong fictional grounds.
        const t6 = await playTurn(page, 6,
            'I find guard captain Hesk, introduce myself as a professional caravan guard, and ask permission to look over the warehouse ledgers tomorrow, offering to help with the smuggler problem in exchange.',
            'challenge', {
                challengeText: 'I am offering the captain free professional help with a problem he demonstrably has. That is leverage, not opposition — a reasonable captain hears me out. This should succeed without dice, or at worst be an easy DC with advantage.',
            });

        // T7: probe re-proposal after T6 ruling; resolve with ROLL.
        const probe6 = t6.proposed ? {
            signature: seenProposalSignatures.at(-1).signature,
            rolls: seenProposalSignatures.at(-1).rolls,
            how: t6.withdrawn ? 'a successful overrule (withdrawn)' : 'an upheld ruling',
        } : null;
        await playTurn(page, 7,
            'I follow up with captain Hesk about actually getting in front of those warehouse ledgers.',
            'roll', { reproposalProbe: probe6 });

        // T8: bribe the keeper → CHALLENGE, and if UPHELD, CHANGE APPROACH on the final
        // ruling (reveal must still work with the carried-forward setup id).
        await playTurn(page, 8,
            'I slide two silver across the bar to Maren and quietly ask her to point out anyone who unloads boats after midnight.',
            'challenge-then-change', {
                challengeText: 'Maren already trusts me from our earlier talk and I am paying her fairly for harmless information. Where is the active opposition? This should not need a roll.',
            });

        // T9: plain conversational color → whatever comes, ROLL. Also watches for
        // prose-detected checks (narration should stay visible if the DM asks in prose).
        await playTurn(page, 9,
            'I trade a story from my caravan days with the room, watching who reacts to the mention of night shipments.',
            'roll');

        // T10: bargaining beat → ROLL, final consistency pass.
        await playTurn(page, 10,
            'I return to Odo and offer him a deal: half the debt now, half when I recover his missing shipment crates.',
            'roll');
}
