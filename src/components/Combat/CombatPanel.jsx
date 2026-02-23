import { useGame } from '../../state/GameContext.jsx';
import './Combat.css';

export default function CombatPanel() {
    const { state, dispatch } = useGame();
    const combat = state.combat;

    if (!combat?.active) return null;

    const currentFighter = combat.turnOrder[combat.currentTurn];
    const isPlayerTurn = currentFighter?.type === 'player';
    const aliveEnemies = combat.enemies.filter(e => e.condition !== 'dead');

    return (
        <div className="combat-overlay">
            <div className="combat-panel">
                <div className="combat-header">
                    <h3 className="combat-title">⚔️ Combat — Round {combat.round}</h3>
                    {aliveEnemies.length === 0 && (
                        <button
                            className="combat-end-btn"
                            onClick={() => dispatch({ type: 'END_COMBAT' })}
                        >
                            Victory! End Combat
                        </button>
                    )}
                </div>

                {/* Initiative Tracker */}
                <div className="combat-initiative">
                    {combat.turnOrder.map((fighter, idx) => {
                        const isCurrent = idx === combat.currentTurn;
                        const isDead = fighter.type === 'enemy' &&
                            combat.enemies.find(e => e.id === fighter.id)?.condition === 'dead';

                        return (
                            <div
                                key={fighter.id || fighter.name}
                                className={`initiative-slot ${isCurrent ? 'current' : ''} ${isDead ? 'dead' : ''} ${fighter.type}`}
                            >
                                <span className="initiative-icon">{fighter.type === 'player' ? '🛡️' : '💀'}</span>
                                <span className="initiative-name">{fighter.name}</span>
                                <span className="initiative-roll">{fighter.initiative}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Enemy Cards */}
                <div className="combat-enemies">
                    {combat.enemies.map(enemy => (
                        <EnemyCard key={enemy.id} enemy={enemy} />
                    ))}
                </div>

                {/* Current Turn Indicator */}
                <div className={`combat-turn ${isPlayerTurn ? 'player-turn' : 'enemy-turn'}`}>
                    {isPlayerTurn
                        ? '⚔️ Your turn — describe your action in chat!'
                        : `🎲 ${currentFighter?.name}'s turn...`
                    }
                </div>
            </div>
        </div>
    );
}

function EnemyCard({ enemy }) {
    const hpPercent = Math.max(0, (enemy.hp / enemy.maxHp) * 100);

    const conditionColors = {
        healthy: '#4caf50',
        bloodied: '#e6a23c',
        critical: '#f44336',
        dead: '#666',
    };

    return (
        <div className={`enemy-card ${enemy.condition}`}>
            <div className="enemy-info">
                <span className="enemy-name">{enemy.name}</span>
                <span className={`enemy-condition ${enemy.condition}`}>
                    {enemy.condition}
                </span>
            </div>
            <div className="enemy-hp-bar-container">
                <div
                    className="enemy-hp-bar"
                    style={{
                        width: `${hpPercent}%`,
                        backgroundColor: conditionColors[enemy.condition],
                    }}
                />
            </div>
            <div className="enemy-stats">
                <span className="enemy-hp-text">
                    {enemy.condition === 'dead' ? '☠️ Dead' : `${enemy.hp}/${enemy.maxHp} HP`}
                </span>
                <span className="enemy-ac">AC {enemy.ac}</span>
            </div>
        </div>
    );
}
