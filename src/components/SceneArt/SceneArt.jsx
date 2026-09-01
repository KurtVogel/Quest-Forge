import { useState, useEffect, useMemo, useRef } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { generatePortraitImageDetailed, generateSceneImageDetailed, peekCachedImage } from '../../llm/providers/imageGen.js';
import { getMachineryGeminiKey } from '../../llm/machinery.js';
import { namesMatch } from '../../engine/npcRoster.js';
import { isSameLocation } from '../../engine/locationRegistry.js';
import { composeScenePrompt } from '../../llm/scribe.js';
import {
    buildCustomPrompt,
    buildFallbackScenePrompt,
    buildFocusedPrompt,
    equippedSummary,
    fallbackNotice,
    pickSceneSituation,
} from './sceneArtHelpers.js';
import './SceneArt.css';

export default function SceneArt() {
    const { state } = useGame();
    const [currentImage, setCurrentImage] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [mode, setMode] = useState('scene');
    const [targetId, setTargetId] = useState('');
    const [customSubject, setCustomSubject] = useState('');
    const [error, setError] = useState('');
    const [generationNotice, setGenerationNotice] = useState('');
    const lastLocationRef = useRef(null);
    // One in-flight render at a time; Cancel aborts it (a deliberate cancel
    // never falls through to the next provider — imageGen rethrows AbortError).
    const abortRef = useRef(null);

    const gear = useMemo(() => equippedSummary(state.inventory), [state.inventory]);
    const visualTargets = useMemo(() => [
        state.character && {
            id: 'player',
            type: 'player',
            label: state.character.name || 'Player character',
            entity: state.character,
            gear,
        },
        // A companion's species/gender/appearance live on their linked roster
        // record (DECISIONS.md 2026-07-23, one system owns all bonds) — merge them in.
        ...(state.party || []).map(c => {
            const dossier = (state.npcs || []).find(n => namesMatch(n.name, c.name));
            return {
                id: `companion:${c.id || c.name}`,
                type: 'companion',
                label: c.name,
                entity: dossier
                    ? { ...c, gender: c.gender || dossier.gender, species: c.species || dossier.species, appearance: c.appearance || dossier.appearance }
                    : c,
            };
        }),
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

    const handleGenerateArt = async ({ reroll = false } = {}) => {
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

        // Reroll bypasses the image cache — an unchanged scene must be able to
        // produce a NEW image (generation is the point of the feature).
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const genOptions = {
            geminiApiKey: getMachineryGeminiKey(state.settings),
            bypassCache: reroll,
            sessionScope: state.session?.id || '',
            signal: controller.signal,
        };

        setIsLoading(true);
        setError('');
        setGenerationNotice('');
        try {
            if (mode === 'focus') {
                const prompt = buildFocusedPrompt(selectedTarget, location);
                const result = await generatePortraitImageDetailed(prompt, state.settings.imageApiKey, genOptions);
                if (result) {
                    setCurrentImage({ url: result.url, caption: selectedTarget.label, shape: 'portrait' });
                    setGenerationNotice(fallbackNotice(result));
                }
                return;
            }

            if (mode === 'custom') {
                const prompt = buildCustomPrompt(customSubject.trim(), location, state.character);
                const result = await generateSceneImageDetailed(prompt, state.settings.imageApiKey, genOptions);
                if (result) {
                    setCurrentImage({ url: result.url, caption: customSubject.trim(), shape: 'scene' });
                    setGenerationNotice(fallbackNotice(result));
                }
                return;
            }

            // The "current situation" is the DM's latest genuine narration — the
            // richest visual text in the app (shared narrative-eligibility
            // predicate: never a scrubbed refusal or a table-talk reply). Falls
            // back to the newest journal summary, then the location.
            const { situation, narrationId } = pickSceneSituation({
                messages: state.messages,
                journal: state.journal,
                location,
            });

            // Scene prompts are LLM-composed and never byte-identical, so the
            // cache is keyed on the render's INPUTS: an unchanged scene must
            // short-circuit BEFORE paying the compose call (2026-08-01 audit P1).
            const sceneCacheKey = `scene|${narrationId || 'no-narration'}|${location}`;
            if (!reroll) {
                const cached = peekCachedImage(sceneCacheKey, {
                    imageApiKey: state.settings.imageApiKey,
                    geminiApiKey: genOptions.geminiApiKey,
                    sessionScope: genOptions.sessionScope,
                });
                if (cached) {
                    setCurrentImage({ url: cached.url, caption: location, shape: 'scene' });
                    setGenerationNotice(fallbackNotice(cached));
                    return;
                }
            }

            // Scribe composes the prompt from the situation + known visual details.
            // Companions ride with their linked roster record's gender/appearance
            // merged in (the same dossier merge the focus-target list uses).
            const composed = await composeScenePrompt({
                situation,
                character: state.character ? { ...state.character, equippedSummary: gear } : null,
                party: visualTargets.filter(t => t.type === 'companion').map(t => t.entity),
                npcs: state.npcs || [],
                combat: state.combat,
                currentLocation: location,
                settings: state.settings,
            });
            // The compose call is not abortable; honor a Cancel pressed during it.
            if (controller.signal.aborted) return;

            // Fallback prompt if the composer is unavailable (no chat key / call failed).
            const prompt = composed || buildFallbackScenePrompt({ location, character: state.character, situation });

            const result = await generateSceneImageDetailed(prompt, state.settings.imageApiKey, { ...genOptions, cacheKey: sceneCacheKey });
            if (result) {
                setCurrentImage({ url: result.url, caption: location, shape: 'scene' });
                setGenerationNotice(fallbackNotice(result));
            }
        } catch (e) {
            // A deliberate Cancel is not an error to report.
            if (e?.name !== 'AbortError') setError(e.message || 'Image failed.');
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            setIsLoading(false);
        }
    };

    const handleCancel = () => {
        abortRef.current?.abort();
    };

    // Clear art when the hero moves to a DIFFERENT place. Alias re-statements
    // the registry folds ("Library landing, Clockwork Tower" → "Clockwork
    // Tower") are the same place and keep the art (2026-09-01 P2).
    useEffect(() => {
        const previous = lastLocationRef.current;
        const current = state.currentLocation;
        const samePlace = !!previous && !!current && isSameLocation(previous, current);
        if (!samePlace) {
            setCurrentImage(null);
            lastLocationRef.current = current;
        }
    }, [state.currentLocation]);

    // Abandon an in-flight render when the panel unmounts.
    useEffect(() => () => abortRef.current?.abort(), []);

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
                        <button className="scene-art-cancel-btn" onClick={handleCancel} title="Abandon this render">
                            Cancel
                        </button>
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

                        <button className="scene-art-generate-btn" onClick={() => handleGenerateArt()}>
                            Visualize {mode === 'scene'
                                ? state.currentLocation
                                : mode === 'focus'
                                    ? (selectedTarget?.label || 'Character')
                                    : 'Subject'}
                        </button>
                        {currentImage && (
                            <button
                                className="scene-art-reroll-btn"
                                onClick={() => handleGenerateArt({ reroll: true })}
                                title="Generate a fresh image for the same subject, bypassing the cache"
                            >
                                Reroll image
                            </button>
                        )}
                        {error && <div className="scene-art-error">{error}</div>}
                        {generationNotice && <div className="scene-art-notice">{generationNotice}</div>}
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
