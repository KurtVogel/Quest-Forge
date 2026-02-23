import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import ChatPanel from '../Chat/ChatPanel.jsx';
import CharacterSheet from '../CharacterSheet/CharacterSheet.jsx';
import DicePanel from '../DiceRoller/DicePanel.jsx';
import InventoryPanel from '../Inventory/InventoryPanel.jsx';
import QuestPanel from '../Quests/QuestPanel.jsx';
import JournalPanel from '../Journal/JournalPanel.jsx';
import SceneArt from '../SceneArt/SceneArt.jsx';
import AmbientControls from '../AmbientAudio/AmbientControls.jsx';
import './Layout.css';

export default function AppShell() {
    const { state, dispatch } = useGame();
    const [isJournalOpen, setIsJournalOpen] = useState(false);

    const handleOpenSettings = () => {
        dispatch({ type: 'SET_UI', payload: { isSettingsOpen: true } });
    };

    return (
        <div className="app-shell">
            <header className="app-header">
                <div className="header-left">
                    <h1 className="app-title">⚔️ Quest Forge</h1>
                    <span className="session-name">{state.session.name || 'New Adventure'}</span>
                </div>
                <div className="header-right">
                    {!state.settings.apiKey && (
                        <span className="api-warning" onClick={handleOpenSettings}>⚠️ Set API Key</span>
                    )}
                    <button
                        className="header-btn"
                        onClick={() => setIsJournalOpen(true)}
                        title="World Journal"
                    >
                        📜
                    </button>
                    <AmbientControls />
                    <button className="header-btn settings-btn-expanded" onClick={handleOpenSettings} title="Settings">
                        ⚙️ Settings
                    </button>
                </div>
            </header>

            <div className="app-body">
                <aside className="sidebar sidebar-left">
                    <div className="sidebar-section">
                        <ErrorBoundary label="Character Sheet">
                            <CharacterSheet />
                        </ErrorBoundary>
                    </div>
                    <div className="sidebar-section sidebar-inventory">
                        <ErrorBoundary label="Inventory">
                            <InventoryPanel />
                        </ErrorBoundary>
                    </div>
                </aside>

                <main className="main-content">
                    <ErrorBoundary label="Scene Art">
                        <SceneArt />
                    </ErrorBoundary>
                    <ErrorBoundary label="Chat">
                        <ChatPanel />
                    </ErrorBoundary>
                </main>

                <aside className="sidebar sidebar-right">
                    <ErrorBoundary label="Dice Roller">
                        <DicePanel />
                    </ErrorBoundary>
                    <ErrorBoundary label="Quests">
                        <QuestPanel />
                    </ErrorBoundary>
                </aside>
            </div>

            <JournalPanel isOpen={isJournalOpen} onClose={() => setIsJournalOpen(false)} />
        </div>
    );
}
