/**
 * Quest Forge played headless, in Node, through the app's own turn pipeline.
 *
 * Nothing here re-implements the game. A reducer-backed store stands in for
 * React's, `createTurnRunner` is the app's (`src/llm/turnOrchestrator.js`),
 * the prompt builder, the adapter, the providers, the parser, the roll
 * arbiter, the dice and the combat engine are imported as they ship. What
 * this file adds is the part `ChatPanel.jsx` does around the runner (posting
 * the player's row, routing the reply, the combat round's two effects) and
 * the measuring:
 *
 * - a `fetch` recorder that times every network call, reads the provider's
 *   own token usage off a copy of the response, and can set the thinking /
 *   reasoning field on the DM stream's request body. That one field is how a
 *   setting is tried with no change under `src/`.
 * - a timed `streamMessage` handed to the runner, so every DM call has a
 *   request start, a first text chunk and an end, measured the way the app's
 *   own `[LLM timing]` log measures them.
 *
 * `installNodeShim()` (./nodeShim.mjs) must have run before this module is
 * imported.
 */
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import path from 'node:path';
import { gameReducer, initialGameState } from '../../src/state/gameReducer.js';
import { CURRENT_SAVE_VERSION } from '../../src/state/migrations.js';
import { createTurnRunner } from '../../src/llm/turnOrchestrator.js';
import { sendMessage, streamMessage } from '../../src/llm/adapter.js';
import { createCharacter, createStartingInventory } from '../../src/engine/characterUtils.js';
import { buildPremiseFromStarter, findPremiseStarter } from '../../src/data/premiseStarters.js';
import { normalizeCampaignPremise } from '../../src/config/contentLimits.js';
import { COMBAT_PHASES } from '../../src/engine/combatPredicates.js';
import { planCombatExchange, planOpeningExchange } from '../../src/engine/combatExchange.js';
import { describeFightCost, describeFightResonance } from '../../src/engine/fightTally.js';
import { combatNarrationPrompt } from '../../src/llm/combatNarration.js';
import { buildCastNarrationPrompt } from '../../src/llm/engineNarration.js';
import { reconcileDeclaredSpells } from '../../src/engine/declaredSpells.js';
import { needsSpellCastNarration, routeTurnEvents, TURN_ROUTES } from '../../src/components/Chat/eventRouting.js';
import { buildCampaignOpeningPrompt } from '../../src/components/Chat/sessionPriming.js';
import { generateCampaignFronts, shouldGenerateCampaignFronts } from '../../src/llm/frontDirector.js';
import { addMemories, factMemoryItem, factMemoryText, journalMemoryItem, npcMemoryItem, sceneMemoryItem, seedMemories, storyCardMemoryItem } from '../../src/engine/vectorMemory.js';
import { liveWorldFacts } from '../../src/engine/worldFacts.js';
import { isRecordEntry } from '../../src/engine/journalEntry.js';
import { getMachineryGeminiKey } from '../../src/llm/machinery.js';
import { turnFlags } from '../../src/llm/turnFlags.js';
import { isTableTalkMessage } from '../../src/llm/tableTalk.js';
import { CHECK, FIGHT, HERO, SCRIPT_VERSION, SESSION_ID, STARTER_ID, TURNS } from './script.mjs';

const now = () => performance.now();
const round = (ms) => (Number.isFinite(ms) ? Math.round(ms) : null);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Keys and cells
// ---------------------------------------------------------------------------

/**
 * Keys from the environment or the git-ignored `.env` in the repo root, like
 * every other eval. An explicit environment variable wins. The values are
 * returned to the caller and never printed or written anywhere.
 */
