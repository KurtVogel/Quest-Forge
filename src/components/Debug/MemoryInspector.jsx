/**
 * Memory Inspector — read-only dev/tuning panel for the invisible memory stack.
 *
 * Shows what the DM actually received last turn (curated story cards with
 * scores, RAG hits with similarity), the full story-memory ledger, hidden
 * front clocks (spoilers — the panel is opt-in), world-state counts, and the
 * Scribe's last extraction/reflection pass. Strictly read-only: it dispatches
 * nothing and exists to make salience/pacing tuning observable.
 *
 * Visibility: Settings → Game → Memory Inspector toggle, or ?debugMemory=1.
 */
import { useSyncExternalStore } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { getInspectorSnapshot, subscribeInspector } from '../../dev/memoryInspectorStore.js';
import { computeRecentHeat, isTempoWindowActive, normalizePaceDial } from '../../engine/worldTempo.js';
import './Debug.css';

function formatAgo(timestamp) {
    if (!timestamp) return 'never';
    const minutes = Math.round((Date.now() - timestamp) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.round(minutes / 60)}h ago`;
}

function ScoreTag({ value }) {
    if (value === null || value === undefined) return null;
    return <span className="mi-score">{value}</span>;
}

function CardRow({ card }) {
    return (
        <li className="mi-row">
            <span className="mi-type">{card.type}</span>
            {card.subject && <span className="mi-subject">{card.subject}</span>}
            <span className="mi-text">{card.text}</span>
            <span className="mi-meta">
                {card.salience != null && `sal ${card.salience}`}
                {card.score != null && ` · score ${card.score}`}
                {card.status && card.status !== 'active' && ` · ${card.status}`}
                {card.lastUsedAt ? ` · used ${formatAgo(card.lastUsedAt)}` : ''}
            </span>
        </li>
    );
}

export default function MemoryInspector({ isOpen, onClose }) {
    const { state } = useGame();
    const captured = useSyncExternalStore(subscribeInspector, getInspectorSnapshot, getInspectorSnapshot);

    if (!isOpen) return null;

    const { lastInjection, lastScribePass, lastReflection } = captured;
    const messageCount = (state.messages || []).length;
    const heat = computeRecentHeat(state);
    const directive = state.worldTempo?.directive || null;
    const windowActive = isTempoWindowActive(directive, messageCount);
    const cards = state.storyMemory || [];
    const cardCounts = cards.reduce((acc, card) => {
        acc[card.type] = (acc[card.type] || 0) + 1;
        return acc;
    }, {});
    const fronts = state.fronts || [];
    const journal = state.journal || [];

    return (
        <div className="journal-overlay" onClick={onClose}>
            <div className="journal-modal mi-modal" onClick={(e) => e.stopPropagation()}>
                <div className="journal-header">
                    <h2 className="journal-modal-title">Memory Inspector</h2>
                    <button className="journal-close" onClick={onClose} title="Close">✕</button>
                </div>
                <div className="mi-body">
                    <p className="mi-hint">
                        Read-only view of the memory machinery. The Hidden Fronts section contains
                        campaign spoilers by design.
                    </p>

                    <details open>
                        <summary>Last turn injection {lastInjection ? `(${formatAgo(lastInjection.at)})` : '(no turn captured yet)'}</summary>
                        {lastInjection ? (
                            <div className="mi-section">
                                <div className="mi-kv">
                                    <span>Player message:</span> {lastInjection.playerMessage || '—'}
                                </div>
                                <div className="mi-kv"><span>Location:</span> {lastInjection.location || '—'}</div>
                                <h4>Curated callback cards ({lastInjection.curated.length})</h4>
                                {lastInjection.curated.length > 0 ? (
                                    <ul className="mi-list">
                                        {lastInjection.curated.map((card, i) => <CardRow key={card.id || i} card={card} />)}
                                    </ul>
                                ) : <p className="mi-empty">None passed curation this turn.</p>}
                                <h4>RAG retrievals ({lastInjection.retrieved.length})</h4>
                                {lastInjection.retrieved.length > 0 ? (
                                    <ul className="mi-list">
                                        {lastInjection.retrieved.map((memory, i) => (
                                            <li key={i} className="mi-row">
                                                <span className="mi-type">{memory.category}</span>
                                                <span className="mi-text">{memory.text}</span>
                                                <span className="mi-meta">
                                                    <ScoreTag value={memory.score} />
                                                    {memory.location && ` · at ${memory.location}`}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : <p className="mi-empty">No retrievals (no machinery key, or nothing relevant).</p>}
                            </div>
                        ) : <p className="mi-empty">Send a message to capture the next injection.</p>}
                    </details>

                    <details>
                        <summary>Story memory ledger ({cards.length} cards)</summary>
                        <div className="mi-section">
                            <div className="mi-kv">
                                <span>By type:</span>{' '}
                                {Object.entries(cardCounts).map(([type, count]) => `${type} ${count}`).join(' · ') || '—'}
                            </div>
                            <ul className="mi-list">
                                {cards.map(card => <CardRow key={card.id} card={card} />)}
                            </ul>
                        </div>
                    </details>

                    <details>
                        <summary>World tempo — pace {normalizePaceDial(state.settings?.paceDial)}, heat {heat.level} ({heat.score}/10)</summary>
                        <div className="mi-section">
                            <div className="mi-kv"><span>Heat reasons:</span> {heat.reasons.join('; ') || 'nothing recent'}</div>
                            {directive ? (
                                <>
                                    <div className="mi-kv">
                                        <span>Directive:</span>{' '}
                                        {directive.frontId
                                            ? `${directive.frontId} may surface at ${directive.maxIntensity}${directive.where ? ` near ${directive.where}` : ''}`
                                            : 'quiet stretch (no front window)'}
                                    </div>
                                    {directive.frontId && (
                                        <div className="mi-kv">
                                            <span>Timing die:</span>{' '}
                                            {windowActive
                                                ? `window OPEN (messages ${directive.activatesAtMessage}–${directive.expiresAtMessage}, now ${messageCount})`
                                                : messageCount < directive.activatesAtMessage
                                                    ? `counting down — opens at message ${directive.activatesAtMessage} (now ${messageCount})`
                                                    : `window expired at message ${directive.expiresAtMessage}`}
                                        </div>
                                    )}
                                    {directive.suggestedSymptom && <div className="mi-kv"><span>Suggested symptom:</span> {directive.suggestedSymptom}</div>}
                                    {directive.rationale && <div className="mi-kv"><span>Rationale:</span> {directive.rationale}</div>}
                                    {directive.quietHook && <div className="mi-kv"><span>Quiet hook:</span> {directive.quietHook}</div>}
                                </>
                            ) : <p className="mi-empty">No tempo directive yet — the first journal cadence creates one.</p>}
                            {(state.recentEncounters || []).length > 0 && (
                                <div className="mi-kv">
                                    <span>Recent fights:</span>{' '}
                                    {state.recentEncounters.map(entry => `${entry.enemies} (${entry.location || '?'}, ${entry.outcome})`).join('; ')}
                                </div>
                            )}
                            {(state.locations || []).length > 0 && (
                                <div className="mi-kv">
                                    <span>Known places:</span>{' '}
                                    {state.locations.map(record => `${record.name}${record.type ? ` [${record.type}${record.danger ? `, ${record.danger}` : ''}]` : ''}${record.theaterFrontIds?.length ? ` ⟵ ${record.theaterFrontIds.join(', ')}` : ''}`).join(' · ')}
                                </div>
                            )}
                        </div>
                    </details>

                    <details>
                        <summary>Hidden fronts ({fronts.length}) — spoilers</summary>
                        <div className="mi-section">
                            {fronts.map(front => (
                                <div key={front.id} className="mi-front">
                                    <div className="mi-front-title">
                                        {front.title}
                                        <span className="mi-meta"> · clock {front.clock}/{front.maxClock} · stage {front.stage} · {front.status}</span>
                                    </div>
                                    {front.faction?.name && <div className="mi-kv"><span>Faction:</span> {front.faction.name} — {front.faction.goal}</div>}
                                    <div className="mi-kv"><span>Goal:</span> {front.goal}</div>
                                    {front.grimPortents?.length > 0 && (
                                        <ol className="mi-portents">
                                            {front.grimPortents.map((portent, i) => (
                                                <li key={i} className={i < front.stage ? 'mi-portent-done' : ''}>{portent}</li>
                                            ))}
                                        </ol>
                                    )}
                                    {front.publicHints?.length > 0 && (
                                        <div className="mi-kv"><span>Recent symptoms:</span> {front.publicHints.slice(-3).join(' | ')}</div>
                                    )}
                                    {front.notes && <div className="mi-kv"><span>Notes:</span> {front.notes}</div>}
                                    {front.lastAdvanceId && (
                                        <div className="mi-kv"><span>Last advance:</span> {front.lastAdvanceId} ({front.lastAdvanceDelta >= 0 ? '+' : ''}{front.lastAdvanceDelta})</div>
                                    )}
                                </div>
                            ))}
                            {fronts.length === 0 && <p className="mi-empty">No fronts in this campaign.</p>}
                        </div>
                    </details>

                    <details>
                        <summary>World state</summary>
                        <div className="mi-section">
                            <div className="mi-kv"><span>World facts:</span> {(state.worldFacts || []).length}</div>
                            <div className="mi-kv"><span>NPCs rostered:</span> {(state.npcs || []).length}</div>
                            <div className="mi-kv"><span>Journal entries:</span> {journal.length}</div>
                            <div className="mi-kv"><span>Premise length:</span> {(state.session?.premise || '').length} chars</div>
                            {journal.length > 0 && (
                                <div className="mi-kv">
                                    <span>Journal trail:</span>{' '}
                                    {journal.slice(-5).map(entry => entry.location || '?').join(' → ')}
                                </div>
                            )}
                        </div>
                    </details>

                    <details>
                        <summary>Scribe — last passes</summary>
                        <div className="mi-section">
                            <h4>Extraction {lastScribePass ? `(${formatAgo(lastScribePass.at)})` : '(none captured yet)'}</h4>
                            {lastScribePass && (
                                <>
                                    <div className="mi-kv"><span>Facts added:</span> {lastScribePass.facts.length ? lastScribePass.facts.join(' | ') : 'none'}</div>
                                    <div className="mi-kv"><span>Cards added:</span> {lastScribePass.cards.length ? lastScribePass.cards.map(c => `[${c.type}] ${c.subject || c.text}`).join(' | ') : 'none'}</div>
                                    <div className="mi-kv"><span>NPCs updated:</span> {lastScribePass.npcsUpdated.join(', ') || 'none'}</div>
                                    <div className="mi-kv">
                                        <span>Also:</span>
                                        {[
                                            lastScribePass.playerAppearance && 'player appearance',
                                            lastScribePass.location && `location → ${lastScribePass.location}`,
                                            lastScribePass.lootAudited && 'loot recovered',
                                            lastScribePass.paymentAudited && 'payment deducted',
                                        ].filter(Boolean).join(' · ') || ' nothing else'}
                                    </div>
                                </>
                            )}
                            <h4>Reflection {lastReflection ? `(${formatAgo(lastReflection.at)})` : '(none captured yet)'}</h4>
                            {lastReflection && (
                                <>
                                    <div className="mi-kv"><span>Cadence:</span> {lastReflection.cadenceId || '—'}</div>
                                    <div className="mi-kv">
                                        <span>Front advances:</span>{' '}
                                        {lastReflection.frontAdvances.length
                                            ? lastReflection.frontAdvances.map(a => `${a.id} ${a.delta >= 0 ? '+' : ''}${a.delta}${a.reason ? ` (${a.reason})` : ''}`).join(' | ')
                                            : 'none'}
                                    </div>
                                    <div className="mi-kv"><span>NPCs updated:</span> {lastReflection.npcsUpdated.join(', ') || 'none'}</div>
                                    <div className="mi-kv"><span>Cards added:</span> {lastReflection.cards.length ? lastReflection.cards.map(c => `[${c.type}] ${c.subject || c.text}`).join(' | ') : 'none'}</div>
                                    {lastReflection.tempoDirective && (
                                        <div className="mi-kv">
                                            <span>Tempo proposed:</span>{' '}
                                            {lastReflection.tempoDirective.frontId
                                                ? `${lastReflection.tempoDirective.frontId} at ${lastReflection.tempoDirective.maxIntensity || '?'}${lastReflection.tempoDirective.where ? ` near ${lastReflection.tempoDirective.where}` : ''}`
                                                : 'quiet stretch'}
                                            {lastReflection.tempoDirective.rationale ? ` — ${lastReflection.tempoDirective.rationale}` : ''}
                                        </div>
                                    )}
                                    {lastReflection.frontProposal && (
                                        <div className="mi-kv"><span>Front proposed:</span> {lastReflection.frontProposal}</div>
                                    )}
                                </>
                            )}
                        </div>
                    </details>
                </div>
            </div>
        </div>
    );
}
