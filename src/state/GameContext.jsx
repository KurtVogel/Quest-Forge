/**
 * React Context provider for game state.
 */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useCallback, useState, useRef } from 'react';
import { archiveNpcBulk, gameReducer, initialGameState, mergeNpcUpdate } from './gameReducer.js';
import { loadSettings, saveSettings, autoSave } from './persistence.js';
import { PROVIDERS } from '../llm/adapter.js';
import { initializeFirebase } from '../config/firebase.js';
import { subscribeToAuth } from './auth.js';

const GameContext = createContext(null);
const GameDispatchContext = createContext(null);
const SaveToastContext = createContext(null);
const FlushAutoSaveContext = createContext(null);

export function GameProvider({ children }) {
    // null = hidden, otherwise { status: 'local' | 'cloud' | 'cloud-error' }
    const [saveToast, setSaveToast] = useState(null);
    const saveToastTimer = useRef(null);
    const stateRef = useRef(null);

    const showSaveToast = useCallback((status = 'local') => {
        setSaveToast({ status });
        if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
        // Leave failures up longer so they can actually be read
        const duration = status.endsWith('error') ? 5000 : 2500;
        saveToastTimer.current = setTimeout(() => setSaveToast(null), duration);
    }, []);

    const [state, dispatch] = useReducer(gameReducer, initialGameState, (initial) => {
        // Load persisted settings on init
        const savedSettings = loadSettings();
        if (savedSettings) {
            const merged = { ...initial, settings: { ...initial.settings, ...savedSettings } };
            // Validate that saved model still exists in current provider's model list
            const provider = PROVIDERS[merged.settings.llmProvider];
            if (provider) {
                const modelExists = provider.models.some(m => m.id === merged.settings.model);
                if (!modelExists) {
                    merged.settings.model = provider.models[0].id;
                }
            }
            return merged;
        }
        return initial;
    });

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    // Automated-playtest hook (?debugState=1): a sanitized live snapshot for
    // assertions the DOM cannot answer (hidden fronts, combat phase, loot dedupe).
    // `settings` (API keys) and `user` (auth) are never included.
    useEffect(() => {
        if (!new URLSearchParams(window.location.search).has('debugState')) return;
        const { settings: _settings, user: _user, ...snapshot } = state;
        window.__QF_STATE__ = snapshot;
    }, [state]);

    const flushAutoSave = useCallback(async ({ npcUpdate = null, npcBulkArchiveIds = null } = {}) => {
        let current = stateRef.current;
        if (!current?.session?.id || !current.character) return;

        if (npcUpdate) {
            current = {
                ...current,
                npcs: mergeNpcUpdate(current.npcs || [], npcUpdate),
            };
        } else if (Array.isArray(npcBulkArchiveIds) && npcBulkArchiveIds.length > 0) {
            current = {
                ...current,
                npcs: archiveNpcBulk(current.npcs, npcBulkArchiveIds),
            };
        }

        const saved = await autoSave({
            ...current,
            session: {
                ...current.session,
                updatedAt: new Date().toISOString(),
            },
        });
        showSaveToast(saved ? 'local' : 'save-error');
    }, [showSaveToast]);

    // Auto-save settings when they change. Settings carries the LLM API key —
    // a silent persist failure (quota, private browsing) must not let the player
    // believe a key was configured when it wasn't.
    useEffect(() => {
        const saved = saveSettings(state.settings);
        if (!saved) showSaveToast('save-error');
    }, [state.settings, showSaveToast]);

    // Flush the debounced autosave when the tab is backgrounded or closed. On phones
    // especially, the browser can kill the page inside the 2s debounce window and
    // silently lose the last turn. pagehide also reports visibilityState 'hidden',
    // so one handler covers both signals.
    useEffect(() => {
        const flushOnHide = () => {
            if (document.visibilityState !== 'hidden') return;
            const current = stateRef.current;
            if (!current?.session?.id || !current.character) return;
            autoSave({
                ...current,
                session: { ...current.session, updatedAt: new Date().toISOString() },
            });
        };
        document.addEventListener('visibilitychange', flushOnHide);
        window.addEventListener('pagehide', flushOnHide);
        return () => {
            document.removeEventListener('visibilitychange', flushOnHide);
            window.removeEventListener('pagehide', flushOnHide);
        };
    }, []);

    // Grandfather legacy NPC records from long-running saves without requiring a reload.
    useEffect(() => {
        if ((state.npcs || []).some(npc => !npc.rosterTier)) {
            dispatch({ type: 'MIGRATE_NPC_ROSTER' });
        }
    }, [state.npcs]);

    // Initialize Firebase and Auth listener when config is present
    useEffect(() => {
        let unsubscribe = null;
        async function initAuth() {
            if (state.settings.firebaseConfig?.apiKey) {
                const isConnected = await initializeFirebase(state.settings.firebaseConfig);
                if (isConnected) {
                    unsubscribe = subscribeToAuth((user) => {
                        if (user) {
                            dispatch({ type: 'SET_USER', payload: { uid: user.uid, email: user.email, isGuest: user.isAnonymous } });
                        } else {
                            dispatch({ type: 'SIGNOUT_USER' });
                        }
                    });
                } else {
                    dispatch({ type: 'SIGNOUT_USER' }); // Signal auth is done failing
                }
            } else {
                dispatch({ type: 'SIGNOUT_USER' }); // No API key, signal auth is done
            }
        }
        initAuth();

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [state.settings.firebaseConfig]);

    // Auto-save game state when significant changes happen (debounced)
    useEffect(() => {
        if (state.session.id && state.character) {
            const timer = setTimeout(() => {
                // Stamp the exact time of save so cross-device sync can pick the newest file
                const timestampedState = {
                    ...state,
                    session: {
                        ...state.session,
                        updatedAt: new Date().toISOString()
                    }
                };

                // Autosaves are deliberately local-per-device: each browser keeps its own
                // "Continue" session. Only manual saves sync to the cloud (SettingsModal).
                // The toast must reflect reality: a quota error or broken IndexedDB
                // otherwise means silent progress loss behind a green checkmark.
                autoSave(timestampedState).then(saved => showSaveToast(saved ? 'local' : 'save-error'));
            }, 2000);
            return () => clearTimeout(timer);
        }
    // Autosave is intentionally keyed to gameplay state, not every state object field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        state.character,
        state.inventory,
        state.messages,
        state.rollHistory,
        state.quests,
        state.party,
        state.combat,
        state.fronts,
        state.pendingRoleplayCheck,
        state.npcs,
        state.journal,
        state.worldFacts,
        state.storyMemory,
        state.currentLocation,
        state.session.id,
        state.session.frontDirector,
        state.user?.uid,
        showSaveToast,
    ]);

    return (
        <GameContext.Provider value={state}>
            <GameDispatchContext.Provider value={dispatch}>
                <FlushAutoSaveContext.Provider value={flushAutoSave}>
                    <SaveToastContext.Provider value={saveToast}>
                        {children}
                    </SaveToastContext.Provider>
                </FlushAutoSaveContext.Provider>
            </GameDispatchContext.Provider>
        </GameContext.Provider>
    );
}

/** @returns {{status: 'local'|'cloud'|'cloud-error'}|null} current save toast, or null when hidden */
export function useSaveToast() {
    return useContext(SaveToastContext);
}

/**
 * Hook to access game state.
 */
export function useGameState() {
    const context = useContext(GameContext);
    if (context === undefined) {
        throw new Error('useGameState must be used within a GameProvider');
    }
    return context;
}

/**
 * Hook to access dispatch function.
 */
export function useGameDispatch() {
    const context = useContext(GameDispatchContext);
    if (!context) {
        throw new Error('useGameDispatch must be used within a GameProvider');
    }
    return context;
}

/**
 * Combined hook for convenience.
 */
export function useFlushAutoSave() {
    const flush = useContext(FlushAutoSaveContext);
    if (!flush) {
        throw new Error('useFlushAutoSave must be used within a GameProvider');
    }
    return flush;
}

export function useGame() {
    return {
        state: useGameState(),
        dispatch: useGameDispatch(),
        flushAutoSave: useFlushAutoSave(),
    };
}
