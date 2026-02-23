import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import './Quests.css';

export default function QuestPanel() {
    const { state, dispatch } = useGame();
    const [showCompleted, setShowCompleted] = useState(false);
    const [showAddQuest, setShowAddQuest] = useState(false);
    const [newQuestName, setNewQuestName] = useState('');

    const activeQuests = state.quests.filter(q => q.status === 'active');
    const completedQuests = state.quests.filter(q => q.status === 'completed');

    const handleAddQuest = () => {
        if (!newQuestName.trim()) return;
        dispatch({
            type: 'ADD_QUEST',
            payload: { name: newQuestName.trim(), description: '', source: 'player' },
        });
        setNewQuestName('');
        setShowAddQuest(false);
    };

    const handleComplete = (questId) => {
        dispatch({ type: 'COMPLETE_QUEST', payload: questId });
    };

    const handleRemove = (questId) => {
        dispatch({ type: 'REMOVE_QUEST', payload: questId });
    };

    return (
        <div className="quest-panel">
            <div className="quest-header">
                <h3 className="quest-title">📜 Quests</h3>
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
                            {quest.description && (
                                <span className="quest-item-desc">{quest.description}</span>
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
                        {showCompleted ? '▾' : '▸'} Completed ({completedQuests.length})
                    </button>

                    {showCompleted && (
                        <div className="quest-list completed">
                            {completedQuests.map(quest => (
                                <div key={quest.id} className="quest-item completed">
                                    <div className="quest-item-status done">✦</div>
                                    <div className="quest-item-info">
                                        <span className="quest-item-name">{quest.name}</span>
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
