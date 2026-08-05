/**
 * Turn orchestrator — ChatPanel's async DM-turn pipeline as a plain module
 * (review P1-7, 2026-07-31). The multi-call turn machinery (RAG retrieval,
 * prompt assembly, streaming, parsing, roll policy, event application, the
 * missing-events nudge, and the roleplay-check accept/challenge/change flow)
 * was the app's most failure-prone code yet lived in component closures that
 * only a mounted DOM could exercise. `createTurnRunner(deps)` owns it now;
 * ChatPanel wires the deps to its React state/refs and keeps only UI concerns
 * (the rAF-coalesced streaming paint, effects, JSX).
 *
 * Dependency surface (all functions; UI callbacks default to no-ops):
 * - getState():         latest game state (the component's stateRef).
 * - dispatch(action):   reducer dispatch.
 * - streamMessage/sendMessage: the LLM adapter calls, injected so tests can
 *   script responses without a network.
 * - isMounted():        false once the owning mount died — a stream resolving
 *   after unmount/campaign switch must never dispatch into the live store.
 * - setAbortController(controller): hands the turn's AbortController to the
 *   component so Stop/unmount can abort it.
 * - onStreamChunkText(text): display text per streamed chunk, already
 *   fence-frozen; the component owns paint coalescing.
 * - clearStreamingDisplay(): drop any streamed text (and scheduled paints).
 * - setLoading(bool) / onStatus(label): the component's isLoading/status UI.
 * - resetRoleplayChallengeUi(): clear the challenge textarea state.
 */

import { buildSystemPrompt } from './promptBuilder.js';
import { parseResponse, detectPreNarratedOutcome, normalizeEvents, detectSemanticTextRolls } from './responseParser.js';
import { applyEvents } from '../state/applyEvents.js';
import { handleRequestedRolls } from '../engine/rollResolver.js';
import { playerAuthorityRollCorrectionPrompt, reviewOutsideCombatRolls } from '../engine/outOfCombatRollPolicy.js';
import { maybeAutoSummarize } from '../engine/worldJournal.js';
import { buildKnownAppearances, buildKnownStances, runScribe } from './scribe.js';
import { TABLE_TALK_RESPONSE_MODE } from './tableTalk.js';
import { addMemory, retrieveRelevant } from '../engine/vectorMemory.js';
import { getMachineryGeminiKey } from './machinery.js';
import { curateStoryMemory } from '../engine/storyMemory.js';
import { captureInjection } from '../debug/memoryInspectorStore.js';
import { buildMessageWindow, deriveSetupVisibility, dropOrphanCombatExchange } from '../components/Chat/turnVisibility.js';
import { buildNudgePrompt, detectMissingEventsCue, extractNudgeEventFields } from '../components/Chat/missingEventsNudge.js';
import { buildRollRulingRecord, buildRoleplayChallengePrompt, buildRoleplayCheckProposal, pruneRecentRulings } from '../engine/roleplayCheck.js';

/** How many recent (un-summarized) messages to send as LLM history. */
export const MESSAGE_WINDOW = 20;

const noop = () => {};

