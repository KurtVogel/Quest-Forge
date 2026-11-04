import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { QUEST_NAME_MAX_LENGTH } from '../../state/handlers/quests.js';
import './Quests.css';

export default function QuestPanel() {
    const { state, dispatch } = useGame();
    const [showCompleted, setShowCompleted] = useState(false);
    const [showAddQuest, setShowAddQuest] = useState(false);
    const [newQuestName, setNewQuestName] = useState('');

    const activeQuests = state.quests.filter(q => q.status === 'active');
    const completedQuests = state.quests.filter(q => q.status === 'completed' || q.status === 'failed');

    const handleAddQuest = () => {
        if (!newQuestName.trim()) return;
        dispatch({
            type: 'ADD_QUEST',
            payload: { name: newQuestName.trim().slice(0, QUEST_NAME_MAX_LENGTH), description: '', source: 'player' },
        });
        setNewQuestName('');
        setShowAddQuest(false);
    };

    const handleComplete = (questId) => {
        // Bare id on purpose: the handler pays engine XP only for the DM's
        // object refs — a panel completion is bookkeeping (2026-09-04 audit).
        dispatch({ type: 'COMPLETE_QUEST', payload: questId });
    };

    const handleRemove = (questId) => {
        dispatch({ type: 'REMOVE_QUEST', payload: questId });
    };

    // The staged log behind a ▸ (WOW 2026-11-04): the agreement, then every
    // stage the DM wrote since — the card shows the newest by default.
    const [openStages, setOpenStages] = useState(() => new Set());
    const toggleStages = (questId) => setOpenStages(prev => {
        const next = new Set(prev);
        if (next.has(questId)) next.delete(questId);
        else next.add(questId);
        return next;
    });
    const describeTerms = (quest) => [
        quest.patron && `for ${quest.patron}`,
        quest.promised && `promised: ${quest.promised}`,
    ].filter(Boolean).join(' · ');
    const stageHistory = (quest) => {
        const stages = Array.isArray(quest.stages) ? quest.stages : [];
        if (stages.length === 0) return [];
        return [
            ...(quest.agreement ? [{ text: quest.agreement, label: 'Agreed' }] : []),
            ...stages.slice(0, -1).map(stage => ({ text: stage.text, label: 'Then' })),
        ];
    };

    return (
        <div className="quest-panel">
            <div className="quest-header">
                <h3 className="quest-title">Quests</h3>
                <button
                    className="quest-add-btn"
                    onClick={() => setShowAddQuest(!showAddQuest)}
                    title="Add quest note"
                >
                    +
                </button>
            </div>

            {showAddQuest && (
                <div className="quest-add-form">
                    <input
                        type="text"
                        className="quest-add-input"
                        value={newQuestName}
                        onChange={(e) => setNewQuestName(e.target.value)}
                        placeholder="Quest objective..."
                        maxLength={QUEST_NAME_MAX_LENGTH}
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleAddQuest()}
                    />
                    <button className="btn btn-primary btn-sm" onClick={handleAddQuest}>Add</button>
                </div>
            )}

            <div className="quest-list">
                {activeQuests.length === 0 && !showAddQuest && (
                    <div className="quest-empty">No active quests yet</div>
                )}

                {activeQuests.map(quest => (
                    <div key={quest.id} className="quest-item active">
                        <div className="quest-item-status">◆</div>
                        <div className="quest-item-info">
                            <span className="quest-item-name">{quest.name}</span>
                            {describeTerms(quest) && (
                                <span className="quest-item-terms" title="Who asked, and what was agreed — the record keeps this however the job changes">{describeTerms(quest)}</span>
                            )}
                            {quest.description && (
                                <span className="quest-item-desc">{quest.description}</span>
                            )}
                            {stageHistory(quest).length > 0 && (
                                <button
                                    type="button"
                                    className="quest-stages-toggle"
                                    onClick={() => toggleStages(quest.id)}
                                    title="How this job got here — the agreement and every stage since"
                                >
                                    {openStages.has(quest.id) ? '▾' : '▸'} {stageHistory(quest).length} earlier stage{stageHistory(quest).length === 1 ? '' : 's'}
                                </button>
                            )}
                            {openStages.has(quest.id) && (
                                <ul className="quest-stages">
                                    {stageHistory(quest).map((stage, i) => (
                                        <li key={i}><span className="quest-stage-label">{stage.label}</span>{stage.text}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <div className="quest-item-actions">
                            <button
                                className="quest-action-btn complete"
                                onClick={() => handleComplete(quest.id)}
                                title="Mark complete"
                            >
                                ✓
                            </button>
                            <button
                                className="quest-action-btn remove"
                                onClick={() => handleRemove(quest.id)}
                                title="Remove"
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {completedQuests.length > 0 && (
                <div className="quest-completed-section">
                    <button
                        className="quest-completed-toggle"
                        onClick={() => setShowCompleted(!showCompleted)}
                    >
                        {showCompleted ? '▾' : '▸'} Finished ({completedQuests.length})
                    </button>

                    {showCompleted && (
                        <div className="quest-list completed">
                            {completedQuests.map(quest => (
                                <div key={quest.id} className="quest-item completed">
                                    <div className="quest-item-status done" title={quest.status === 'failed' ? 'Failed' : 'Completed'}>
                                        {quest.status === 'failed' ? '✕' : '✦'}
                                    </div>
                                    <div className="quest-item-info">
                                        <span className="quest-item-name">{quest.name}</span>
                                        {(quest.outcome || describeTerms(quest)) && (
                                            <span className="quest-item-outcome" title={quest.status === 'failed' ? 'How it was lost' : 'How it ended'}>
                                                {quest.outcome || describeTerms(quest)}
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        className="quest-action-btn remove"
                                        onClick={() => handleRemove(quest.id)}
                                        title="Remove"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
