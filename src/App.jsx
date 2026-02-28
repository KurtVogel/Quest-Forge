import { useState, useEffect } from 'react';
import { GameProvider, useGameState, useGameDispatch, useGame } from './state/GameContext.jsx';
import AppShell from './components/Layout/AppShell.jsx';
import CharacterCreation from './components/CharacterSheet/CharacterCreation.jsx';
import SettingsModal from './components/Settings/SettingsModal.jsx';
import { loadAutoSave, listSaves, loadGame } from './state/persistence.js';
import { loadGameFromCloud, listCloudSaves } from './state/cloudSync.js';
import './App.css';

function StartScreen() {
  const { state, dispatch } = useGame();
  const [autoSaveData, setAutoSaveData] = useState(null);
  const [saves, setSaves] = useState([]);
  const [cloudAutoSave, setCloudAutoSave] = useState(null);
  const [cloudSaves, setCloudSaves] = useState([]);
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
        console.warn('Failed to check config saves:', e);
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
          const [cAutoSave, cList] = await Promise.all([
            loadGameFromCloud(state.user.uid, '__autosave__'),
            listCloudSaves(state.user.uid)
          ]);
          setCloudAutoSave(cAutoSave);
          setCloudSaves(cList);
        } catch (e) {
          console.warn('Failed to load cloud saves', e);
        }
      } else {
        setCloudAutoSave(null);
        setCloudSaves([]);
      }
    }
    fetchCloudSaves();
  }, [state.user?.uid]);

  const handleContinue = () => {
    // Prefer cloud auto save if it exists and is newer, otherwise fallback to local
    const useCloud = cloudAutoSave && (!autoSaveData || new Date(cloudAutoSave.session?.updatedAt || 0) > new Date(autoSaveData.session?.updatedAt || 0));
    const dataToLoad = useCloud ? cloudAutoSave : autoSaveData;

    if (dataToLoad) {
      dispatch({ type: 'LOAD_GAME', payload: dataToLoad });
    }
  };

  const handleLoadSave = async (slotId, isCloud = false) => {
    let savedState = null;
    if (isCloud && state.user?.uid) {
      savedState = await loadGameFromCloud(state.user.uid, slotId);
    } else {
      savedState = await loadGame(slotId);
    }

    if (savedState) {
      dispatch({ type: 'LOAD_GAME', payload: savedState });
    }
  };

  const handleNewGame = () => {
    dispatch({ type: 'SET_UI', payload: { isCharacterCreationOpen: true } });
  };

  const hasAnySave = autoSaveData || saves.length > 0 || cloudAutoSave || cloudSaves.length > 0;
  const bestAutoSave = cloudAutoSave || autoSaveData; // Simplified preference

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
        <div className="start-logo">⚔️</div>
        <h1 className="start-title">Quest Forge</h1>
        <p className="start-subtitle">AI-Powered Tabletop RPG</p>
        {state.settings.firebaseConfig?.apiKey && state.user?.isAuthLoading && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem', textAlign: 'center' }}>
            Firebase mapped. Checking auth state...
          </div>
        )}

        <div className="start-buttons">
          {bestAutoSave && (
            <button className="start-btn continue-btn" onClick={handleContinue}>
              <span className="start-btn-icon">▶</span>
              <span className="start-btn-text">
                <span className="start-btn-label">Continue {cloudAutoSave ? '☁️' : '💾'}</span>
                <span className="start-btn-detail">
                  {bestAutoSave.character?.name} · Lv.{bestAutoSave.character?.level} {bestAutoSave.character?.class}
                </span>
              </span>
            </button>
          )}

          {(saves.length > 0 || cloudSaves.length > 0) && (
            <button className="start-btn load-btn" onClick={() => setShowSaves(!showSaves)}>
              <span className="start-btn-icon">📂</span>
              <span className="start-btn-text">
                <span className="start-btn-label">Load Game</span>
                <span className="start-btn-detail">{saves.length + cloudSaves.length} saved games</span>
              </span>
            </button>
          )}

          <button className="start-btn new-btn" onClick={handleNewGame}>
            <span className="start-btn-icon">✨</span>
            <span className="start-btn-text">
              <span className="start-btn-label">New Game</span>
              <span className="start-btn-detail">Create a new character</span>
            </span>
          </button>
        </div>

        {showSaves && (
          <div className="start-saves-list">
            {cloudSaves.length > 0 && <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)' }}>☁️ Cloud Saves</h4>}
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

            {saves.length > 0 && <h4 style={{ margin: '1rem 0 0.5rem 0', color: 'var(--text-muted)' }}>💾 Local Saves</h4>}
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
      {showCharacterCreation && <CharacterCreation />}
      {state.character && <AppShell />}
      {state.ui.isSettingsOpen && <SettingsModal />}
    </>
  );
}

export default function App() {
  return (
    <GameProvider>
      <AppContent />
    </GameProvider>
  );
}

