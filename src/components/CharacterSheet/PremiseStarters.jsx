import { useEffect, useRef, useState } from 'react';
import { PREMISE_STARTERS, buildPremiseFromStarter } from '../../data/premiseStarters.js';
import { draftPremisesFromHero } from '../../llm/premiseDrafter.js';
import { isMachineryReady } from '../../llm/machinery.js';

/**
 * Tap-cards above the "Set the stage" textarea (wow audit 2026-09-09, W0):
 * curated starters with the hero's name woven in, plus "Draft from my hero" —
 * one machinery call returning three premises built from the confirmed sheet.
 * A tap FILLS the editable textarea; nothing here bypasses the player's own
 * authorship. `onPick(text, starterId)` — starterId is null for drafts and for
 * anything the player later edits (the wizard re-checks on Begin Adventure).
 */
export default function PremiseStarters({ hero, heroName, settings, premise, onPick }) {
    const [drafts, setDrafts] = useState([]);
    const [isDrafting, setIsDrafting] = useState(false);
    const [draftError, setDraftError] = useState('');
    const abortRef = useRef(null);
    useEffect(() => () => abortRef.current?.abort(), []);

    const machineryReady = isMachineryReady(settings);
    const current = (premise || '').trim();
    const cards = [
        ...PREMISE_STARTERS.map(starter => ({
            key: starter.id,
            starterId: starter.id,
            title: starter.title,
            blurb: starter.blurb,
            text: buildPremiseFromStarter(starter, heroName),
        })),
        ...drafts.map((draft, index) => ({
            key: `draft-${index}`,
            starterId: null,
            title: draft.title,
            blurb: draft.premise.length > 140 ? `${draft.premise.slice(0, 140).trimEnd()}…` : draft.premise,
            text: draft.premise,
            drafted: true,
        })),
    ];

    const handleDraft = async () => {
        if (isDrafting || !hero?.name) return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setIsDrafting(true);
        setDraftError('');
        try {
            const next = await draftPremisesFromHero({
                character: hero,
                presetKey: settings?.preset,
                settings,
                signal: controller.signal,
            });
            if (!controller.signal.aborted) setDrafts(next);
        } catch (e) {
            if (e?.name === 'AbortError' || controller.signal.aborted) return;
            setDraftError(e?.message || 'Drafting failed.');
        } finally {
            if (abortRef.current === controller) setIsDrafting(false);
        }
    };

    return (
        <div className="premise-starters">
            <div className="premise-starters-header">
                <span className="premise-starters-label">Start from a tale you didn't have to write — tap one, then make it yours.</span>
                <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={handleDraft}
                    disabled={isDrafting || !machineryReady || !hero?.name}
                    title={machineryReady
                        ? 'Three premises drafted from your hero\'s sheet, background, and the tone preset'
                        : 'Add a Gemini key in Settings → AI Provider to draft premises'}
                >
                    {isDrafting ? 'Drafting…' : (drafts.length > 0 ? 'Draft again' : 'Draft from my hero')}
                </button>
            </div>
            <div className="premise-starter-grid">
                {cards.map(card => (
                    <button
                        type="button"
                        key={card.key}
                        className={`premise-starter-card${current && current === card.text.trim() ? ' selected' : ''}${card.drafted ? ' drafted' : ''}`}
                        onClick={() => onPick(card.text, card.starterId)}
                        title={card.text}
                    >
                        <span className="premise-starter-title">{card.title}</span>
                        <span className="premise-starter-blurb">{card.blurb}</span>
                    </button>
                ))}
            </div>
            {!machineryReady && (
                <p className="creation-hint premise-starters-hint">
                    "Draft from my hero" needs the Gemini machinery key (Settings → AI Provider).
                </p>
            )}
            {draftError && <div className="premise-starters-error">{draftError}</div>}
        </div>
    );
}
