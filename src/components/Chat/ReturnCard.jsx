/**
 * The return card (WOW 2026-09-15, session-return): "Previously, in
 * <campaign>" above the composer after time away. UI only — never a message.
 * Data comes from `buildReturnCard` (pure); this is the element.
 */
export default function ReturnCard({ card, onDismiss, onAskRecap, recapDisabled = false }) {
    if (!card) return null;
    const { where } = card;
    const hpChip = where.hp != null && where.maxHp != null ? `HP ${where.hp}/${where.maxHp}` : null;
    const acChip = where.ac != null ? `AC ${where.ac}` : null;
    return (
        <section className="return-card" aria-label="Previously in this campaign">
            <div className="return-card-heading">
                <div>
                    <span className="return-card-kicker">You were away {card.timeAway}</span>
                    <h3>Previously{card.campaignName ? `, in ${card.campaignName}` : ''}</h3>
                </div>
                <button type="button" className="btn btn-primary return-card-dismiss" onClick={onDismiss}>Continue</button>
            </div>

            <div className="return-card-grid">
                {card.lastTime.length > 0 && (
                    <div className="return-card-block">
                        <h4>Last time</h4>
                        <ul>
                            {card.lastTime.map((entry, index) => (
                                <li key={index}>
                                    {entry.summary}
                                    {entry.keyDecisions.length > 0 && (
                                        <span className="return-card-decisions"> You decided: {entry.keyDecisions.join('; ')}.</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {(card.openThreads.length > 0 || card.pendingCheck) && (
                    <div className="return-card-block">
                        <h4>Open threads</h4>
                        <ul>
                            {card.pendingCheck && (
                                <li className="return-card-pending">
                                    A check is waiting on the table: {card.pendingCheck.description}
                                    {card.pendingCheck.dc != null ? ` (DC ${card.pendingCheck.dc})` : ''}
                                </li>
                            )}
                            {card.openThreads.map(quest => (
                                <li key={quest.name}>
                                    <strong>{quest.name}</strong>{quest.description ? ` — ${quest.description}` : ''}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="return-card-block">
                    <h4>Where you are</h4>
                    <p>
                        {where.location || 'Somewhere unrecorded'}
                        {where.party.length > 0 && <span> · with {where.party.join(', ')}</span>}
                    </p>
                    {(hpChip || acChip) && (
                        <p className="return-card-chips">
                            {hpChip && <span className="return-card-chip">{hpChip}</span>}
                            {acChip && <span className="return-card-chip">{acChip}</span>}
                        </p>
                    )}
                </div>

                {card.dmAsked && (
                    <div className="return-card-block">
                        <h4>The DM asked</h4>
                        <p className="return-card-question">“{card.dmAsked}”</p>
                    </div>
                )}
            </div>

            {onAskRecap && (
                <div className="return-card-actions">
                    <button type="button" className="btn btn-secondary" onClick={onAskRecap} disabled={recapDisabled} title="One out-of-character question to the DM: a recap in their voice, kept out of the story's memory">
                        Ask the DM for a recap
                    </button>
                </div>
            )}
        </section>
    );
}
