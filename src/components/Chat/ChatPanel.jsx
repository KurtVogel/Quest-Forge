import { useState, useRef, useEffect } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { streamMessage } from '../../llm/adapter.js';
import { buildSystemPrompt } from '../../llm/promptBuilder.js';
import { parseResponse, applyEvents } from '../../llm/responseParser.js';
import { handleRequestedRolls } from '../../engine/rollResolver.js';
import { maybeAutoSummarize } from '../../engine/worldJournal.js';
import { runScribe } from '../../llm/scribe.js';
import { addMemory, seedMemories, retrieveRelevant, buildRetrievedMemoriesBlock, clearMemories } from '../../engine/vectorMemory.js';
import CombatPanel from '../Combat/CombatPanel.jsx';
import MarkdownText from './MarkdownText.jsx';
import './Chat.css';

/** How many recent (un-summarized) messages to send as LLM history. */
const MESSAGE_WINDOW = 20;

export default function ChatPanel() {
    const { state, dispatch } = useGame();
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [streamingMessage, setStreamingMessage] = useState('');
    const messagesEndRef = useRef(null);
    const abortControllerRef = useRef(null);
    const inputRef = useRef(null);
    const lastSummarizedRef = useRef(0);
    const hasPrimedRef = useRef(false); // Ensure session priming only fires once per mount
    const memorySeededRef = useRef(false); // Ensure RAG seeding only fires once per mount

    // Use a ref to always read the latest state inside async callbacks
    const stateRef = useRef(state);
    stateRef.current = state;

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state.messages, streamingMessage]);

    /**
     * Session-start priming: when a game is loaded (has a character + journal/world facts
     * but zero visible messages), auto-trigger the DM to set the scene.
     * This fires once per component mount.
     */
    useEffect(() => {
        const s = stateRef.current;
        const hasCharacter = !!s.character;
        const hasNoMessages = s.messages.filter(m => !m.hidden).length === 0;
        const hasHistory = (s.journal?.length > 0) || (s.worldFacts?.length > 0) || (s.npcs?.length > 0);
        const hasApiKey = !!s.settings.apiKey;

        if (hasCharacter && hasNoMessages && hasHistory && hasApiKey && !hasPrimedRef.current) {
            hasPrimedRef.current = true;
            setIsLoading(true);

            // Build a context-aware priming message for the DM
            const lastJournal = s.journal?.slice(-1)[0];
            const lastSummary = lastJournal?.summary || '';
            const location = s.currentLocation || 'your last known location';

            const primingMessage = `[SYSTEM: The player has just resumed this campaign. Do NOT mention loading or saving. Instead, briefly recap what happened last session in 1-2 sentences, then set the scene for where the player finds themselves now in ${location}. Reference specific established facts, NPCs, and threats from the world state. End with "What do you do?" as usual.]${lastSummary ? ` Last session summary for reference: "${lastSummary}"` : ''}`;

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

        memorySeededRef.current = true;
        clearMemories();

        const items = [
            ...(s.worldFacts || []).map(f => ({ text: f.fact, category: f.category || 'world_fact' })),
            ...(s.journal || []).map(j => ({ text: j.summary, category: 'journal' })),
            ...(s.npcs || []).filter(n => n.lastNotes || n.notes).map(n => ({
                text: `${n.name} (${n.disposition || 'unknown'}): ${n.lastNotes || n.notes}`,
                category: 'npc',
            })),
        ];

        if (items.length > 0) {
            seedMemories(s.settings.apiKey, items).catch(() => {});
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only on mount

    /**
     * Build the system prompt from current state, with optional RAG memories injected.
     */
    const buildCurrentSystemPrompt = (retrievedMemories = []) => {
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
            currentLocation: s.currentLocation,
            combat: s.combat,
            worldFacts: s.worldFacts || [],
            retrievedMemories,
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
    const sendToLLM = async (userMessage, originalPlayerMessage) => {
        const s = stateRef.current;

        // RAG: retrieve memories relevant to the current player message (Gemini only)
        let retrievedMemories = [];
        if (originalPlayerMessage && s.settings.apiKey && s.settings.llmProvider === 'gemini') {
            retrievedMemories = await retrieveRelevant(s.settings.apiKey, originalPlayerMessage).catch(() => []);
        }

        const systemPrompt = buildCurrentSystemPrompt(retrievedMemories);
        const messageHistory = buildMessageHistory();

        abortControllerRef.current = new AbortController();

        const fullResponse = await streamMessage({
            provider: s.settings.llmProvider,
            apiKey: s.settings.apiKey,
            model: s.settings.model,
            systemPrompt,
            messageHistory,
            userMessage,
            onChunk: (chunk) => {
                setStreamingMessage(chunk);
            },
            signal: abortControllerRef.current.signal,
        });

        const { narrative, events } = parseResponse(fullResponse);

        // Add DM message
        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'assistant', content: narrative, events },
        });

        // Apply game events (damage, items, etc.)
        if (events) {
            applyEvents(events, dispatch);
            if (events.location) {
                dispatch({ type: 'SET_LOCATION', payload: events.location });
            }
        }

        // Run the Scribe silently in the background — extract world facts & NPC updates
        // Only for real player messages (not roll follow-ups) to avoid redundant extraction
        if (originalPlayerMessage && narrative) {
            runScribe({
                playerMessage: originalPlayerMessage,
                dmNarrative: narrative,
                settings: stateRef.current.settings,
                dispatch,
            }).catch(() => {}); // Scribe failures are non-critical, silently ignored

            // RAG: embed the current DM narrative as a new memory for future retrieval
            if (s.settings.apiKey && s.settings.llmProvider === 'gemini') {
                addMemory(s.settings.apiKey, narrative.slice(0, 500), 'narrative').catch(() => {});
            }
        }

        // RAG: also embed any new world facts that came back from the DM this turn
        if (events?.worldFacts?.length > 0 && s.settings.apiKey && s.settings.llmProvider === 'gemini') {
            for (const f of events.worldFacts) {
                addMemory(s.settings.apiKey, f.fact, f.category || 'world_fact').catch(() => {});
            }
        }

        return events;
    };

    /**
     * Handle the full send flow: user message → LLM → dice rolls → auto follow-up.
     */
    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed || isLoading) return;

        setInput('');

        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'user', content: trimmed },
        });

        setIsLoading(true);
        setStreamingMessage('');

        try {
            const events = await sendToLLM(trimmed, trimmed);

            // Handle requested rolls via the extracted roll resolver (with depth limiting)
            if (events?.requestedRolls?.length > 0) {
                await handleRequestedRolls(events.requestedRolls, {
                    getState: () => stateRef.current,
                    dispatch,
                    sendToLLM,
                });
            }

            // Auto-summarize for session memory (runs in background, uses Gemini 2.5 Flash)
            maybeAutoSummarize(stateRef.current, dispatch, lastSummarizedRef.current).then(idx => {
                lastSummarizedRef.current = idx;
            });
        } catch (error) {
            if (error.name !== 'AbortError') {
                dispatch({
                    type: 'ADD_MESSAGE',
                    payload: {
                        role: 'system',
                        content: `⚠️ Error: ${error.message}`,
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
                        <div className="chat-empty-icon">⚔️</div>
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
                    <div className="chat-message dm streaming">
                        <div className="message-avatar">🐉</div>
                        <div className="message-content">
                            <div className="message-role">Dungeon Master</div>
                            <div className="message-text">{streamingMessage}</div>
                        </div>
                    </div>
                )}

                {isLoading && !streamingMessage && (
                    <div className="chat-message dm streaming">
                        <div className="message-avatar">🐉</div>
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
                    rows={1}
                />
                {isLoading ? (
                    <button className="chat-stop-btn" onClick={handleStop} title="Stop generating">
                        ⬛
                    </button>
                ) : (
                    <button
                        className="chat-send-btn"
                        onClick={handleSend}
                        disabled={!input.trim() || !hasApiKey}
                        title="Send message"
                    >
                        ➤
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
        user: '🧙',
        assistant: '🐉',
        system: '⚙️',
    };

    if (message.hidden) return null;

    return (
        <div className={`chat-message ${message.role}`}>
            <div className="message-avatar">{avatars[message.role]}</div>
            <div className="message-content">
                <div className="message-role">{roleLabels[message.role]}</div>
                <div className="message-text">
                    <MarkdownText text={message.content} />
                </div>
            </div>
        </div>
    );
}

