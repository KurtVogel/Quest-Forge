import { useState, useRef, useEffect } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { streamMessage } from '../../llm/adapter.js';
import { buildSystemPrompt } from '../../llm/promptBuilder.js';
import { parseResponse, applyEvents, detectPreNarratedOutcome } from '../../llm/responseParser.js';
import { handleRequestedRolls } from '../../engine/rollResolver.js';
import { maybeAutoSummarize } from '../../engine/worldJournal.js';
import { runScribe } from '../../llm/scribe.js';
import { addMemory, seedMemories, retrieveRelevant, clearMemories } from '../../engine/vectorMemory.js';
import { curateStoryMemory } from '../../engine/storyMemory.js';
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
    const messagesEndRef = useRef(null);
    const abortControllerRef = useRef(null);
    const inputRef = useRef(null);
    const lastSummarizedRef = useRef(state.session?.prunedMessageCount || 0);
    const hasPrimedRef = useRef(false); // Ensure session priming only fires once per mount
    const memorySeededRef = useRef(false); // Ensure RAG seeding only fires once per mount
    const streamBufferRef = useRef(''); // Accumulated streaming text for JSON fence detection
    const narratedCueIdsRef = useRef(new Set()); // Mechanic system messages already given an LLM flavor beat

    // Use a ref to always read the latest state inside async callbacks
    const stateRef = useRef(state);
    stateRef.current = state;

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state.messages, streamingMessage]);

    /**
     * Session-start priming: auto-trigger the DM to set the opening scene, so play never
     * begins on a blank "type something to start" box. Fires once per mount, when the DM
     * hasn't spoken yet, in two cases:
     *   - Fresh campaign: the player authored a premise at creation → open the scene from it.
     *   - Resumed campaign: there's prior history (journal/world facts/NPCs) → recap + set scene.
     */
    useEffect(() => {
        const s = stateRef.current;
        const hasCharacter = !!s.character;
        // Prime while the DM has yet to narrate — a premise intro is a system message, so we
        // key off the absence of an assistant message rather than an empty transcript.
        const dmHasNotSpoken = s.messages.filter(m => !m.hidden && m.role === 'assistant').length === 0;
        const hasHistory = (s.journal?.length > 0) || (s.worldFacts?.length > 0) || (s.npcs?.length > 0);
        const hasPremise = !!s.session?.premise?.trim();
        const hasApiKey = !!s.settings.apiKey;

        if (hasCharacter && dmHasNotSpoken && hasApiKey && (hasHistory || hasPremise) && !hasPrimedRef.current) {
            hasPrimedRef.current = true;
            setIsLoading(true);

            let primingMessage;
            if (hasHistory) {
                // Resumed campaign — recap last session and set the current scene.
                const lastSummary = s.journal?.slice(-1)[0]?.summary || '';
                const location = s.currentLocation || 'your last known location';
                primingMessage = `[SYSTEM: The player has just resumed this campaign. Do NOT mention loading or saving. Instead, briefly recap what happened last session in 1-2 sentences, then set the scene for where the player finds themselves now in ${location}. Reference specific established facts, NPCs, and threats from the world state. End with "What do you do?" as usual.]${lastSummary ? ` Last session summary for reference: "${lastSummary}"` : ''}`;
            } else {
                // Brand-new campaign — open the very first scene from the authored premise
                // (already pinned in the system prompt as CAMPAIGN PREMISE).
                primingMessage = `[SYSTEM: This is the opening of a brand-new campaign. Open the very first scene, drawing on the CAMPAIGN PREMISE in your context. Establish the setting and the character's immediate situation vividly, honoring every place, name, and detail in the premise as canon. Do NOT mention game mechanics, saving, or that a game is starting. End with "What do you do?" as usual.]`;
            }

            sendToLLM(primingMessage, null)
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

    /**
     * RAG seeding: embed all existing world facts and journal summaries once on mount.
     * New memories are added incrementally as play continues.
     */
    useEffect(() => {
        const s = stateRef.current;
        if (!s.settings.apiKey || memorySeededRef.current) return;
        if (s.settings.llmProvider !== 'gemini') return; // Embeddings only available for Gemini

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
            seedMemories(s.settings.apiKey, items).catch((e) => {
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
        });
    };

    /**
     * Build the sliding-window message history for the LLM.
     * Only sends the last MESSAGE_WINDOW un-summarized messages.
     * Older messages have been captured in journal entries and world facts.
     */
    const buildMessageHistory = () => {
        const s = stateRef.current;
        const unsummarized = s.messages.filter(m => !m.summarized);
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

        // RAG: retrieve memories relevant to the current scene (Gemini only)
        // Include location and combat context for better retrieval relevance
        let retrievedMemories = [];
        let dramaticMemories = [];
        if (originalPlayerMessage && s.settings.apiKey && s.settings.llmProvider === 'gemini') {
            const sceneContext = [
                originalPlayerMessage,
                s.currentLocation && `Location: ${s.currentLocation}`,
                s.combat?.active && `In combat with: ${s.combat.enemies.map(e => e.name).join(', ')}`,
            ].filter(Boolean).join('. ');
            retrievedMemories = await retrieveRelevant(s.settings.apiKey, sceneContext).catch(() => []);
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

        const systemPrompt = buildCurrentSystemPrompt(retrievedMemories, dramaticMemories);
        const messageHistory = buildMessageHistory();

        abortControllerRef.current = new AbortController();
        streamBufferRef.current = '';

        const fullResponse = await streamMessage({
            provider: s.settings.llmProvider,
            apiKey: s.settings.apiKey,
            model: s.settings.model,
            systemPrompt,
            messageHistory,
            userMessage,
            onChunk: (chunk) => {
                streamBufferRef.current += chunk;
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

        const parsed = parseResponse(fullResponse);
        const narrative = parsed.narrative;
        const events = opts.narrationOnly ? null : parsed.events;

        // Detect pre-narrated outcome (DM wrote outcome before dice were rolled)
        if (events?.requestedRolls?.length > 0 && detectPreNarratedOutcome(narrative)) {
            events._preNarratedOutcome = true;
            console.warn('[ChatPanel] DM pre-narrated outcome before roll — correction will be injected with roll results.');
        }

        // Any narration that still has PENDING ROLLS is a "setup" the post-roll narration
        // will supersede, so withhold it: the DM narrates the whole beat once, AFTER the
        // dice resolve (see rollResolver). Only the final, roll-free narration is shown.
        // This must hold for CHAINED rolls too — a failed check that provokes an enemy
        // attack, a multi-enemy round, a triggered save — not just the player's first
        // action. Keying on pending rolls alone is the fix; the previous condition also
        // required the first-turn `originalPlayerMessage`, so every chained setup stayed
        // visible and the player saw the beat twice (setup, then outcome). The flag also
        // drives applyEvents' setupPhase, so deferring outcome mutations to the final
        // narration likewise extends correctly to chained rolls (no double-application).
        const hideSetup = events?.requestedRolls?.length > 0;
        if (hideSetup) setStreamingMessage('');
        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'assistant', content: narrative, events, hidden: hideSetup },
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
            applyEvents(events, dispatch, () => stateRef.current, { setupPhase: hideSetup });
            if (events.location) {
                dispatch({ type: 'SET_LOCATION', payload: events.location });
            }
        }

        // RAG: embed any new world facts the DM emitted this turn (per response).
        // The per-turn Scribe + narrative embedding run once in handleSend on the FINAL
        // narrated outcome, so they capture results rather than withheld setup text.
        // Skip on a withheld setup turn — those facts ride on the outcome narration.
        if (!hideSetup && events?.worldFacts?.length > 0 && s.settings.apiKey && s.settings.llmProvider === 'gemini') {
            for (const f of events.worldFacts) {
                addMemory(s.settings.apiKey, f.fact, f.category || 'world_fact').catch(() => {});
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

    /**
     * Handle the full send flow: user message → LLM → dice rolls → auto follow-up.
     */
    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed || isLoading) return;

        setInput('');
        // Reset textarea height to single line
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
        }

        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'user', content: trimmed },
        });
        if (stateRef.current.settings.apiKey && stateRef.current.settings.llmProvider === 'gemini') {
            addMemory(stateRef.current.settings.apiKey, trimmed.slice(0, 500), 'player').catch(() => {});
        }

        const clearActionSurgeAfterTurn = !!stateRef.current.character?.pendingActionSurge;

        setIsLoading(true);
        setStreamingMessage('');

        try {
            const events = await sendToLLM(trimmed, trimmed);

            // Handle requested rolls via the extracted roll resolver (with depth limiting)
            if (events?.requestedRolls?.length > 0) {
                const rollResolution = await handleRequestedRolls(events.requestedRolls, {
                    getState: () => stateRef.current,
                    dispatch,
                    sendToLLM,
                    preNarrated: events._preNarratedOutcome || false,
                    playerAction: trimmed,
                });

                if (rollResolution?.resolved && stateRef.current.combat?.active) {
                    dispatch({ type: 'RESOLVE_COMBAT_EXCHANGE' });
                }
            }

            // Extract world-state from the FINAL narrated outcome (where the real facts
            // live), now that any roll chain has resolved. Covers no-roll turns too, and
            // skips the withheld pre-roll setup (flagged hidden).
            const latest = stateRef.current;
            const finalNarration = [...latest.messages].reverse()
                .find(m => m.role === 'assistant' && !m.hidden && m.content?.trim());
            if (finalNarration) {
                runScribe({
                    playerMessage: trimmed,
                    dmNarrative: finalNarration.content,
                    settings: latest.settings,
                    dispatch,
                }).catch(() => {});
                if (latest.settings.apiKey && latest.settings.llmProvider === 'gemini') {
                    addMemory(latest.settings.apiKey, finalNarration.content.slice(0, 500), 'narrative').catch(() => {});
                }
            }

            // Auto-summarize for session memory (runs in background, uses Gemini 2.5 Flash)
            maybeAutoSummarize(stateRef.current, dispatch, lastSummarizedRef.current).then(idx => {
                lastSummarizedRef.current = idx;
            });

            if (clearActionSurgeAfterTurn) {
                dispatch({ type: 'CLEAR_ACTION_SURGE' });
            }
        } catch (error) {
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

    const hasApiKey = !!state.settings.apiKey;

    return (
        <div className="chat-panel">
            <div className="chat-messages">
                {state.messages.length === 0 && (
                    <div className="chat-empty">
                        <div className="chat-empty-icon" aria-hidden="true" />
                        <h3>Your Adventure Awaits</h3>
                        <p>
                            {hasApiKey
                                ? 'Send a message to begin your quest. The Dungeon Master is ready.'
                                : 'Set your API key in Settings to begin your quest.'}
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
                                <span></span><span></span><span></span>
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {state.combat?.active && <CombatPanel />}

            <div className="chat-input-area">
                <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={input}
                    onInput={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder={hasApiKey ? "What do you do?" : "Set your API key in Settings first..."}
                    disabled={!hasApiKey || isLoading}
                    maxLength={4000}
                    rows={1}
                />
                {isLoading ? (
                    <button className="chat-stop-btn" onClick={handleStop} title="Stop generating">
                        Stop
                    </button>
                ) : (
                    <button
                        className="chat-send-btn"
                        onClick={handleSend}
                        disabled={!input.trim() || !hasApiKey}
                        title="Send message"
                    >
                        Send
                    </button>
                )}
            </div>
        </div>
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
                <div className="message-text">
                    <MarkdownText text={cleanDisplayText(message.content)} />
                </div>
            </div>
        </div>
    );
}

