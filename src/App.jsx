import { useState, useEffect } from 'react';
import { GameProvider, useGameState, useGame } from './state/GameContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import AppShell from './components/Layout/AppShell.jsx';
import CharacterCreation from './components/CharacterSheet/CharacterCreation.jsx';
import SettingsModal from './components/Settings/SettingsModal.jsx';
import { loadAutoSave, listSaves, loadGame } from './state/persistence.js';
import { loadGameFromCloud, listCloudSaves } from './state/cloudSync.js';
import { clearImageCache } from './llm/providers/imageGen.js';
import './App.css';

function StartScreen() {
  const { state, dispatch } = useGame();
  const [autoSaveData, setAutoSaveData] = useState(null);
  const [saves, setSaves] = useState([]);
  const [cloudSaves, setCloudSaves] = useState([]);
  const [cloudLoadError, setCloudLoadError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSaves, setShowSaves] = useState(false);

  useEffect(() => {
    async function checkSaves() {
      try {
        const [autoSave, saveList] = await Promise.all([
          loadAutoSave(),
          listSaves(),
        ]);
        setAutoSaveData(autoSave);
        setSaves(saveList);
      } catch (e) {
        // A blocked/quota/corrupt IndexedDB used to render as "no autosave, no
        // saves" — the player saw their campaign gone while the data sat intact
        // (2026-09-02 audit). Fail loudly here like the in-game load path does.
        console.error('Failed to read local saves at boot:', e);
        setLoadError(
          'Your local save store could not be opened, so Continue and Load Game are unavailable right now. '
          + 'Your campaign data is most likely intact — close any other Quest Forge tabs and reload the page.'
          + (e?.message ? ` (${e.message})` : '')
        );
      } finally {
        setLoading(false);
      }
    }
    checkSaves();
  }, []);

  useEffect(() => {
    async function fetchCloudSaves() {
      if (state.user?.uid) {
        try {
          setCloudLoadError('');
          setCloudSaves(await listCloudSaves(state.user.uid));
        } catch (e) {
          console.warn('Failed to load cloud saves', e);
          setCloudLoadError(e.message || 'Failed to load cloud saves');
          setCloudSaves([]);
        }
      } else {
        setCloudLoadError('');
        setCloudSaves([]);
      }
    }
    fetchCloudSaves();
  }, [state.user?.uid]);

  const handleContinue = () => {
    // Autosaves are deliberately per-device (local browser only); the cloud
    // carries manual saves. Continue always resumes this device's session.
    if (autoSaveData) {
      clearImageCache(); // Scene-art cache is per-campaign — never show another campaign's art
      dispatch({ type: 'LOAD_GAME', payload: autoSaveData });
    }
  };

  const [loadingSlot, setLoadingSlot] = useState(null);

  const handleLoadSave = async (slotId, isCloud = false) => {
    if (loadingSlot) return; // A double-click must not dispatch LOAD_GAME twice
    setLoadError('');
    // An expired/absent session used to fall through to the LOCAL branch,
    // find nothing, and silently do nothing (2026-07-25 audit).
    if (isCloud && !state.user?.uid) {
      setLoadError('Sign in with Google to load cloud saves — your session has expired or you are signed out.');
      return;
    }
    setLoadingSlot(slotId);
    try {
      const savedState = isCloud
        ? await loadGameFromCloud(state.user.uid, slotId)
        : await loadGame(slotId);

      if (savedState) {
        clearImageCache();
        dispatch({ type: 'LOAD_GAME', payload: savedState });
      } else {
        setLoadError('That save could not be loaded — details in the browser console.');
      }
    } catch (e) {
      console.error('Failed to load save', e);
      setLoadError(e?.message || 'That save could not be loaded — details in the browser console.');
    } finally {
      setLoadingSlot(null);
    }
  };

  const handleNewGame = () => {
    dispatch({ type: 'SET_UI', payload: { isCharacterCreationOpen: true } });
  };

  const handleCloudSync = () => {
    dispatch({ type: 'SET_UI', payload: { isSettingsOpen: true, settingsTab: 'cloud' } });
  };

  const hasFirebaseConfig = !!state.settings.firebaseConfig?.apiKey;
  const cloudStatus = state.user?.uid
    ? `Signed in${state.user.email ? ` as ${state.user.email}` : ''}`
    : hasFirebaseConfig && state.user?.isAuthLoading
      ? 'Checking cloud sync...'
      : hasFirebaseConfig
        ? 'Cloud sync not signed in'
        : 'Cloud sync not configured';

  if (loading) {
    return (
      <div className="start-screen">
        <div className="start-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="start-screen">
      <div className="start-content">
        <div className="start-logo" aria-hidden="true">
          <span className="start-logo-blade start-logo-blade-left" />
          <span className="start-logo-blade start-logo-blade-right" />
        </div>
        <h1 className="start-title">Quest Forge</h1>
        <p className="start-subtitle">AI-Powered Tabletop RPG</p>
        {state.settings.firebaseConfig?.apiKey && state.user?.isAuthLoading && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem', textAlign: 'center' }}>
            Firebase mapped. Checking auth state...
          </div>
        )}
        <div className="start-cloud-status">
          <span>{cloudStatus}</span>
          <button className="start-cloud-btn" onClick={handleCloudSync}>
            Cloud Sync
          </button>
        </div>
        {cloudLoadError && (
          <div className="start-cloud-error">
            Cloud saves could not be loaded: {cloudLoadError}
          </div>
        )}

        <div className="start-buttons">
          {autoSaveData && (
            <button className="start-btn continue-btn" onClick={handleContinue}>
              <span className="start-btn-icon start-btn-icon-continue" aria-hidden="true" />
              <span className="start-btn-text">
                <span className="start-btn-label">Continue</span>
                <span className="start-btn-detail">
                  {autoSaveData.character?.name} · Lv.{autoSaveData.character?.level} {autoSaveData.character?.class}
                </span>
              </span>
            </button>
          )}

          {(saves.length > 0 || cloudSaves.length > 0) && (
            <button className="start-btn load-btn" onClick={() => setShowSaves(!showSaves)}>
              <span className="start-btn-icon start-btn-icon-load" aria-hidden="true" />
              <span className="start-btn-text">
                <span className="start-btn-label">Load Game</span>
                <span className="start-btn-detail">{saves.length + cloudSaves.length} saved games</span>
              </span>
            </button>
          )}

          <button className="start-btn new-btn" onClick={handleNewGame}>
            <span className="start-btn-icon start-btn-icon-new" aria-hidden="true" />
            <span className="start-btn-text">
              <span className="start-btn-label">New Game</span>
              <span className="start-btn-detail">Create a new character</span>
            </span>
          </button>
        </div>

        {loadError && (
          <div className="start-cloud-error">
            {loadError}
          </div>
        )}

        {showSaves && (
          <div className="start-saves-list">
            {cloudSaves.length > 0 && <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)' }}>Cloud Saves</h4>}
            {cloudSaves.map(save => (
              <button key={`cloud-${save.slotId}`} className="start-save-slot" onClick={() => handleLoadSave(save.slotId, true)}>
                <div className="start-save-info">
                  <span className="start-save-name">{save.name}</span>
                  <span className="start-save-meta">
                    {save.characterName} · Lv.{save.characterLevel} {save.characterClass} · {save.messageCount} msgs
                  </span>
                </div>
                <span className="start-save-date">{new Date(save.savedAt).toLocaleDateString()}</span>
              </button>
            ))}

            {saves.length > 0 && <h4 style={{ margin: '1rem 0 0.5rem 0', color: 'var(--text-muted)' }}>Local Saves</h4>}
            {saves.map(save => (
              <button key={`local-${save.slotId}`} className="start-save-slot" onClick={() => handleLoadSave(save.slotId, false)}>
                <div className="start-save-info">
                  <span className="start-save-name">{save.name}</span>
                  <span className="start-save-meta">
                    {save.characterName} · Lv.{save.characterLevel} {save.characterClass} · {save.messageCount} msgs
                  </span>
                </div>
                <span className="start-save-date">{new Date(save.savedAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AppContent() {
  const state = useGameState();

  const showCharacterCreation = !state.character && state.ui.isCharacterCreationOpen;
  const showStartScreen = !state.character && !state.ui.isCharacterCreationOpen;

  return (
    <>
      {showStartScreen && <StartScreen />}
      {showCharacterCreation && (
        <ErrorBoundary label="Character Creation">
          <CharacterCreation />
        </ErrorBoundary>
      )}
      {/* Keyed by session AND load nonce so loading ANY save mid-session —
          including an earlier/later save of the SAME campaign, whose session.id
          is unchanged — remounts the whole shell (2026-08-31 P1). ChatPanel's
          mount-scoped refs (RAG seeding, journal baseline, exchange/cue
          narration dedupe) assume one mount = one timeline. */}
      {state.character && <AppShell key={`${state.session?.id ?? 'no-session'}:${state.session?.loadNonce ?? 0}`} />}
      {state.ui.isSettingsOpen && (
        <ErrorBoundary label="Settings">
          <SettingsModal />
        </ErrorBoundary>
      )}
    </>
  );
}

export default function App() {
  return (
    <GameProvider>
      {/* Root boundary INSIDE the provider: a render crash anywhere below shows
          the recovery UI while the in-memory game state (and the debounced
          autosave that reads it) survives. */}
      <ErrorBoundary label="Quest Forge">
        <AppContent />
      </ErrorBoundary>
    </GameProvider>
  );
}

