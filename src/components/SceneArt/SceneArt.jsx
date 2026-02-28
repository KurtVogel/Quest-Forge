import { useState, useEffect, useRef } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { generateSceneImage } from '../../llm/providers/imageGen.js';
import './SceneArt.css';

export default function SceneArt() {
    const { state } = useGame();
    const [currentImage, setCurrentImage] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const lastLocationRef = useRef(null);

    const handleGenerateArt = () => {
        const location = state.currentLocation;
        if (!location) return;

        setIsLoading(true);

        // Build a rich description based on game state
        let richDescription = `Location: ${location}. `;

        if (state.character) {
            const { name, race, level } = state.character;
            const charClass = state.character.class || 'adventurer';
            richDescription += `The scene features ${name}, a level ${level} ${race} ${charClass}. `;

            const equippedItems = (state.inventory || []).filter(i => i.equipped).map(i => i.name || i.id);
            if (equippedItems.length > 0) {
                richDescription += `Equipped with: ${equippedItems.join(', ')}. `;
            }
        }

        if (state.combat?.active && state.combat.enemies?.length > 0) {
            const enemyNames = state.combat.enemies.map(e => e.name).join(', ');
            richDescription += `Action shot! High-tension combat against: ${enemyNames}. `;
        } else if (state.journal?.length > 0) {
            const lastEntry = state.journal[state.journal.length - 1];
            let summary = lastEntry.summary || lastEntry.text || 'Exploring';
            if (summary.length > 150) summary = summary.substring(0, 150) + '...';
            richDescription += `Current situation: ${summary}. `;
        }

        generateSceneImage(richDescription, state.settings.apiKey)
            .then(imageUrl => {
                if (imageUrl) {
                    setCurrentImage(imageUrl);
                }
            })
            .finally(() => setIsLoading(false));
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
                        <span className="scene-loading-icon">🎨</span>
                        <span>Painting the scene...</span>
                    </div>
                )}

                {!currentImage && !isLoading && state.currentLocation && (
                    <button className="scene-art-generate-btn" onClick={handleGenerateArt}>
                        🎨 Visualize {state.currentLocation}
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
                            <span className="scene-location-icon">📍</span>
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
