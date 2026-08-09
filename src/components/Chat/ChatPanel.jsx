import { useState, useRef, useEffect, memo } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { sendMessage, streamMessage } from '../../llm/adapter.js';
import { createTurnRunner } from '../../llm/turnOrchestrator.js';
import { playerAuthorityRollCorrectionPrompt } from '../../engine/outOfCombatRollPolicy.js';
import { combatNarrationPrompt, COMBAT_PHASES, planCombatExchange, planOpeningExchange } from '../../engine/combatExchange.js';
import { reconcileDeclaredSpells } from '../../engine/declaredSpells.js';
import { buildKnownAppearances, buildKnownStances, runScribe } from '../../llm/scribe.js';
import { isTableTalkMessage } from '../../llm/tableTalk.js';
import { addMemory, seedMemories } from '../../engine/vectorMemory.js';
import { getMachineryGeminiKey, isMachineryReady } from '../../llm/machinery.js';
import { generateCampaignFronts, shouldGenerateCampaignFronts } from '../../llm/frontDirector.js';
import { generateFrontAftermath, shouldGenerateFrontAftermath } from '../../llm/frontAftermath.js';
import { generateAbsenceDrift, shouldGenerateAbsenceDrift } from '../../llm/absenceDrift.js';
import { generateRegionalFronts, shouldGenerateRegionalFronts } from '../../llm/regionalFronts.js';
import { formatSecrecyTag } from '../../engine/storyMemory.js';
import { buildCampaignOpeningPrompt, shouldPrimeCampaignOpening } from './sessionPriming.js';
import { needsSpellCastNarration, routeTurnEvents, TURN_ROUTES } from './eventRouting.js';
import CombatPanel from '../Combat/CombatPanel.jsx';
import MarkdownText from './MarkdownText.jsx';
import './Chat.css';

/**
 * How many transcript messages mount as DOM at once. An "infinite campaign on a
 * phone" must not mount thousands of nodes — older play is one "Load earlier"
 * click away and still lives in saves/journal/RAG regardless.
 */
const RENDERED_MESSAGE_WINDOW = 150;
// Opening-scene priming attempts per API key: enough to absorb the StrictMode
// dev double-mount abort and one transient failure, without looping a bad key.
const MAX_PRIMING_ATTEMPTS = 3;
const DECORATIVE_SYMBOL_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?/gu;

function cleanDisplayText(text) {
    return String(text || '').replace(DECORATIVE_SYMBOL_RE, '').replace(/[ \t]{2,}/g, ' ').trimStart();
}

