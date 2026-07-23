import { useGame } from '../../state/GameContext.jsx';
import { namesMatch } from '../../engine/npcRoster.js';
import './Companions.css';

export default function CompanionsPanel() {
    const { state } = useGame();

    // Fall back to empty array if undefined
    const party = state.party || [];
    // A companion's personal bond with the hero (stance + moments) lives in
    // their roster NPC record — the party record carries only mechanics.
    const npcs = state.npcs || [];

    if (party.length === 0) {
        return (
            <div className="companions-panel">
                <div className="companions-header">
                    <h3>Companions</h3>
                    <span className="companion-count">0 / 4</span>
                </div>
                <div className="empty-party">You travel alone.</div>
            </div>
        );
    }

    return (
        <div className="companions-panel">
            <div className="companions-header">
                <h3>Companions</h3>
                <span className="companion-count">{party.length} / 4</span>
            </div>

            <div className="companions-list">
                {party.map(companion => {
                    const hpPercent = Math.max(0, Math.min(100, (companion.hp / companion.maxHp) * 100));
                    const affinityPercent = Math.max(0, Math.min(100, companion.affinity || 50));
                    const status = companion.status || (companion.hp <= 0 ? 'downed' : 'healthy');
                    const dossier = npcs.find(npc => namesMatch(npc.name, companion.name));
                    const bondMoments = (dossier?.bondMoments || [])
                        .map(moment => moment?.text)
                        .filter(Boolean);

                    let affinityClass = '';
                    if (affinityPercent >= 75) affinityClass = 'affinity-high';
                    if (affinityPercent <= 25) affinityClass = 'affinity-low';

                    return (
                        <div key={companion.id} className="companion-card">
                            <div className="companion-top">
                                <span className="companion-name">{companion.name}</span>
                                <span className={`companion-status ${status}`}>{status}</span>
                            </div>

                            <div className="companion-stats">
                                <span title="Level">Lvl {companion.level}</span>
                                <span title="Armor Class">AC {companion.ac}</span>
                                <span className="companion-weapon" title="Attack">{companion.weapon || 'Unarmed'} {(companion.attackBonus ?? 0) + (companion.weaponBonus || 0) >= 0 ? '+' : ''}{(companion.attackBonus ?? 0) + (companion.weaponBonus || 0)} · {companion.damage || '1d4+1'}{companion.weaponBonus ? `+${companion.weaponBonus}` : ''}</span>
                            </div>

                            <div className="comp-hp-wrap" title={`Health: ${companion.hp} / ${companion.maxHp}`}>
                                <span className="comp-hp-text">HP {companion.hp}</span>
                                <div className="comp-hp-track">
                                    <div className="comp-hp-fill" style={{ width: `${hpPercent}%` }}></div>
                                </div>
                            </div>

                            <div className="comp-affinity-wrap" title={`Affinity: ${affinityPercent}%`}>
                                <span className="comp-affinity-icon">Bond</span>
                                <div className="comp-affinity-track">
                                    <div className={`comp-affinity-fill ${affinityClass}`} style={{ width: `${affinityPercent}%` }}></div>
                                </div>
                            </div>

                            {(companion.keepsakes || []).length > 0 && (
                                <div className="comp-keepsakes" title="Keepsakes from your journey together">
                                    {companion.keepsakes.join(' · ')}
                                </div>
                            )}

                            {dossier?.stanceToPlayer && (
                                <p className="comp-stance">
                                    <span className="comp-bond-label">Toward you</span>
                                    {dossier.stanceToPlayer}
                                </p>
                            )}

                            {bondMoments.length > 0 && (
                                <div className="comp-bond-moments">
                                    <span className="comp-bond-label">Moments between you</span>
                                    <ul className="comp-bond-list">
                                        {[...bondMoments].reverse().slice(0, 4).map((moment, i) => (
                                            <li key={i} title={moment}>{moment}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