export function loadKeys(repoRoot) {
    try {
        const envText = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
        for (const line of envText.split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* no .env: explicit environment variables only */ }
    return { gemini: process.env.GEMINI_API_KEY || '', openai: process.env.OPENAI_API_KEY || '' };
}

/** Replace any key value in a string, for everything this harness writes or prints. */
export function scrubKeys(text, keys) {
    let out = String(text ?? '');
    for (const value of Object.values(keys || {})) {
        if (typeof value === 'string' && value.length >= 8) out = out.replaceAll(value, '[key]');
    }
    return out;
}

/**
 * What each setting name puts on the wire. `default` leaves the request as
 * the app built it, so it measures the app as it ships (the app sets its own
 * level per model, modelCatalog `dmThinking`). `unset` removes the field, so
 * the provider's own default governs: the baseline the app's level is
 * measured against. Any other name replaces whatever the app set. Gemini's
 * field is `generationConfig.thinkingConfig` (`thinkingLevel`, or the older
 * `thinkingBudget`); OpenAI's is the top-level `reasoning_effort` on Chat
 * Completions.
 */
const UNSET = Object.freeze({ unset: true });
export const WIRE_SETTINGS = Object.freeze({
    gemini: Object.freeze({
        default: null,
        unset: UNSET,
        minimal: { thinkingLevel: 'minimal' },
        low: { thinkingLevel: 'low' },
        medium: { thinkingLevel: 'medium' },
        high: { thinkingLevel: 'high' },
        budget0: { thinkingBudget: 0 },
    }),
    openai: Object.freeze({
        default: null,
        unset: UNSET,
        none: { reasoning_effort: 'none' },
        low: { reasoning_effort: 'low' },
        medium: { reasoning_effort: 'medium' },
        high: { reasoning_effort: 'high' },
    }),
});

/** "gemini:gemini-3.8-flash:low" -> a cell. */
export function parseCell(spec) {
    const [provider, model, setting = 'default'] = String(spec || '').trim().split(':');
    if (!WIRE_SETTINGS[provider]) throw new Error(`Unknown provider in cell "${spec}" (gemini or openai; never the Grok DM).`);
    if (!model) throw new Error(`No model in cell "${spec}".`);
    if (!(setting in WIRE_SETTINGS[provider])) throw new Error(`Unknown ${provider} setting "${setting}" in cell "${spec}" (${Object.keys(WIRE_SETTINGS[provider]).join(', ')}).`);
    return { spec: `${provider}:${model}:${setting}`, provider, model, setting, id: `${model}--${setting}`.replace(/[^a-z0-9.-]+/gi, '_') };
}

export function settingsForCell(cell, keys) {
    return {
        ...initialGameState.settings,
        llmProvider: cell.provider,
        apiKey: cell.provider === 'gemini' ? keys.gemini : keys.openai,
        geminiApiKey: keys.gemini,
        model: cell.model,
    };
}

// ---------------------------------------------------------------------------
// The fetch recorder
// ---------------------------------------------------------------------------

function classifyRequest(url, body) {
    if (url.includes('generativelanguage.googleapis.com')) {
        const model = (url.match(/\/models\/([^:/?]+)/) || [])[1] || '';
        if (url.includes(':streamGenerateContent')) return { provider: 'gemini', kind: 'dm-stream', model };
        if (url.includes(':generateContent')) return { provider: 'gemini', kind: 'generate', model };
        if (url.includes('EmbedContent')) {
            const first = body?.requests?.[0]?.content?.parts?.[0]?.text || '';
            return { provider: 'gemini', kind: first.startsWith('task: search result | query:') ? 'embed-query' : 'embed-doc', model, texts: body?.requests?.length ?? 1 };
        }
        return { provider: 'gemini', kind: 'other', model };
    }
    if (url.includes('api.openai.com')) {
        if (url.includes('/chat/completions')) return { provider: 'openai', kind: body?.stream ? 'dm-stream' : 'generate', model: body?.model || '' };
        return { provider: 'openai', kind: 'other', model: '' };
    }
    return { provider: 'other', kind: 'other', model: '' };
}

/** The provider's own usage numbers in one shape. `thinkTokens` is thinking / reasoning; `answerTokens` is the visible reply. */
function normalizeUsage(provider, raw) {
    if (!raw || typeof raw !== 'object') return null;
    const num = (value) => (Number.isFinite(value) ? value : 0);
    if (provider === 'gemini') {
        return {
            promptTokens: num(raw.promptTokenCount),
            cachedTokens: num(raw.cachedContentTokenCount),
            thinkTokens: num(raw.thoughtsTokenCount),
            answerTokens: num(raw.candidatesTokenCount),
        };
    }
    const think = num(raw.completion_tokens_details?.reasoning_tokens);
    return {
        promptTokens: num(raw.prompt_tokens),
        cachedTokens: num(raw.prompt_tokens_details?.cached_tokens),
        cacheWriteTokens: num(raw.prompt_tokens_details?.cache_write_tokens),
        thinkTokens: think,
        answerTokens: Math.max(0, num(raw.completion_tokens) - think),
    };
}

function usageFromBody(provider, kind, text) {
    const field = provider === 'gemini' ? 'usageMetadata' : 'usage';
    try {
        if (kind === 'dm-stream') {
            let last = null;
            for (const line of text.split(/\r?\n/)) {
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]' || !payload.includes(`"${field}"`)) continue;
                try {
                    const parsed = JSON.parse(payload);
                    if (parsed?.[field]) last = parsed[field];
                } catch { /* a partial line: skip */ }
            }
            return normalizeUsage(provider, last);
        }
        return normalizeUsage(provider, JSON.parse(text)?.[field]);
    } catch {
        return null;
    }
}

function errorFromBody(text) {
    try {
        const parsed = JSON.parse(text);
        return String(parsed?.error?.message || text).slice(0, 240);
    } catch {
        return String(text || '').slice(0, 240);
    }
}

/**
 * Wrap `globalThis.fetch` once. Every call is logged with its kind, model,
 * status and four times (sent, headers, first body byte, end). The response
 * the app reads is untouched; usage is read off `response.clone()`.
 *
 * `setDmThinking(wire)` sets the thinking / reasoning field on DM stream
 * bodies from then on (null sends the body as the app built it).
 */
export function createFetchRecorder({ keys = {} } = {}) {
    const realFetch = globalThis.fetch.bind(globalThis);
    const log = [];
    let inFlight = 0;
    let lastActivity = now();
    let dmThinking = null;
    let fatal = null;

    globalThis.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : (input?.url || String(input));
        let body = null;
        if (typeof init?.body === 'string') {
            try { body = JSON.parse(init.body); } catch { body = null; }
        }
        const info = classifyRequest(url, body);
        let sentThinking = null;
        if (body && info.kind === 'dm-stream') {
            if (info.provider === 'gemini') {
                if (dmThinking?.unset) delete body.generationConfig?.thinkingConfig;
                else if (dmThinking) body.generationConfig = { ...(body.generationConfig || {}), thinkingConfig: dmThinking };
                sentThinking = body.generationConfig?.thinkingConfig ?? null;
            } else if (info.provider === 'openai') {
                if (dmThinking?.unset) delete body.reasoning_effort;
                else if (dmThinking) Object.assign(body, dmThinking);
                sentThinking = body.reasoning_effort ? { reasoning_effort: body.reasoning_effort } : null;
            }
            if (dmThinking) init = { ...init, body: JSON.stringify(body) };
        } else if (body && info.kind === 'generate' && info.provider === 'gemini') {
            sentThinking = body.generationConfig?.thinkingConfig ?? null;
        }
        const entry = {
            ...info,
            startedAt: now(), headersAt: null, firstByteAt: null, endedAt: null,
            status: null, sentThinking, usage: null, error: null,
            requestChars: typeof init?.body === 'string' ? init.body.length : null,
        };
        let settle;
        entry.done = new Promise((resolve) => { settle = resolve; });
        log.push(entry);
        inFlight += 1;
        lastActivity = entry.startedAt;
        const finish = () => {
            entry.endedAt = now();
            inFlight -= 1;
            lastActivity = entry.endedAt;
            settle();
        };
        try {
            const response = await realFetch(input, init);
            entry.status = response.status;
            entry.headersAt = now();
            // A depleted prepay (402) or a refused key ends the run: every later number would be void.
            if ([401, 402, 403].includes(response.status) && info.kind !== 'other') {
                fatal = fatal || `${info.provider} answered HTTP ${response.status} on a ${info.kind} call`;
            }
            let copy = null;
            try { copy = response.clone(); } catch { copy = null; }
            if (!copy?.body) {
                finish();
                return response;
            }
            const keepText = info.kind === 'dm-stream' || info.kind === 'generate' || !response.ok;
            (async () => {
                const reader = copy.body.getReader();
                const decoder = new TextDecoder();
                let text = '';
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (entry.firstByteAt === null) entry.firstByteAt = now();
                    if (keepText) text += decoder.decode(value, { stream: true });
                }
                if (!response.ok) entry.error = scrubKeys(errorFromBody(text), keys);
                else if (keepText) entry.usage = usageFromBody(info.provider, info.kind, text);
            })().catch(() => {}).finally(finish);
            return response;
        } catch (error) {
            entry.error = scrubKeys(String(error?.message || error).slice(0, 240), keys);
            finish();
            throw error;
        }
    };

    return {
        log,
        setDmThinking(wire) { dmThinking = wire || null; },
        get fatal() { return fatal; },
        /** Resolve once no call is in flight and none has started for `quietMs`. */
        async idle(quietMs = 2000, maxMs = 120000) {
            const startedAt = now();
            for (;;) {
                if (inFlight === 0 && now() - lastActivity >= quietMs) return true;
                if (now() - startedAt > maxMs) return false;
                await sleep(100);
            }
        },
        restore() { globalThis.fetch = realFetch; },
    };
}

