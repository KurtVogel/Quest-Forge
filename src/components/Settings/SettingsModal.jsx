import { useState, useEffect } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { initialGameState } from '../../state/gameReducer.js';
import { PROVIDERS, PROVIDER_LIST } from '../../llm/adapter.js';
import { PRESETS, PRESET_LIST } from '../../data/presets.js';
import { saveGame, loadGame, listSaves, deleteSave } from '../../state/persistence.js';
import { saveGameToCloud, loadGameFromCloud, listCloudSaves, deleteGameFromCloud } from '../../state/cloudSync.js';
import { getFirebaseConfigError, initializeFirebase } from '../../config/firebase.js';
import { signInWithGoogle, logOut } from '../../state/auth.js';
import { upgradeCampaignFrontsV2 } from '../../llm/frontUpgrade.js';
import { clearImageCache } from '../../llm/providers/imageGen.js';
import './Settings.css';

export default function SettingsModal() {
    const { state, dispatch } = useGame();
    const [activeTab, setActiveTab] = useState(state.ui.settingsTab || 'llm');
    const [saves, setSaves] = useState([]);
    const [cloudSaves, setCloudSaves] = useState([]);
    const [saveName, setSaveName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [firebaseConfig, setFirebaseConfig] = useState(state.settings.firebaseConfig || {
        apiKey: '',
        authDomain: '',
        projectId: ''
    });
    const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);
    const [authError, setAuthError] = useState('');
    const [syncStatus, setSyncStatus] = useState('');
    const [isMigratingFronts, setIsMigratingFronts] = useState(false);
    const [frontMigrationStatus, setFrontMigrationStatus] = useState('');
    const hasRichLivingWorld = state.session?.frontDirector?.generationVersion >= 2;

    useEffect(() => {
        let isCancelled = false;

        async function loadActiveSavesList() {
            const list = await listSaves();
            if (isCancelled) return;
            setSaves(list);

            if (state.user?.uid) {
                try {
                    const cList = await listCloudSaves(state.user.uid);
                    if (!isCancelled) {
                        setCloudSaves(cList);
                        setAuthError('');
                    }
                } catch (e) {
                    if (!isCancelled) {
                        setCloudSaves([]);
                        setAuthError('Cloud saves could not be loaded: ' + e.message);
                    }
                }
            } else {
                setCloudSaves([]);
            }
        }

        if (activeTab === 'saves') {
            loadActiveSavesList();
        }

        return () => {
            isCancelled = true;
        };
    }, [activeTab, state.user?.uid]);

    useEffect(() => {
        if (state.settings.firebaseConfig?.apiKey) {
            initializeFirebase(state.settings.firebaseConfig).then(setIsFirebaseConnected);
        }
    }, [state.settings.firebaseConfig]);

    const handleClose = () => {
        dispatch({ type: 'SET_UI', payload: { isSettingsOpen: false, settingsTab: null } });
    };

    const loadSavesList = async () => {
        const list = await listSaves();
        setSaves(list);
        if (state.user?.uid) {
            try {
                const cList = await listCloudSaves(state.user.uid);
                setCloudSaves(cList);
                setAuthError('');
            } catch (e) {
                setCloudSaves([]);
                setAuthError('Cloud saves could not be loaded: ' + e.message);
            }
        } else {
            setCloudSaves([]);
        }
    };

    const handleSave = async () => {
        if (isSaving) return; // Guard against rapid double-clicks creating phantom saves
        setIsSaving(true);
        try {
            const slotId = `save-${Date.now()}`;
            const sessionName = saveName.trim() || state.session.name || 'Manual Save';
            const updatedState = {
                ...state,
                session: {
                    ...state.session,
                    name: sessionName,
                    updatedAt: new Date().toISOString()
                }
            };
            await saveGame(slotId, updatedState);
            await loadSavesList(); // Local save is committed now — refresh immediately
            if (state.user?.uid) {
                const cloudOk = await saveGameToCloud(state.user.uid, slotId, updatedState);
                await loadSavesList(); // Reflect the cloud copy once it lands
                setSyncStatus(cloudOk
                    ? '✓ Saved locally and to cloud'
                    : 'Saved locally, but the cloud upload failed — this save will not appear on other devices (details in browser console)');
            } else {
                setSyncStatus('Saved locally only — sign in with Google for cloud sync');
            }
            setSaveName('');
        } finally {
            setIsSaving(false);
        }
    };

    const handleLoad = async (slotId, isCloud = false) => {
        let savedState = null;
        if (isCloud && state.user?.uid) {
            savedState = await loadGameFromCloud(state.user.uid, slotId);
        } else {
            savedState = await loadGame(slotId);
        }
        if (savedState) {
            clearImageCache(); // Scene-art cache is per-campaign — never show another campaign's art
            dispatch({ type: 'LOAD_GAME', payload: savedState });
            handleClose();
        }
    };

    const handleDelete = async (slotId) => {
        await deleteSave(slotId);
        await loadSavesList();
    };

    const handleDeleteCloud = async (slotId, name) => {
        if (!state.user?.uid) return;
        if (!confirm(`Delete the cloud save "${name}"? It will disappear from all your devices.`)) return;
        const ok = await deleteGameFromCloud(state.user.uid, slotId);
        setSyncStatus(ok ? `Deleted "${name}" from the cloud` : `Failed to delete "${name}" from the cloud`);
        await loadSavesList();
    };

    // Overwrite an existing slot (local + cloud when signed in) with the current game.
    const handleOverwrite = async (slotId, name) => {
        if (isSaving || !state.character) return;
        if (!confirm(`Overwrite "${name}" with your current game?`)) return;
        setIsSaving(true);
        try {
            const updatedState = {
                ...state,
                session: {
                    ...state.session,
                    name,
                    updatedAt: new Date().toISOString()
                }
            };
            await saveGame(slotId, updatedState);
            if (state.user?.uid) {
                const cloudOk = await saveGameToCloud(state.user.uid, slotId, updatedState);
                setSyncStatus(cloudOk
                    ? `✓ Overwrote "${name}" locally and in the cloud`
                    : `Overwrote "${name}" locally, but the cloud upload failed`);
            } else {
                setSyncStatus(`Overwrote "${name}" locally (sign in for cloud sync)`);
            }
            await loadSavesList();
        } finally {
            setIsSaving(false);
        }
    };

    const handleNewGame = () => {
        if (confirm('Start a new game? Current unsaved progress will be lost.')) {
            clearImageCache();
            dispatch({ type: 'NEW_GAME' });
            dispatch({ type: 'SET_UI', payload: { isCharacterCreationOpen: true, isSettingsOpen: false } });
        }
    };

    const updateSetting = (key, value) => {
        dispatch({ type: 'UPDATE_SETTINGS', payload: { [key]: value } });
    };

    const handleFrontMigration = async () => {
        if (isMigratingFronts || hasRichLivingWorld) return;
        setIsMigratingFronts(true);
        setFrontMigrationStatus(`Reading ${state.character?.name || 'this hero'}’s established campaign history…`);
        try {
            const result = await upgradeCampaignFrontsV2(state);
            dispatch({ type: 'UPGRADE_FRONTS_V2', payload: result });
            setFrontMigrationStatus(`Dynamic world upgraded from ${result.counts.facts} canonical facts, ${result.counts.journalEntries} journal entries, ${result.counts.npcs} known NPCs, and ${result.counts.memories} dramatic memories. Existing clocks and campaign state were preserved.`);
        } catch (e) {
            setFrontMigrationStatus(e.message || 'Upgrade failed. No campaign state was changed.');
        } finally {
            setIsMigratingFronts(false);
        }
    };

    const handleConnectFirebase = async () => {
        const configError = getFirebaseConfigError(firebaseConfig);
        if (configError) {
            setIsFirebaseConnected(false);
            setAuthError(configError);
            return;
        }

        updateSetting('firebaseConfig', firebaseConfig);
        const success = await initializeFirebase(firebaseConfig);
        setIsFirebaseConnected(success);
        if (!success) setAuthError('Failed to initialize Firebase with provided config');
        else setAuthError('');
    };

    const handleGoogleLogin = async () => {
        try {
            setAuthError('');
            const configError = getFirebaseConfigError(firebaseConfig);
            if (configError) {
                setAuthError(configError);
                return;
            }
            if (!isFirebaseConnected) {
                setAuthError('Connect Firebase before signing in with Google');
                return;
            }
            const user = await signInWithGoogle();
            dispatch({
                type: 'SET_USER',
                payload: { uid: user.uid, email: user.email, isGuest: false }
            });
        } catch (e) {
            const message = e.code === 'auth/popup-blocked'
                ? 'Google Sign-In popup was blocked by the browser. Allow popups for this site and try again.'
                : e.code === 'auth/unauthorized-domain'
                    ? 'This domain is not authorized in Firebase Authentication. Add this app domain in Firebase Console > Authentication > Settings > Authorized domains.'
                    : e.message;
            setAuthError('Google Sign-In failed: ' + message);
        }
    };

    const handleLogout = async () => {
        await logOut();
        dispatch({ type: 'SIGNOUT_USER' });
    };

    const handleUploadLocalSaves = async () => {
        if (!state.user?.uid) {
            setAuthError('Sign in with Google before uploading local saves');
            return;
        }

        setAuthError('');
        setSyncStatus('Uploading local saves...');

        try {
            const localSaves = await listSaves();
            if (localSaves.length === 0) {
                setSyncStatus('No local saves to upload');
                return;
            }

            let uploaded = 0;
            for (const save of localSaves) {
                const savedState = await loadGame(save.slotId);
                if (savedState) {
                    const ok = await saveGameToCloud(state.user.uid, save.slotId, savedState);
                    if (ok) uploaded++;
                }
            }

            await loadSavesList();
            setSyncStatus(`Uploaded ${uploaded} of ${localSaves.length} local save${localSaves.length === 1 ? '' : 's'} to cloud`);
        } catch (e) {
            setSyncStatus('');
            setAuthError('Cloud upload failed: ' + e.message);
        }
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
                    <button
                        className={`tab-button ${activeTab === 'llm' ? 'active' : ''}`}
                        onClick={() => setActiveTab('llm')}
                    >
                        AI Provider
                    </button>
                    <button
                        className={`tab-button ${activeTab === 'game' ? 'active' : ''}`}
                        onClick={() => setActiveTab('game')}
                    >
                        Game
                    </button>
                    <button
                        className={`tab-button ${activeTab === 'saves' ? 'active' : ''}`}
                        onClick={() => setActiveTab('saves')}
                    >
                        Saves
                    </button>
                    <button
                        className={`tab-button ${activeTab === 'cloud' ? 'active' : ''}`}
                        onClick={() => setActiveTab('cloud')}
                    >
                        Cloud Sync
                    </button>
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
                                        : state.settings.llmProvider === 'xai'
                                            ? 'Get a key at console.x.ai — the same kind of key as scene art below. Keys pasted without the xai- prefix are normalized automatically.'
                                            : 'Get a key at platform.openai.com'}
                                </p>
                            </div>

                            {state.settings.llmProvider !== 'gemini' && (
                                <div className="setting-group">
                                    <label className="setting-label">Gemini API Key (game memory — required)</label>
                                    <input
                                        type="password"
                                        className="setting-input"
                                        value={state.settings.geminiApiKey || ''}
                                        onChange={(e) => updateSetting('geminiApiKey', e.target.value)}
                                        placeholder="Enter your Gemini API key..."
                                    />
                                    <p className="setting-hint">
                                        The campaign machinery — long-term vector memory (RAG), the Scribe world-state
                                        extractor, journal summaries, loot audits, and roll-policy checks — always runs
                                        on Gemini Flash regardless of your DM provider. Playing without it would quietly
                                        break long campaigns, so the game will not start until this key is set. Get a
                                        free key at aistudio.google.com.
                                    </p>
                                </div>
                            )}

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

                            <div className="setting-group">
                                <label className="setting-label">xAI Image API Key (Scene Art)</label>
                                <input
                                    type="password"
                                    className="setting-input"
                                    value={state.settings.imageApiKey || ''}
                                    onChange={(e) => updateSetting('imageApiKey', e.target.value)}
                                    placeholder="xai-..."
                                />
                                <p className="setting-hint">
                                    Scene art is generated by xAI&apos;s Grok Imagine. This key is separate from your
                                    DM provider key above — get one at console.x.ai. Keys pasted without the xai- prefix
                                    are normalized automatically. Without a key, scene art uses a visibly lower-quality
                                    free fallback and labels the result accordingly.
                                </p>
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
                                            <span className="preset-code">{PRESETS[p].code}</span>
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
                                <label className="setting-label">Campaign Pace</label>
                                <select
                                    className="setting-select"
                                    value={state.settings.paceDial || 'standard'}
                                    onChange={(e) => updateSetting('paceDial', e.target.value)}
                                >
                                    <option value="slow-burn">Slow burn — long quiet stretches, pressure builds patiently</option>
                                    <option value="standard">Standard — quiet and tension in waves</option>
                                    <option value="breakneck">Breakneck — the world pushes hard and often</option>
                                </select>
                                <p className="setting-hint">
                                    Sets how often the hidden world intrudes on its own. The engine measures
                                    recent tension and steers the DM toward this pace either way — danger you
                                    seek out yourself is never limited.
                                </p>
                            </div>

                            <div className="setting-group living-world-migration">
                                <div className="setting-label-row">
                                    <label className="setting-label">Living World</label>
                                    {hasRichLivingWorld
                                        ? <span className="living-world-badge">Dynamic</span>
                                        : state.session?.frontMigration?.version >= 1
                                            ? <span className="living-world-badge basic">Contextual</span>
                                        : (state.fronts || []).length > 0
                                            ? <span className="living-world-badge basic">Basic</span>
                                            : null}
                                </div>
                                <p className="setting-hint">
                                    {hasRichLivingWorld
                                        ? 'Interacting hidden pressures are evolving from this campaign’s premise and history, creating organic NPC, consequence, and companion opportunities.'
                                        : (state.fronts || []).length > 0
                                            ? 'This established campaign can be upgraded to interacting dynamic pressures derived from its full history while preserving every existing clock and consequence.'
                                            : 'Awaken hidden campaign pressures from the premise, canonical facts, journal, known characters, relationships, story memories, and recent events. This never changes mechanics or forces a companion.'}
                                </p>
                                {!hasRichLivingWorld && (
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={handleFrontMigration}
                                        disabled={isMigratingFronts || !state.character || !state.session?.id || !state.settings.apiKey || state.combat?.active}
                                    >
                                        {isMigratingFronts
                                            ? 'Upgrading Dynamic World…'
                                            : 'Upgrade This Campaign to Dynamic World v2'}
                                    </button>
                                )}
                                {!state.settings.apiKey && !hasRichLivingWorld && (
                                    <p className="setting-hint">Set your DM API key before running this one-time private upgrade.</p>
                                )}
                                {state.combat?.active && !hasRichLivingWorld && (
                                    <p className="setting-hint">Finish the current combat first so the upgrade captures its final outcome.</p>
                                )}
                                {frontMigrationStatus && <div className="living-world-status">{frontMigrationStatus}</div>}
                            </div>

                            <div className="setting-group">
                                <div className="setting-label-row">
                                    <label className="setting-label">Custom DM Instructions</label>
                                    <button
                                        type="button"
                                        className="setting-inline-btn"
                                        onClick={() => updateSetting('customSystemPrompt', initialGameState.settings.customSystemPrompt)}
                                    >
                                        Reset to default
                                    </button>
                                </div>
                                <textarea
                                    className="setting-textarea custom-prompt-textarea"
                                    value={state.settings.customSystemPrompt}
                                    onChange={(e) => updateSetting('customSystemPrompt', e.target.value)}
                                    placeholder="Add custom instructions for the DM... (e.g. 'Describe combat in vivid, gritty detail. Use mature themes and morally complex situations. The world is dark and dangerous.')"
                                    rows={12}
                                />
                                <p className="setting-hint">
                                    These instructions are injected into the DM's system prompt. Use this to control tone, content, and style. {state.settings.customSystemPrompt?.length || 0} characters.
                                </p>
                            </div>

                            <div className="setting-group">
                                <div className="setting-label-row">
                                    <label className="setting-label">Memory Inspector (dev)</label>
                                    <button
                                        type="button"
                                        className="setting-inline-btn"
                                        onClick={() => updateSetting('memoryInspector', !state.settings.memoryInspector)}
                                    >
                                        {state.settings.memoryInspector ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                                    </button>
                                </div>
                                <p className="setting-hint">
                                    Adds a read-only "Memory" panel to the header showing what the DM
                                    actually received: curated callback cards with scores, RAG retrievals,
                                    the story-memory ledger, and the Scribe's last pass. <strong>Spoilers:</strong> it
                                    also reveals the hidden campaign fronts and their clocks.
                                </p>
                            </div>

                            <div className="setting-group">
                                <button className="btn btn-danger" onClick={handleNewGame}>
                                    New Game
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
                                    <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
                                        {isSaving ? 'Saving…' : 'Save Game'}
                                    </button>
                                </div>
                            )}

                            {syncStatus && (
                                <div className="auth-status" style={{ margin: '0.5rem 0', fontSize: '0.8rem' }}>
                                    {syncStatus}
                                </div>
                            )}

                            <div className="saves-list">
                                <h4 className="saves-list-title">Saved Games</h4>
                                {saves.length === 0 && cloudSaves.length === 0 ? (
                                    <div className="saves-empty">No saved games yet</div>
                                ) : (
                                    <>
                                        {cloudSaves.length > 0 && <div className="saves-empty" style={{ textAlign: 'left', margin: '0 0 10px' }}>Cloud Saves</div>}
                                        {cloudSaves.map(save => (
                                            <div key={`cloud-${save.slotId}`} className="save-slot">
                                                <div className="save-info">
                                                    <div className="save-name">{save.name}</div>
                                                    <div className="save-meta">
                                                        {save.characterName} · Lv.{save.characterLevel} {save.characterClass}
                                                        {save.characterHP != null ? ` · HP ${save.characterHP}/${save.characterMaxHP}` : ''}
                                                        {save.characterAC ? ` · AC ${save.characterAC}` : ''}
                                                    </div>
                                                    <div className="save-meta">
                                                        {save.gold ? `${save.gold}gp ` : ''}{save.silver ? `${save.silver}sp ` : ''}{save.copper ? `${save.copper}cp ` : ''}
                                                        {save.inventoryCount ? `· ${save.inventoryCount} items ` : ''}
                                                        {save.questCount ? `· ${save.questCount} quests ` : ''}
                                                        {save.partySize ? `· ${save.partySize} companions` : ''}
                                                    </div>
                                                    {save.location && <div className="save-meta">{save.location}</div>}
                                                    <div className="save-date">
                                                        {new Date(save.savedAt).toLocaleString()}
                                                    </div>
                                                </div>
                                                <div className="save-actions">
                                                    <button className="btn btn-sm btn-primary" onClick={() => handleLoad(save.slotId, true)}>
                                                        Load
                                                    </button>
                                                    {state.character && (
                                                        <button className="btn btn-sm" title="Overwrite this save with your current game" disabled={isSaving} onClick={() => handleOverwrite(save.slotId, save.name)}>
                                                            Overwrite
                                                        </button>
                                                    )}
                                                    <button className="btn btn-sm btn-danger" title="Delete this cloud save" onClick={() => handleDeleteCloud(save.slotId, save.name)}>
                                                        ✕
                                                    </button>
                                                </div>
                                            </div>
                                        ))}

                                        {saves.length > 0 && <div className="saves-empty" style={{ textAlign: 'left', margin: '15px 0 10px' }}>Local Saves</div>}
                                        {saves.map(save => (
                                            <div key={save.slotId} className="save-slot">
                                                <div className="save-info">
                                                    <div className="save-name">{save.name}</div>
                                                    <div className="save-meta">
                                                        {save.characterName} · Lv.{save.characterLevel} {save.characterClass}
                                                        {save.characterHP != null ? ` · HP ${save.characterHP}/${save.characterMaxHP}` : ''}
                                                        {save.characterAC ? ` · AC ${save.characterAC}` : ''}
                                                    </div>
                                                    <div className="save-meta">
                                                        {save.gold ? `${save.gold}gp ` : ''}{save.silver ? `${save.silver}sp ` : ''}{save.copper ? `${save.copper}cp ` : ''}
                                                        {save.inventoryCount ? `· ${save.inventoryCount} items ` : ''}
                                                        {save.questCount ? `· ${save.questCount} quests ` : ''}
                                                        {save.partySize ? `· ${save.partySize} companions` : ''}
                                                    </div>
                                                    {save.location && <div className="save-meta">{save.location}</div>}
                                                    <div className="save-date">
                                                        {new Date(save.savedAt).toLocaleString()}
                                                    </div>
                                                </div>
                                                <div className="save-actions">
                                                    <button className="btn btn-sm btn-primary" onClick={() => handleLoad(save.slotId)}>
                                                        Load
                                                    </button>
                                                    {state.character && (
                                                        <button className="btn btn-sm" title="Overwrite this save with your current game" disabled={isSaving} onClick={() => handleOverwrite(save.slotId, save.name)}>
                                                            Overwrite
                                                        </button>
                                                    )}
                                                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(save.slotId)}>
                                                        ✕
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'cloud' && (
                        <div className="settings-section">
                            <h3 className="settings-section-title">Cross-Device Cloud Sync</h3>
                            <p className="setting-hint" style={{ marginBottom: '1rem' }}>
                                Connect your own Firebase Firestore database to seamlessly sync your saves across Desktop and Mobile.
                                Find these keys in your Google Firebase Console (Project Settings &gt; General &gt; Your Apps).
                            </p>

                            <div className="setting-group">
                                <label className="setting-label">apiKey</label>
                                <input
                                    type="password"
                                    className="setting-input"
                                    value={firebaseConfig.apiKey}
                                    onChange={(e) => setFirebaseConfig({ ...firebaseConfig, apiKey: e.target.value })}
                                    placeholder="AIzaSyA..."
                                />
                            </div>
                            <div className="setting-group">
                                <label className="setting-label">authDomain</label>
                                <input
                                    type="text"
                                    className="setting-input"
                                    value={firebaseConfig.authDomain}
                                    onChange={(e) => setFirebaseConfig({ ...firebaseConfig, authDomain: e.target.value })}
                                    placeholder="your-project.firebaseapp.com"
                                />
                            </div>
                            <div className="setting-group">
                                <label className="setting-label">projectId</label>
                                <input
                                    type="text"
                                    className="setting-input"
                                    value={firebaseConfig.projectId}
                                    onChange={(e) => setFirebaseConfig({ ...firebaseConfig, projectId: e.target.value })}
                                    placeholder="your-project-id"
                                />
                            </div>

                            <button
                                className={`btn ${isFirebaseConnected ? 'btn-success' : 'btn-primary'}`}
                                onClick={handleConnectFirebase}
                                style={{ marginBottom: '1.5rem', width: '100%' }}
                            >
                                {isFirebaseConnected ? 'Database Connected' : 'Connect Database'}
                            </button>

                            {isFirebaseConnected && (
                                <div className="cloud-auth-section">
                                    <h4 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Authentication</h4>

                                    {state.user?.uid ? (
                                        <div className="auth-status connected">
                                            <div style={{ marginBottom: '0.5rem' }}>
                                                <strong>Logged in as:</strong> {state.user.email || 'Guest'}
                                            </div>
                                            <button className="btn btn-sm btn-primary" onClick={handleUploadLocalSaves}>
                                                Upload Local Saves to Cloud
                                            </button>
                                            <button className="btn btn-sm btn-danger" onClick={handleLogout}>
                                                Sign Out
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="auth-actions">
                                            <p className="setting-hint" style={{ marginBottom: '0.5rem' }}>Sign in to sync your saves to the cloud.</p>
                                            <button className="btn btn-primary" onClick={handleGoogleLogin}>
                                                Sign In with Google
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {authError && (
                                <div className="auth-error" style={{ color: 'var(--danger)', marginTop: '1rem', fontSize: '0.8rem' }}>
                                    {authError}
                                </div>
                            )}
                            {syncStatus && (
                                <div className="auth-status" style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
                                    {syncStatus}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
