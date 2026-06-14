import { useState, useEffect, useRef } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { generateSceneImage } from '../../llm/providers/imageGen.js';
import { composeScenePrompt } from '../../llm/scribe.js';
import './SceneArt.css';

export default function SceneArt() {
    const { state } = useGame();
    const [currentImage, setCurrentImage] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const lastLocationRef = useRef(null);

    const handleGenerateArt = async () => {
        const location = state.currentLocation;
        if (!location) return;

        setIsLoading(true);
        try {
            // The "current situation" is the DM's latest narrated moment — the richest
            // visual text in the app. Fall back to the newest journal summary, then location.
            const lastNarration = [...(state.messages || [])].reverse()
                .find(m => m.role === 'assistant' && !m.hidden && m.content?.trim())?.content;
            const lastJournal = state.journal?.length ? state.journal[state.journal.length - 1].summary : '';
            let situation = (lastNarration || lastJournal || `The scene at ${location}.`).trim();
            if (situation.length > 700) situation = situation.slice(0, 700) + '…';

            const equippedSummary = (state.inventory || [])
                .filter(i => i.equipped)
                .map(i => i.name)
                .filter(Boolean)
                .join(', ');

            // Scribe composes the prompt from the situation + known visual details.
            const composed = await composeScenePrompt({
                situation,
                character: state.character ? { ...state.character, equippedSummary } : null,
                npcs: state.npcs || [],
                combat: state.combat,
                currentLocation: location,
                settings: state.settings,
            });

            // Fallback prompt if the composer is unavailable (no chat key / call failed).
            const prompt = composed || [
                `Dark fantasy RPG scene at ${location}.`,
                state.character && `Featuring ${state.character.name}, a ${state.character.race} ${state.character.class}${state.character.appearance ? `: ${state.character.appearance}` : ''}.`,
                situation,
                'dark fantasy digital painting, cinematic lighting, highly detailed',
            ].filter(Boolean).join(' ');

            const imageUrl = await generateSceneImage(prompt, state.settings.imageApiKey);
            if (imageUrl) setCurrentImage(imageUrl);
        } finally {
            setIsLoading(false);
        }
    };

    // Clear art if we move to a new vastly different area
    useEffect(() => {
        if (state.currentLocation !== lastLocationRef.current) {
            setCurrentImage(null);
            lastLocationRef.current = state.currentLocation;
        }
    }, [state.currentLocation]);

    if (!state.currentLocation) return null;

    return (
        <>
            <div className="scene-art-container">
                {isLoading && (
                    <div className="scene-art-loading">
                        <span className="scene-loading-icon" aria-hidden="true" />
                        <span>Painting the scene...</span>
                    </div>
                )}

                {!currentImage && !isLoading && state.currentLocation && (
                    <button className="scene-art-generate-btn" onClick={handleGenerateArt}>
                        Visualize {state.currentLocation}
                    </button>
                )}

                {currentImage && (
                    <div className="scene-art-image-wrap" onClick={() => setIsExpanded(true)}>
                        <img
                            src={currentImage}
                            alt={state.currentLocation || 'Scene'}
                            className="scene-art-image"
                        />
                        <div className="scene-art-caption">
                            <span className="scene-location-icon" aria-hidden="true" />
                            {state.currentLocation}
                        </div>
                    </div>
                )}
            </div>

            {isExpanded && currentImage && (
                <div className="scene-art-lightbox" onClick={() => setIsExpanded(false)}>
                    <img
                        src={currentImage}
                        alt={state.currentLocation || 'Scene'}
                        className="scene-art-lightbox-img"
                    />
                    <div className="scene-art-lightbox-caption">{state.currentLocation}</div>
                </div>
            )}
        </>
    );
}
