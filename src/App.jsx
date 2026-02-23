import { useState, useEffect } from 'react';
import { GameProvider, useGameState, useGameDispatch } from './state/GameContext.jsx';
import AppShell from './components/Layout/AppShell.jsx';
import CharacterCreation from './components/CharacterSheet/CharacterCreation.jsx';
import SettingsModal from './components/Settings/SettingsModal.jsx';
import { loadAutoSave, listSaves, loadGame } from './state/persistence.js';
import './App.css';

function StartScreen() {
  const dispatch = useGameDispatch();
  const [autoSaveData, setAutoSaveData] = useState(null);
  const [saves, setSaves] = useState([]);
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
        console.warn('Failed to check saves:', e);
      } finally {
        setLoading(false);
      }
    }
    checkSaves();
  }, []);

  const handleContinue = () => {
    if (autoSaveData) {
      dispatch({ type: 'LOAD_GAME', payload: autoSaveData });
    }
  };

  const handleLoadSave = async (slotId) => {
    const savedState = await loadGame(slotId);
    if (savedState) {
      dispatch({ type: 'LOAD_GAME', payload: savedState });
    }
  };

  const handleNewGame = () => {
    dispatch({ type: 'SET_UI', payload: { isCharacterCreationOpen: true } });
  };

  const hasAnySave = autoSaveData || saves.length > 0;

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

        <div className="start-buttons">
          {autoSaveData && (
            <button className="start-btn continue-btn" onClick={handleContinue}>
              <span className="start-btn-icon">▶</span>
              <span className="start-btn-text">
                <span className="start-btn-label">Continue</span>
                <span className="start-btn-detail">
                  {autoSaveData.character?.name} · Lv.{autoSaveData.character?.level} {autoSaveData.character?.class}
                </span>
              </span>
            </button>
          )}

          {saves.length > 0 && (
            <button className="start-btn load-btn" onClick={() => setShowSaves(!showSaves)}>
              <span className="start-btn-icon">📂</span>
              <span className="start-btn-text">
                <span className="start-btn-label">Load Game</span>
                <span className="start-btn-detail">{saves.length} saved {saves.length === 1 ? 'game' : 'games'}</span>
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
            {saves.map(save => (
              <button key={save.slotId} className="start-save-slot" onClick={() => handleLoadSave(save.slotId)}>
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
