import { useState, useEffect, useMemo, useRef } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { generatePortraitImage, generateSceneImage } from '../../llm/providers/imageGen.js';
import { composeScenePrompt } from '../../llm/scribe.js';
import './SceneArt.css';

function equippedSummary(inventory = []) {
    return inventory
        .filter(i => i.equipped)
        .map(i => i.name)
        .filter(Boolean)
        .join(', ');
}

function describeEntity(target) {
    if (!target) return '';
    if (target.type === 'player') {
        const c = target.entity;
        return [
            `${c.name}, a ${c.race || ''} ${c.class || 'adventurer'}`.trim(),
            c.appearance,
            target.gear && `Wearing/wielding: ${target.gear}.`,
        ].filter(Boolean).join('. ');
    }
    if (target.type === 'companion') {
        const c = target.entity;
        return [
            `${c.name}, ${c.role || 'companion'}`,
            c.appearance || c.notes,
            c.weapon && `Wielding ${c.weapon}.`,
        ].filter(Boolean).join('. ');
    }
    if (target.type === 'npc') {
        const n = target.entity;
        return [
            `${n.name}, ${n.disposition || 'NPC'}`,
            n.appearance || n.lastNotes || n.notes,
            n.lastLocation && `Last seen at ${n.lastLocation}.`,
        ].filter(Boolean).join('. ');
    }
    if (target.type === 'enemy') {
        const e = target.entity;
        return [
            `${e.name}, hostile combatant`,
            e.condition && `Condition: ${e.condition}.`,
        ].filter(Boolean).join('. ');
    }
    return target.label || '';
}

function buildFocusedPrompt(target, location) {
    const description = describeEntity(target);
    return [
        `Focused waist-up portrait of ${target.label}.`,
        description,
        location && `Current setting: ${location}.`,
        'Adult low-fantasy tabletop RPG portrait, grounded and believable, expressive face, practical clothing and gear, painterly realism, dark neutral background, soft rim light, no text, no frame.',
    ].filter(Boolean).join(' ');
}

function buildCustomPrompt(subject, location, character) {
    return [
        subject,
        location && `Set in or near ${location}.`,
        character?.appearance && `Keep ${character.name}'s established look consistent if present: ${character.appearance}.`,
        'Dark fantasy tabletop RPG illustration, grounded details, cinematic lighting, painterly realism, no text, no UI, no watermark.',
    ].filter(Boolean).join(' ');
}

