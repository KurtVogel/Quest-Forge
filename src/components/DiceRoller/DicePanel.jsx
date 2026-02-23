import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { rollWithModifier, DIE_TYPES } from '../../engine/dice.js';
import './DiceRoller.css';

export default function DicePanel() {
    const { state, dispatch } = useGame();
    const [modifier, setModifier] = useState(0);
    const [lastRoll, setLastRoll] = useState(null);

    const handleRoll = (sides) => {
        const result = rollWithModifier(1, sides, modifier, `Manual d${sides} roll`);
        dispatch({ type: 'ADD_ROLL', payload: result });
        setLastRoll(result);

        // Auto-clear animation after a moment
        setTimeout(() => setLastRoll(null), 2000);
    };

    return (
        <div className="dice-panel">
            <h3 className="dice-title">🎲 Dice Roller</h3>

            <div className="dice-buttons">
                {DIE_TYPES.map(sides => (
                    <button
                        key={sides}
                        className={`dice-btn d${sides}`}
                        onClick={() => handleRoll(sides)}
                    >
                        d{sides}
                    </button>
                ))}
            </div>

            <div className="dice-modifier">
                <label className="modifier-label">Modifier</label>
                <div className="modifier-controls">
                    <button className="mod-btn" onClick={() => setModifier(m => m - 1)}>−</button>
                    <span className="mod-value">{modifier >= 0 ? `+${modifier}` : modifier}</span>
                    <button className="mod-btn" onClick={() => setModifier(m => m + 1)}>+</button>
                    {modifier !== 0 && (
                        <button className="mod-reset" onClick={() => setModifier(0)}>Reset</button>
                    )}
                </div>
            </div>

            {lastRoll && (
                <div className={`dice-result-display ${lastRoll.isCritical ? 'crit' : ''} ${lastRoll.isCritFail ? 'critfail' : ''}`}>
                    <div className="result-total">{lastRoll.total}</div>
                    <div className="result-detail">
                        {lastRoll.notation} = {lastRoll.rolls.join(' + ')}
                        {lastRoll.modifier !== 0 && ` ${lastRoll.modifier >= 0 ? '+' : ''}${lastRoll.modifier}`}
                    </div>
                    {lastRoll.isCritical && <div className="result-crit">★ Natural 20!</div>}
                    {lastRoll.isCritFail && <div className="result-crit fail">✗ Natural 1!</div>}
                </div>
            )}

            <div className="dice-log">
                <h4 className="dice-log-title">Roll History</h4>
                <div className="dice-log-entries">
                    {state.rollHistory.length === 0 ? (
                        <div className="dice-log-empty">No rolls yet</div>
                    ) : (
                        [...state.rollHistory].reverse().slice(0, 20).map((roll) => (
                            <div
                                key={roll.id}
                                className={`dice-log-entry ${roll.isCritical ? 'crit' : ''} ${roll.isCritFail ? 'critfail' : ''}`}
                            >
                                <div className="log-entry-top">
                                    <span className="log-notation">{roll.notation}</span>
                                    <span className="log-total">{roll.total}</span>
                                </div>
                                {roll.description && (
                                    <div className="log-desc">{roll.description}</div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