/** A log entry as plain numbers relative to `origin`. */
function describeFetch(entry, origin) {
    return {
        kind: entry.kind,
        model: entry.model,
        status: entry.status,
        startMs: round(entry.startedAt - origin),
        headersMs: entry.headersAt === null ? null : round(entry.headersAt - entry.startedAt),
        firstByteMs: entry.firstByteAt === null ? null : round(entry.firstByteAt - entry.startedAt),
        totalMs: entry.endedAt === null ? null : round(entry.endedAt - entry.startedAt),
        ...(entry.sentThinking ? { sentThinking: entry.sentThinking } : {}),
        ...(entry.usage ? { usage: entry.usage } : {}),
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.texts ? { texts: entry.texts } : {}),
    };
}

// ---------------------------------------------------------------------------
// The headless game: a store, the app's runner, a timed DM stream
// ---------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {object} options.state - the full game state to start from
 * @param {ReturnType<typeof createFetchRecorder>} options.recorder
 */
export function createHeadlessGame({ state, recorder }) {
    let current = state;
    const getState = () => current;
    const dispatch = (action) => { current = gameReducer(current, action); };
    const dmCalls = [];
    const scripted = [];
    const game = { getState, dispatch, dmCalls, scripted, tag: 'plain', firstVisibleAt: null, runner: null };

    const timedStream = async (options) => {
        const call = {
            tag: game.tag,
            startedAt: now(), firstChunkAt: null, endedAt: null,
            promptChars: (options.systemPrompt || '').length,
            prefixChars: (options.systemPromptParts?.prefix || '').length,
            historyRows: (options.messageHistory || []).length,
            fetchFrom: recorder.log.length,
            raw: '', error: null, scripted: false, fetches: [],
        };
        dmCalls.push(call);
        const onChunk = (chunk) => {
            if (call.firstChunkAt === null) call.firstChunkAt = now();
            options.onChunk?.(chunk);
        };
        try {
            let text;
            if (scripted.length > 0) {
                call.scripted = true;
                text = scripted.shift();
                onChunk(text);
            } else {
                text = await streamMessage({ ...options, onChunk });
            }
            call.endedAt = now();
            call.raw = text;
            return text;
        } catch (error) {
            call.endedAt = now();
            call.error = String(error?.message || error).slice(0, 300);
            throw error;
        } finally {
            call.fetches = recorder.log.slice(call.fetchFrom).filter(entry => entry.kind === 'dm-stream');
        }
    };

    game.runner = createTurnRunner({
        getState,
        dispatch,
        streamMessage: timedStream,
        sendMessage,
        // What the player can actually read: the runner hands the display text
        // (cut at the event block; nothing on a JSON-only lane).
        onStreamChunkText: (text) => {
            if (text && game.firstVisibleAt === null) game.firstVisibleAt = now();
        },
    });
    return game;
}

/** One DM call as numbers, measured like the app's `[LLM timing]` line (retries before the first byte are inside it). */
async function describeDmCall(call, origin) {
    await Promise.all(call.fetches.map(entry => Promise.race([entry.done, sleep(3000)])));
    const last = call.fetches[call.fetches.length - 1] || null;
    const refused = call.fetches.filter(entry => entry.status !== null && entry.status !== 200).map(entry => entry.status);
    return {
        tag: call.tag,
        startMs: round(call.startedAt - origin),
        ttftMs: call.firstChunkAt === null ? null : round(call.firstChunkAt - call.startedAt),
        totalMs: round(call.endedAt - call.startedAt),
        attempts: call.fetches.length,
        refused,
        // The last attempt alone: when a refusal was retried, this is the clean call's own time.
        cleanTtftMs: last && call.firstChunkAt !== null ? round(call.firstChunkAt - last.startedAt) : null,
        cleanTotalMs: last && last.endedAt !== null ? round(last.endedAt - last.startedAt) : null,
        headersMs: last && last.headersAt !== null ? round(last.headersAt - last.startedAt) : null,
        firstByteMs: last && last.firstByteAt !== null ? round(last.firstByteAt - last.startedAt) : null,
        usage: last?.usage || null,
        sentThinking: last?.sentThinking ?? null,
        promptChars: call.promptChars,
        prefixChars: call.prefixChars,
        historyRows: call.historyRows,
        replyChars: (call.raw || '').length,
        ...(call.scripted ? { scripted: true } : {}),
        ...(call.error ? { error: call.error } : {}),
    };
}

// ---------------------------------------------------------------------------
// What ChatPanel does around the runner
// ---------------------------------------------------------------------------

function commitCombatPlan(game, plan) {
    if (!plan?.ok) {
        game.dispatch({ type: 'REJECT_COMBAT_EXCHANGE', payload: { reason: plan?.error } });
        return false;
    }
    game.dispatch({ type: 'APPLY_COMBAT_EXCHANGE', payload: plan.payload });
    return true;
}

function commitPlannedExchange(game, plan) {
    try {
        return commitCombatPlan(game, plan());
    } catch (error) {
        game.dispatch({ type: 'REJECT_COMBAT_EXCHANGE', payload: { reason: `The engine could not resolve this exchange (${String(error?.message || error).slice(0, 160)}).` } });
        return false;
    }
}

/**
 * `submitPlayerMessage` of ChatPanel.jsx, without the React state: post the
 * player's row, embed it, run the turn on its lane, route the reply.
 * `extract` runs the background Scribe pass and the journal cadence as the
 * app does after an ordinary turn (recording); a measured turn leaves them
 * off, because the player does not wait on them.
 */
