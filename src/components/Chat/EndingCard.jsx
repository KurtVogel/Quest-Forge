/**
 * The ending card (WOW 2026-09-30, death-and-stakes W1 — the last chapter):
 * "The story of <Name> ends here" in place of the composer once the hero is
 * dead. UI only — never a message. Data comes from `buildEndingCard` (pure);
 * this is the element. Three handles: the one epilogue call (table-talk
 * lane, once), the Chronicle's chapter close, and the roster path to a new
 * campaign with the same hero, alive and rested. A dead sheet accepts no
 * ordinary turn — the composer is gone, not disabled.
 */
import MarkdownText from './MarkdownText.jsx';

export default function EndingCard({
    card,
    onEpilogue,
    epilogueDisabled = false,
    onCloseChapter,
    onBeginAgain,
    beginAgainDisabled = false,
    onStop = null,
    notice = '',
}) {
    if (!card) return null;
    const { epilogue } = card;
    const epilogueTitle = epilogue.asked
        ? (epilogue.answered ? 'The DM has already told the ending.' : 'The ending has been asked for.')
        : 'One out-of-character question to the DM: what became of the people and places the hero leaves behind, kept out of the story\'s memory';
    return (
        <section className="return-card ending-card" aria-label="The story ends here">
            <div className="return-card-heading">
                <div>
                    <span className="return-card-kicker">The last chapter</span>
                    <h3>The story of {card.name} ends here</h3>
                </div>
            </div>

            <div className="ending-card-epitaph">
                <MarkdownText text={card.epitaph} />
            </div>

            {(card.companions.length > 0 || card.openThreads.length > 0) && (
                <div className="return-card-grid">
                    {card.companions.length > 0 && (
                        <div className="return-card-block">
                            <h4>Left behind</h4>
                            <p>{card.companions.join(', ')}</p>
                        </div>
                    )}
                    {card.openThreads.length > 0 && (
                        <div className="return-card-block">
                            <h4>Unfinished</h4>
                            <ul>
                                {card.openThreads.map(name => <li key={name}>{name}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            <div className="return-card-actions ending-card-actions">
                {onStop && (
                    <button type="button" className="btn btn-secondary" onClick={onStop} title="Stop generating">
                        Stop
                    </button>
                )}
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onEpilogue}
                    disabled={epilogueDisabled || epilogue.asked}
                    title={epilogueTitle}
                >
                    What became of them
                </button>
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onCloseChapter}
                    title="Open the Chronicle and close the last chapter of the saga"
                >
                    Close the last chapter
                </button>
                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onBeginAgain}
                    disabled={beginAgainDisabled}
                    title="Save this hero to the roster and begin a new campaign with them, alive and rested — this campaign's death stands"
                >
                    Begin again with this hero
                </button>
            </div>
            {notice && <p className="ending-card-notice">{notice}</p>}
        </section>
    );
}