export default function ChatPanel() {
    const { state, dispatch } = useGame();
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [streamingMessage, setStreamingMessage] = useState('');
    const [renderWindow, setRenderWindow] = useState(RENDERED_MESSAGE_WINDOW);
    const [loadingStatus, setLoadingStatus] = useState('');
    const [combatNarrationRetry, setCombatNarrationRetry] = useState(0);
    const [roleplayChallenge, setRoleplayChallenge] = useState('');
    const [showRoleplayChallenge, setShowRoleplayChallenge] = useState(false);
    const messagesContainerRef = useRef(null);
    const stickToBottomRef = useRef(true); // Follow new content only while the reader is at the bottom
    const [showJumpToLatest, setShowJumpToLatest] = useState(false);
    const abortControllerRef = useRef(null);
    const inputRef = useRef(null);
    const hasPrimedRef = useRef(false); // True while an opening-scene attempt is in flight (reset on failure so it can retry)
    const [primingRetryToken, setPrimingRetryToken] = useState(0); // Bumped after a failed attempt to re-arm the priming effect
    const primingAttemptsRef = useRef(0); // Bounded so a persistently failing key can't loop the opening call
    const primingKeyRef = useRef(undefined); // Last apiKey seen by the priming effect; a change resets the attempt budget
    const memorySeededRef = useRef(false); // Ensure RAG seeding only fires once per mount
    const pendingStreamTextRef = useRef(''); // Latest fence-frozen display text from the turn runner
    const narratedCueIdsRef = useRef(new Set()); // Mechanic system messages already given an LLM flavor beat
    const narratedCombatExchangeIdsRef = useRef(new Set()); // Prevent duplicate narration calls for one mechanics commit
    const frontGenerationSessionRef = useRef(null); // One private generation request per fresh campaign at a time
    const aftermathFrontRef = useRef(null); // One aftermath request per resolved front at a time
    const absenceDriftRef = useRef(null); // One absence-drift request per qualifying return at a time
    const regionalFrontsRef = useRef(null); // One native-pressure generation per newly entered region at a time

    // Use a ref to always read the latest state inside async callbacks
    const stateRef = useRef(state);
    stateRef.current = state;

    // Streaming display paints are coalesced to one per animation frame: a raw
    // per-chunk setState re-renders the whole transcript O(campaign × chunks)
    // per DM turn (2026-07-30 audit). The turn runner supplies chunk-accurate
    // display text; only the paint is throttled.
    const streamPaintRafRef = useRef(0);

    const cancelScheduledStreamPaint = () => {
        if (streamPaintRafRef.current) {
            cancelAnimationFrame(streamPaintRafRef.current);
            streamPaintRafRef.current = 0;
        }
    };

    // Every clear must go through here: a clear that leaves a scheduled paint
    // behind lets the next frame resurrect the cleared text — including a
    // withheld roll-setup narration that must stay hidden.
    const clearStreamingDisplay = () => {
        cancelScheduledStreamPaint();
        setStreamingMessage('');
    };

    useEffect(() => cancelScheduledStreamPaint, []);

    // One mount = one campaign (AppShell is keyed by session id). When this
    // mount dies — campaign switch, New Game, boundary reset — abort any
    // in-flight DM turn and refuse its late results: a stream resolving after
    // unmount must never dispatch events into whatever campaign is live now.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            abortControllerRef.current?.abort();
        };
    }, []);

    // The async turn pipeline (sendToLLM, roleplay-check flow, missing-events
    // nudge, auto-summarize) lives in llm/turnOrchestrator.js as a plain,
    // unit-tested module. One runner per mount = one campaign; every dep reads
    // through stable refs/setters so the first-render instance never goes stale.
    const runnerRef = useRef(null);
    if (!runnerRef.current) {
        runnerRef.current = createTurnRunner({
            getState: () => stateRef.current,
            dispatch,
            streamMessage,
            sendMessage,
            isMounted: () => mountedRef.current,
            setAbortController: (controller) => { abortControllerRef.current = controller; },
            onStreamChunkText: (text) => {
                pendingStreamTextRef.current = text;
                if (streamPaintRafRef.current) return; // a paint is already scheduled for this frame
                streamPaintRafRef.current = requestAnimationFrame(() => {
                    streamPaintRafRef.current = 0;
                    setStreamingMessage(pendingStreamTextRef.current);
                });
            },
            clearStreamingDisplay,
            setLoading: setIsLoading,
            onStatus: setLoadingStatus,
            resetRoleplayChallengeUi: () => {
                setRoleplayChallenge('');
                setShowRoleplayChallenge(false);
            },
        });
    }
    const runner = runnerRef.current;

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

    // Scroll ONLY the messages container. scrollIntoView walks every scrollable
    // ancestor — including the overflow:hidden .app-shell, which it can leave
    // permanently scrolled (header off-screen, input buried under the combat panel)
    // since a hidden-overflow container gives the user no way to scroll back.
    const scrollMessagesToBottom = (smooth = false) => {
        const el = messagesContainerRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    };

    const jumpToLatest = () => {
        stickToBottomRef.current = true;
        setShowJumpToLatest(false);
        scrollMessagesToBottom(true);
    };

    useEffect(() => {
        // Instant (not smooth) keeps the follow reliable during streaming: a smooth
        // animation still in flight reads as "not at bottom" and would break the stick.
        if (stickToBottomRef.current) {
            scrollMessagesToBottom();
        }
    }, [state.messages, streamingMessage]);

    /**
     * Fresh-campaign priming: auto-trigger the DM to set the opening scene only when
     * character creation explicitly marked it pending. Continue/Load must never create
     * an unsolicited DM turn merely because older assistant messages were summarized.
     *
     * Retry-safe since the Codex playtest P0 (2026-08-09): the old version consumed
     * `openingScenePending` BEFORE the call and never retried, so React StrictMode's
     * dev double-mount (whose cleanup aborts the in-flight turn) permanently stalled
     * every fresh premise campaign — AbortError, no opening, reload can't recover.
     * Now the marker is consumed only after the opening actually commits, a failed
     * attempt re-arms itself (bounded), and a late-arriving API key (begin without a
     * key, set it in Settings) triggers the opening it used to silently skip.
     * shouldPrimeCampaignOpening goes false once any visible assistant message
     * exists, so a player who starts manually can never receive a stray opening.
     */
    useEffect(() => {
        const s = stateRef.current;
        if (primingKeyRef.current !== s.settings?.apiKey) {
            primingKeyRef.current = s.settings?.apiKey;
            primingAttemptsRef.current = 0; // a new key is a fresh chance
        }
        if (!shouldPrimeCampaignOpening(s) || hasPrimedRef.current) return;
        if (primingAttemptsRef.current >= MAX_PRIMING_ATTEMPTS) return;
        hasPrimedRef.current = true;
        primingAttemptsRef.current += 1;
        setIsLoading(true);

        // The authored premise and live starting inventory are already in the system
        // prompt. The one-time opening also reconciles explicit premise possessions.
        runner.sendToLLM(buildCampaignOpeningPrompt(), null, { openingScene: true })
            .then(() => {
                // The committed-turn record, never a state read: stateRef has not
                // re-rendered yet in this task (live playtest #6's stale-Scribe root
                // cause — the first draft of this check re-made that exact bug).
                const committed = runner.getLastCommittedTurn();
                if (!committed || committed.hidden || !committed.content?.trim()) {
                    throw new Error('opening scene did not commit');
                }
                dispatch({ type: 'UPDATE_SESSION', payload: { openingScenePending: false } });
            })
            .catch(e => {
                console.warn('[Priming] Session start priming failed:', e);
                hasPrimedRef.current = false;
                if (!mountedRef.current) return; // real unmount: the next mount retries
                if (primingAttemptsRef.current < MAX_PRIMING_ATTEMPTS) {
                    setPrimingRetryToken(t => t + 1);
                } else {
                    dispatch({
                        type: 'ADD_MESSAGE',
                        payload: {
                            role: 'system',
                            content: '**The opening scene could not be generated.** Check your AI provider settings, then reload to retry — or simply describe your first action to begin.',
                        },
                    });
                }
            })
            .finally(() => {
                setIsLoading(false);
                clearStreamingDisplay();
            });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [primingRetryToken, state.settings?.apiKey]);

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
     * Front aftermath: a resolved front leaves a pending flag; a private DM-model
     * call decides what the victory leaves behind (0–2 successor pressures, often
     * none). Fire-and-forget like initial front generation — the reducer's
     * one-shot pending guard makes a late or duplicate result harmless, and a
     * failed call retries on the next dependency change.
     */
    useEffect(() => {
        const s = stateRef.current;
        const pending = s.session?.pendingFrontAftermath;
        if (!pending || !shouldGenerateFrontAftermath(s) || aftermathFrontRef.current === pending.frontId) return;
        const sessionId = s.session.id;
        const frontId = pending.frontId;
        aftermathFrontRef.current = frontId;
        generateFrontAftermath(s)
            .then(fronts => {
                dispatch({ type: 'INSTALL_AFTERMATH_FRONTS', payload: { sessionId, frontId, fronts } });
                console.info(`[Fronts] Aftermath of ${frontId}: ${fronts.length} successor pressure(s) proposed.`);
            })
            .catch(error => {
                console.warn('[Fronts] Aftermath generation failed; will retry:', error.message || error);
                if (aftermathFrontRef.current === frontId) aftermathFrontRef.current = null;
            });
    }, [state.session?.pendingFrontAftermath?.frontId, state.settings.apiKey, state.combat?.active, dispatch]);

    /**
     * Absence drift (DECISIONS.md 2026-08-05): returning to a known place after
     * a long absence raises a one-shot session marker; a private DM-model call
     * proposes what happened THERE while the hero was away. Fire-and-forget like
     * front aftermath — INSTALL_ABSENCE_DRIFT re-validates everything, a stale
     * or duplicate result is dropped, and a failed call retries on the next
     * dependency change.
     */
    useEffect(() => {
        const s = stateRef.current;
        const pending = s.session?.pendingAbsenceDrift;
        if (!pending || !shouldGenerateAbsenceDrift(s) || absenceDriftRef.current === pending.key) return;
        const sessionId = s.session.id;
        const key = pending.key;
        absenceDriftRef.current = key;
        generateAbsenceDrift(s)
            .then(drift => {
                dispatch({ type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId, key, drift } });
                console.info(`[LivingWorld] Absence drift for ${pending.locationName}: ${drift.developments.length} development(s)${drift.worldFact ? ' + fact' : ''}${drift.frontSymptom ? ' + symptom' : ''}.`);
            })
            .catch(error => {
                console.warn('[LivingWorld] Absence-drift generation failed; will retry:', error.message || error);
                if (absenceDriftRef.current === key) absenceDriftRef.current = null;
            });
    }, [state.session?.pendingAbsenceDrift?.key, state.settings.apiKey, state.combat?.active, dispatch]);

    /**
     * Regional front seeding (world-tempo component 9, DECISIONS.md 2026-08-05):
     * entering a genuinely new named region raises a one-shot marker; a private
     * DM-model call proposes 1–2 pressures NATIVE to that land, installed with
     * the arrival place as their theater. Same fire-and-forget contract as the
     * other living-world directors.
     */
    useEffect(() => {
        const s = stateRef.current;
        const pending = s.session?.pendingRegionalFronts;
        if (!pending || !shouldGenerateRegionalFronts(s) || regionalFrontsRef.current === pending.key) return;
        const sessionId = s.session.id;
        const key = pending.key;
        regionalFrontsRef.current = key;
        generateRegionalFronts(s)
            .then(fronts => {
                dispatch({ type: 'INSTALL_REGIONAL_FRONTS', payload: { sessionId, key, fronts } });
                console.info(`[LivingWorld] Native pressures for ${pending.region}: ${fronts.length} proposed.`);
            })
            .catch(error => {
                console.warn('[LivingWorld] Regional front seeding failed; will retry:', error.message || error);
                if (regionalFrontsRef.current === key) regionalFrontsRef.current = null;
            });
    }, [state.session?.pendingRegionalFronts?.key, state.settings.apiKey, state.combat?.active, dispatch]);

    /**
     * RAG seeding: embed all existing world facts and journal summaries once on mount.
     * New memories are added incrementally as play continues.
     */
    useEffect(() => {
        const s = stateRef.current;
        const machineryKey = getMachineryGeminiKey(s.settings);
        if (!machineryKey || memorySeededRef.current) return;

        memorySeededRef.current = true; // Prevent concurrent attempts

        const items = [
            // Secret facts/cards keep their knower boundary inside the embedded
            // text, so a RAG hit re-surfaces the SECRET tag along with the canon.
            ...(s.worldFacts || []).map(f => ({ text: `${formatSecrecyTag(f.knownBy)}${f.fact}`, category: f.category || 'world_fact' })),
            ...(s.journal || []).map(j => ({ text: j.summary, category: 'journal', location: j.location })),
            ...(s.npcs || []).filter(n => n.lastNotes || n.notes).map(n => ({
                text: `${n.name} (${n.disposition || 'unknown'}): ${n.lastNotes || n.notes}`,
                category: 'npc',
                location: n.basedIn || n.lastLocation,
            })),
            // Non-active cards stay out of retrieval: a resolved promise or a
            // dormant scene beat retrieving beside live ones invites the DM to
            // revive a paid-off arc (2026-08-06 audit). Their cached rows are
            // mutable-category, so the seed prune also drops them from disk.
            ...(s.storyMemory || []).filter(m => (m.status || 'active') === 'active').map(m => ({
                text: `${formatSecrecyTag(m.knownBy)}${m.subject ? `${m.subject}: ` : ''}${m.text}`,
                category: `story_${m.type || 'callback'}`,
                location: m.location,
            })),
        ];

        // Campaign-keyed seeding (v4): loads THIS campaign's cached embeddings and
        // re-embeds only what's missing — no wipe, no cross-campaign leakage, and a
        // page reload no longer re-embeds the whole corpus. One mount = one campaign
        // (AppShell is keyed by session id), so mount-time seeding is sound.
        seedMemories(machineryKey, items, s.session?.id || null)
            .catch((e) => {
                console.error('[RAG] Memory seeding failed — will retry next mount:', e);
                memorySeededRef.current = false; // Allow retry on next mount
            });
        // Re-runs when the machinery key first appears (a key entered in
        // Settings after mount previously left the session unseeded AND its
        // live embeds unpersisted for the whole session — 2026-08-06 audit);
        // memorySeededRef keeps this one-shot once a seed succeeds.
    }, [!!getMachineryGeminiKey(state.settings)]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const s = stateRef.current;
        if (!s.settings.apiKey || isLoading) return;
        const cueMessage = (s.messages || [])
            .findLast(m => m.role === 'system' && m.narrationCue && !narratedCueIdsRef.current.has(m.id));
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
        clearStreamingDisplay();
        runner.sendToLLM(narrationRequest, null, { narrationOnly: true })
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
                clearStreamingDisplay();
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
        clearStreamingDisplay();
        setLoadingStatus('Narrating combat outcome');
        runner.sendToLLM(combatNarrationPrompt(result), null, {
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
                        addMemory(machineryKey, narrativeText, 'narrative', loc).catch(() => {});
                    }
                }
                runner.runAutoSummarize();
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
                clearStreamingDisplay();
                setLoadingStatus('');
            });
    // sendToLLM is intentionally driven only by the persisted exchange identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.combat?.phase, state.combat?.lastExchangeResult?.exchangeId, isLoading, combatNarrationRetry]);

    // The roleplay-check accept/challenge/change flow lives in the turn runner;
    // these handlers keep only the component-side UI guards (isLoading, the
    // challenge textarea text) and delegate everything else.
    const handleAcceptRoleplayCheck = () => {
        if (isLoading) return;
        runner.acceptRoleplayCheck();
    };

    const handleChallengeRoleplayCheck = () => {
        if (isLoading) return;
        runner.challengeRoleplayCheck(roleplayChallenge);
    };

    const handleChangeRoleplayApproach = () => {
        runner.changeRoleplayApproach();
    };

    /**
     * Handle the full send flow: user message → LLM → dice rolls → auto follow-up.
     */
    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed || isLoading) return;

        // Explicit OOC table talk ("OOC: ...", "DM, ...") is a question to the DM,
        // never a character action: it must not enter the combat-intent machine,
        // seed memory, or run the Scribe — the world is paused for one exchange.
        const tableTalkTurn = isTableTalkMessage(trimmed);
        const startedCombatIntent = !tableTalkTurn
            && stateRef.current.combat?.active
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
        if (playerMachineryKey && !tableTalkTurn) {
            const loc = stateRef.current.currentLocation;
            const playerText = loc
                ? `[Location: ${loc}] ${trimmed.slice(0, 500)}`
                : trimmed.slice(0, 500);
            addMemory(playerMachineryKey, playerText, 'player', loc).catch(() => {});
        }

        setIsLoading(true);
        clearStreamingDisplay();
        setLoadingStatus(startedCombatIntent ? 'Interpreting combat action' : (tableTalkTurn ? 'Table talk with the DM' : ''));

        try {
            let dmNarrative = '';
            const events = await runner.sendToLLM(trimmed, trimmed, {
                combatIntentOnly: startedCombatIntent,
                tableTalk: tableTalkTurn,
                onNarrative: text => { dmNarrative = text; },
            });

            const combatStartedNow = !!events?.combatStart;
            // The routing decision is pure and unit-tested in eventRouting.js;
            // this switch only executes the chosen route's side effects.
            const routed = routeTurnEvents(events, { combatWasActive: stateRef.current.combat?.active });
            const combatIntentHandled = routed.combatIntentHandled;
            if (routed.route === TURN_ROUTES.COMBAT_REJECTED
                || routed.route === TURN_ROUTES.IN_COMBAT_ROLLS_REJECTED) {
                dispatch({ type: 'REJECT_COMBAT_EXCHANGE', payload: { reason: routed.reason } });
            } else if (routed.route === TURN_ROUTES.COMBAT_EXCHANGE) {
                // Declared-spell reconciliation (playtest #4): honor a castable
                // spell the player named, and say so out loud when the DM's
                // translation adapted or dropped named magic. Returns a NEW
                // exchange — the stored intent message is never mutated.
                const reconciled = reconcileDeclaredSpells(trimmed, events.combatExchange, stateRef.current.character);
                for (const note of reconciled.notes) {
                    dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', content: note } });
                }
                commitCombatPlan(planCombatExchange(stateRef.current, reconciled.exchange));
            } else if (routed.route === TURN_ROUTES.ROLL_PROPOSAL) {
                // A hidden setup rides the proposal so its fiction survives: re-woven into
                // the post-roll outcome, or revealed if the player changes approach.
                // Prose-detected checks stay visible, so they carry no setup payload.
                runner.stageRoleplayCheck(events.requestedRolls, trimmed, {
                    preNarrated: events._preNarratedOutcome,
                    loot: routed.proposalLoot,
                    setupNarrative: events._setupHidden ? dmNarrative : '',
                    setupMessageId: events._setupHidden ? events._setupMessageId : null,
                });
            } else if (routed.route === TURN_ROUTES.AUTHORITY_CORRECTION) {
                await runner.sendToLLM(playerAuthorityRollCorrectionPrompt(), null, { narrationOnly: true });
            }
            if (startedCombatIntent && !combatIntentHandled) {
                dispatch({ type: 'CANCEL_COMBAT_INTENT' });
            }

            // The JSON-only spell_cast backstop condition lives in eventRouting.js.
            if (needsSpellCastNarration(events, {
                dmNarrative,
                combatIntentHandled,
                combatActive: stateRef.current.combat?.active,
            })) {
                const castResults = [...stateRef.current.messages].slice(-1 - events.spellCasts.length)
                    .filter(m => m.role === 'system' && /casts /i.test(m.content || ''))
                    .map(m => m.content)
                    .join(' ');
                const castNarrationRequest = [
                    '[SYSTEM: Your previous response declared a spell casting but contained no prose — the player saw nothing.',
                    'The engine has already resolved the mechanics; do not emit spell_cast again or any JSON.',
                    'Narrate the casting and what the magic does, reveals, opens, or aids, in 1-3 short paragraphs, unvarnished, continuing the same scene.',
                    'Do not state healing numbers or slot counts; the system line already reported them.',
                    castResults ? `Engine result to interpret fictionally: ${castResults}]` : ']',
                ].join(' ');
                await runner.sendToLLM(castNarrationRequest, null, { narrationOnly: true });
            }

            // Extract world-state from the FINAL narrated outcome (where the real facts
            // live), now that any roll chain has resolved. Covers no-roll turns too, and
            // skips the withheld pre-roll setup (flagged hidden).
            const latest = stateRef.current;
            const waitsForResolution = !!events?.combatExchange
                || combatStartedNow
                || !!events?.requestedRolls?.length;
            // An OOC exchange is meta conversation, not fiction: extracting facts,
            // NPC updates, or memories from it would canonize table talk.
            // The narration comes from the runner's committed-turn record, never a
            // state read: the ADD_MESSAGE render has not flushed yet in this task,
            // so findLast(assistant) here returned the PREVIOUS turn's message —
            // the Scribe was extracting from one narrative behind (live playtest #6).
            const committed = runner.getLastCommittedTurn();
            const finalNarration = (waitsForResolution || tableTalkTurn
                || !committed || committed.hidden || !committed.content?.trim())
                ? null
                : committed;
            if (finalNarration) {
                runScribe({
                    playerMessage: trimmed,
                    dmNarrative: finalNarration.content,
                    settings: latest.settings,
                    dispatch,
                    knownAppearances: buildKnownAppearances(latest, trimmed, finalNarration.content),
                    knownStances: buildKnownStances(latest, trimmed, finalNarration.content),
                    // The DM's own location event (already applied) outranks the async
                    // Scribe for this turn: the Scribe's location downgrades to
                    // confirm-or-fill so it can never relocate the hero backwards.
                    dmLocationEvent: finalNarration.events?.location || null,
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
                    addMemory(machineryKey, narrativeText, 'narrative', loc).catch(() => {});
                }
            }

            // A turn awaiting dice resolution summarizes after the outcome lands, not mid-split.
            if (!waitsForResolution) runner.runAutoSummarize();

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
            clearStreamingDisplay();
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

                {state.messages.length > renderWindow && (
                    <button
                        className="chat-load-earlier"
                        onClick={() => setRenderWindow(w => w + RENDERED_MESSAGE_WINDOW)}
                    >
                        Load earlier messages ({state.messages.length - renderWindow} more)
                    </button>
                )}

                {(state.messages.length > renderWindow
                    ? state.messages.slice(-renderWindow)
                    : state.messages
                ).map((msg) => (
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

// Memoized: message objects are immutable once appended, so a streaming-paint
// re-render of the panel must not re-render (and re-parse markdown for) every
// transcript message — that was O(campaign × chunks) per DM turn.
const ChatMessage = memo(function ChatMessage({ message }) {
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
});