export async function submitPlayerMessage(game, text, { extract = false } = {}) {
    const trimmed = String(text || '').trim();
    const tableTalkTurn = isTableTalkMessage(trimmed);
    const entry = game.getState();
    const startedCombatIntent = !tableTalkTurn && !!entry.combat?.active && entry.combat.phase === COMBAT_PHASES.AWAITING_PLAYER;
    if (startedCombatIntent) game.dispatch({ type: 'BEGIN_COMBAT_INTENT' });

    const playerMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const playerMessageIndex = (game.getState().messages || []).length;
    const locationAtSend = game.getState().currentLocation;
    game.dispatch({ type: 'ADD_MESSAGE', payload: { id: playerMessageId, role: 'user', content: trimmed } });
    const machineryKey = getMachineryGeminiKey(game.getState().settings);
    if (machineryKey && !tableTalkTurn) {
        addMemories(machineryKey, [sceneMemoryItem(trimmed, { category: 'player', location: locationAtSend, sourceMessage: playerMessageId, atMessage: playerMessageIndex })]).catch(() => {});
    }

    let dmNarrative = '';
    let planCommitted = null;
    let correction = null;
    try {
        const events = await game.runner.sendToLLM(trimmed, trimmed, {
            lane: startedCombatIntent ? 'combatIntent' : (tableTalkTurn ? 'tableTalk' : 'standard'),
            onNarrative: (narrative) => { dmNarrative = narrative; },
        });
        const combatStartedNow = !!events?.combatStart;
        const routed = routeTurnEvents(events);
        if (routed.route === TURN_ROUTES.COMBAT_REJECTED || routed.route === TURN_ROUTES.IN_COMBAT_ROLLS_REJECTED) {
            game.dispatch({ type: 'REJECT_COMBAT_EXCHANGE', payload: { reason: routed.reason } });
            planCommitted = false;
        } else if (routed.route === TURN_ROUTES.COMBAT_EXCHANGE) {
            const reconciled = reconcileDeclaredSpells(trimmed, events.combatExchange, game.getState().character);
            for (const note of reconciled.notes) game.dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', content: note } });
            planCommitted = commitCombatPlan(game, planCombatExchange(game.getState(), reconciled.exchange));
        } else if (routed.route === TURN_ROUTES.ROLL_PROPOSAL) {
            game.runner.stageRoleplayCheck(events.requestedRolls, trimmed, { events, narrative: dmNarrative, loot: routed.proposalLoot });
        } else if (routed.route === TURN_ROUTES.ATTACK_AS_CHECK) {
            correction = await game.runner.sendRollCorrection({ attackAsCheck: true, playerAction: trimmed, setupLocation: turnFlags(events).setupLocation || null });
        } else if (routed.route === TURN_ROUTES.AUTHORITY_CORRECTION) {
            correction = await game.runner.sendRollCorrection({ setupLocation: turnFlags(events).setupLocation || null });
        }
        if (startedCombatIntent && !routed.combatIntentHandled) game.dispatch({ type: 'CANCEL_COMBAT_INTENT' });

        if (needsSpellCastNarration(events, { dmNarrative, combatIntentHandled: routed.combatIntentHandled, combatActive: !!turnFlags(events).combatWasActive })) {
            await game.runner.sendToLLM(buildCastNarrationPrompt(events.spellCasts), null, { lane: 'narration' });
        }

        const waitsForResolution = !!events?.combatExchange
            || combatStartedNow
            || !!events?.requestedRolls?.length
            || correction?.route === 'staged'
            || correction?.route === 'combat';
        let extracted = false;
        if (extract && !waitsForResolution && !tableTalkTurn) extracted = game.runner.runPostTurnExtraction(trimmed, { auditCasts: true });
        if (extract && !waitsForResolution) game.runner.runAutoSummarize();
        return { events, routed, correction, dmNarrative, combatStartedNow, waitsForResolution, planCommitted, playerMessageId, locationAtSend, extracted };
    } catch (error) {
        if (startedCombatIntent) game.dispatch({ type: 'CANCEL_COMBAT_INTENT' });
        throw error;
    }
}

/** ChatPanel's combat-narration effect for the exchange the engine just committed. */
async function narrateCommittedExchange(game) {
    const state = game.getState();
    const result = state.combat?.lastExchangeResult;
    const narrationPrompt = combatNarrationPrompt(result, {
        cost: describeFightCost(state.combat.fightTally, state),
        resonance: describeFightResonance(state, result),
    });
    let narrative = '';
    await game.runner.sendToLLM(narrationPrompt, null, { lane: 'combatNarration', onNarrative: (text) => { narrative = text; } });
    game.dispatch({ type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: result.exchangeId } });
    return { narrative, terminal: result.terminal || 'ongoing', kind: result.kind };
}

/**
 * ChatPanel's three combat effects, run until the fight waits on the player:
 * Opening Initiative, a queued exchange, the narration of whatever the engine
 * just committed.
 */
export async function settleCombat(game, { maxSteps = 8 } = {}) {
    const narrations = [];
    for (let step = 0; step < maxSteps; step += 1) {
        const state = game.getState();
        if (!state.combat?.active) break;
        if (state.combat.phase === COMBAT_PHASES.OPENING) {
            if (!commitPlannedExchange(game, () => planOpeningExchange(game.getState()))) break;
        } else if (state.combat.phase === COMBAT_PHASES.AWAITING_PLAYER && state.combat.queuedExchange) {
            if (!commitPlannedExchange(game, () => planCombatExchange(game.getState(), game.getState().combat.queuedExchange))) break;
        } else if (state.combat.phase === COMBAT_PHASES.AWAITING_NARRATION && state.combat.lastExchangeResult?.exchangeId) {
            narrations.push(await narrateCommittedExchange(game));
        } else {
            break;
        }
    }
    return narrations;
}

// ---------------------------------------------------------------------------
// Fixture: the saved states every run replays from
// ---------------------------------------------------------------------------

/** The campaign as a save holds it: never settings (keys), the signed-in user or UI state. */
function serializeForFixture(state) {
    const { settings: _settings, user: _user, ui: _ui, ...persisted } = state;
    return JSON.parse(JSON.stringify(persisted));
}

export function restoreState(snapshot, settings) {
    return {
        ...initialGameState,
        ...JSON.parse(JSON.stringify(snapshot)),
        settings,
        user: initialGameState.user,
        ui: initialGameState.ui,
    };
}

