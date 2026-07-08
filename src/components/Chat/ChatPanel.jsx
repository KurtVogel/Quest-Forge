import { useState, useRef, useEffect } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { streamMessage } from '../../llm/adapter.js';
import { buildSystemPrompt } from '../../llm/promptBuilder.js';
import { parseResponse, applyEvents, detectPreNarratedOutcome, normalizeEvents, detectSemanticTextRolls } from '../../llm/responseParser.js';
import { handleRequestedRolls } from '../../engine/rollResolver.js';
import { playerAuthorityRollCorrectionPrompt, reviewOutsideCombatRolls } from '../../engine/outOfCombatRollPolicy.js';
import { combatNarrationPrompt, COMBAT_PHASES, planCombatExchange, planOpeningExchange } from '../../engine/combatExchange.js';
import { maybeAutoSummarize } from '../../engine/worldJournal.js';
import { buildKnownAppearances, buildKnownStances, runScribe } from '../../llm/scribe.js';
import { addMemory, seedMemories, retrieveRelevant, clearMemories } from '../../engine/vectorMemory.js';
import { getMachineryGeminiKey, isMachineryReady } from '../../llm/machinery.js';
import { curateStoryMemory } from '../../engine/storyMemory.js';
import { generateCampaignFronts, shouldGenerateCampaignFronts } from '../../llm/frontDirector.js';
import { buildCampaignOpeningPrompt, shouldPrimeCampaignOpening } from './sessionPriming.js';
import { buildRollRulingRecord, buildRoleplayChallengePrompt, buildRoleplayCheckProposal, pruneRecentRulings } from '../../engine/roleplayCheck.js';
import CombatPanel from '../Combat/CombatPanel.jsx';
import MarkdownText from './MarkdownText.jsx';
import './Chat.css';

/** How many recent (un-summarized) messages to send as LLM history. */
const MESSAGE_WINDOW = 20;
const DECORATIVE_SYMBOL_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?/gu;

function cleanDisplayText(text) {
    return String(text || '').replace(DECORATIVE_SYMBOL_RE, '').replace(/[ \t]{2,}/g, ' ').trimStart();
}

