import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import LookEditor from '../Journal/LookEditor.jsx';
import { bondKindLabel, listNpcImpressions, namesMatch, resolveCompanionLook, splitBondMoments } from '../../engine/npcRoster.js';
import './Companions.css';

export default function CompanionsPanel() {
    const { state, dispatch, flushAutoSave } = useGame();

    // Fall back to empty array if undefined
    const party = state.party || [];
    // A companion's personal bond with the hero (stance + moments) lives in
    // their roster NPC record — the party record carries only mechanics.
    const npcs = state.npcs || [];
    const [editingLookId, setEditingLookId] = useState(null);
    // A companion's look lives on their linked roster record (one system
    // owns all bonds); ADD_COMPANION/LOAD_GAME guarantee the record exists.
    const handleSaveLook = async (dossier, companion, look) => {
        const action = dossier
            ? { type: 'SET_NPC_LOOK', payload: { id: dossier.id, ...look } }
            : { type: 'UPDATE_NPC', payload: { name: companion.name, kind: 'character', rosterEligible: true, disposition: 'friendly', ...look } };
        dispatch(action);
        await flushAutoSave({ action });
        setEditingLookId(null);
    };

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
                    const look = resolveCompanionLook(companion, npcs);
                    const lookIdentity = [look.species, look.gender].filter(Boolean).join(' ');
                    // Key moments vs lately (2026-09-12) — same shelves as the
                    // Journal card and the DM's party line.
                    const bonds = splitBondMoments(dossier?.bondMoments);
                    const impressions = listNpcImpressions(dossier, 'stanceToPlayer');

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

                            {editingLookId === companion.id ? (
                                <LookEditor
                                    key={companion.id}
                                    npc={{ ...look }}
                                    onSave={(next) => handleSaveLook(dossier, companion, next)}
                                    onCancel={() => setEditingLookId(null)}
                                />
                            ) : (
                                <p className="comp-stance" title="The look scene art and the DM paint from — the Scribe records it as the story establishes it">
                                    <span className="comp-bond-label">
                                        Looks{lookIdentity ? ` (${lookIdentity})` : ''}
                                        <button
                                            type="button"
                                            className="look-edit-btn"
                                            title="Edit the recorded look — this exact text is what portraits, scene art, and the DM paint from"
                                            onClick={() => setEditingLookId(companion.id)}
                                        >
                                            Edit
                                        </button>
                                    </span>
                                    {look.appearance || 'No description recorded yet — the story has not described them.'}
                                </p>
                            )}

                            {dossier?.stanceToPlayer && (
                                <p className="comp-stance">
                                    <span className="comp-bond-label">Toward you</span>
                                    {dossier.stanceToPlayer}
                                </p>
                            )}

                            {bonds.key.length > 0 && (
                                <div className="comp-bond-moments">
                                    <span className="comp-bond-label">Key moments</span>
                                    <ul className="comp-bond-list">
                                        {bonds.key.map((moment, i) => (
                                            <li key={i} title={moment.text}>
                                                {bondKindLabel(moment.kind) && (
                                                    <span className="comp-bond-kind">{bondKindLabel(moment.kind)}</span>
                                                )}
                                                {moment.text}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {(impressions.length > 0 || bonds.recent.length > 0) && (
                                <div className="comp-bond-moments comp-bond-lately">
                                    <span className="comp-bond-label">Lately</span>
                                    <ul className="comp-bond-list">
                                        {impressions.slice(-2).map((text, i) => (
                                            <li
                                                key={`impression-${i}`}
                                                className="comp-impression"
                                                title="A recent impression — it joins the permanent record only if the story bears it out again"
                                            >
                                                {text}
                                            </li>
                                        ))}
                                        {bonds.recent.slice(0, bonds.key.length > 0 ? 2 : 4).map((moment, i) => (
                                            <li key={i} title={moment.text}>{moment.text}</li>
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