/**
 * Twenty-two snapshots of one campaign share almost everything, so the file
 * stores each distinct value once: every top-level key of a snapshot, and
 * every message, is an index into `pool`.
 */
function packSnapshots(snapshots) {
    const pool = [];
    const index = new Map();
    const intern = (value) => {
        const json = JSON.stringify(value);
        if (!index.has(json)) {
            index.set(json, pool.length);
            pool.push(value);
        }
        return index.get(json);
    };
    const packed = {};
    for (const [name, snapshot] of Object.entries(snapshots)) {
        const refs = {};
        for (const [key, value] of Object.entries(snapshot)) {
            refs[key] = key === 'messages' && Array.isArray(value) ? { rows: value.map(intern) } : intern(value);
        }
        packed[name] = refs;
    }
    return { pool, packed };
}

function unpackSnapshot(pool, refs) {
    const snapshot = {};
    for (const [key, ref] of Object.entries(refs)) {
        snapshot[key] = ref && typeof ref === 'object' ? ref.rows.map(i => pool[i]) : pool[ref];
    }
    return snapshot;
}

export function writeFixture(file, { meta, snapshots, rowLocations, transcript }, keys) {
    const { pool, packed } = packSnapshots(snapshots);
    // One pool entry per line, so a re-recording diffs by line.
    const text = [
        '{',
        `"meta": ${JSON.stringify(meta)},`,
        `"transcript": ${JSON.stringify(transcript, null, 1)},`,
        `"rowLocations": ${JSON.stringify(rowLocations)},`,
        `"snapshots": ${JSON.stringify(packed)},`,
        '"pool": [',
        pool.map(value => JSON.stringify(value)).join(',\n'),
        ']',
        '}',
        '',
    ].join('\n');
    for (const value of Object.values(keys || {})) {
        if (typeof value === 'string' && value.length >= 8 && text.includes(value)) throw new Error('Refusing to write the fixture: it contains an API key.');
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

export function readFixture(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const snapshots = {};
    for (const [name, refs] of Object.entries(raw.snapshots)) snapshots[name] = unpackSnapshot(raw.pool, refs);
    if (raw.meta?.saveVersion !== CURRENT_SAVE_VERSION) {
        console.warn(`[latency] The fixture was recorded at save version ${raw.meta?.saveVersion}; the app is at ${CURRENT_SAVE_VERSION}. Record it again (npm run eval:latency -- record) before comparing numbers.`);
    }
    if (raw.meta?.scriptVersion !== SCRIPT_VERSION) {
        console.warn(`[latency] The fixture was recorded from script version ${raw.meta?.scriptVersion}; the script is at ${SCRIPT_VERSION}. Record it again.`);
    }
    return { meta: raw.meta, transcript: raw.transcript, rowLocations: raw.rowLocations || {}, snapshots };
}

/**
 * The retrieval store as this device would hold it on Continue: the mount
 * seed of ChatPanel.jsx (facts, journal, people, story cards), then the
 * per-turn rows real play cached as it went (the player's lines and the final
 * narrations). Without it the store is empty and the turn skips the query
 * embed the player normally waits on.
 */
export async function seedVectorStore(state, rowLocations = {}) {
    const machineryKey = getMachineryGeminiKey(state.settings);
    if (!machineryKey) return;
    const rosterNames = (state.npcs || []).map(npc => npc?.name).filter(Boolean);
    const items = [
        ...liveWorldFacts(state.worldFacts).map(fact => factMemoryItem(fact)),
        ...(state.journal || []).filter(isRecordEntry).map(entry => journalMemoryItem(entry, rosterNames)),
        ...(state.npcs || []).map(npcMemoryItem).filter(Boolean),
        ...(state.storyMemory || []).filter(card => (card.status || 'active') === 'active').map(storyCardMemoryItem),
    ];
    await seedMemories(machineryKey, items, state.session?.id || null, {
        retiredTexts: new Set((state.worldFacts || []).filter(fact => fact && (fact.supersededBy || Number.isFinite(fact.retractedAtMessage))).map(factMemoryText)),
        transcriptIds: new Set((state.messages || []).map(message => message?.id).filter(id => typeof id === 'string' && id)),
    });
    const rows = [];
    (state.messages || []).forEach((message, index) => {
        if (!message || typeof message.id !== 'string' || !(message.id in rowLocations)) return;
        if (message.hidden || typeof message.content !== 'string' || !message.content.trim()) return;
        rows.push(sceneMemoryItem(message.content, {
            category: message.role === 'user' ? 'player' : 'narrative',
            location: rowLocations[message.id] || null,
            sourceMessage: message.id,
            atMessage: index,
        }));
    });
    if (rows.length > 0) await addMemories(machineryKey, rows);
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

function newCampaignState(settings) {
    const starter = findPremiseStarter(STARTER_ID);
    if (!starter) throw new Error(`Unknown premise starter ${STARTER_ID}`);
    const premise = normalizeCampaignPremise(buildPremiseFromStarter(starter, HERO.name));
    const character = { ...createCharacter(HERO.name, HERO.race, HERO.class, HERO.abilityScores, HERO.skills, HERO.options), ...HERO.coins };
    // The same three dispatches CharacterCreation.jsx makes when the adventure begins.
    let state = { ...initialGameState, settings };
    state = gameReducer(state, { type: 'START_CHARACTER', payload: { character, inventory: createStartingInventory(HERO.class) } });
    state = gameReducer(state, {
        type: 'UPDATE_SESSION',
        payload: { id: SESSION_ID, name: `${HERO.name}'s Adventure`, premise, premiseStarterId: STARTER_ID, openingScenePending: true, createdAt: Date.now(), lastPlayedAt: Date.now() },
    });
    state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'system', content: `**Your tale begins.**\n\n${premise}` } });
    return state;
}

const lastVisibleAssistant = (state) => (state.messages || []).findLast(message => message?.role === 'assistant' && !message.hidden && typeof message.content === 'string' && message.content.trim());

/**
 * Play the script once on the shipped default (the app's own request, no
 * thinking field) and save the state before every turn. The Scribe, the
 * journal cadence and the opening front director run as they do in the app,
 * so the saved states carry the facts, people, cards and summaries a real
 * campaign has by turn 20.
 */
