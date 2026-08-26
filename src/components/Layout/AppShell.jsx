import { useEffect, useRef, useState } from 'react';
import { useGame, useSaveToast } from '../../state/GameContext.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import ChatPanel from '../Chat/ChatPanel.jsx';
import CharacterSheet from '../CharacterSheet/CharacterSheet.jsx';
import DicePanel from '../DiceRoller/DicePanel.jsx';
import InventoryPanel from '../Inventory/InventoryPanel.jsx';
import QuestPanel from '../Quests/QuestPanel.jsx';
import JournalPanel from '../Journal/JournalPanel.jsx';
import SceneArt from '../SceneArt/SceneArt.jsx';
import AmbientControls from '../AmbientAudio/AmbientControls.jsx';
import CompanionsPanel from '../Companions/CompanionsPanel.jsx';
import MemoryInspector from '../Debug/MemoryInspector.jsx';
import { isMemoryInspectorEnabled } from '../../debug/memoryInspectorStore.js';
import { isMachineryReady } from '../../llm/machinery.js';
import './Layout.css';

export default function AppShell() {
    const { state, dispatch } = useGame();
    const saveToast = useSaveToast();
    const [isJournalOpen, setIsJournalOpen] = useState(false);
    const [isInspectorOpen, setIsInspectorOpen] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const inspectorEnabled = isMemoryInspectorEnabled(state.settings);
    const hamburgerRef = useRef(null);
    const drawerCloseRef = useRef(null);

    // Dialog behavior for the mobile drawer (Codex 2026-08-09 a11y): Escape
    // closes, focus moves to the close control on open and back to the opener
    // on close — without this the 85vw drawer covered its own opener with no
    // visible way out and no keyboard path.
    useEffect(() => {
        if (!isMobileMenuOpen) return undefined;
        const opener = hamburgerRef.current;
        drawerCloseRef.current?.focus();
        const onKeyDown = (event) => {
            if (event.key === 'Escape') setIsMobileMenuOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            opener?.focus();
        };
    }, [isMobileMenuOpen]);

    const handleOpenSettings = () => {
        dispatch({ type: 'SET_UI', payload: { isSettingsOpen: true } });
    };

    return (
        <div className="app-shell">
            <header className="app-header">
                <div className="header-left">
                    <button
                        ref={hamburgerRef}
                        className="header-btn mobile-hamburger-btn"
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        title="Open Menu"
                        aria-label="Open game menu"
                        aria-expanded={isMobileMenuOpen}
                    >
                        ☰
                    </button>
                    <h1 className="app-title">
                        <span className="app-title-mark" aria-hidden="true" />
                        Quest Forge
                    </h1>
                    <span className="session-name">{state.session.name || 'New Adventure'}</span>
                </div>
                <div className="header-right">
                    {!state.settings.apiKey ? (
                        <span className="api-warning" onClick={handleOpenSettings}>Set API Key</span>
                    ) : !isMachineryReady(state.settings) && (
                        <span className="api-warning" onClick={handleOpenSettings}>Set Gemini Key</span>
                    )}
                    <button
                        className="header-btn desktop-only-btn"
                        onClick={() => setIsJournalOpen(true)}
                        title="World Journal"
                    >
                        Journal
                    </button>
                    {inspectorEnabled && (
                        <button
                            className="header-btn desktop-only-btn"
                            onClick={() => setIsInspectorOpen(true)}
                            title="Memory Inspector (dev)"
                        >
                            Memory
                        </button>
                    )}
                    <div className="desktop-audio-controls">
                        <AmbientControls />
                    </div>
                    <button className="header-btn settings-btn-expanded desktop-only-btn" onClick={handleOpenSettings} title="Settings">
                        Settings
                    </button>
                </div>
            </header>

            <div className="app-body">
                {/* Unified Mobile Drawer Container. Dialog semantics only while
                    OPEN — on desktop these are the plain always-visible sidebars. */}
                <div
                    className={`mobile-menu-drawer ${isMobileMenuOpen ? 'drawer-open' : ''}`}
                    {...(isMobileMenuOpen && { role: 'dialog', 'aria-modal': true, 'aria-label': 'Game menu' })}
                >
                    <button
                        ref={drawerCloseRef}
                        className="mobile-drawer-close"
                        onClick={() => setIsMobileMenuOpen(false)}
                        aria-label="Close game menu"
                    >
                        ✕ Close
                    </button>
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
                        <div className="sidebar-section">
                            <ErrorBoundary label="Companions">
                                <CompanionsPanel />
                            </ErrorBoundary>
                        </div>
                    </aside>

                    <aside className="sidebar sidebar-right">
                        <ErrorBoundary label="Dice Log">
                            <DicePanel />
                        </ErrorBoundary>
                        <ErrorBoundary label="Quests">
                            <QuestPanel />
                        </ErrorBoundary>

                        {/* Mobile-only Action Buttons at the bottom of the drawer */}
                        <div className="mobile-only-actions">
                            <div className="mobile-audio-controls">
                                <AmbientControls />
                            </div>
                            <button
                                className="mobile-drawer-btn"
                                onClick={() => { setIsJournalOpen(true); setIsMobileMenuOpen(false); }}
                            >
                                World Journal
                            </button>
                            {inspectorEnabled && (
                                <button
                                    className="mobile-drawer-btn"
                                    onClick={() => { setIsInspectorOpen(true); setIsMobileMenuOpen(false); }}
                                >
                                    Memory Inspector
                                </button>
                            )}
                            <button
                                className="mobile-drawer-btn"
                                onClick={() => { handleOpenSettings(); setIsMobileMenuOpen(false); }}
                            >
                                Settings
                            </button>
                        </div>
                    </aside>
                </div>

                {/* Chat Panel remains the central column on desktop, but stands natively on mobile */}
                <main className="main-content">
                    <ErrorBoundary label="Scene Art">
                        <SceneArt />
                    </ErrorBoundary>
                    <ErrorBoundary label="Chat">
                        <ChatPanel />
                    </ErrorBoundary>
                </main>

                {/* Overlay to catch clicks outside the drawer on mobile */}
                {isMobileMenuOpen && (
                    <div className="drawer-overlay" onClick={() => setIsMobileMenuOpen(false)}></div>
                )}
            </div>

            <JournalPanel isOpen={isJournalOpen} onClose={() => setIsJournalOpen(false)} />
            {inspectorEnabled && (
                <MemoryInspector isOpen={isInspectorOpen} onClose={() => setIsInspectorOpen(false)} />
            )}

            {saveToast && (
                <div className={`save-toast ${saveToast.status.endsWith('error') ? 'save-toast-error' : ''}`}>
                    {saveToast.status === 'cloud' && 'Game saved to cloud'}
                    {saveToast.status === 'local' && 'Game saved locally'}
                    {saveToast.status === 'cloud-error' && 'Cloud sync failed — saved locally only'}
                    {saveToast.status === 'save-error' && 'Auto-save FAILED — progress is not being saved. Check storage space.'}
                </div>
            )}
        </div>
    );
}
