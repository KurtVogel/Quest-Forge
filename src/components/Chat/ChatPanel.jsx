import { useState, useRef, useEffect } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { streamMessage } from '../../llm/adapter.js';
import { buildSystemPrompt } from '../../llm/promptBuilder.js';
import { parseResponse, applyEvents } from '../../llm/responseParser.js';
import { handleRequestedRolls } from '../../engine/rollResolver.js';
import { maybeAutoSummarize } from '../../engine/worldJournal.js';
import CombatPanel from '../Combat/CombatPanel.jsx';
import MarkdownText from './MarkdownText.jsx';
import './Chat.css';

export default function ChatPanel() {
    const { state, dispatch } = useGame();
    const [input, setInput] = useState('');
    const messagesEndRef = useRef(null);
    const abortControllerRef = useRef(null);
    const inputRef = useRef(null);
    const lastSummarizedRef = useRef(0);

    // Use a ref to always read the latest state inside async callbacks
    const stateRef = useRef(state);
    stateRef.current = state;

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state.messages, state.ui.streamingMessage]);

    /**
     * Build the system prompt from current state.
     */
    const buildCurrentSystemPrompt = () => {
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
        });
    };

    /**
     * Send a message to the LLM and process the response.
     * Returns the parsed events (or null).
     */
    const sendToLLM = async (userMessage) => {
        const s = stateRef.current;
        const systemPrompt = buildCurrentSystemPrompt();

        const messageHistory = s.messages.map(m => ({
            role: m.role === 'system' ? 'user' : m.role,
            content: m.content,
        }));

        abortControllerRef.current = new AbortController();

        const fullResponse = await streamMessage({
            provider: s.settings.llmProvider,
            apiKey: s.settings.apiKey,
            model: s.settings.model,
            systemPrompt,
            messageHistory,
            userMessage,
            onChunk: (chunk) => {
                dispatch({ type: 'SET_UI', payload: { streamingMessage: chunk } });
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

        return events;
    };

    /**
     * Handle the full send flow: user message → LLM → dice rolls → auto follow-up.
     */
    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed || state.ui.isLoading) return;

        setInput('');

        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'user', content: trimmed },
        });

        dispatch({ type: 'SET_UI', payload: { isLoading: true, streamingMessage: '' } });

        try {
            const events = await sendToLLM(trimmed);

            // Handle requested rolls via the extracted roll resolver (with depth limiting)
            if (events?.requestedRolls?.length > 0) {
                await handleRequestedRolls(events.requestedRolls, {
                    getState: () => stateRef.current,
                    dispatch,
                    sendToLLM,
                });
            }

            // Auto-summarize for session memory (runs in background)
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
            dispatch({ type: 'SET_UI', payload: { isLoading: false, streamingMessage: '' } });
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
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

                {state.ui.isLoading && state.ui.streamingMessage && (
                    <div className="chat-message dm streaming">
                        <div className="message-avatar">🐉</div>
                        <div className="message-content">
                            <div className="message-role">Dungeon Master</div>
                            <div className="message-text">{state.ui.streamingMessage}</div>
                        </div>
                    </div>
                )}

                {state.ui.isLoading && !state.ui.streamingMessage && (
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
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={hasApiKey ? "What do you do?" : "Set your API key in Settings first..."}
                    disabled={!hasApiKey || state.ui.isLoading}
                    rows={2}
                />
                {state.ui.isLoading ? (
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