export async function recordFixture({ cell, keys, file, say = () => {} }) {
    const recorder = createFetchRecorder({ keys });
    const settings = settingsForCell(cell, keys);
    const game = createHeadlessGame({ state: newCampaignState(settings), recorder });
    const snapshots = {};
    const rowLocations = {};
    const transcript = [];
    const abortIfFatal = () => { if (recorder.fatal) throw new Error(`Recording stopped: ${recorder.fatal}.`); };

    await seedVectorStore(game.getState(), rowLocations);

    say('opening scene');
    game.tag = 'opening';
    await game.runner.sendToLLM(buildCampaignOpeningPrompt(), null, { lane: 'opening' });
    const opening = game.runner.getLastCommittedTurn();
    if (!opening?.content?.trim()) throw new Error('The opening scene did not commit.');
    game.dispatch({ type: 'UPDATE_SESSION', payload: { openingScenePending: false } });
    abortIfFatal();
    if (shouldGenerateCampaignFronts(game.getState())) {
        say('campaign fronts');
        try {
            const sessionId = game.getState().session.id;
            const fronts = await generateCampaignFronts(game.getState());
            game.dispatch({ type: 'INSTALL_GENERATED_FRONTS', payload: { sessionId, fronts } });
        } catch (error) {
            say(`front generation failed (${String(error?.message || error).slice(0, 80)}); the safety-net front stays`);
        }
    }
    await recorder.idle(3000);
    transcript.push({ turn: 0, player: null, dm: opening.content });

    for (let i = 0; i < TURNS.length; i += 1) {
        abortIfFatal();
        snapshots[`turn-${String(i + 1).padStart(2, '0')}`] = serializeForFixture(game.getState());
        const { line } = TURNS[i];
        game.tag = 'plain';
        const outcome = await submitPlayerMessage(game, line, { extract: true });
        rowLocations[outcome.playerMessageId] = outcome.locationAtSend || null;
        let checks = 0;
        // A proposed check is accepted, as a player would, so the story goes on.
        while (game.getState().pendingRoleplayCheck && checks < 3) {
            checks += 1;
            game.tag = 'check-outcome';
            await game.runner.acceptRoleplayCheck();
        }
        if (game.getState().pendingRoleplayCheck) game.runner.changeRoleplayApproach();
        if (game.getState().combat?.active) throw new Error(`Turn ${i + 1} started a fight; the ordinary script cannot go on. Record again.`);
        await recorder.idle(3000);
        const committed = game.runner.getLastCommittedTurn();
        if (committed?.id && !committed.hidden) rowLocations[committed.id] = game.getState().currentLocation || null;
        const reply = lastVisibleAssistant(game.getState());
        transcript.push({ turn: i + 1, player: line, dm: reply?.content || '', checks });
        say(`turn ${i + 1}/${TURNS.length}: ${(reply?.content || '').split(/\s+/).filter(Boolean).length} words${checks ? `, ${checks} check(s) accepted` : ''}; facts ${game.getState().worldFacts.length}, people ${game.getState().npcs.length}, cards ${game.getState().storyMemory.length}, journal ${game.getState().journal.length}`);
    }
    abortIfFatal();

    // The check turn and the fight both start from the state after turn 20.
    const afterScript = serializeForFixture(game.getState());
    snapshots.check = afterScript;

    say('fight start (scripted DM reply), opening exchange');
    const fight = createHeadlessGame({ state: restoreState(afterScript, settings), recorder });
    fight.tag = 'fight-start';
    fight.scripted.push(FIGHT.dmStart);
    const started = await submitPlayerMessage(fight, FIGHT.approachLine, { extract: false });
    if (!started.combatStartedNow || !fight.getState().combat?.active) throw new Error('The scripted fight did not start.');
    fight.tag = 'narration';
    await settleCombat(fight);
    const combat = fight.getState().combat;
    if (!combat?.active || combat.phase !== COMBAT_PHASES.AWAITING_PLAYER) throw new Error(`The fight did not reach the player's turn (phase ${combat?.phase}, active ${combat?.active}). Record again.`);
    if ((fight.getState().character?.currentHP || 0) <= 0) throw new Error('The hero fell in the opening exchange. Record again.');
    await recorder.idle(3000);
    snapshots.round = serializeForFixture(fight.getState());
    abortIfFatal();

    const finalState = game.getState();
    const meta = {
        recordedAt: new Date().toISOString(),
        scriptVersion: SCRIPT_VERSION,
        saveVersion: CURRENT_SAVE_VERSION,
        recordedWith: cell.spec,
        turns: TURNS.length,
        messages: finalState.messages.length,
        worldFacts: finalState.worldFacts.length,
        npcs: finalState.npcs.length,
        storyCards: finalState.storyMemory.length,
        journalEntries: finalState.journal.length,
        fight: { round: combat.round, heroHp: `${fight.getState().character.currentHP}/${fight.getState().character.maxHP}`, enemies: combat.enemies.map(enemy => `${enemy.name} ${enemy.hp}/${enemy.maxHp}`) },
    };
    writeFixture(file, { meta, snapshots, rowLocations, transcript }, keys);
    recorder.restore();
    return meta;
}

// ---------------------------------------------------------------------------
// Measured turns
// ---------------------------------------------------------------------------

/** Console lines the app prints on a problem (a refused stream, a skipped arbiter), kept with the turn they belong to. */
function captureWarnings() {
    const lines = [];
    const original = { warn: console.warn, error: console.error };
    const keep = (...args) => { lines.push(args.map(arg => (typeof arg === 'string' ? arg : (arg?.message || JSON.stringify(arg)))).join(' ').slice(0, 300)); };
    console.warn = keep;
    console.error = keep;
    return { lines, stop() { console.warn = original.warn; console.error = original.error; } };
}

/** Event channels a reply actually used, by name. */
function usedEventChannels(events) {
    if (!events || typeof events !== 'object') return [];
    const used = [];
    for (const [key, value] of Object.entries(events)) {
        if (key.startsWith('_')) continue;
        if (Array.isArray(value) ? value.length > 0 : (typeof value === 'number' ? value !== 0 : (typeof value === 'string' ? value.trim() !== '' : (value && typeof value === 'object' ? Object.keys(value).length > 0 : value === true)))) used.push(key);
    }
    return used.sort();
}

