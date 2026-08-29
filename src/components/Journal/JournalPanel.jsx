import { useMemo, useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { enrichNpcProfile, needsNpcEnrichment, normalizeCallbackHook } from '../../llm/npcEnrichment.js';
import { suggestArchivableFodder } from '../../llm/npcFodderReview.js';
import { isMachineryReady, getMachineryGeminiKey } from '../../llm/machinery.js';
import { scoreNpcForPrompt } from '../../engine/npcRoster.js';
import { generatePortraitImageDetailed } from '../../llm/providers/imageGen.js';
import { buildNpcPortraitPrompt } from '../CharacterSheet/portraitPrompt.js';
import { writeChronicleChapter, chronicleToMarkdown, collectChapterMessages, CHRONICLE_MIN_MESSAGES } from '../../llm/chronicler.js';
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
    const [portraitBusyId, setPortraitBusyId] = useState(null);
    const [chapterTitle, setChapterTitle] = useState('');
    const [writingChapter, setWritingChapter] = useState(false);
    const [chronicleStatus, setChronicleStatus] = useState('');

    const imageKeyAvailable = !!(state.settings?.imageApiKey || getMachineryGeminiKey(state.settings));

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
        if (!isMachineryReady(state.settings)) {
            setReviewMessage('Add your Gemini API key in Settings, then use Suggest fodder — or select entries manually.');
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
        const archiveAction = { type: 'ARCHIVE_NPC_BULK', payload: { ids: [...selectedIds] } };
        dispatch(archiveAction);
        setSelectedIds(new Set());
        setReviewMessage(`Archived ${selectedCount} entries.`);
        flushAutoSave({ action: archiveAction }).catch(() => {});
    };

    const handleDeepen = async (npc) => {
        if (!isMachineryReady(state.settings)) {
            setEnrichError('Add your Gemini API key in Settings before deepening NPC memory.');
            return;
        }
        setEnrichError('');
        setEnrichingId(npc.id);
        try {
            const update = await enrichNpcProfile({ state, npc, settings: state.settings });
            const updateAction = { type: 'UPDATE_NPC', payload: update };
            dispatch(updateAction);
            await flushAutoSave({ action: updateAction });
        } catch (error) {
            setEnrichError(error.message || 'Failed to deepen NPC memory.');
        } finally {
            setEnrichingId(null);
        }
    };

    const handleWriteChapter = async () => {
        if (writingChapter) return;
        setChronicleStatus('');
        setWritingChapter(true);
        try {
            const chapter = await writeChronicleChapter({
                state,
                title: chapterTitle,
                onProgress: setChronicleStatus,
            });
            const chapterAction = { type: 'ADD_CHRONICLE_CHAPTER', payload: chapter };
            dispatch(chapterAction);
            setChapterTitle('');
            setChronicleStatus(chapter.warning || 'Chapter written.');
            await flushAutoSave({ action: chapterAction });
        } catch (error) {
            setChronicleStatus(error.message || 'The chronicler failed.');
        } finally {
            setWritingChapter(false);
        }
    };

    const handleExportChronicle = () => {
        const markdown = chronicleToMarkdown(state.chronicle || [], state.session?.name || 'Campaign');
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const slug = String(state.session?.name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        link.download = `${slug || 'campaign'}-chronicle.md`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handlePortrait = async (npc) => {
        if (portraitBusyId) return;
        setEnrichError('');
        setPortraitBusyId(npc.id);
        try {
            const prompt = buildNpcPortraitPrompt(npc);
            const result = await generatePortraitImageDetailed(prompt, state.settings?.imageApiKey, {
                geminiApiKey: getMachineryGeminiKey(state.settings),
                bypassCache: !!npc.portraitUrl, // reroll must paint a genuinely new image
                sessionScope: state.session?.id || '',
            });
            if (!result?.url) throw new Error('No portrait returned.');
            const portraitAction = {
                type: 'SET_NPC_PORTRAIT',
                payload: {
                    id: npc.id,
                    portraitUrl: result.url,
                    portraitPrompt: prompt,
                    portraitProvider: result.provider || '',
                },
            };
            dispatch(portraitAction);
            await flushAutoSave({ action: portraitAction });
        } catch (error) {
            setEnrichError(error.message || 'Portrait failed.');
        } finally {
            setPortraitBusyId(null);
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
                        Journal
                    </button>
                    <button
                        className={`journal-tab ${tab === 'chronicle' ? 'active' : ''}`}
                        onClick={() => setTab('chronicle')}
                    >
                        Chronicle{(state.chronicle || []).length > 0 ? ` (${state.chronicle.length})` : ''}
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
                    {tab === 'chronicle' && (
                        <ChronicleTab
                            chapters={state.chronicle || []}
                            messages={state.messages || []}
                            chapterTitle={chapterTitle}
                            onChapterTitle={setChapterTitle}
                            writing={writingChapter}
                            status={chronicleStatus}
                            onWrite={handleWriteChapter}
                            onExport={handleExportChronicle}
                            suggestedTitle={state.session?.chapterCloseSuggested?.title || null}
                        />
                    )}
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
                                onPortrait={imageKeyAvailable ? handlePortrait : null}
                                portraitBusyId={portraitBusyId}
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

function ChronicleTab({ chapters, messages, chapterTitle, onChapterTitle, writing, status, onWrite, onExport, suggestedTitle }) {
    const lastChronicled = chapters.length > 0 ? (chapters[chapters.length - 1].toIndex ?? -1) : -1;
    const pendingCount = collectChapterMessages(messages, lastChronicled + 1).length;
    const canWrite = pendingCount >= CHRONICLE_MIN_MESSAGES;

    return (
        <div className="chronicle-tab">
            <div className="chronicle-compose">
                {suggestedTitle && canWrite && !writing && (
                    <p className="journal-hint chronicle-suggested">
                        🕰️ The fall of “{suggestedTitle}” just closed a major arc — a fitting
                        moment to close this chapter of the saga.
                    </p>
                )}
                <p className="journal-hint">
                    Close a chapter to have the chronicler retell your play since the last one as
                    a continuous saga — written from the actual scenes, kept forever, never shown
                    to the DM. {pendingCount > 0
                        ? `${pendingCount} message${pendingCount === 1 ? '' : 's'} of play await the quill.`
                        : 'No new play since the last chapter.'}
                </p>
                <div className="chronicle-compose-row">
                    <input
                        type="text"
                        className="chronicle-title-input"
                        value={chapterTitle}
                        onChange={(e) => onChapterTitle(e.target.value)}
                        placeholder={`Chapter ${chapters.length + 1} title (optional)`}
                        maxLength={80}
                        disabled={writing}
                    />
                    <button
                        type="button"
                        className="chronicle-write-btn"
                        disabled={writing || !canWrite}
                        title={canWrite ? 'Retell the span since the last chapter' : `Needs at least ${CHRONICLE_MIN_MESSAGES} messages of new play`}
                        onClick={onWrite}
                    >
                        {writing ? 'Writing…' : 'Close chapter'}
                    </button>
                    {chapters.length > 0 && (
                        <button type="button" className="chronicle-export-btn" onClick={onExport}>
                            Export markdown
                        </button>
                    )}
                </div>
                {status && <p className="chronicle-status">{status}</p>}
            </div>

            {chapters.length === 0 ? (
                <div className="journal-empty">
                    <p>No chapters written yet.</p>
                    <p className="journal-hint">
                        Play a stretch of your campaign, then close the chapter — the chronicler
                        retells it from the real scenes, not summaries.
                    </p>
                </div>
            ) : (
                <div className="chronicle-chapters">
                    {[...chapters].reverse().map((chapter, idx) => (
                        <details key={chapter.id} className="chronicle-chapter" open={idx === 0}>
                            <summary className="chronicle-chapter-summary">
                                <span className="chronicle-chapter-title">{chapter.title}</span>
                                <span className="chronicle-chapter-when">
                                    {chapter.createdAt ? new Date(chapter.createdAt).toLocaleDateString() : ''}
                                </span>
                            </summary>
                            <div className="chronicle-chapter-text">
                                {chapter.text.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
                            </div>
                        </details>
                    ))}
                </div>
            )}
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
    onPortrait = null,
    portraitBusyId = null,
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
                            {(npc.species || npc.gender) && (
                                <span className="journal-npc-gender" title="Registered species and gender — keep portraits, scene art, and the story consistent">
                                    {[npc.species, npc.gender].filter(Boolean).join(' ')}
                                </span>
                            )}
                            <span className={`journal-npc-disposition ${npc.disposition}`}>
                                {npc.disposition || 'unknown'}
                            </span>
                        </div>
                        {npc.portraitUrl && (
                            <div className="journal-npc-portrait">
                                <img
                                    src={npc.portraitUrl}
                                    alt={`Portrait of ${npc.name}`}
                                    title={npc.portraitPrompt || undefined}
                                />
                                {npc.portraitProvider && npc.portraitProvider !== 'xai' && (
                                    <span className="journal-npc-portrait-provider">
                                        {npc.portraitProvider === 'gemini' ? 'Gemini fallback' : npc.portraitProvider}
                                    </span>
                                )}
                            </div>
                        )}
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
                            // Only the latest shift shows by default (previous → current) —
                            // the full chain took card space without play value (Vesa,
                            // 2026-07-23). The stored history is the opt-in timeline below.
                            <details className="journal-npc-arc-details">
                                <summary className="journal-npc-arc" title="How this relationship last shifted — expand for the full history">
                                    <span className="journal-npc-arc-label">Arc:</span>
                                    <span className={`journal-npc-arc-step ${npc.relationshipHistory[npc.relationshipHistory.length - 1].from}`}>
                                        {npc.relationshipHistory[npc.relationshipHistory.length - 1].from}
                                    </span>
                                    <span className="journal-npc-arc-seg">
                                        <span className="journal-npc-arc-sep">→</span>
                                        <span className={`journal-npc-arc-step ${npc.disposition}`}>{npc.disposition}</span>
                                    </span>
                                    {npc.relationshipHistory.length > 1 && (
                                        <span className="journal-npc-arc-more">
                                            +{npc.relationshipHistory.length - 1} earlier
                                        </span>
                                    )}
                                </summary>
                                <ol className="journal-npc-arc-timeline">
                                    {npc.relationshipHistory.map((step, i) => (
                                        <li key={i}>
                                            {step.at && (
                                                <span className="journal-npc-arc-when">
                                                    {new Date(step.at).toLocaleDateString()}
                                                </span>
                                            )}
                                            <span className={`journal-npc-arc-step ${step.from}`}>{step.from}</span>
                                            <span className="journal-npc-arc-sep">→</span>
                                            <span className={`journal-npc-arc-step ${step.to}`}>{step.to}</span>
                                            {step.note && <span className="journal-npc-arc-note" title={step.note}>{step.note}</span>}
                                        </li>
                                    ))}
                                </ol>
                            </details>
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
                            {!archived && onPortrait && npc.appearance && (
                                <button
                                    type="button"
                                    className="journal-npc-portrait-btn"
                                    disabled={portraitBusyId === npc.id}
                                    title="Paint this character from their recorded looks and gender"
                                    onClick={() => onPortrait(npc)}
                                >
                                    {portraitBusyId === npc.id
                                        ? 'Painting…'
                                        : (npc.portraitUrl ? 'Reroll portrait' : 'Portrait')}
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