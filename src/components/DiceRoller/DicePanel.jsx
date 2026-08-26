import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import './DiceRoller.css';

/**
 * Read-only log of the engine's rolls. Manual "throw a d6" buttons were removed
 * on purpose (2026-07-08): every gameplay die is rolled by the engine through
 * the check/combat machinery, so a free-roll surface only invited confusion.
 *
 * Collapsed by default (2026-08-26): the log is an occasional reference, not a
 * per-turn readout — always-open it made the right column very tall. The header
 * still shows the latest roll at a glance while collapsed.
 */
export default function DicePanel() {
    const { state } = useGame();
    const [isOpen, setIsOpen] = useState(false);
    const latest = state.rollHistory[state.rollHistory.length - 1];

    return (
        <div className="dice-panel">
            <button
                className="dice-toggle"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                <span className="dice-title">Dice Log</span>
                {!isOpen && latest && (
                    <span
                        className={`dice-latest ${latest.isCritical ? 'crit' : ''} ${latest.isCritFail ? 'critfail' : ''}`}
                        title={latest.description || undefined}
                    >
                        {latest.notation} → {latest.total}
                    </span>
                )}
                <span className="dice-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            </button>

            {isOpen && (
                <div className="dice-log">
                    <div className="dice-log-entries">
                        {state.rollHistory.length === 0 ? (
                            <div className="dice-log-empty">No rolls yet</div>
                        ) : (
                            state.rollHistory.slice(-20).reverse().map((roll) => (
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
            )}
        </div>
    );
}
