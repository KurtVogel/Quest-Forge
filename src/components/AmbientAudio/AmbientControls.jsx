import { useState, useEffect } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { ambientAudio } from '../../engine/ambientAudio.js';
import './AmbientControls.css';

export default function AmbientControls() {
    const { state } = useGame();
    const [audioState, setAudioState] = useState(ambientAudio.getState());

    useEffect(() => {
        return ambientAudio.subscribe(setAudioState);
    }, []);

    // Auto-switch ambience based on location and combat
    useEffect(() => {
        const profile = ambientAudio.detectProfile(
            state.currentLocation,
            state.combat?.active
        );
        if (profile) {
            ambientAudio.playProfile(profile);
        }
    }, [state.currentLocation, state.combat?.active]);

    const handleToggle = () => {
        if (audioState.isPlaying) {
            ambientAudio.stopAll();
        } else {
            const profile = ambientAudio.detectProfile(
                state.currentLocation,
                state.combat?.active
            );
            ambientAudio.playProfile(profile || 'forest');
        }
    };

    return (
        <div className="ambient-controls">
            <button
                className={`ambient-toggle ${audioState.isPlaying ? 'playing' : ''}`}
                onClick={handleToggle}
                title={audioState.isPlaying ? `♪ ${audioState.profileLabel || 'Ambient'}` : 'Enable ambient audio'}
            >
                {audioState.isPlaying ? '🔊' : '🔇'}
            </button>

            {audioState.isPlaying && (
                <>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value={audioState.volume * 100}
                        onChange={(e) => ambientAudio.setVolume(e.target.value / 100)}
                        className="ambient-volume"
                        title={`Volume: ${Math.round(audioState.volume * 100)}%`}
                    />
                    <span className="ambient-label">{audioState.profileLabel}</span>
                </>
            )}
        </div>
    );
}
