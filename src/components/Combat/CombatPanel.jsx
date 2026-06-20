import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { getCombatStatus } from '../../engine/combatStatus.js';
import { COMBAT_PHASES, isEnemyActive } from '../../engine/combatExchange.js';
import './Combat.css';

export default function CombatPanel() {
    const { state, dispatch } = useGame();
    const [isCollapsed, setIsCollapsed] = useState(() =>
        typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
    );
    const combat = state.combat;

    if (!combat?.active) return null;

    const currentFighter = combat.turnOrder[combat.currentTurn];
    const isPlayerTurn = currentFighter?.type === 'player';
    const isCompanionTurn = currentFighter?.type === 'companion';
    const aliveEnemies = combat.enemies.filter(isEnemyActive);
    const combatStatus = getCombatStatus({
        character: state.character,
        combat,
        party: state.party || [],
    });
    const enemySummary = aliveEnemies.length > 0
        ? aliveEnemies.map(enemy => `${enemy.name} ${enemy.hp}/${enemy.maxHp} HP`).join(' · ')
        : 'No foes standing';

    return (
        <div className="combat-overlay">
            <div className="combat-panel">
                <div className="combat-header">
                    <h3 className="combat-title">Combat — Round {combat.round}</h3>
                    <div className="combat-header-actions">
                        {aliveEnemies.length === 0 && combat.phase !== COMBAT_PHASES.AWAITING_NARRATION && (
                            <button
                                className="combat-end-btn"
                                onClick={() => dispatch({ type: 'END_COMBAT' })}
                            >
                                Victory! End Combat
                            </button>
                        )}
                        <button
                            type="button"
                            className="combat-collapse-btn"
                            aria-expanded={!isCollapsed}
                            aria-controls="combat-details"
                            onClick={() => setIsCollapsed(collapsed => !collapsed)}
                        >
                            {isCollapsed ? 'Show details' : 'Hide details'}
                            <span aria-hidden="true">{isCollapsed ? '⌄' : '⌃'}</span>
                        </button>
                    </div>
                </div>

                {isCollapsed ? (
                    <div className={`combat-collapsed-summary ${combatStatus.variant}`}>
                        <span>{combatStatus.title}</span>
                        <span>{enemySummary}</span>
                    </div>
                ) : (
                    <div id="combat-details">
                        {/* Initiative Tracker */}
                        <div className="combat-initiative">
                            {combat.turnOrder.map((fighter, idx) => {
                                const isCurrent = idx === combat.currentTurn;
                                const isDead = fighter.type === 'enemy'
                                    ? combat.enemies.find(e => e.id === fighter.id)?.condition === 'dead'
                                    : fighter.type === 'companion' && (state.party || []).find(c => c.id === fighter.id)?.status === 'downed';
                                const icon = fighter.type === 'player'
                                    ? 'PC'
                                    : fighter.type === 'companion'
                                        ? 'Ally'
                                        : 'Foe';

                                return (
                                    <div
                                        key={fighter.id || fighter.name}
                                        className={`initiative-slot ${isCurrent ? 'current' : ''} ${isDead ? 'dead' : ''} ${fighter.type}`}
                                    >
                                        <span className="initiative-icon">{icon}</span>
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
                            {combat.phase === COMBAT_PHASES.OPENING
                                ? 'Opening Initiative — faster actors resolve once before your first turn.'
                                : combat.phase === COMBAT_PHASES.AWAITING_INTENT
                                    ? 'Action committed — awaiting validated intent.'
                                : combat.phase === COMBAT_PHASES.AWAITING_NARRATION
                                    ? 'Exchange resolved — awaiting its narration.'
                                    : isPlayerTurn
                                ? 'Your turn — describe your action in chat.'
                                : isCompanionTurn
                                    ? `${currentFighter?.name} is ready — direct them in chat or let the DM choose their move.`
                                    : `${currentFighter?.name}'s turn...`
                            }
                        </div>

                        <div className={`combat-status ${combatStatus.variant}`}>
                            <span className="combat-status-title">{combatStatus.title}</span>
                            <span className="combat-status-detail">{combatStatus.detail}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function EnemyCard({ enemy }) {
    const hpPercent = Math.max(0, (enemy.hp / enemy.maxHp) * 100);
    const displayStatus = enemy.combatStatus && enemy.combatStatus !== 'active'
        ? enemy.combatStatus
        : enemy.condition;

    const conditionColors = {
        healthy: '#4caf50',
        bloodied: '#e6a23c',
        critical: '#f44336',
        dead: '#666',
    };

    return (
        <div className={`enemy-card ${displayStatus}`}>
            <div className="enemy-info">
                <span className="enemy-name">{enemy.name}</span>
                <span className={`enemy-condition ${displayStatus}`}>
                    {displayStatus}
                </span>
            </div>
            <div className="enemy-hp-bar-container">
                <div
                    className="enemy-hp-bar"
                    style={{
                        width: `${hpPercent}%`,
                        backgroundColor: conditionColors[enemy.condition] || '#777',
                    }}
                />
            </div>
            <div className="enemy-stats">
                <span className="enemy-hp-text">
                    {enemy.condition === 'dead' ? 'Dead' : displayStatus === 'fled' ? 'Fled' : displayStatus === 'surrendered' ? 'Surrendered' : `${enemy.hp}/${enemy.maxHp} HP`}
                </span>
                <span className="enemy-ac">AC {enemy.ac}</span>
            </div>
            {enemy.conditions?.length > 0 && (
                <div className="enemy-mechanical-conditions">
                    {enemy.conditions.map(condition => (
                        <span key={condition}>{condition}</span>
                    ))}
                </div>
            )}
        </div>
    );
}
