import { useGame } from '../../state/GameContext.jsx';
import './Companions.css';

export default function CompanionsPanel() {
    const { state, dispatch } = useGame();

    // Fall back to empty array if undefined
    const party = state.party || [];

    if (party.length === 0) {
        return (
            <div className="companions-panel">
                <div className="companions-header">
                    <h3>🤝 Companions</h3>
                    <span className="companion-count">0 / 4</span>
                </div>
                <div className="empty-party">You travel alone.</div>
            </div>
        );
    }

    return (
        <div className="companions-panel">
            <div className="companions-header">
                <h3>🤝 Companions</h3>
                <span className="companion-count">{party.length} / 4</span>
            </div>

            <div className="companions-list">
                {party.map(companion => {
                    const hpPercent = Math.max(0, Math.min(100, (companion.hp / companion.maxHp) * 100));
                    const affinityPercent = Math.max(0, Math.min(100, companion.affinity || 50));

                    let affinityClass = '';
                    if (affinityPercent >= 75) affinityClass = 'affinity-high';
                    if (affinityPercent <= 25) affinityClass = 'affinity-low';

                    return (
                        <div key={companion.id} className="companion-card">
                            <div className="companion-top">
                                <span className="companion-name">{companion.name}</span>
                                <span className="companion-level">Lvl {companion.level}</span>
                            </div>

                            <div className="companion-stats">
                                <span title="Armor Class">🛡️ AC {companion.ac}</span>
                                <span className="companion-weapon" title="Equipped Weapon">🗡️ {companion.weapon || 'Unarmed'}</span>
                            </div>

                            <div className="comp-hp-wrap" title={`Health: ${companion.hp} / ${companion.maxHp}`}>
                                <span className="comp-hp-text">HP {companion.hp}</span>
                                <div className="comp-hp-track">
                                    <div className="comp-hp-fill" style={{ width: `${hpPercent}%` }}></div>
                                </div>
                            </div>

                            <div className="comp-affinity-wrap" title={`Affinity: ${affinityPercent}%`}>
                                <span className="comp-affinity-icon">{affinityPercent >= 75 ? '❤️' : affinityPercent <= 25 ? '💔' : '🤝'}</span>
                                <div className="comp-affinity-track">
                                    <div className="comp-affinity-fill ${affinityClass}" style={{ width: `${affinityPercent}%` }}></div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
