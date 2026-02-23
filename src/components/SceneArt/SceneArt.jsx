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

        generateSceneImage(location, state.settings.apiKey)
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