export function createTurnRunner({
    getState,
    dispatch,
    streamMessage,
    sendMessage,
    isMounted = () => true,
    setAbortController = noop,
    onStreamChunkText = noop,
    clearStreamingDisplay = noop,
    setLoading = noop,
    onStatus = noop,
    resetRoleplayChallengeUi = noop,
}) {
    let lastSummarizedIndex = getState()?.session?.prunedMessageCount || 0;
    let summarizeInFlight = false; // One summarize pass at a time — overlapping runs would double-journal the same range

    const runAutoSummarize = async () => {
        if (summarizeInFlight) return;
        summarizeInFlight = true;
        try {
            const result = await maybeAutoSummarize(getState(), dispatch, lastSummarizedIndex);
            lastSummarizedIndex = result.index;
            const machineryKey = getMachineryGeminiKey(getState().settings);
            if (result.journalEntry && machineryKey) {
                const journalText = result.journalEntry.location
                    ? `[Location: ${result.journalEntry.location}] ${result.journalEntry.summary}`
                    : result.journalEntry.summary;
                await addMemory(machineryKey, journalText, 'journal', result.journalEntry.location).catch(() => {});
            }
        } catch (e) {
            console.error('[Journal RAG Seeding] Failed:', e);
        } finally {
            summarizeInFlight = false;
        }
    };

    /**
     * Build the system prompt from current state, with optional RAG memories injected.
     */
    const buildCurrentSystemPrompt = (retrievedMemories = [], storyMemory = []) => {
        const s = getState();
        return buildSystemPrompt({
            character: s.character,
            inventory: s.inventory,
            quests: s.quests,
            rollHistory: s.rollHistory,
            preset: s.settings.preset,
            ruleset: s.settings.ruleset,
            customSystemPrompt: s.settings.customSystemPrompt,
            journal: s.journal,
            npcs: s.npcs,
            party: s.party,
            currentLocation: s.currentLocation,
            combat: s.combat,
            worldFacts: s.worldFacts || [],
            fronts: s.fronts || [],
            worldTempo: s.worldTempo || null,
            recentEncounters: s.recentEncounters || [],
            recentChecks: s.recentChecks || [],
            paceDial: s.settings.paceDial,
            messageCount: (s.messages || []).length,
            messages: s.messages || [],
            storyMemory,
            retrievedMemories,
            premise: s.session?.premise,
            regionalHearsay: s.session?.regionalHearsay || null,
            absenceDrift: s.session?.absenceDrift || null,
            recentRulings: pruneRecentRulings(s.recentRulings, {
                messageCount: (s.messages || []).length,
                location: s.currentLocation,
            }),
        });
    };

    /**
     * Build the sliding-window message history for the LLM.
     * Only sends the last MESSAGE_WINDOW un-summarized messages.
     * Older messages have been captured in journal entries and world facts.
     */
    const buildMessageHistory = () => buildMessageWindow(getState().messages, MESSAGE_WINDOW);

    /**
     * Send a message to the LLM and process the response.
     * Returns the parsed events (or null).
     * @param {string} userMessage
     * @param {string} [originalPlayerMessage] - The player's actual input (for Scribe)
     */
    const sendToLLM = async (userMessage, originalPlayerMessage, opts = {}) => {
        const s = getState();

        // RAG: retrieve memories relevant to the current scene (machinery key —
        // embeddings are Gemini-only regardless of the DM provider).
        // Include location and combat context for better retrieval relevance
        const machineryKey = getMachineryGeminiKey(s.settings);
        let retrievedMemories = [];
        let dramaticMemories = [];
        if (originalPlayerMessage && machineryKey) {
            const sceneContext = [
                originalPlayerMessage,
                s.currentLocation && `Location: ${s.currentLocation}`,
                s.combat?.active && `In combat with: ${s.combat.enemies.map(e => e.name).join(', ')}`,
            ].filter(Boolean).join('. ');
            retrievedMemories = await retrieveRelevant(machineryKey, sceneContext).catch(() => []);
            dramaticMemories = curateStoryMemory({
                memories: s.storyMemory || [],
                query: sceneContext,
                location: s.currentLocation || '',
                npcs: s.npcs || [],
            });
        } else if (originalPlayerMessage) {
            dramaticMemories = curateStoryMemory({
                memories: s.storyMemory || [],
                query: originalPlayerMessage,
                location: s.currentLocation || '',
                npcs: s.npcs || [],
            });
        }
        if (originalPlayerMessage) {
            // Scores/similarities are dropped once the prompt string is built —
            // keep the latest copy for the read-only Memory Inspector panel.
            captureInjection({
                playerMessage: originalPlayerMessage,
                location: s.currentLocation,
                retrieved: retrievedMemories,
                curated: dramaticMemories,
            });
        }

        const baseSystemPrompt = buildCurrentSystemPrompt(retrievedMemories, dramaticMemories);
        let systemPrompt = baseSystemPrompt;
        if (opts.combatIntentOnly) {
            systemPrompt = `${baseSystemPrompt}\n\n## CURRENT RESPONSE MODE — COMBAT INTENT ONLY
Translate the player's committed action into the single bounded combat_exchange required by the live combat rules. Return ONLY the trailing fenced JSON event block: no narrative, setup, outcome, commentary, or prose outside the JSON. Keep descriptions brief. The engine will resolve mechanics and make a separate narration-only request from the authoritative result.`;
        } else if (opts.tableTalk) {
            // Deterministic OOC contract: some DM providers (Grok in live play) never
            // break character on their own and steamroll "DM, ..." into scene prose.
            systemPrompt = `${baseSystemPrompt}\n\n${TABLE_TALK_RESPONSE_MODE}`;
        }
        const messageHistory = buildMessageHistory();

        const abortController = new AbortController();
        setAbortController(abortController);
        let streamBuffer = '';
        const requestStartedAt = performance.now();
        let firstChunkAt = null;

        const fullResponse = await streamMessage({
            provider: s.settings.llmProvider,
            apiKey: s.settings.apiKey,
            model: s.settings.model,
            systemPrompt,
            messageHistory,
            userMessage,
            onChunk: (chunk) => {
                if (firstChunkAt === null) firstChunkAt = performance.now();
                streamBuffer += chunk;
                if (opts.combatIntentOnly) return;
                // Once we hit a ```json fence, freeze the display text — all remaining
                // chunks are JSON data that parseResponse handles on the full text.
                // (Paint coalescing stays in the component; this only supplies the
                // ready-to-display text per chunk.)
                const fenceIdx = streamBuffer.search(/```json/i);
                onStreamChunkText(fenceIdx !== -1 ? streamBuffer.slice(0, fenceIdx).trimEnd() : streamBuffer);
            },
            signal: abortController.signal,
        });
        const requestFinishedAt = performance.now();
        if (!isMounted()) return null; // Response landed after unmount/campaign switch — drop it
        const mode = opts.combatIntentOnly ? 'combat-intent' : (opts.narrationOnly ? 'narration-only' : 'standard');
        console.info(
            `[LLM timing] ${mode}: TTFT ${firstChunkAt === null ? 'n/a' : `${Math.round(firstChunkAt - requestStartedAt)}ms`}, total ${Math.round(requestFinishedAt - requestStartedAt)}ms`
        );

        const parsed = parseResponse(fullResponse);
        const narrative = parsed.narrative;
        // Unrepairable JSON means the DM's mechanical events were dropped. That
        // must be VISIBLE — a silently vanished event block reads as "the DM gave
        // me nothing", and channels without a Scribe backstop (combat_start,
        // spell_cast, conditions) had no signal at all before this.
        if (parsed.eventsDropped && !opts.narrationOnly && !opts.tableTalk) {
            dispatch({
                type: 'ADD_MESSAGE',
                payload: { role: 'system', content: 'The DM\'s mechanical events could not be read this turn (malformed data) — the story above stands, but no game state changed. If something seemed granted or started here, ask the DM to restate it.' },
            });
        }
        // Table talk pauses the world: whatever a disobedient DM appends, no events
        // exist on an OOC turn — no rolls, loot, quests, or NPC/state mutations.
        let events = (opts.narrationOnly || opts.tableTalk) ? null : parsed.events;
        opts.onNarrative?.(narrative);

        // A combat_exchange with no live combat has no machine to resolve it; left in
        // place it hides the narration AND dead-ends in a silent plan rejection —
        // the whole response vanishes (playtest #10 finding: DM emitted a death_save
        // exchange after END_COMBAT closed the fight with the hero dying).
        if (dropOrphanCombatExchange(events, !!s.combat?.active)) {
            console.warn('[ChatPanel] Dropped a combat_exchange emitted outside active combat; narrating normally.');
        }

        // If no JSON events/rolls were detected, check if we should run the Scribe to semantically detect any requested rolls in text
        if (!opts.narrationOnly && !opts.tableTalk && (!events || !events.requestedRolls?.length) && originalPlayerMessage && !s.combat?.active && s.settings.apiKey) {
            const semanticRolls = await detectSemanticTextRolls(narrative, s.settings);
            if (semanticRolls && semanticRolls.length > 0) {
                console.warn('[ChatPanel] Scribe detected text-based rolls semantically:', semanticRolls);
                // Merge the detected rolls into any existing events — replacing the whole
                // object would silently drop loot/quest/NPC events the response carried.
                const detected = normalizeEvents({ requested_rolls: semanticRolls });
                if (events) {
                    events.requestedRolls = detected.requestedRolls;
                } else {
                    events = detected;
                }
                events._textRollDetected = true;
            }
        }

        if (events?.requestedRolls?.length > 0 && originalPlayerMessage && !s.combat?.active) {
            const review = await reviewOutsideCombatRolls(events.requestedRolls, originalPlayerMessage, narrative, s.settings);
            events.requestedRolls = review.acceptedRolls;
            if (review.rejectedRolls.length > 0) {
                events._playerAuthorityRollRejected = true;
                console.warn('[ChatPanel] Rejected a check that overrides player-authored portrayal; requesting a no-roll roleplay response.');
            }
            const preNarrated = review.preNarrated !== undefined ? review.preNarrated : detectPreNarratedOutcome(narrative);
            if (preNarrated) {
                events._preNarratedOutcome = true;
                console.warn('[ChatPanel] DM pre-narrated outcome before roll — correction will be injected with roll results.');
            }
        }

        // Withheld-setup policy lives in turnVisibility.js (unit-tested): narration
        // with pending rolls is superseded by the post-roll beat and hidden, EXCEPT
        // prose-extracted proposals the player already read; setupPhase separately
        // defers outcome mutations until dice resolve.
        const { setupPhase, hideSetup } = deriveSetupVisibility(events);
        if (hideSetup) clearStreamingDisplay();
        // Pre-generate a stable message ID so applyEvents can reference it as a loot source key.
        const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        if (events) {
            // Let callers staging a roleplay-check proposal recover this response's
            // narration (the withheld setup) and reveal/reuse it later.
            events._setupMessageId = msgId;
            events._setupHidden = hideSetup;
            // In a batched combat round the client already rolled AND applied HP from the
            // inline damage, so ignore any HP deltas the DM narrated to avoid double-counting.
            // Finalized BEFORE dispatch: this object enters the reducer store, and an
            // object already in the store must never be mutated afterwards — what got
            // autosaved would depend on a race with the 2s debounce.
            if (opts.suppressHpEvents) {
                events.damageTaken = 0;
                events.enemyUpdates = [];
            }
        }
        if (!isMounted()) return null; // Never commit a turn into a different campaign's store
        dispatch({
            type: 'ADD_MESSAGE',
            payload: { id: msgId, role: 'assistant', content: narrative, events, hidden: hideSetup },
        });

        // Apply game events (damage, items, etc.)
        if (events) {
            // On a withheld roll-setup turn, defer outcome mutations to the post-roll
            // narration (see applyEvents) so the DM can't double-apply state across the split.
            // playerActionContext carries the original player intent into follow-up
            // calls (post-roll outcomes) where originalPlayerMessage is deliberately
            // absent — so the transaction replay guard can still honor an explicit
            // "I buy another one" when the purchase lands after dice.
            applyEvents(events, dispatch, getState, {
                setupPhase,
                lootSourceId: msgId,
                playerMessage: originalPlayerMessage || opts.playerActionContext,
            });
            if (events.location && !s.combat?.active && !events.combatExchange) {
                dispatch({ type: 'SET_LOCATION', payload: events.location });
            }
        }

        // RAG: embed any new world facts the DM emitted this turn (per response).
        // The per-turn Scribe + narrative embedding run once in handleSend on the FINAL
        // narrated outcome, so they capture results rather than withheld setup text.
        // Skip on a setup turn (pending rolls) — those facts ride on the outcome narration.
        if (!setupPhase && !s.combat?.active && events?.worldFacts?.length > 0 && machineryKey) {
            for (const f of events.worldFacts) {
                addMemory(machineryKey, f.fact, f.category || 'world_fact', events?.location || s.currentLocation).catch(() => {});
            }
        }

        // Missing-events nudge (IDEAS 2026-07-11): a no-JSON response at a contract
        // moment loses quest_updates/starting_items forever — the only channels with
        // no Scribe audit backstop. Recovery is one JSON-only follow-up, whitelisted.
        if (!opts.narrationOnly && !opts.tableTalk && !opts.combatIntentOnly
            && !getState().combat?.active
            && !(events?.requestedRolls?.length > 0)) { // a text-detected check owns this turn
            const nudgeCue = detectMissingEventsCue({
                hadEventBlock: !!parsed.events,
                openingScene: !!opts.openingScene,
                playerMessage: originalPlayerMessage || opts.playerActionContext || '',
                narrative,
                combatActive: !!getState().combat?.active,
            });
            if (nudgeCue) await recoverMissingEvents(nudgeCue, narrative, msgId);
        }

        return events;
    };

    /**
     * One cheap JSON-only follow-up for a prose-only contract moment. The reply is
     * hard-whitelisted (missingEventsNudge.js) and re-shaped through the real parser
     * before applying, so nothing beyond quest_updates/starting_items can enter.
     */
    const recoverMissingEvents = async (cue, narrative, lootSourceId) => {
        try {
            const s = getState();
            const response = await sendMessage({
                provider: s.settings.llmProvider,
                apiKey: s.settings.apiKey,
                model: s.settings.model,
                systemPrompt: buildCurrentSystemPrompt([], []),
                messageHistory: buildMessageHistory(),
                userMessage: buildNudgePrompt(cue, narrative),
                temperature: 0.2,
            });
            const rawFields = extractNudgeEventFields(response, cue);
            if (!rawFields) return;
            const synthetic = parseResponse('```json\n' + JSON.stringify(rawFields) + '\n```');
            if (!synthetic.events) return;
            applyEvents(synthetic.events, dispatch, getState, {
                lootSourceId: `${lootSourceId}:nudge`,
            });
            console.warn(`[ChatPanel] Missing-events nudge recovered ${Object.keys(rawFields).join(' + ')} (${cue.reason} cue).`);
        } catch (error) {
            // Recovery is best-effort — a failed nudge must never block the turn.
            console.warn('[ChatPanel] Missing-events nudge failed:', error.message || error);
        }
    };

    const stageRoleplayCheck = (rolls, playerAction, { challengeUsed = false, preNarrated = false, loot = null, setupNarrative = '', setupMessageId = null } = {}) => {
        const proposal = buildRoleplayCheckProposal(rolls, playerAction, { challengeUsed, preNarrated, loot, setupNarrative, setupMessageId });
        if (!proposal) return false;
        dispatch({ type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal });
        resetRoleplayChallengeUi();
        return true;
    };

    const finalizeRoleplayTurn = (playerAction) => {
        const latest = getState();
        const finalNarration = (latest.messages || [])
            .findLast(message => message.role === 'assistant' && !message.hidden && message.content?.trim());
        if (finalNarration) {
            runScribe({
                playerMessage: playerAction,
                dmNarrative: finalNarration.content,
                settings: latest.settings,
                dispatch,
                knownAppearances: buildKnownAppearances(latest, playerAction, finalNarration.content),
                knownStances: buildKnownStances(latest, playerAction, finalNarration.content),
                // Post-roll outcomes are where narrated loot most often loses its
                // events (the withheld setup already dropped them by design).
                lootAudit: (!latest.combat?.active && finalNarration.id) ? {
                    sourceId: `${finalNarration.id}:scribe-loot`,
                    appliedEvents: finalNarration.events || null,
                    getState,
                } : null,
            }).catch(() => {});
            const machineryKey = getMachineryGeminiKey(latest.settings);
            if (machineryKey) {
                const loc = latest.currentLocation;
                const narrativeText = loc
                    ? `[Location: ${loc}] ${finalNarration.content.slice(0, 500)}`
                    : finalNarration.content.slice(0, 500);
                addMemory(machineryKey, narrativeText, 'narrative', loc).catch(() => {});
            }
        }
        runAutoSummarize();
    };

    const acceptRoleplayCheck = async () => {
        const proposal = getState().pendingRoleplayCheck;
        if (!proposal) return;
        dispatch({ type: 'CLEAR_ROLEPLAY_CHECK' });
        setLoading(true);
        onStatus('Rolling accepted check');
        let stagedFollowUp = false;
        // Failure recovery must know whether dice already landed: before dice,
        // the proposal can be restored intact; after dice, restoring it would
        // reopen the exact reroll-bargaining door the proposal system closes.
        const rollCountBefore = getState().rollHistory?.length || 0;
        try {
            await handleRequestedRolls(proposal.rolls, {
                getState,
                dispatch,
                sendToLLM,
                playerAction: proposal.playerAction,
                preNarrated: proposal.preNarrated,
                setupNarrative: proposal.setupNarrative,
                onFollowUpRolls: (rolls, meta) => {
                    // Carry declared-but-unapplied loot into the re-staged proposal so the
                    // eventual roll-free outcome still gets the grant-or-deny reminder.
                    // A follow-up response is itself a withheld setup — carry its narration
                    // the same way so chained checks don't erase fiction either.
                    stagedFollowUp = stageRoleplayCheck(rolls, meta.playerAction || proposal.playerAction, {
                        preNarrated: meta.preNarrated,
                        loot: meta.pendingLoot || null,
                        setupNarrative: meta.setupNarrative || '',
                        setupMessageId: meta.setupMessageId || null,
                    });
                },
                pendingLoot: proposal.loot,
            });
            if (!stagedFollowUp) finalizeRoleplayTurn(proposal.playerAction);
        } catch (error) {
            if (error.name !== 'AbortError') {
                const diceRolled = (getState().rollHistory?.length || 0) > rollCountBefore;
                if (diceRolled) {
                    // The dice are final; only the outcome narration failed. Point the
                    // player at the retry path instead of stranding them in silence.
                    dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', content: `The dice landed (see the roll above) but the DM's outcome response failed: ${error.message}. Say "continue" to have the DM narrate the result.` } });
                } else {
                    dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', content: `Error resolving check: ${error.message}` } });
                    dispatch({ type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal });
                }
            }
        } finally {
            setLoading(false);
            clearStreamingDisplay();
            onStatus('');
        }
    };

    const challengeRoleplayCheck = async (challengeText) => {
        const proposal = getState().pendingRoleplayCheck;
        const challenge = String(challengeText || '').trim();
        if (!proposal || proposal.challengeUsed || !challenge) return;
        dispatch({ type: 'CLEAR_ROLEPLAY_CHECK' });
        dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: `**Roll challenge:** ${challenge}` } });
        setLoading(true);
        onStatus('DM reconsidering the ruling');
        try {
            const events = await sendToLLM(
                buildRoleplayChallengePrompt(proposal, challenge),
                proposal.playerAction
            );
            if (events?.requestedRolls?.length > 0) {
                // Upheld/revised rulings are JSON-only responses; the original withheld
                // setup is still the scene the player never saw, so carry it forward.
                stageRoleplayCheck(events.requestedRolls, proposal.playerAction, {
                    challengeUsed: true,
                    preNarrated: events._preNarratedOutcome,
                    loot: proposal.loot,
                    setupNarrative: proposal.setupNarrative,
                    setupMessageId: proposal.setupMessageId,
                });
            } else {
                // The DM withdrew (or its re-proposal was policy-rejected): this
                // objective is settled without dice. Record it so the DM cannot
                // re-propose the same check from scratch a few turns later.
                const latest = getState();
                const ruling = buildRollRulingRecord(proposal, 'withdrawn', {
                    messageCount: (latest.messages || []).length,
                    location: latest.currentLocation,
                    challenge,
                });
                if (ruling) dispatch({ type: 'RECORD_ROLL_RULING', payload: ruling });
                if (events?._playerAuthorityRollRejected) {
                    await sendToLLM(playerAuthorityRollCorrectionPrompt(), null, { narrationOnly: true });
                }
                finalizeRoleplayTurn(proposal.playerAction);
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', content: `Error challenging check: ${error.message}` } });
                dispatch({ type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal });
            }
        } finally {
            setLoading(false);
            clearStreamingDisplay();
            onStatus('');
        }
    };

    const changeRoleplayApproach = () => {
        // No dice will ever resolve this setup, so reveal it instead of erasing its
        // fiction — unless it pre-narrated an outcome that never happened.
        const proposal = getState().pendingRoleplayCheck;
        const setupMessage = proposal?.setupMessageId
            ? getState().messages.find(m => m.id === proposal.setupMessageId)
            : null;
        const revealSetup = !!(setupMessage?.hidden && setupMessage.content?.trim() && !proposal.preNarrated);
        if (revealSetup) dispatch({ type: 'REVEAL_MESSAGE', payload: { id: proposal.setupMessageId } });
        if (proposal) {
            // A set-aside ruling still binds the DM: an ordinary proposal must return
            // unchanged on a retry, and an upheld final ruling stays final.
            const ruling = buildRollRulingRecord(proposal, 'set_aside', {
                messageCount: (getState().messages || []).length,
                location: getState().currentLocation,
            });
            if (ruling) dispatch({ type: 'RECORD_ROLL_RULING', payload: ruling });
        }
        dispatch({ type: 'CLEAR_ROLEPLAY_CHECK' });
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: revealSetup
                    ? 'The proposed check is set aside; the scene above stands, but no dice were rolled. Describe a different approach.'
                    : 'The proposed check is set aside. Describe a different approach; no dice were rolled.',
            },
        });
        resetRoleplayChallengeUi();
    };

    return {
        sendToLLM,
        recoverMissingEvents,
        runAutoSummarize,
        stageRoleplayCheck,
        finalizeRoleplayTurn,
        acceptRoleplayCheck,
        challengeRoleplayCheck,
        changeRoleplayApproach,
    };
}
