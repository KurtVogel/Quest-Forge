import { useState, useEffect } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { listGalleryImages, deleteGalleryImage } from '../../state/persistence.js';
import './Journal.css';

const DISPOSITION_MARK = {
    friendly: 'Ally',
    neutral: 'Neutral',
    hostile: 'Hostile',
    wary: 'Wary',
    unknown: 'Unknown',
};

export default function JournalPanel({ isOpen, onClose }) {
    const { state } = useGame();
    const [tab, setTab] = useState('journal');

    if (!isOpen) return null;

    return (
        <div className="journal-overlay" onClick={onClose}>
            <div className="journal-modal" onClick={(e) => e.stopPropagation()}>
                <div className="journal-header">
                    <h2 className="journal-modal-title">World Journal</h2>
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
                    <button
                        className={`journal-tab ${tab === 'gallery' ? 'active' : ''}`}
                        onClick={() => setTab('gallery')}
                    >
                        Gallery
                    </button>
                </div>

                <div className="journal-body">
                    {tab === 'journal' && <JournalTab journal={state.journal || []} location={state.currentLocation} />}
                    {tab === 'npcs' && <NPCTab npcs={state.npcs || []} />}
                    {tab === 'gallery' && <GalleryTab />}
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
                    <span className="journal-location-icon" aria-hidden="true" />
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

function GalleryTab() {
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState(null);

    useEffect(() => {
        listGalleryImages()
            .then(setImages)
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!selected) return;
        const handleKey = (e) => { if (e.key === 'Escape') setSelected(null); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [selected]);

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        await deleteGalleryImage(id);
        setImages(imgs => imgs.filter(img => img.id !== id));
        setSelected(sel => (sel?.id === id ? null : sel));
    };

    if (loading) {
        return <div className="journal-empty"><p>Loading gallery…</p></div>;
    }

    if (images.length === 0) {
        return (
            <div className="journal-empty">
                <p>No scenes saved yet.</p>
                <p className="journal-hint">Generate scene art with "Visualize" above the chat — it's saved here automatically.</p>
            </div>
        );
    }

    return (
        <>
            <div className="gallery-grid">
                {images.map(img => (
                    <div key={img.id} className="gallery-thumb" onClick={() => setSelected(img)}>
                        <img src={img.dataUrl} alt={img.location || 'Scene'} loading="lazy" />
                        <div className="gallery-thumb-caption">{img.location || 'Unknown'}</div>
                        <button
                            className="gallery-thumb-delete"
                            onClick={(e) => handleDelete(img.id, e)}
                            aria-label="Delete image"
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>

            {selected && (
                <div className="gallery-lightbox" onClick={() => setSelected(null)}>
                    <button
                        className="gallery-lightbox-close"
                        onClick={(e) => { e.stopPropagation(); setSelected(null); }}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                    <img
                        src={selected.dataUrl}
                        alt={selected.location || 'Scene'}
                        className="gallery-lightbox-img"
                        onClick={(e) => e.stopPropagation()}
                    />
                    <div className="gallery-lightbox-caption">
                        <span>{selected.location || 'Unknown location'}</span>
                        <span className="gallery-lightbox-date">{new Date(selected.createdAt).toLocaleString()}</span>
                        <button className="gallery-lightbox-delete" onClick={(e) => handleDelete(selected.id, e)}>
                            Delete
                        </button>
                    </div>
                </div>
            )}
        </>
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
                        <span className="journal-npc-mark">{DISPOSITION_MARK[npc.disposition] || 'Unknown'}</span>
                        <span className="journal-npc-name">{npc.name}</span>
                        <span className={`journal-npc-disposition ${npc.disposition}`}>
                            {npc.disposition || 'unknown'}
                        </span>
                    </div>
                    <p className="journal-npc-notes">{npc.lastNotes || npc.notes || 'No notes'}</p>
                    {npc.relationshipHistory?.length > 0 && (
                        <div className="journal-npc-arc" title="How this relationship has shifted">
                            <span className="journal-npc-arc-label">Arc:</span>
                            <span className={`journal-npc-arc-step ${npc.relationshipHistory[0].from}`}>
                                {npc.relationshipHistory[0].from}
                            </span>
                            {npc.relationshipHistory.map((h, i) => (
                                <span key={i} className="journal-npc-arc-seg">
                                    <span className="journal-npc-arc-sep">→</span>
                                    <span className={`journal-npc-arc-step ${h.to}`}>{h.to}</span>
                                </span>
                            ))}
                        </div>
                    )}
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
