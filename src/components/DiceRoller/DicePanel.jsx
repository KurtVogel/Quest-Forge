import { useGame } from '../../state/GameContext.jsx';
import './DiceRoller.css';

/**
 * Read-only log of the engine's rolls. Manual "throw a d6" buttons were removed
 * on purpose (2026-07-08): every gameplay die is rolled by the engine through
 * the check/combat machinery, so a free-roll surface only invited confusion.
 */
export default function DicePanel() {
    const { state } = useGame();

    return (
        <div className="dice-panel">
            <h3 className="dice-title">Dice Log</h3>

            <div className="dice-log">
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
