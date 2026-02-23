/**
 * React Context provider for game state.
 */
import { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { gameReducer, initialGameState } from './gameReducer.js';
import { loadSettings, saveSettings, autoSave } from './persistence.js';
import { PROVIDERS } from '../llm/adapter.js';

const GameContext = createContext(null);
const GameDispatchContext = createContext(null);

export function GameProvider({ children }) {
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

    // Auto-save settings when they change
    useEffect(() => {
        saveSettings(state.settings);
    }, [state.settings]);

    // Auto-save game state when significant changes happen (debounced)
    useEffect(() => {
        if (state.session.id && state.character) {
            const timer = setTimeout(() => {
                autoSave(state);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [state.character, state.inventory, state.messages, state.quests, state.session.id]);

    return (
        <GameContext.Provider value={state}>
            <GameDispatchContext.Provider value={dispatch}>
                {children}
            </GameDispatchContext.Provider>
        </GameContext.Provider>
    );
}

/**
 * Hook to access game state.
 */
export function useGameState() {
    const context = useContext(GameContext);
    if (!context && context !== null) {
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
export function useGame() {
    return {
        state: useGameState(),
        dispatch: useGameDispatch(),
    };
}