const coinTotal = (character) => (character?.gold || 0) * 100 + (character?.silver || 0) * 10 + (character?.copper || 0);
const wordCount = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const hadEventBlock = (raw) => /```\s*json/i.test(String(raw || ''));
const EVENTS_UNREADABLE = 'mechanical events could not be read this turn';

/** Calls in a window, by kind: what the player waited on besides the DM stream. */
function windowFetches(recorder, from, to, origin) {
    return recorder.log.filter(entry => entry.startedAt >= from && entry.startedAt <= to && entry.kind !== 'dm-stream').map(entry => describeFetch(entry, origin));
}

async function measurePlainTurn({ recorder, settings, fixture, index }) {
    const { line, kind } = TURNS[index];
    const state = restoreState(fixture.snapshots[`turn-${String(index + 1).padStart(2, '0')}`], settings);
    await seedVectorStore(state, fixture.rowLocations);
    await recorder.idle(400);
    const game = createHeadlessGame({ state, recorder });
    const coinsBefore = coinTotal(state.character);
    const messagesBefore = state.messages.length;
    const warnings = captureWarnings();
    game.tag = 'plain';
    const t0 = now();
    let outcome = null;
    let error = null;
    try {
        outcome = await submitPlayerMessage(game, line, { extract: false });
    } catch (e) {
        error = String(e?.message || e).slice(0, 300);
    }
    const t1 = now();
    warnings.stop();
    const after = game.getState();
    const dmCalls = await Promise.all(game.dmCalls.map(call => describeDmCall(call, t0)));
    const first = game.dmCalls[0] || null;
    const last = game.dmCalls[game.dmCalls.length - 1] || null;
    const pending = after.pendingRoleplayCheck;
    const newRows = after.messages.slice(messagesBefore);
    const record = {
        index: index + 1,
        kind,
        line,
        turnMs: round(t1 - t0),
        preStreamMs: first ? round(first.startedAt - t0) : null,
        firstVisibleMs: game.firstVisibleAt === null ? null : round(game.firstVisibleAt - t0),
        postStreamMs: last ? round(t1 - last.endedAt) : null,
        dmCalls,
        otherCalls: windowFetches(recorder, t0, t1, t0),
        route: outcome?.routed?.route || null,
        correction: outcome?.correction?.route || null,
        checkProposed: pending ? pending.rolls.map(roll => `${roll.skill || roll.ability || roll.type} DC ${roll.dc}`) : null,
        combatStarted: !!outcome?.combatStartedNow,
        narrative: outcome?.dmNarrative || '',
        hidden: !!game.runner.getLastCommittedTurn()?.hidden,
        words: wordCount(outcome?.dmNarrative),
        raw: first?.raw || '',
        eventBlock: hadEventBlock(first?.raw),
        eventsUnreadable: newRows.some(row => row?.role === 'system' && String(row.content || '').includes(EVENTS_UNREADABLE)),
        eventChannels: usedEventChannels(outcome?.events),
        coinDelta: coinTotal(after.character) - coinsBefore,
        warnings: warnings.lines,
        ...(error ? { error } : {}),
    };
    await recorder.idle(2000, 30000);
    return record;
}

async function measureCheck({ recorder, settings, fixture }) {
    const attempts = [];
    for (let attempt = 1; attempt <= CHECK.maxAttempts; attempt += 1) {
        const state = restoreState(fixture.snapshots.check, settings);
        await seedVectorStore(state, fixture.rowLocations);
        await recorder.idle(400);
        const game = createHeadlessGame({ state, recorder });
        const warnings = captureWarnings();
        game.tag = 'check-setup';
        const t0 = now();
        let error = null;
        let outcome = null;
        try {
            outcome = await submitPlayerMessage(game, CHECK.line, { extract: false });
        } catch (e) {
            error = String(e?.message || e).slice(0, 300);
        }
        const tCard = now();
        const proposal = game.getState().pendingRoleplayCheck;
        if (error || !proposal) {
            warnings.stop();
            attempts.push({
                attempt, line: CHECK.line, proposed: false, setupMs: round(tCard - t0), route: outcome?.routed?.route || null,
                dmCalls: await Promise.all(game.dmCalls.map(call => describeDmCall(call, t0))),
                narrative: outcome?.dmNarrative || '', warnings: warnings.lines, ...(error ? { error } : {}),
            });
            await recorder.idle(2000, 30000);
            continue;
        }
        const setupCalls = game.dmCalls.length;
        const setupVisibleAt = game.firstVisibleAt;
        const rollsBefore = (game.getState().rollHistory || []).length;
        const messagesBefore = game.getState().messages.length;
        // The click. A player takes a moment here; the harness takes none, and the two waits are reported apart.
        game.tag = 'check-outcome';
        game.firstVisibleAt = null;
        const tClick = now();
        await game.runner.acceptRoleplayCheck();
        const tEnd = now();
        warnings.stop();
        const after = game.getState();
        const dmCalls = await Promise.all(game.dmCalls.map(call => describeDmCall(call, t0)));
        const outcomeRow = after.messages.slice(messagesBefore).findLast(row => row?.role === 'assistant' && !row.hidden && String(row.content || '').trim());
        const failed = after.messages.slice(messagesBefore).some(row => row?.role === 'system' && /outcome (narration|response) failed|Error resolving check/i.test(String(row.content || '')));
        const result = {
            attempt,
            line: CHECK.line,
            proposed: true,
            rolls: proposal.rolls.map(roll => `${roll.skill || roll.ability || roll.type} DC ${roll.dc}`),
            rollLines: after.messages.slice(messagesBefore).filter(row => row?.role === 'system' && !row.kind && String(row.content || '').includes('Rolled')).map(row => String(row.content).slice(0, 300)),
            diceRolled: (after.rollHistory || []).length - rollsBefore,
            setupMs: round(tCard - t0),
            setupFirstVisibleMs: setupVisibleAt === null ? null : round(setupVisibleAt - t0),
            outcomeFirstVisibleMs: game.firstVisibleAt === null ? null : round(game.firstVisibleAt - tClick),
            outcomeMs: round(tEnd - tClick),
            wholeMs: round((tCard - t0) + (tEnd - tClick)),
            // The first words that stay on screen: the setup's prose is withheld once a check is staged.
            firstLastingWordMs: game.firstVisibleAt === null ? null : round((tCard - t0) + (game.firstVisibleAt - tClick)),
            dmCallCount: dmCalls.length,
            setupDmCalls: setupCalls,
            dmCalls,
            otherCallsSetup: windowFetches(recorder, t0, tCard, t0),
            otherCallsOutcome: windowFetches(recorder, tClick, tEnd, t0),
            chainedCheck: !!after.pendingRoleplayCheck,
            setupWords: wordCount(proposal.setupNarrative),
            narrative: outcomeRow?.content || '',
            words: wordCount(outcomeRow?.content),
            warnings: warnings.lines,
            ...(failed || !outcomeRow ? { error: 'the outcome narration did not commit' } : {}),
        };
        attempts.push(result);
        // The app starts the Scribe after an outcome; let it finish before the next measurement.
        await recorder.idle(3000, 90000);
        break;
    }
    return attempts;
}

async function measureRound({ recorder, settings, fixture }) {
    const state = restoreState(fixture.snapshots.round, settings);
    await recorder.idle(400);
    const game = createHeadlessGame({ state, recorder });
    const warnings = captureWarnings();
    game.tag = 'combat-intent';
    const t0 = now();
    let error = null;
    let outcome = null;
    try {
        outcome = await submitPlayerMessage(game, FIGHT.roundLine, { extract: false });
    } catch (e) {
        error = String(e?.message || e).slice(0, 300);
    }
    const tIntent = now();
    const committed = outcome?.planCommitted === true && game.getState().combat?.phase === COMBAT_PHASES.AWAITING_NARRATION;
    const exchange = outcome?.events?.combatExchange || null;
    let narrations = [];
    if (committed) {
        game.tag = 'combat-narration';
        game.firstVisibleAt = null;
        try {
            narrations = await settleCombat(game);
        } catch (e) {
            error = String(e?.message || e).slice(0, 300);
        }
    }
    const tEnd = now();
    warnings.stop();
    const dmCalls = await Promise.all(game.dmCalls.map(call => describeDmCall(call, t0)));
    const record = {
        line: FIGHT.roundLine,
        intentMs: round(tIntent - t0),
        intentAccepted: committed,
        resolved: game.getState().messages.slice(state.messages.length).filter(row => row?.exchangeLine).map(row => String(row.content || '').slice(0, 300)),
        route: outcome?.routed?.route || null,
        playerSlots: (exchange?.playerSlots || []).map(slot => slot.action),
        enemyIntents: (exchange?.enemyIntents || []).map(intent => intent.action),
        firstNarrationWordMs: game.firstVisibleAt === null || !committed ? null : round(game.firstVisibleAt - t0),
        roundMs: committed && narrations.length > 0 ? round(tEnd - t0) : null,
        dmCallCount: dmCalls.length,
        dmCalls,
        otherCalls: windowFetches(recorder, t0, tEnd, t0),
        terminal: narrations[0]?.terminal || null,
        narrative: narrations[0]?.narrative || '',
        words: wordCount(narrations[0]?.narrative),
        intentRaw: game.dmCalls[0]?.raw || '',
        warnings: warnings.lines,
        ...(error ? { error } : {}),
    };
    await recorder.idle(2000, 30000);
    return record;
}

/**
 * One model at one setting: the twenty turns, then the check and the round,
 * each `reps` times. The result file is rewritten after every step, so a run
 * that dies keeps what it measured.
 */
export async function runCell({ cell, keys, fixture, file, turns = TURNS.length, reps = 3, say = () => {} }) {
    const recorder = createFetchRecorder({ keys });
    recorder.setDmThinking(WIRE_SETTINGS[cell.provider][cell.setting]);
    const settings = settingsForCell(cell, keys);
    const result = {
        cell,
        wire: WIRE_SETTINGS[cell.provider][cell.setting],
        startedAt: new Date().toISOString(),
        finishedAt: null,
        fixtureRecordedAt: fixture.meta?.recordedAt || null,
        turns: [],
        checks: [],
        rounds: [],
        aborted: null,
    };
    const save = () => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, scrubKeys(JSON.stringify(result, null, 1), keys));
    };
    const stopIfFatal = () => { if (recorder.fatal) throw new Error(recorder.fatal); };
    let consecutiveErrors = 0;
    try {
        for (let index = 0; index < Math.min(turns, TURNS.length); index += 1) {
            stopIfFatal();
            const record = await measurePlainTurn({ recorder, settings, fixture, index });
            result.turns.push(record);
            save();
            const call = record.dmCalls[0];
            say(`turn ${record.index}: first word ${call?.ttftMs ?? 'n/a'} ms, call ${call?.totalMs ?? 'n/a'} ms, whole turn ${record.turnMs} ms, thinking ${call?.usage?.thinkTokens ?? '?'} tok, ${record.words} words${record.checkProposed ? ' [check proposed]' : ''}${record.error ? ` ERROR ${record.error.slice(0, 80)}` : ''}`);
            consecutiveErrors = record.error ? consecutiveErrors + 1 : 0;
            if (consecutiveErrors >= 3) throw new Error(`three turns in a row failed (${record.error})`);
        }
        for (let rep = 1; rep <= reps; rep += 1) {
            stopIfFatal();
            const attempts = await measureCheck({ recorder, settings, fixture });
            result.checks.push({ rep, attempts });
            save();
            const done = attempts.find(attempt => attempt.proposed);
            say(`check ${rep}/${reps}: ${done ? `card after ${done.setupMs} ms, outcome ${done.outcomeMs} ms, whole ${done.wholeMs} ms, ${done.dmCallCount} DM calls` : `no check proposed in ${attempts.length} tries`}${done?.error ? ` ERROR ${done.error}` : ''}`);
        }
        for (let rep = 1; rep <= reps; rep += 1) {
            stopIfFatal();
            const record = await measureRound({ recorder, settings, fixture });
            result.rounds.push({ rep, ...record });
            save();
            say(`round ${rep}/${reps}: intent ${record.intentMs} ms${record.intentAccepted ? `, first narration word ${record.firstNarrationWordMs} ms, whole round ${record.roundMs} ms` : ' REJECTED'}${record.error ? ` ERROR ${record.error.slice(0, 80)}` : ''}`);
        }
    } catch (error) {
        result.aborted = scrubKeys(String(error?.message || error).slice(0, 300), keys);
        say(`ABORTED: ${result.aborted}`);
    }
    result.finishedAt = new Date().toISOString();
    save();
    recorder.restore();
    return result;
}