export default function SceneArt() {
    const { state } = useGame();
    const [currentImage, setCurrentImage] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [mode, setMode] = useState('scene');
    const [targetId, setTargetId] = useState('');
    const [customSubject, setCustomSubject] = useState('');
    const [error, setError] = useState('');
    const lastLocationRef = useRef(null);

    const gear = useMemo(() => equippedSummary(state.inventory), [state.inventory]);
    const visualTargets = useMemo(() => [
        state.character && {
            id: 'player',
            type: 'player',
            label: state.character.name || 'Player character',
            entity: state.character,
            gear,
        },
        ...(state.party || []).map(c => ({
            id: `companion:${c.id || c.name}`,
            type: 'companion',
            label: c.name,
            entity: c,
        })),
        ...(state.npcs || []).filter(n => n.name).map(n => ({
            id: `npc:${n.id || n.name}`,
            type: 'npc',
            label: n.name,
            entity: n,
        })),
        ...(state.combat?.enemies || []).filter(e => e.name).map(e => ({
            id: `enemy:${e.id || e.name}`,
            type: 'enemy',
            label: e.name,
            entity: e,
        })),
    ].filter(Boolean), [gear, state.character, state.party, state.npcs, state.combat?.enemies]);

    const selectedTarget = visualTargets.find(t => t.id === targetId) || visualTargets[0] || null;

    const handleGenerateArt = async () => {
        const location = state.currentLocation;
        if (!location) return;
        if (mode === 'focus' && !selectedTarget) {
            setError('No character to visualize yet.');
            return;
        }
        if (mode === 'custom' && !customSubject.trim()) {
            setError('Subject is required.');
            return;
        }

        setIsLoading(true);
        setError('');
        try {
            if (mode === 'focus') {
                const prompt = buildFocusedPrompt(selectedTarget, location);
                const imageUrl = await generatePortraitImage(prompt, state.settings.imageApiKey);
                if (imageUrl) setCurrentImage({ url: imageUrl, caption: selectedTarget.label, shape: 'portrait' });
                return;
            }

            if (mode === 'custom') {
                const prompt = buildCustomPrompt(customSubject.trim(), location, state.character);
                const imageUrl = await generateSceneImage(prompt, state.settings.imageApiKey);
                if (imageUrl) setCurrentImage({ url: imageUrl, caption: customSubject.trim(), shape: 'scene' });
                return;
            }

            // The "current situation" is the DM's latest narrated moment — the richest
            // visual text in the app. Fall back to the newest journal summary, then location.
            const lastNarration = [...(state.messages || [])].reverse()
                .find(m => m.role === 'assistant' && !m.hidden && m.content?.trim())?.content;
            const lastJournal = state.journal?.length ? state.journal[state.journal.length - 1].summary : '';
            let situation = (lastNarration || lastJournal || `The scene at ${location}.`).trim();
            if (situation.length > 700) situation = situation.slice(0, 700) + '…';

            // Scribe composes the prompt from the situation + known visual details.
            const composed = await composeScenePrompt({
                situation,
                character: state.character ? { ...state.character, equippedSummary: gear } : null,
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
            if (imageUrl) setCurrentImage({ url: imageUrl, caption: location, shape: 'scene' });
        } catch (e) {
            setError(e.message || 'Image failed.');
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

    useEffect(() => {
        if (!targetId && visualTargets.length > 0) {
            setTargetId(visualTargets[0].id);
        }
    }, [targetId, visualTargets]);

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

                {!isLoading && state.currentLocation && (
                    <div className="scene-art-controls">
                        <div className="scene-art-mode-tabs" role="group" aria-label="Image target">
                            <button
                                className={`scene-art-mode-btn ${mode === 'scene' ? 'active' : ''}`}
                                onClick={() => setMode('scene')}
                            >
                                Scene
                            </button>
                            <button
                                className={`scene-art-mode-btn ${mode === 'focus' ? 'active' : ''}`}
                                onClick={() => setMode('focus')}
                            >
                                Character
                            </button>
                            <button
                                className={`scene-art-mode-btn ${mode === 'custom' ? 'active' : ''}`}
                                onClick={() => setMode('custom')}
                            >
                                Custom
                            </button>
                        </div>

                        {mode === 'focus' && (
                            <select
                                className="scene-art-target-select"
                                value={selectedTarget?.id || ''}
                                onChange={(e) => setTargetId(e.target.value)}
                            >
                                {visualTargets.map(target => (
                                    <option key={target.id} value={target.id}>{target.label}</option>
                                ))}
                            </select>
                        )}

                        {mode === 'custom' && (
                            <textarea
                                className="scene-art-custom-input"
                                value={customSubject}
                                onChange={(e) => setCustomSubject(e.target.value)}
                                placeholder="A specific person, place, object, or moment..."
                                rows={2}
                            />
                        )}

                        <button className="scene-art-generate-btn" onClick={handleGenerateArt}>
                            Visualize {mode === 'scene'
                                ? state.currentLocation
                                : mode === 'focus'
                                    ? (selectedTarget?.label || 'Character')
                                    : 'Subject'}
                        </button>
                        {error && <div className="scene-art-error">{error}</div>}
                    </div>
                )}

                {currentImage && (
                    <div
                        className={`scene-art-image-wrap ${currentImage.shape === 'portrait' ? 'portrait' : ''}`}
                        onClick={() => setIsExpanded(true)}
                    >
                        <img
                            src={currentImage.url}
                            alt={currentImage.caption || state.currentLocation || 'Scene'}
                            className="scene-art-image"
                        />
                        <div className="scene-art-caption">
                            <span className="scene-location-icon" aria-hidden="true" />
                            {currentImage.caption || state.currentLocation}
                        </div>
                    </div>
                )}
            </div>

            {isExpanded && currentImage && (
                <div className="scene-art-lightbox" onClick={() => setIsExpanded(false)}>
                    <img
                        src={currentImage.url}
                        alt={currentImage.caption || state.currentLocation || 'Scene'}
                        className="scene-art-lightbox-img"
                    />
                    <div className="scene-art-lightbox-caption">{currentImage.caption || state.currentLocation}</div>
                </div>
            )}
        </>
    );
}
