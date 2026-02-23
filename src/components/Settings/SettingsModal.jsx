import { useState, useEffect } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { PROVIDERS, PROVIDER_LIST } from '../../llm/adapter.js';
import { PRESETS, PRESET_LIST } from '../../data/presets.js';
import { saveGame, loadGame, listSaves, deleteSave } from '../../state/persistence.js';
import './Settings.css';

export default function SettingsModal() {
    const { state, dispatch } = useGame();
    const [activeTab, setActiveTab] = useState('llm');
    const [saves, setSaves] = useState([]);
    const [saveName, setSaveName] = useState('');

    useEffect(() => {
        if (activeTab === 'saves') {
            loadSavesList();
        }
    }, [activeTab]);

    const loadSavesList = async () => {
        const list = await listSaves();
        setSaves(list);
    };

    const handleClose = () => {
        dispatch({ type: 'SET_UI', payload: { isSettingsOpen: false } });
    };

    const handleSave = async () => {
        const slotId = `save-${Date.now()}`;
        const sessionName = saveName.trim() || state.session.name || 'Manual Save';
        await saveGame(slotId, { ...state, session: { ...state.session, name: sessionName } });
        setSaveName('');
        loadSavesList();
    };

    const handleLoad = async (slotId) => {
        const savedState = await loadGame(slotId);
        if (savedState) {
            dispatch({ type: 'LOAD_GAME', payload: savedState });
            handleClose();
        }
    };

    const handleDelete = async (slotId) => {
        await deleteSave(slotId);
        loadSavesList();
    };

    const handleNewGame = () => {
        if (confirm('Start a new game? Current unsaved progress will be lost.')) {
            dispatch({ type: 'NEW_GAME' });
            dispatch({ type: 'SET_UI', payload: { isCharacterCreationOpen: true, isSettingsOpen: false } });
        }
    };

    const updateSetting = (key, value) => {
        dispatch({ type: 'UPDATE_SETTINGS', payload: { [key]: value } });
    };

    const selectedProvider = PROVIDERS[state.settings.llmProvider];

    return (
        <div className="settings-overlay" onClick={handleClose}>
            <div className="settings-modal" onClick={e => e.stopPropagation()}>
                <div className="settings-header">
                    <h2>Settings</h2>
                    <button className="settings-close" onClick={handleClose}>✕</button>
                </div>

                <div className="settings-tabs">
                    {[
                        { id: 'llm', label: '🤖 AI Provider' },
                        { id: 'game', label: '🎮 Game' },
                        { id: 'saves', label: '💾 Save / Load' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="settings-content">
                    {activeTab === 'llm' && (
                        <div className="settings-section">
                            <div className="setting-group">
                                <label className="setting-label">Provider</label>
                                <select
                                    className="setting-select"
                                    value={state.settings.llmProvider}
                                    onChange={(e) => {
                                        updateSetting('llmProvider', e.target.value);
                                        // Reset model to first model of new provider
                                        const newProvider = PROVIDERS[e.target.value];
                                        if (newProvider?.models?.[0]) {
                                            updateSetting('model', newProvider.models[0].id);
                                        }
                                    }}
                                >
                                    {PROVIDER_LIST.map(p => (
                                        <option key={p} value={p}>{PROVIDERS[p].name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="setting-group">
                                <label className="setting-label">API Key</label>
                                <input
                                    type="password"
                                    className="setting-input"
                                    value={state.settings.apiKey}
                                    onChange={(e) => updateSetting('apiKey', e.target.value)}
                                    placeholder="Enter your API key..."
                                />
                                <p className="setting-hint">
                                    {state.settings.llmProvider === 'gemini'
                                        ? 'Get a free key at aistudio.google.com'
                                        : 'Get a key at platform.openai.com'}
                                </p>
                            </div>

                            <div className="setting-group">
                                <label className="setting-label">Model</label>
                                <select
                                    className="setting-select"
                                    value={state.settings.model}
                                    onChange={(e) => updateSetting('model', e.target.value)}
                                >
                                    {selectedProvider?.models?.map(m => (
                                        <option key={m.id} value={m.id}>
                                            {m.name}
                                        </option>
                                    ))}
                                </select>
                                {selectedProvider?.models?.find(m => m.id === state.settings.model)?.description && (
                                    <p className="setting-hint">
                                        {selectedProvider.models.find(m => m.id === state.settings.model).description}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'game' && (
                        <div className="settings-section">
                            <div className="setting-group">
                                <label className="setting-label">Tone & Setting</label>
                                <div className="preset-grid">
                                    {PRESET_LIST.map(p => (
                                        <button
                                            key={p}
                                            className={`preset-card ${state.settings.preset === p ? 'selected' : ''}`}
                                            onClick={() => updateSetting('preset', p)}
                                        >
                                            <span className="preset-emoji">{PRESETS[p].emoji}</span>
                                            <span className="preset-name">{PRESETS[p].name}</span>
                                            <span className="preset-desc">{PRESETS[p].description}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="setting-group">
                                <label className="setting-label">Ruleset</label>
                                <select
                                    className="setting-select"
                                    value={state.settings.ruleset}
                                    onChange={(e) => updateSetting('ruleset', e.target.value)}
                                >
                                    <option value="simplified5e">Simplified D&D 5e</option>
                                    <option value="narrative">Narrative Mode (Story-first)</option>
                                </select>
                            </div>

                            <div className="setting-group">
                                <label className="setting-label">Custom DM Instructions</label>
                                <textarea
                                    className="setting-textarea"
                                    value={state.settings.customSystemPrompt}
                                    onChange={(e) => updateSetting('customSystemPrompt', e.target.value)}
                                    placeholder="Add custom instructions for the DM... (e.g. 'Describe combat in vivid, gritty detail. Use mature themes and morally complex situations. The world is dark and dangerous.')"
                                    rows={4}
                                />
                                <p className="setting-hint">
                                    These instructions are injected into the DM's system prompt. Use this to control tone, content, and style.
                                </p>
                            </div>

                            <div className="setting-group">
                                <button className="btn btn-danger" onClick={handleNewGame}>
                                    🆕 New Game
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'saves' && (
                        <div className="settings-section">
                            {state.character && (
                                <div className="save-new">
                                    <input
                                        type="text"
                                        className="setting-input"
                                        value={saveName}
                                        onChange={(e) => setSaveName(e.target.value)}
                                        placeholder="Save name (optional)..."
                                    />
                                    <button className="btn btn-primary" onClick={handleSave}>
                                        💾 Save Game
                                    </button>
                                </div>
                            )}

                            <div className="saves-list">
                                <h4 className="saves-list-title">Saved Games</h4>
                                {saves.length === 0 ? (
                                    <div className="saves-empty">No saved games yet</div>
                                ) : (
                                    saves.map(save => (
                                        <div key={save.slotId} className="save-slot">
                                            <div className="save-info">
                                                <div className="save-name">{save.name}</div>
                                                <div className="save-meta">
                                                    {save.characterName} · Lv.{save.characterLevel} {save.characterClass} · {save.messageCount} msgs
                                                </div>
                                                <div className="save-date">
                                                    {new Date(save.savedAt).toLocaleString()}
                                                </div>
                                            </div>
                                            <div className="save-actions">
                                                <button className="btn btn-sm btn-primary" onClick={() => handleLoad(save.slotId)}>
                                                    Load
                                                </button>
                                                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(save.slotId)}>
                                                    ✕
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
