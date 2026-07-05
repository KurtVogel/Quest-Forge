import { useMemo, useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { enrichNpcProfile, needsNpcEnrichment, normalizeCallbackHook } from '../../llm/npcEnrichment.js';
import { suggestArchivableFodder } from '../../llm/npcFodderReview.js';
import { scoreNpcForPrompt } from '../../engine/npcRoster.js';
import './Journal.css';

const DISPOSITION_MARK = {
    friendly: 'Ally',
    neutral: 'Neutral',
    hostile: 'Hostile',
    wary: 'Wary',
    unknown: 'Unknown',
};

export default function JournalPanel({ isOpen, onClose }) {
    const { state, dispatch, flushAutoSave } = useGame();
    const [tab, setTab] = useState('journal');
    const [enrichingId, setEnrichingId] = useState(null);
    const [enrichError, setEnrichError] = useState('');
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [reviewingFodder, setReviewingFodder] = useState(false);
    const [reviewMessage, setReviewMessage] = useState('');

    const characterNpcs = useMemo(
        () => (state.npcs || []).filter(npc => npc.rosterTier !== 'archived_creature'),
        [state.npcs],
    );
    const archivedNpcs = useMemo(
        () => (state.npcs || []).filter(npc => npc.rosterTier === 'archived_creature'),
        [state.npcs],
    );
    const selectedCount = selectedIds.size;

    const toggleSelected = (id, checked) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    const handleSuggestFodder = async () => {
        if (!state.settings?.apiKey) {
            setReviewMessage('Add your API key in Settings, then use Suggest fodder — or select entries manually.');
            return;
        }
        setReviewMessage('');
        setEnrichError('');
        setReviewingFodder(true);
        try {
            const { ids: suggested, partialFailure } = await suggestArchivableFodder({
                npcs: characterNpcs,
                settings: state.settings,
            });
            setSelectedIds(new Set(suggested));
            if (suggested.length > 0) {
                setReviewMessage(partialFailure
                    ? `AI suggested ${suggested.length} entries (one batch had a parse issue — review carefully). Uncheck keepers, then Archive selected.`
                    : `AI suggested ${suggested.length} entries. Review the checkboxes, uncheck anyone you want to keep, then Archive selected.`);
            } else {
                setReviewMessage('AI found no disposable fodder in the current roster.');
            }
        } catch (error) {
            setReviewMessage(error.message || 'Fodder review failed.');
        } finally {
            setReviewingFodder(false);
        }
    };

    const handleArchiveSelected = () => {
        if (selectedCount === 0) return;
        dispatch({ type: 'ARCHIVE_NPC_BULK', payload: { ids: [...selectedIds] } });
        setSelectedIds(new Set());
        setReviewMessage(`Archived ${selectedCount} entries.`);
        flushAutoSave({ npcBulkArchiveIds: [...selectedIds] }).catch(() => {});
    };

    const handleDeepen = async (npc) => {
        if (!state.settings?.apiKey) {
            setEnrichError('Add your API key in Settings before deepening NPC memory.');
            return;
        }
        setEnrichError('');
        setEnrichingId(npc.id);
        try {
            const update = await enrichNpcProfile({ state, npc, settings: state.settings });
            dispatch({ type: 'UPDATE_NPC', payload: update });
            await flushAutoSave({ npcUpdate: update });
        } catch (error) {
            setEnrichError(error.message || 'Failed to deepen NPC memory.');
        } finally {
            setEnrichingId(null);
        }
    };

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
                        Characters ({characterNpcs.length})
                    </button>
                    {archivedNpcs.length > 0 && (
                        <button
                            className={`journal-tab ${tab === 'archived' ? 'active' : ''}`}
                            onClick={() => setTab('archived')}
                        >
                            Archived ({archivedNpcs.length})
                        </button>
                    )}
                </div>

                <div className="journal-body">
                    {tab === 'journal' && <JournalTab journal={state.journal || []} location={state.currentLocation} />}
                    {tab === 'npcs' && (
                        <>
                            {characterNpcs.length > 0 && (
                                <div className="journal-npc-toolbar">
                                    <button
                                        type="button"
                                        className="journal-npc-bulk-btn"
                                        disabled={reviewingFodder}
                                        onClick={handleSuggestFodder}
                                    >
                                        {reviewingFodder ? 'Reviewing roster…' : 'Suggest fodder (AI)'}
                                    </button>
                                    {selectedCount > 0 && (
                                        <button
                                            type="button"
                                            className="journal-npc-archive-btn"
                                            onClick={handleArchiveSelected}
                                        >
                                            Archive selected ({selectedCount})
                                        </button>
                                    )}
                                    {selectedCount > 0 && (
                                        <button
                                            type="button"
                                            className="journal-npc-pin-btn"
                                            onClick={() => {
                                                setSelectedIds(new Set());
                                                setReviewMessage('');
                                            }}
                                        >
                                            Clear selection
                                        </button>
                                    )}
                                </div>
                            )}
                            {reviewMessage && <p className="journal-npc-review-msg">{reviewMessage}</p>}
                            {enrichError && <p className="journal-npc-error">{enrichError}</p>}
                            <NPCTab
                                npcs={characterNpcs}
                                location={state.currentLocation}
                                enrichingId={enrichingId}
                                selectedIds={selectedIds}
                                onToggleSelected={toggleSelected}
                                onPin={(id, pinned) => dispatch({ type: 'PIN_NPC', payload: { id, pinned } })}
                                onArchive={(id) => dispatch({ type: 'ARCHIVE_NPC', payload: { id } })}
                                onDeepen={handleDeepen}
                            />
                        </>
                    )}
                    {tab === 'archived' && (
                        <NPCTab
                            npcs={archivedNpcs}
                            location={state.currentLocation}
                            archived
                            onPin={(id, pinned) => dispatch({ type: 'PIN_NPC', payload: { id, pinned } })}
                        />
                    )}
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

function NPCTab({
    npcs,
    location,
    archived = false,
    enrichingId = null,
    selectedIds = null,
    onToggleSelected = null,
    onPin,
    onArchive,
    onDeepen,
}) {
    if (npcs.length === 0) {
        return (
            <div className="journal-empty">
                <p>{archived ? 'No archived creatures.' : 'No characters tracked yet.'}</p>
                <p className="journal-hint">
                    {archived
                        ? 'Generic combat fodder can be archived here instead of cluttering your character roster.'
                        : 'Pin important rivals, use Suggest fodder (AI) or checkboxes to clean combat clutter, and Deepen memory for thin legacy records.'}
                </p>
            </div>
        );
    }

    const sorted = [...npcs].sort((a, b) => scoreNpcForPrompt(b, { location }) - scoreNpcForPrompt(a, { location }));

    return (
        <div className="journal-npc-list">
            {sorted.map(npc => {
                const thin = !archived && needsNpcEnrichment(npc);
                const deepening = enrichingId === npc.id;
                return (
                    <div key={npc.id} className={`journal-npc ${npc.disposition || 'unknown'}${npc.pinned ? ' pinned' : ''}${selectedIds?.has(npc.id) ? ' selected' : ''}`}>
                        <div className="journal-npc-header">
                            {!archived && onToggleSelected && !npc.pinned && (
                                <input
                                    type="checkbox"
                                    className="journal-npc-select"
                                    checked={selectedIds?.has(npc.id) || false}
                                    aria-label={`Select ${npc.name} for archive`}
                                    onChange={(e) => onToggleSelected(npc.id, e.target.checked)}
                                />
                            )}
                            <span className="journal-npc-mark">{DISPOSITION_MARK[npc.disposition] || 'Unknown'}</span>
                            <span className="journal-npc-name">{npc.name}</span>
                            {npc.pinned && <span className="journal-npc-pin-badge" title="Pinned for long-term recall">Pinned</span>}
                            {thin && <span className="journal-npc-thin-badge" title="Agenda, inner life, or personal stance toward you not yet synthesized — Deepen memory fills them from campaign history and your conversations">Thin record</span>}
                            <span className={`journal-npc-disposition ${npc.disposition}`}>
                                {npc.disposition || 'unknown'}
                            </span>
                        </div>
                        {npc.appearance && (
                            <p className="journal-npc-looks">
                                <span className="journal-npc-looks-label">Looks</span>
                                {npc.appearance}
                            </p>
                        )}
                        {npc.stanceToPlayer && (
                            <p className="journal-npc-stance">
                                <span className="journal-npc-stance-label">Toward you</span>
                                {npc.stanceToPlayer}
                            </p>
                        )}
                        {npc.bondMoments?.length > 0 && (
                            <div className="journal-npc-bonds">
                                <span className="journal-npc-bonds-label">Moments between you</span>
                                <ul className="journal-npc-bonds-list">
                                    {[...npc.bondMoments].reverse().slice(0, 4).map((moment, i) => (
                                        <li key={i} title={moment.text}>{moment.text}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {(npc.basedIn || npc.lastLocation) && (
                            <p className="journal-npc-where">
                                {npc.basedIn && <span>Based in: <strong>{npc.basedIn}</strong></span>}
                                {npc.lastLocation && <span>Last seen: <strong>{npc.lastLocation}</strong></span>}
                            </p>
                        )}
                        <p className="journal-npc-notes">{npc.lastNotes || npc.notes || 'No notes'}</p>
                        {(npc.agenda || npc.relationshipTension || npc.privateNotes) && (
                            <p className="journal-npc-meta">
                                {npc.relationshipTension && <span>Tension: {npc.relationshipTension}</span>}
                                {npc.agenda && <span>Agenda: {npc.agenda}</span>}
                                {npc.privateNotes && <span>Mind: {npc.privateNotes}</span>}
                            </p>
                        )}
                        {npc.callbackHooks?.length > 0 && (
                            <div className="journal-npc-hooks">
                                <span className="journal-npc-hooks-label">Hooks</span>
                                <ul className="journal-npc-hooks-list">
                                    {npc.callbackHooks.map((hook, i) => {
                                        const text = normalizeCallbackHook(hook);
                                        if (!text) return null;
                                        return <li key={i} title={text}>{text}</li>;
                                    })}
                                </ul>
                            </div>
                        )}
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
                        <div className="journal-npc-footer">
                            {npc.lastSeen && (
                                <span className="journal-npc-lastseen">
                                    Last seen: {new Date(npc.lastSeen).toLocaleDateString()}
                                </span>
                            )}
                            {!archived && onDeepen && (
                                <button
                                    type="button"
                                    className="journal-npc-deepen-btn"
                                    disabled={deepening}
                                    onClick={() => onDeepen(npc)}
                                >
                                    {deepening ? 'Deepening…' : 'Deepen memory'}
                                </button>
                            )}
                            {!archived && onPin && (
                                <button
                                    type="button"
                                    className={`journal-npc-pin-btn${npc.pinned ? ' active' : ''}`}
                                    onClick={() => onPin(npc.id, !npc.pinned)}
                                >
                                    {npc.pinned ? 'Unpin' : 'Pin'}
                                </button>
                            )}
                            {!archived && onArchive && (
                                <button
                                    type="button"
                                    className="journal-npc-archive-btn"
                                    onClick={() => onArchive(npc.id)}
                                >
                                    Archive
                                </button>
                            )}
                            {archived && onPin && (
                                <button
                                    type="button"
                                    className="journal-npc-pin-btn"
                                    onClick={() => onPin(npc.id, true)}
                                >
                                    Restore & Pin
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}