export default function ChatPanel() {
    const { state, dispatch } = useGame();
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [streamingMessage, setStreamingMessage] = useState('');
    const [loadingStatus, setLoadingStatus] = useState('');
    const [combatNarrationRetry, setCombatNarrationRetry] = useState(0);
    const [roleplayChallenge, setRoleplayChallenge] = useState('');
    const [showRoleplayChallenge, setShowRoleplayChallenge] = useState(false);
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const stickToBottomRef = useRef(true); // Follow new content only while the reader is at the bottom
    const [showJumpToLatest, setShowJumpToLatest] = useState(false);
    const abortControllerRef = useRef(null);
    const inputRef = useRef(null);
    const lastSummarizedRef = useRef(state.session?.prunedMessageCount || 0);
    const hasPrimedRef = useRef(false); // Ensure session priming only fires once per mount
    const memorySeededRef = useRef(false); // Ensure RAG seeding only fires once per mount
    const streamBufferRef = useRef(''); // Accumulated streaming text for JSON fence detection
    const narratedCueIdsRef = useRef(new Set()); // Mechanic system messages already given an LLM flavor beat
    const narratedCombatExchangeIdsRef = useRef(new Set()); // Prevent duplicate narration calls for one mechanics commit
    const frontGenerationSessionRef = useRef(null); // One private generation request per fresh campaign at a time

    // Use a ref to always read the latest state inside async callbacks
    const stateRef = useRef(state);
    stateRef.current = state;

    const summarizeInFlightRef = useRef(false); // One summarize pass at a time — overlapping runs would double-journal the same range

    const runAutoSummarize = async (waitsForResolution = false) => {
        if (waitsForResolution) return;
        if (summarizeInFlightRef.current) return;
        summarizeInFlightRef.current = true;
        try {
            const result = await maybeAutoSummarize(stateRef.current, dispatch, lastSummarizedRef.current);
            lastSummarizedRef.current = result.index;
            const machineryKey = getMachineryGeminiKey(stateRef.current.settings);
            if (result.journalEntry && machineryKey) {
                const journalText = result.journalEntry.location
                    ? `[Location: ${result.journalEntry.location}] ${result.journalEntry.summary}`
                    : result.journalEntry.summary;
                await addMemory(machineryKey, journalText, 'journal').catch(() => {});
            }
        } catch (e) {
            console.error('[Journal RAG Seeding] Failed:', e);
        } finally {
            summarizeInFlightRef.current = false;
        }
    };

    /**
     * Sticky-bottom scrolling: follow the feed only while the reader is already at
     * the bottom. A reader who scrolled up to re-read earlier beats (opening combat
     * rolls, an unresolved cliffhanger) must never be yanked down — not by streaming
     * chunks, not by the finished message, and not by trailing system lines. The
     * floating "Latest" button is the way back down.
     */
    const handleMessagesScroll = () => {
        const el = messagesContainerRef.current;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
        stickToBottomRef.current = nearBottom;
        setShowJumpToLatest(!nearBottom);
    };

    const jumpToLatest = () => {
        stickToBottomRef.current = true;
        setShowJumpToLatest(false);
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        // Instant (not smooth) keeps the follow reliable during streaming: a smooth
        // animation still in flight reads as "not at bottom" and would break the stick.
        if (stickToBottomRef.current) {
            messagesEndRef.current?.scrollIntoView();
        }
    }, [state.messages, streamingMessage]);

    /**
     * Fresh-campaign priming: auto-trigger the DM to set the opening scene only when
     * character creation explicitly marked it pending. Continue/Load must never create
     * an unsolicited DM turn merely because older assistant messages were summarized.
     */
    useEffect(() => {
        const s = stateRef.current;
        if (shouldPrimeCampaignOpening(s) && !hasPrimedRef.current) {
            hasPrimedRef.current = true;
            dispatch({ type: 'UPDATE_SESSION', payload: { openingScenePending: false } });
            setIsLoading(true);

            // The authored premise and live starting inventory are already in the system
            // prompt. The one-time opening also reconciles explicit premise possessions.
            sendToLLM(buildCampaignOpeningPrompt(), null)
                .catch(e => {
                    console.warn('[Priming] Session start priming failed:', e);
                })
                .finally(() => {
                    setIsLoading(false);
                    setStreamingMessage('');
                });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only on mount

    /** Privately replace the generic safety-net front with a grounded 2–3-front web. */
    useEffect(() => {
        const s = stateRef.current;
        if (!shouldGenerateCampaignFronts(s) || frontGenerationSessionRef.current === s.session.id) return;
        const sessionId = s.session.id;
        frontGenerationSessionRef.current = sessionId;
        generateCampaignFronts(s)
            .then(fronts => {
                dispatch({ type: 'INSTALL_GENERATED_FRONTS', payload: { sessionId, fronts } });
                console.info(`[Fronts] Generated ${fronts.length} private campaign pressures.`);
            })
            .catch(error => {
                console.warn('[Fronts] Initial private generation failed; deterministic front remains active:', error.message || error);
                if (frontGenerationSessionRef.current === sessionId) frontGenerationSessionRef.current = null;
            });
    }, [state.session?.id, state.session?.frontDirector?.version, state.settings.apiKey, state.messages.length, state.combat?.active, dispatch]);

    /**
     * RAG seeding: embed all existing world facts and journal summaries once on mount.
     * New memories are added incrementally as play continues.
     */
    useEffect(() => {
        const s = stateRef.current;
        const machineryKey = getMachineryGeminiKey(s.settings);
        if (!machineryKey || memorySeededRef.current) return;

        memorySeededRef.current = true; // Prevent concurrent attempts
        clearMemories();

        const items = [
            ...(s.worldFacts || []).map(f => ({ text: f.fact, category: f.category || 'world_fact' })),
            ...(s.journal || []).map(j => ({ text: j.summary, category: 'journal' })),
            ...(s.npcs || []).filter(n => n.lastNotes || n.notes).map(n => ({
                text: `${n.name} (${n.disposition || 'unknown'}): ${n.lastNotes || n.notes}`,
                category: 'npc',
            })),
            ...(s.storyMemory || []).map(m => ({
                text: `${m.subject ? `${m.subject}: ` : ''}${m.text}`,
                category: `story_${m.type || 'callback'}`,
            })),
        ];

        if (items.length > 0) {
            seedMemories(machineryKey, items).catch((e) => {
                console.error('[RAG] Memory seeding failed — will retry next mount:', e);
                memorySeededRef.current = false; // Allow retry on next mount
            });
        }
    }, []); // Only on mount

    /**
     * Build the system prompt from current state, with optional RAG memories injected.
     */
    const buildCurrentSystemPrompt = (retrievedMemories = [], storyMemory = []) => {
        const s = stateRef.current;
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
            storyMemory,
            retrievedMemories,
            premise: s.session?.premise,
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
    const buildMessageHistory = () => {
        const s = stateRef.current;
        // Hidden setup messages were intentionally superseded by authoritative roll/exchange
        // results. Sending them back can bias the narrator toward a pre-rolled outcome.
        const unsummarized = s.messages.filter(m => {
            if (m.summarized || m.hidden) return false;
            if (m.role === 'system') {
                return /rolled \*\*/i.test(m.content || '');
            }
            return true;
        });
        const window = unsummarized.slice(-MESSAGE_WINDOW);
        return window.map(m => ({
            role: m.role === 'system' ? 'user' : m.role,
            content: m.content,
        }));
    };

    /**
     * Send a message to the LLM and process the response.
     * Returns the parsed events (or null).
     * @param {string} userMessage
     * @param {string} [originalPlayerMessage] - The player's actual input (for Scribe)
     */
    const sendToLLM = async (userMessage, originalPlayerMessage, opts = {}) => {
        const s = stateRef.current;

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

        const baseSystemPrompt = buildCurrentSystemPrompt(retrievedMemories, dramaticMemories);
        const systemPrompt = opts.combatIntentOnly
            ? `${baseSystemPrompt}\n\n## CURRENT RESPONSE MODE — COMBAT INTENT ONLY
Translate the player's committed action into the single bounded combat_exchange required by the live combat rules. Return ONLY the trailing fenced JSON event block: no narrative, setup, outcome, commentary, or prose outside the JSON. Keep descriptions brief. The engine will resolve mechanics and make a separate narration-only request from the authoritative result.`
            : baseSystemPrompt;
        const messageHistory = buildMessageHistory();

        abortControllerRef.current = new AbortController();
        streamBufferRef.current = '';
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
                streamBufferRef.current += chunk;
                if (opts.combatIntentOnly) return;
                const buf = streamBufferRef.current;
                // Once we hit a ```json fence, freeze the display — all remaining
                // chunks are JSON data that parseResponse handles on the full text.
                const fenceIdx = buf.search(/```json/i);
                if (fenceIdx !== -1) {
                    setStreamingMessage(buf.slice(0, fenceIdx).trimEnd());
                } else {
                    setStreamingMessage(buf);
                }
            },
            signal: abortControllerRef.current.signal,
        });
        const requestFinishedAt = performance.now();
        const mode = opts.combatIntentOnly ? 'combat-intent' : (opts.narrationOnly ? 'narration-only' : 'standard');
        console.info(
            `[LLM timing] ${mode}: TTFT ${firstChunkAt === null ? 'n/a' : `${Math.round(firstChunkAt - requestStartedAt)}ms`}, total ${Math.round(requestFinishedAt - requestStartedAt)}ms`
        );

        const parsed = parseResponse(fullResponse);
        const narrative = parsed.narrative;
        let events = opts.narrationOnly ? null : parsed.events;
        opts.onNarrative?.(narrative);

        // If no JSON events/rolls were detected, check if we should run the Scribe to semantically detect any requested rolls in text
        if (!opts.narrationOnly && (!events || !events.requestedRolls?.length) && originalPlayerMessage && !s.combat?.active && s.settings.apiKey) {
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

        // Any narration that still has PENDING ROLLS is a "setup" the post-roll narration
        // will supersede, so withhold it: the DM narrates the whole beat once, AFTER the
        // dice resolve (see rollResolver). Only the final, roll-free narration is shown.
        // This must hold for CHAINED rolls too — a failed check that provokes an enemy
        // attack, a multi-enemy round, a triggered save — not just the player's first
        // action. Keying on pending rolls alone is the fix; the previous condition also
        // required the first-turn `originalPlayerMessage`, so every chained setup stayed
        // visible and the player saw the beat twice (setup, then outcome).
        // EXCEPTION: a check the Scribe extracted from natural prose (no JSON) reads like
        // a real DM asking for a roll mid-scene. That narration is a complete beat, not a
        // withheld setup — hiding it retroactively erased fiction the player had already
        // read. Keep it visible and stage the proposal beneath it, unless it pre-narrated
        // the outcome or the check was rejected as a player-authority override.
        // setupPhase (defer outcome mutations until dice resolve) still keys on pending
        // rolls alone — visibility and mutation deferral are separate concerns.
        const proposalFromProse = !!events?._textRollDetected
            && !events?._preNarratedOutcome
            && !events?._playerAuthorityRollRejected
            && events?.requestedRolls?.length > 0;
        const setupPhase = events?.requestedRolls?.length > 0
            || !!events?.combatExchange
            || !!events?._playerAuthorityRollRejected;
        const hideSetup = setupPhase && !proposalFromProse;
        if (hideSetup) setStreamingMessage('');
        // Pre-generate a stable message ID so applyEvents can reference it as a loot source key.
        const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        if (events) {
            // Let callers staging a roleplay-check proposal recover this response's
            // narration (the withheld setup) and reveal/reuse it later.
            events._setupMessageId = msgId;
            events._setupHidden = hideSetup;
        }
        dispatch({
            type: 'ADD_MESSAGE',
            payload: { id: msgId, role: 'assistant', content: narrative, events, hidden: hideSetup },
        });

        // Apply game events (damage, items, etc.)
        if (events) {
            // In a batched combat round the client already rolled AND applied HP from the
            // inline damage, so ignore any HP deltas the DM narrated to avoid double-counting.
            if (opts.suppressHpEvents) {
                events.damageTaken = 0;
                events.enemyUpdates = [];
            }
            // On a withheld roll-setup turn, defer outcome mutations to the post-roll
            // narration (see applyEvents) so the DM can't double-apply state across the split.
            // playerActionContext carries the original player intent into follow-up
            // calls (post-roll outcomes) where originalPlayerMessage is deliberately
            // absent — so the transaction replay guard can still honor an explicit
            // "I buy another one" when the purchase lands after dice.
            applyEvents(events, dispatch, () => stateRef.current, {
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
                addMemory(machineryKey, f.fact, f.category || 'world_fact').catch(() => {});
            }
        }

        return events;
    };

    useEffect(() => {
        const s = stateRef.current;
        if (!s.settings.apiKey || isLoading) return;
        const cueMessage = [...(s.messages || [])].reverse()
            .find(m => m.role === 'system' && m.narrationCue && !narratedCueIdsRef.current.has(m.id));
        if (!cueMessage) return;

        narratedCueIdsRef.current.add(cueMessage.id);
        const cue = cueMessage.narrationCue;
        const combatLine = s.combat?.active
            ? 'Combat is active; do not advance enemy turns, request rolls, or resolve any enemy actions.'
            : 'Do not advance time or introduce a new challenge.';
        const narrationRequest = [
            '[SYSTEM: The engine just resolved a player-triggered mechanic. Narrate only the felt fictional beat.',
            'Write one short paragraph maximum, usually one or two sentences.',
            'Do not mention JSON, UI, numbers, dice, HP totals, resources, or system messages.',
            'Do not apply healing, spend resources, request rolls, add items, alter combat, or emit JSON.',
            combatLine,
            'Do not end with "What do you do?" unless the scene genuinely needs a prompt.',
            `Mechanic: ${cue.mechanic}. Action type: ${cue.actionType || 'action'}. Effect: ${cue.effect}.`,
            `System result to interpret fictionally: ${cueMessage.content}]`,
        ].join(' ');

        setIsLoading(true);
        setStreamingMessage('');
        sendToLLM(narrationRequest, null, { narrationOnly: true })
            .catch(error => {
                if (error.name !== 'AbortError') {
                    dispatch({
                        type: 'ADD_MESSAGE',
                        payload: {
                            role: 'system',
                            content: `Error: ${error.message}`,
                        },
                    });
                }
            })
            .finally(() => {
                setIsLoading(false);
                setStreamingMessage('');
            });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.messages, isLoading]);

    /** Commit a pure combat plan once. Invalid plans leave every actor untouched. */
    const commitCombatPlan = (plan) => {
        if (!plan?.ok) {
            dispatch({ type: 'REJECT_COMBAT_EXCHANGE', payload: { reason: plan?.error } });
            return false;
        }
        dispatch({ type: 'APPLY_COMBAT_EXCHANGE', payload: plan.payload });
        return true;
    };

    /** Opening Initiative is engine-owned and resolves before any queued player action. */
    useEffect(() => {
        if (isLoading || state.combat?.phase !== COMBAT_PHASES.OPENING) return;
        commitCombatPlan(planOpeningExchange(state));
    // commitCombatPlan only dispatches the pure plan for the current combat snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.combat?.phase, isLoading]);

    /** A player action that started combat waits safely behind Opening Initiative. */
    useEffect(() => {
        if (isLoading || state.combat?.phase !== COMBAT_PHASES.AWAITING_PLAYER || !state.combat.queuedExchange) return;
        commitCombatPlan(planCombatExchange(state, state.combat.queuedExchange));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.combat?.phase, state.combat?.queuedExchange, isLoading]);

    /**
     * Narration is a retryable acknowledgment of already-committed mechanics. It never
     * carries events, never rerolls, and is keyed by exchangeId for reload safety.
     */
    useEffect(() => {
        const result = state.combat?.lastExchangeResult;
        if (isLoading || state.combat?.phase !== COMBAT_PHASES.AWAITING_NARRATION || !result?.exchangeId) return;
        if (narratedCombatExchangeIdsRef.current.has(result.exchangeId)) return;
        narratedCombatExchangeIdsRef.current.add(result.exchangeId);

        let narrative = '';
        setIsLoading(true);
        setStreamingMessage('');
        setLoadingStatus('Narrating combat outcome');
        sendToLLM(combatNarrationPrompt(result), null, {
            narrationOnly: true,
            onNarrative: text => { narrative = text; },
        })
            .then(() => {
                dispatch({ type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: result.exchangeId } });
                const latest = stateRef.current;
                if (narrative.trim()) {
                    runScribe({
                        playerMessage: result.kind === 'opening' ? 'Opening Initiative' : 'Combat exchange',
                        dmNarrative: narrative,
                        settings: latest.settings,
                        dispatch,
                        knownAppearances: buildKnownAppearances(latest, narrative),
                        knownStances: buildKnownStances(latest, narrative),
                        authoritativeContext: {
                            terminal: result.terminal || 'ongoing',
                            postState: result.postState,
                        },
                        // Victory narration is narration-only, so loot the DM narrates
                        // there ("you pry 15 gold from the bandit's purse") has no event
                        // channel at all — the audit is its only way to persist. Keyed to
                        // the exchangeId, matching the narration's own retry idempotency.
                        lootAudit: result.terminal === 'victory' ? {
                            sourceId: `loot-${result.exchangeId}:scribe-loot`,
                            appliedEvents: null,
                            getState: () => stateRef.current,
                        } : null,
                    }).catch(() => {});
                    // Ordinary combat beats are transient and the engine snapshot, not prose,
                    // owns their truth. Persist only terminal combat narration to RAG so a
                    // model wording mistake cannot become a long-lived semantic memory.
                    const machineryKey = getMachineryGeminiKey(latest.settings);
                    if (['victory', 'defeat', 'escaped'].includes(result.terminal) && machineryKey) {
                        const loc = latest.currentLocation;
                        const narrativeText = loc
                            ? `[Location: ${loc}] ${narrative.slice(0, 500)}`
                            : narrative.slice(0, 500);
                        addMemory(machineryKey, narrativeText, 'narrative').catch(() => {});
                    }
                }
                runAutoSummarize();
            })
            .catch(error => {
                if (error.name !== 'AbortError') {
                    dispatch({
                        type: 'ADD_MESSAGE',
                        payload: {
                            role: 'system',
                            content: `Combat mechanics are safely resolved, but narration failed: ${error.message}. Retry narration; the dice and HP will not be applied again.`,
                        },
                    });
                }
            })
            .finally(() => {
                setIsLoading(false);
                setStreamingMessage('');
                setLoadingStatus('');
            });
    // sendToLLM is intentionally driven only by the persisted exchange identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.combat?.phase, state.combat?.lastExchangeResult?.exchangeId, isLoading, combatNarrationRetry]);

    const stageRoleplayCheck = (rolls, playerAction, { challengeUsed = false, preNarrated = false, loot = null, setupNarrative = '', setupMessageId = null } = {}) => {
        const proposal = buildRoleplayCheckProposal(rolls, playerAction, { challengeUsed, preNarrated, loot, setupNarrative, setupMessageId });
        if (!proposal) return false;
        dispatch({ type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal });
        setRoleplayChallenge('');
        setShowRoleplayChallenge(false);
        return true;
    };

    const finalizeRoleplayTurn = (playerAction) => {
        const latest = stateRef.current;
        const finalNarration = [...(latest.messages || [])].reverse()
            .find(message => message.role === 'assistant' && !message.hidden && message.content?.trim());
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
                    getState: () => stateRef.current,
                } : null,
            }).catch(() => {});
            const machineryKey = getMachineryGeminiKey(latest.settings);
            if (machineryKey) {
                const loc = latest.currentLocation;
                const narrativeText = loc
                    ? `[Location: ${loc}] ${finalNarration.content.slice(0, 500)}`
                    : finalNarration.content.slice(0, 500);
                addMemory(machineryKey, narrativeText, 'narrative').catch(() => {});
            }
        }
        runAutoSummarize();
    };

    const handleAcceptRoleplayCheck = async () => {
        const proposal = stateRef.current.pendingRoleplayCheck;
        if (!proposal || isLoading) return;
        dispatch({ type: 'CLEAR_ROLEPLAY_CHECK' });
        setIsLoading(true);
        setLoadingStatus('Rolling accepted check');
        let stagedFollowUp = false;
        try {
            await handleRequestedRolls(proposal.rolls, {
                getState: () => stateRef.current,
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
                dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', content: `Error resolving check: ${error.message}` } });
            }
        } finally {
            setIsLoading(false);
            setStreamingMessage('');
            setLoadingStatus('');
        }
    };

    const handleChallengeRoleplayCheck = async () => {
        const proposal = stateRef.current.pendingRoleplayCheck;
        const challenge = roleplayChallenge.trim();
        if (!proposal || proposal.challengeUsed || !challenge || isLoading) return;
        dispatch({ type: 'CLEAR_ROLEPLAY_CHECK' });
        dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: `**Roll challenge:** ${challenge}` } });
        setIsLoading(true);
        setLoadingStatus('DM reconsidering the ruling');
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
                const latest = stateRef.current;
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
            setIsLoading(false);
            setStreamingMessage('');
            setLoadingStatus('');
        }
    };

    const handleChangeRoleplayApproach = () => {
        // No dice will ever resolve this setup, so reveal it instead of erasing its
        // fiction — unless it pre-narrated an outcome that never happened.
        const proposal = stateRef.current.pendingRoleplayCheck;
        const setupMessage = proposal?.setupMessageId
            ? stateRef.current.messages.find(m => m.id === proposal.setupMessageId)
            : null;
        const revealSetup = !!(setupMessage?.hidden && setupMessage.content?.trim() && !proposal.preNarrated);
        if (revealSetup) dispatch({ type: 'REVEAL_MESSAGE', payload: { id: proposal.setupMessageId } });
        if (proposal) {
            // A set-aside ruling still binds the DM: an ordinary proposal must return
            // unchanged on a retry, and an upheld final ruling stays final.
            const ruling = buildRollRulingRecord(proposal, 'set_aside', {
                messageCount: (stateRef.current.messages || []).length,
                location: stateRef.current.currentLocation,
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
        setRoleplayChallenge('');
        setShowRoleplayChallenge(false);
    };

    /**
     * Handle the full send flow: user message → LLM → dice rolls → auto follow-up.
     */
    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed || isLoading) return;

        const startedCombatIntent = stateRef.current.combat?.active
            && stateRef.current.combat.phase === COMBAT_PHASES.AWAITING_PLAYER;
        if (startedCombatIntent) dispatch({ type: 'BEGIN_COMBAT_INTENT' });

        setInput('');
        // Reset textarea height to single line
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
        }

        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'user', content: trimmed },
        });
        const playerMachineryKey = getMachineryGeminiKey(stateRef.current.settings);
        if (playerMachineryKey) {
            const loc = stateRef.current.currentLocation;
            const playerText = loc
                ? `[Location: ${loc}] ${trimmed.slice(0, 500)}`
                : trimmed.slice(0, 500);
            addMemory(playerMachineryKey, playerText, 'player').catch(() => {});
        }

        setIsLoading(true);
        setStreamingMessage('');
        setLoadingStatus(startedCombatIntent ? 'Interpreting combat action' : '');

        try {
            let dmNarrative = '';
            const events = await sendToLLM(trimmed, trimmed, {
                combatIntentOnly: startedCombatIntent,
                onNarrative: text => { dmNarrative = text; },
            });

            const combatWasActive = stateRef.current.combat?.active;
            const combatStartedNow = !!events?.combatStart;
            let combatIntentHandled = false;
            if (events?.combatExchangeRejected) {
                combatIntentHandled = true;
                dispatch({
                    type: 'REJECT_COMBAT_EXCHANGE',
                    payload: { reason: 'The DM returned a malformed combat intent envelope.' },
                });
            } else if (events?.combatExchange && !combatStartedNow) {
                combatIntentHandled = true;
                commitCombatPlan(planCombatExchange(stateRef.current, events.combatExchange));
            } else if (events?.requestedRolls?.length > 0 && (combatWasActive || combatStartedNow)) {
                // Active combat never falls back to LLM-authored attack batches. An invalid
                // envelope costs nobody a turn and cannot produce a free enemy attack.
                combatIntentHandled = true;
                dispatch({ type: 'REJECT_COMBAT_EXCHANGE', payload: { reason: 'The DM requested legacy combat rolls instead of a committed action envelope.' } });
            } else if (events?.requestedRolls?.length > 0) {
                // Outside combat, dice do not exist until the player accepts the public
                // adjudication. Combat remains immediate and engine-owned above.
                const initialLoot = (events.goldFound || events.silverFound || events.copperFound || events.itemsFound?.length) ? {
                    goldFound: events.goldFound || 0,
                    silverFound: events.silverFound || 0,
                    copperFound: events.copperFound || 0,
                    itemsFound: events.itemsFound || [],
                } : null;
                // A hidden setup rides the proposal so its fiction survives: re-woven into
                // the post-roll outcome, or revealed if the player changes approach.
                // Prose-detected checks stay visible, so they carry no setup payload.
                stageRoleplayCheck(events.requestedRolls, trimmed, {
                    preNarrated: events._preNarratedOutcome,
                    loot: initialLoot,
                    setupNarrative: events._setupHidden ? dmNarrative : '',
                    setupMessageId: events._setupHidden ? events._setupMessageId : null,
                });
            } else if (events?._playerAuthorityRollRejected) {
                await sendToLLM(playerAuthorityRollCorrectionPrompt(), null, { narrationOnly: true });
            }
            if (startedCombatIntent && !combatIntentHandled) {
                dispatch({ type: 'CANCEL_COMBAT_INTENT' });
            }

            // Extract world-state from the FINAL narrated outcome (where the real facts
            // live), now that any roll chain has resolved. Covers no-roll turns too, and
            // skips the withheld pre-roll setup (flagged hidden).
            const latest = stateRef.current;
            const waitsForResolution = !!events?.combatExchange
                || combatStartedNow
                || !!events?.requestedRolls?.length;
            const finalNarration = waitsForResolution ? null : [...latest.messages].reverse()
                .find(m => m.role === 'assistant' && !m.hidden && m.content?.trim());
            if (finalNarration) {
                runScribe({
                    playerMessage: trimmed,
                    dmNarrative: finalNarration.content,
                    settings: latest.settings,
                    dispatch,
                    knownAppearances: buildKnownAppearances(latest, trimmed, finalNarration.content),
                    knownStances: buildKnownStances(latest, trimmed, finalNarration.content),
                    // Loot persistence audit: recover coins/items the narrative granted
                    // but the DM's structured events missed. Out-of-combat only; keyed
                    // to the narration message so retries/reloads cannot double-grant.
                    lootAudit: (!latest.combat?.active && finalNarration.id) ? {
                        sourceId: `${finalNarration.id}:scribe-loot`,
                        appliedEvents: finalNarration.events || null,
                        getState: () => stateRef.current,
                    } : null,
                }).catch(() => {});
                const machineryKey = getMachineryGeminiKey(latest.settings);
                if (machineryKey) {
                    const loc = latest.currentLocation;
                    const narrativeText = loc
                        ? `[Location: ${loc}] ${finalNarration.content.slice(0, 500)}`
                        : finalNarration.content.slice(0, 500);
                    addMemory(machineryKey, narrativeText, 'narrative').catch(() => {});
                }
            }

            runAutoSummarize(waitsForResolution);

        } catch (error) {
            if (startedCombatIntent) dispatch({ type: 'CANCEL_COMBAT_INTENT' });
            if (error.name !== 'AbortError') {
                dispatch({
                    type: 'ADD_MESSAGE',
                    payload: {
                        role: 'system',
                        content: `Error: ${error.message}`,
                    },
                });
            }
        } finally {
            setIsLoading(false);
            setStreamingMessage('');
            setLoadingStatus('');
            // Prevent auto-focusing on mobile to stop the virtual keyboard from forcing 
            // the whole app layout to suddenly scroll up, which hides the top header.
            if (window.innerWidth > 768) {
                inputRef.current?.focus();
            }
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
            // Reset height after send
            if (inputRef.current) {
                inputRef.current.style.height = 'auto';
            }
        }
    };

    const handleInput = (e) => {
        setInput(e.target.value);
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 150)}px`;
        }
    };

    const handleStop = () => {
        abortControllerRef.current?.abort();
    };

    const handleRetryCombatNarration = () => {
        const exchangeId = stateRef.current.combat?.lastExchangeResult?.exchangeId;
        if (!exchangeId) return;
        narratedCombatExchangeIdsRef.current.delete(exchangeId);
        setCombatNarrationRetry(value => value + 1);
    };

    // Playing without the Gemini machinery (RAG, Scribe, journal, loot audit)
    // isn't a degraded mode — it quietly rots a campaign. Both keys or no play.
    const hasApiKey = !!state.settings.apiKey;
    const machineryReady = isMachineryReady(state.settings);
    const readyToPlay = hasApiKey && machineryReady;
    const missingKeyHint = !hasApiKey
        ? 'Set your DM API key in Settings to begin your quest.'
        : 'Set your Gemini API key in Settings — the game’s memory (Scribe, journal, RAG) requires it.';
    const awaitingCombatNarration = state.combat?.phase === COMBAT_PHASES.AWAITING_NARRATION;
    const pendingRoleplayCheck = state.pendingRoleplayCheck;
    const combatInputLocked = state.combat?.active && (
        state.combat.phase !== COMBAT_PHASES.AWAITING_PLAYER || !!state.combat.queuedExchange
    );

    return (
        <div className="chat-panel">
            <div className="chat-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
                {state.messages.length === 0 && (
                    <div className="chat-empty">
                        <div className="chat-empty-icon" aria-hidden="true" />
                        <h3>Your Adventure Awaits</h3>
                        <p>
                            {readyToPlay
                                ? 'Send a message to begin your quest. The Dungeon Master is ready.'
                                : missingKeyHint}
                        </p>
                    </div>
                )}

                {state.messages.map((msg) => (
                    <ChatMessage key={msg.id} message={msg} />
                ))}

                {isLoading && streamingMessage && (
                    <div className="chat-message assistant streaming">
                        <div className="message-avatar">DM</div>
                        <div className="message-content">
                            <div className="message-role">Dungeon Master</div>
                            <div className="message-text">{cleanDisplayText(streamingMessage)}</div>
                        </div>
                    </div>
                )}

                {isLoading && !streamingMessage && (
                    <div className="chat-message assistant streaming">
                        <div className="message-avatar">DM</div>
                        <div className="message-content">
                            <div className="message-role">Dungeon Master</div>
                            <div className="message-text typing-indicator">
                                {loadingStatus && <span className="loading-status">{loadingStatus}</span>}
                                <span></span><span></span><span></span>
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {showJumpToLatest && (
                <button className="chat-jump-latest" onClick={jumpToLatest} title="Jump to the latest message">
                    ↓ Latest
                </button>
            )}

            {state.combat?.active && <CombatPanel />}

            {pendingRoleplayCheck && !state.combat?.active && (
                <RoleplayCheckPanel
                    proposal={pendingRoleplayCheck}
                    challenge={roleplayChallenge}
                    showChallenge={showRoleplayChallenge}
                    disabled={isLoading}
                    onAccept={handleAcceptRoleplayCheck}
                    onShowChallenge={() => setShowRoleplayChallenge(true)}
                    onChallengeChange={setRoleplayChallenge}
                    onSubmitChallenge={handleChallengeRoleplayCheck}
                    onChangeApproach={handleChangeRoleplayApproach}
                />
            )}

            <div className="chat-input-area">
                <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={input}
                    onInput={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder={!readyToPlay
                        ? missingKeyHint
                        : state.combat?.active
                            ? 'Describe your combat action (e.g., attack the goblin)...'
                            : 'What do you do?'}
                    disabled={!readyToPlay || isLoading || combatInputLocked || !!pendingRoleplayCheck}
                    maxLength={4000}
                    rows={1}
                />
                {isLoading ? (
                    <button className="chat-stop-btn" onClick={handleStop} title="Stop generating">
                        Stop
                    </button>
                ) : awaitingCombatNarration ? (
                    <button
                        className="chat-send-btn"
                        onClick={handleRetryCombatNarration}
                        disabled={!readyToPlay}
                        title="Retry combat narration without rerolling"
                    >
                        Retry narration
                    </button>
                ) : (
                    <button
                        className="chat-send-btn"
                        onClick={handleSend}
                        disabled={!input.trim() || !readyToPlay || combatInputLocked || !!pendingRoleplayCheck}
                        title="Send message"
                    >
                        Send
                    </button>
                )}
            </div>
        </div>
    );
}

function RoleplayCheckPanel({
    proposal,
    challenge,
    showChallenge,
    disabled,
    onAccept,
    onShowChallenge,
    onChallengeChange,
    onSubmitChallenge,
    onChangeApproach,
}) {
    return (
        <section className="roleplay-check-panel" aria-label="Proposed roleplay check">
            <div className="roleplay-check-heading">
                <div>
                    <span className="roleplay-check-kicker">DM ruling · no dice rolled yet</span>
                    <h3>Proposed roleplay check</h3>
                </div>
                {proposal.challengeUsed && <span className="roleplay-check-final">Final ruling</span>}
            </div>

            {proposal.rolls.map((roll, index) => (
                <div className="roleplay-check-roll" key={`${roll.type}-${roll.skill}-${index}`}>
                    <div className="roleplay-check-title">
                        <strong>{roll.description || `${roll.skill || 'Ability'} check`}</strong>
                        <span>DC {roll.dc}</span>
                        {roll.advantage && <span className="roleplay-check-edge">Advantage</span>}
                        {roll.disadvantage && <span className="roleplay-check-edge danger">Disadvantage</span>}
                    </div>
                    <dl className="roleplay-check-reasoning">
                        <div><dt>Why roll?</dt><dd>{roll.reason || 'The DM did not provide a specific justification.'}</dd></div>
                        <div><dt>Opposition</dt><dd>{roll.opposition || 'No active opposition was specified.'}</dd></div>
                        <div><dt>Failure stakes</dt><dd>{roll.failureStakes || 'No distinct failure consequence was specified.'}</dd></div>
                        <div><dt>Why this DC?</dt><dd>{roll.difficultyReason || 'No difficulty basis was specified.'}</dd></div>
                        {(roll.advantage || roll.disadvantage) && (
                            <div>
                                <dt>Situation</dt>
                                <dd>{(roll.advantage ? roll.advantageReason : roll.disadvantageReason) || 'No situational reason was specified.'}</dd>
                            </div>
                        )}
                    </dl>
                </div>
            ))}

            {showChallenge && !proposal.challengeUsed && (
                <div className="roleplay-check-challenge">
                    <label htmlFor="roleplay-check-challenge">Why should this ruling change?</label>
                    <textarea
                        id="roleplay-check-challenge"
                        value={challenge}
                        onChange={event => onChallengeChange(event.target.value)}
                        placeholder="Explain what removes the uncertainty, lowers the DC, or grants advantage..."
                        maxLength={2000}
                        rows={3}
                        disabled={disabled}
                    />
                    <div className="roleplay-check-challenge-actions">
                        <button className="btn btn-secondary" onClick={onSubmitChallenge} disabled={disabled || !challenge.trim()}>Send challenge</button>
                    </div>
                </div>
            )}

            <div className="roleplay-check-actions">
                <button className="btn btn-primary" onClick={onAccept} disabled={disabled}>Roll</button>
                {!proposal.challengeUsed && !showChallenge && (
                    <button className="btn btn-secondary" onClick={onShowChallenge} disabled={disabled}>Challenge ruling</button>
                )}
                <button className="btn btn-secondary" onClick={onChangeApproach} disabled={disabled}>Change approach</button>
            </div>
        </section>
    );
}

function ChatMessage({ message }) {
    const roleLabels = {
        user: 'You',
        assistant: 'Dungeon Master',
        system: 'System',
    };

    const avatars = {
        user: 'You',
        assistant: 'DM',
        system: 'Sys',
    };

    if (message.hidden) return null;

    return (
        <div className={`chat-message ${message.role}`}>
            <div className="message-avatar">{avatars[message.role]}</div>
            <div className="message-content">
                <div className="message-role">{roleLabels[message.role]}</div>
                {message.revealedSetup && (
                    <div className="message-setup-note">Revealed after the check was set aside — no dice were rolled.</div>
                )}
                <div className="message-text">
                    <MarkdownText text={cleanDisplayText(message.content)} />
                </div>
            </div>
        </div>
    );
}

