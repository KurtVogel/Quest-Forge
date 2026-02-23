import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import './Journal.css';

const DISPOSITION_EMOJI = {
    friendly: '😊',
    neutral: '😐',
    hostile: '😠',
    wary: '🤨',
    unknown: '❓',
};

export default function JournalPanel({ isOpen, onClose }) {
    const { state } = useGame();
    const [tab, setTab] = useState('journal');

    if (!isOpen) return null;

    return (
        <div className="journal-overlay" onClick={onClose}>
            <div className="journal-modal" onClick={(e) => e.stopPropagation()}>
                <div className="journal-header">
                    <h2 className="journal-modal-title">📜 World Journal</h2>
                    <button className="journal-close" onClick={onClose}>✕</button>
                </div>

                <div className="journal-tabs">
                    <button
                        className={`journal-tab ${tab === 'journal' ? 'active' : ''}`}
                        onClick={() => setTab('journal')}
                    >
                        Chronicle
                    </button>
                    <button
                        className={`journal-tab ${tab === 'npcs' ? 'active' : ''}`}
                        onClick={() => setTab('npcs')}
                    >
                        NPCs ({state.npcs?.length || 0})
                    </button>
                </div>

                <div className="journal-body">
                    {tab === 'journal' && <JournalTab journal={state.journal || []} location={state.currentLocation} />}
                    {tab === 'npcs' && <NPCTab npcs={state.npcs || []} />}
                </div>
            </div>
        </div>
    );
}

function JournalTab({ journal, location }) {
    if (journal.length === 0) {
        return (
            <div className="journal-empty">
                <p>Your chronicle is empty.</p>
                <p className="journal-hint">Journal entries are automatically created as you play, summarizing key events every ~10 messages.</p>
            </div>
        );
    }

    return (
        <div className="journal-entries">
            {location && (
                <div className="journal-location">
                    <span className="journal-location-icon">📍</span>
                    <span>Current location: <strong>{location}</strong></span>
                </div>
            )}

            {[...journal].reverse().map((entry, idx) => (
                <div key={entry.id} className="journal-entry">
                    <div className="journal-entry-header">
                        <span className="journal-entry-num">Entry {journal.length - idx}</span>
                        <span className="journal-entry-time">
                            {new Date(entry.timestamp).toLocaleDateString()}
                        </span>
                    </div>
                    <p className="journal-entry-text">{entry.summary}</p>
                    {entry.keyDecisions?.length > 0 && (
                        <div className="journal-decisions">
                            <span className="journal-sub-label">Decisions:</span>
                            <ul>
                                {entry.keyDecisions.map((d, i) => <li key={i}>{d}</li>)}
                            </ul>
                        </div>
                    )}
                    {entry.consequences?.length > 0 && (
                        <div className="journal-consequences">
                            <span className="journal-sub-label">Consequences:</span>
                            <ul>
                                {entry.consequences.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

function NPCTab({ npcs }) {
    if (npcs.length === 0) {
        return (
            <div className="journal-empty">
                <p>No NPCs encountered yet.</p>
                <p className="journal-hint">NPCs are automatically tracked as you meet characters in the world.</p>
            </div>
        );
    }

    return (
        <div className="journal-npc-list">
            {npcs.map(npc => (
                <div key={npc.id} className={`journal-npc ${npc.disposition || 'unknown'}`}>
                    <div className="journal-npc-header">
                        <span className="journal-npc-emoji">{DISPOSITION_EMOJI[npc.disposition] || '❓'}</span>
                        <span className="journal-npc-name">{npc.name}</span>
                        <span className={`journal-npc-disposition ${npc.disposition}`}>
                            {npc.disposition || 'unknown'}
                        </span>
                    </div>
                    <p className="journal-npc-notes">{npc.lastNotes || npc.notes || 'No notes'}</p>
                    {npc.lastSeen && (
                        <span className="journal-npc-lastseen">
                            Last seen: {new Date(npc.lastSeen).toLocaleDateString()}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}
