import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { createCharacter, createStartingInventory, STANDARD_ARRAY, ABILITY_NAMES, ABILITY_SHORT, SKILL_LABELS } from '../../engine/characterUtils.js';
import { sanitizeCharacter, sanitizeInventory, parseCharacterExport, downloadCharacterExport } from '../../engine/characterVault.js';
import { listRosterCharacters, saveRosterCharacter, deleteRosterCharacter } from '../../state/persistence.js';
import { RACES, RACE_LIST } from '../../data/races.js';
import { CLASSES, CLASS_LIST } from '../../data/classes.js';
import { SKILL_ABILITIES, computeACFromInventory, getModifier, getProficiencyBonus, getSkillModifier } from '../../engine/rules.js';
import { getAbilityGuidance } from '../../engine/abilityGuidance.js';
import { generatePortraitImageDetailed } from '../../llm/providers/imageGen.js';
import { getMachineryGeminiKey } from '../../llm/machinery.js';
import { buildPortraitPrompt } from './portraitPrompt.js';
import { CAMPAIGN_PREMISE_MAX_LENGTH, normalizeCampaignPremise } from '../../config/contentLimits.js';
import './CharacterSheet.css';

const formatModifier = (mod) => (mod >= 0 ? `+${mod}` : `${mod}`);

const STEPS = ['name', 'race', 'class', 'stats', 'skills', 'confirm', 'adventure'];

/**
 * Characters-remaining countdown for a capped text field. Counts down instead of
 * up and turns warning-red near the cap (last 5%, at least 10 chars) so the
 * player sees the limit coming instead of hitting an invisible wall.
 */
function CharCountdown({ length, max }) {
    const remaining = Math.max(0, max - length);
    const warnAt = Math.max(10, Math.round(max * 0.05));
    return (
        <div className={`creation-character-count${remaining <= warnAt ? ' count-low' : ''}`}>
            {remaining.toLocaleString()} characters left
        </div>
    );
}

export default function CharacterCreation() {
    const { state, dispatch } = useGame();
    const [phase, setPhase] = useState('start'); // 'start' | 'wizard' | 'roster'
    const [step, setStep] = useState(0);
    const [name, setName] = useState('');
    const [gender, setGender] = useState('');
    const [appearance, setAppearance] = useState('');
    const [background, setBackground] = useState('');
    const [race, setRace] = useState('');
    const [charClass, setCharClass] = useState('');
    const [fightingStyle, setFightingStyle] = useState('defense');
    const [statAssignment, setStatAssignment] = useState({});
    const [chosenSkills, setChosenSkills] = useState([]);
    const [expertiseSkills, setExpertiseSkills] = useState([]);
    const [adventureName, setAdventureName] = useState('');
    const [premise, setPremise] = useState('');
    const [roster, setRoster] = useState([]);
    const [selectedHeroId, setSelectedHeroId] = useState(null);
    const [rosterError, setRosterError] = useState(null);
    const [portraitUrl, setPortraitUrl] = useState('');
    const [portraitProvider, setPortraitProvider] = useState('');
    const [portraitPromptUsed, setPortraitPromptUsed] = useState('');
    const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false);
    const [portraitError, setPortraitError] = useState('');
    const importInputRef = useRef(null);

    // A generated portrait is tied to the identity it was painted from — going
    // back and changing who the hero is invalidates it.
    useEffect(() => {
        setPortraitUrl('');
        setPortraitProvider('');
        setPortraitPromptUsed('');
        setPortraitError('');
    }, [name, gender, appearance, race, charClass]);

    useEffect(() => {
        listRosterCharacters().then(setRoster).catch(() => setRoster([]));
    }, []);

    const currentStep = STEPS[step];

    const handleAssignStat = (ability, value) => {
        const newAssignment = { ...statAssignment };
        for (const key of Object.keys(newAssignment)) {
            if (newAssignment[key] === value) {
                delete newAssignment[key];
            }
        }
        newAssignment[ability] = value;
        setStatAssignment(newAssignment);
    };

    const handleUnassignStat = (ability) => {
        const newAssignment = { ...statAssignment };
        delete newAssignment[ability];
        setStatAssignment(newAssignment);
    };

    const assignedValues = new Set(Object.values(statAssignment));
    const availableValues = STANDARD_ARRAY.filter(v => !assignedValues.has(v));
    const allStatsAssigned = ABILITY_NAMES.every(a => statAssignment[a] !== undefined);

    // Which ability a class lives on is invisible to a first-time player, so the
    // stats step recommends a spread (and says why) instead of leaving them to guess.
    const abilityGuidance = useMemo(
        () => getAbilityGuidance(charClass, { fightingStyle }),
        [charClass, fightingStyle],
    );

    const handleApplyRecommendedStats = () => {
        if (abilityGuidance) setStatAssignment({ ...abilityGuidance.recommended });
    };

    // Skills logic
    const classData = charClass ? CLASSES[charClass] : null;
    const raceData = race ? RACES[race] : null;
    const racialSkills = raceData?.skillProficiencies || [];
    const availableSkillChoices = classData?.skillChoices || [];
    const numChoices = classData?.numSkillChoices || 2;
    // Filter out skills already granted by race
    const selectableSkills = availableSkillChoices.filter(s => !racialSkills.includes(s));
    const allSkillsChosen = chosenSkills.length >= numChoices;

    const handleToggleSkill = (skill) => {
        setChosenSkills(previous => {
            if (previous.includes(skill)) return previous.filter(selected => selected !== skill);
            return previous.length < numChoices ? [...previous, skill] : previous;
        });
    };

    // Reset skills when class changes
    const handleClassSelect = (c) => {
        setCharClass(c);
        setChosenSkills([]);
        setExpertiseSkills([]);
        setFightingStyle('defense');
    };

    // Engine-computed preview of the finished hero for the reveal step: the same
    // createCharacter/createStartingInventory calls handleCreate makes, so every
    // number the player sees is the real engine math, not a UI estimate. Kept
    // alive through the adventure (premise) step and REUSED by handleCreate —
    // starting gold is crypto-rolled inside createCharacter, so a second call at
    // confirm time would re-roll it and break the reveal's promise (playtest #4:
    // the reveal showed 25 gp, the campaign began with a freshly rolled 12).
    const currentStepName = STEPS[step];
    const revealReady = !!(name.trim() && race && charClass && allStatsAssigned && allSkillsChosen);
    const previewCacheRef = useRef({ key: null, value: null });
    const preview = useMemo(() => {
        if (!revealReady || (currentStepName !== 'confirm' && currentStepName !== 'adventure')) return null;
        const abilityScores = {};
        for (const ability of ABILITY_NAMES) {
            abilityScores[ability] = statAssignment[ability];
        }
        // Identity-keyed cache, NOT a bare memo: the step advance from confirm to
        // adventure changes a dep, and a recompute would re-run the crypto gold
        // roll. Same identity inputs → the SAME built character all the way to
        // handleCreate; an identity edit mints a fresh one (and its fresh roll).
        const key = JSON.stringify([name, race, charClass, abilityScores, chosenSkills, fightingStyle, expertiseSkills, gender, appearance, background]);
        if (previewCacheRef.current.key !== key) {
            const character = createCharacter(name, race, charClass, abilityScores, chosenSkills, { fightingStyle, expertiseSkills, gender, appearance, background });
            previewCacheRef.current = { key, value: { character, inventory: createStartingInventory(charClass) } };
        }
        return previewCacheRef.current.value;
    }, [revealReady, currentStepName, name, race, charClass, statAssignment, chosenSkills, fightingStyle, expertiseSkills, gender, appearance, background]);

    const imageKeyAvailable = !!(state.settings?.imageApiKey || getMachineryGeminiKey(state.settings));

    const handleGeneratePortrait = async () => {
        if (!preview || !appearance.trim() || isGeneratingPortrait) return;
        setIsGeneratingPortrait(true);
        setPortraitError('');
        try {
            const equippedNames = preview.inventory.filter(i => i.equipped && i.name).map(i => i.name);
            const prompt = buildPortraitPrompt(preview.character, appearance.trim(), equippedNames);
            const result = await generatePortraitImageDetailed(prompt, state.settings?.imageApiKey, {
                geminiApiKey: getMachineryGeminiKey(state.settings),
                bypassCache: !!portraitUrl, // reroll must paint a genuinely new image
                // Pre-session (the wizard runs before the campaign exists) — the
                // draft scope keeps wizard renders apart from any live campaign.
                sessionScope: 'creation-wizard',
            });
            if (!result?.url) throw new Error('No portrait returned.');
            setPortraitUrl(result.url);
            setPortraitProvider(result.provider || '');
            setPortraitPromptUsed(prompt);
        } catch (e) {
            setPortraitError(e.message || 'Portrait failed.');
        } finally {
            setIsGeneratingPortrait(false);
        }
    };

    const beginAdventure = (character, inventory) => {
        dispatch({ type: 'START_CHARACTER', payload: { character, inventory } });

        // Create session — the premise is pinned here as permanent campaign canon.
        const sessionName = adventureName.trim() || `${character.name}'s Adventure`;
        const trimmedPremise = normalizeCampaignPremise(premise);
        dispatch({
            type: 'UPDATE_SESSION',
            payload: {
                id: `session-${Date.now()}`,
                name: sessionName,
                premise: trimmedPremise || undefined,
                openingScenePending: !!trimmedPremise,
                createdAt: Date.now(),
                lastPlayedAt: Date.now(),
            },
        });

        // Opening message. With a premise, show it as the campaign's first entry — the DM
        // then auto-opens the scene from it (see ChatPanel priming). Without one, fall back
        // to the classic "send a message to begin" prompt.
        const openingContent = trimmedPremise
            ? `**Your tale begins.**\n\n${trimmedPremise}`
            : `**${character.name}** the **${RACES[character.race]?.name} ${CLASSES[character.class]?.name}** has entered the world. Send a message to begin your adventure!`;
        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'system', content: openingContent },
        });

        dispatch({ type: 'SET_UI', payload: { isCharacterCreationOpen: false } });
    };

    const handleCreate = () => {
        // The revealed hero IS the hero: reuse the preview so the stat chips and
        // gold the player just confirmed are what the campaign starts with.
        if (preview) {
            const character = { ...preview.character };
            if (portraitUrl) {
                character.portraitUrl = portraitUrl;
                character.portraitPrompt = portraitPromptUsed;
                character.portraitUpdatedAt = Date.now();
            }
            beginAdventure(character, preview.inventory);
            return;
        }
        const abilityScores = {};
        for (const ability of ABILITY_NAMES) {
            abilityScores[ability] = statAssignment[ability];
        }

        const character = createCharacter(name, race, charClass, abilityScores, chosenSkills, { fightingStyle, expertiseSkills, gender, appearance, background });
        if (portraitUrl) {
            character.portraitUrl = portraitUrl;
            character.portraitPrompt = portraitPromptUsed;
            character.portraitUpdatedAt = Date.now();
        }
        const inventory = createStartingInventory(charClass);
        beginAdventure(character, inventory);
    };

    // === Roster (use an existing hero) ===

    const selectedHero = roster.find(entry => entry.id === selectedHeroId) || null;

    const handleBeginFromRoster = () => {
        if (!selectedHero) return;
        try {
            // Re-sanitize on the way out of the roster: rests the hero (full HP,
            // fresh resources) and refreshes derived fields against current data.
            // Keep the roster id (sanitize mints a fresh one for imports) so a later
            // "Save to Roster" updates this hero's entry instead of duplicating it.
            const character = { ...sanitizeCharacter(selectedHero.character), id: selectedHero.id };
            const inventory = sanitizeInventory(selectedHero.inventory);
            beginAdventure(character, inventory);
        } catch (err) {
            setRosterError(err.message);
        }
    };

    const handleImportFile = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = ''; // allow re-importing the same file
        if (!file) return;
        setRosterError(null);
        try {
            const { character, inventory } = parseCharacterExport(await file.text());
            await saveRosterCharacter(character, inventory);
            setRoster(await listRosterCharacters());
            setSelectedHeroId(character.id);
        } catch (err) {
            setRosterError(err.message || 'Could not import this file.');
        }
    };

    const handleExportHero = (entry) => {
        downloadCharacterExport(entry.character, entry.inventory);
    };

    const handleDeleteHero = async (entry) => {
        if (!confirm(`Remove ${entry.name} from the roster? An exported file is the only way to get them back.`)) return;
        await deleteRosterCharacter(entry.id);
        if (selectedHeroId === entry.id) setSelectedHeroId(null);
        setRoster(await listRosterCharacters());
    };

    // Combine racial + chosen skills for the confirm screen
    const allSkillProficiencies = [...new Set([...racialSkills, ...chosenSkills])];

    if (phase === 'start') {
        return (
            <div className="char-creation-overlay">
                <div className="char-creation-modal">
                    <h2 className="char-creation-title">Your Hero</h2>
                    <div className="creation-grid">
                        <button className="creation-card" onClick={() => setPhase('wizard')}>
                            <div className="card-name">Forge a New Hero</div>
                            <div className="card-desc">Create a character from scratch — race, class, stats, and skills.</div>
                        </button>
                        <button className="creation-card" onClick={() => setPhase('roster')}>
                            <div className="card-name">Use an Existing Hero</div>
                            <div className="card-desc">Pick a hero from your roster, or import a character file.</div>
                            <div className="card-bonus">{roster.length} in roster</div>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (phase === 'roster') {
        return (
            <div className="char-creation-overlay">
                <div className="char-creation-modal">
                    <h2 className="char-creation-title">Choose Your Hero</h2>

                    {roster.length === 0 && (
                        <p className="creation-hint">
                            Your roster is empty. Import a character file below, or save a hero
                            to the roster from the character sheet during play.
                        </p>
                    )}

                    <div className="roster-list">
                        {roster.map(entry => (
                            <div key={entry.id} className={`roster-entry ${selectedHeroId === entry.id ? 'selected' : ''}`}>
                                <button className="roster-entry-main" onClick={() => setSelectedHeroId(entry.id)}>
                                    <span className="roster-entry-name">{entry.name}</span>
                                    <span className="roster-entry-meta">
                                        Lv.{entry.level} {RACES[entry.race]?.name || entry.race} {CLASSES[entry.class]?.name || entry.class}
                                        {' · saved '}{new Date(entry.savedAt).toLocaleDateString()}
                                    </span>
                                </button>
                                <div className="roster-entry-actions">
                                    <button className="btn btn-secondary btn-sm" onClick={() => handleExportHero(entry)}>Export</button>
                                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteHero(entry)}>Delete</button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {rosterError && <div className="roster-error">{rosterError}</div>}

                    {selectedHero && (
                        <div className="creation-step roster-adventure">
                            <h3>Set the stage</h3>
                            <input
                                type="text"
                                className="creation-input"
                                value={adventureName}
                                onChange={(e) => setAdventureName(e.target.value)}
                                placeholder={`${selectedHero.name}'s Adventure`}
                                maxLength={60}
                            />
                            <textarea
                                className="creation-input creation-premise"
                                value={premise}
                                onChange={(e) => setPremise(e.target.value)}
                                placeholder={`Where does ${selectedHero.name}'s new tale open, and what's at stake? Name the places and people that matter — the DM opens the scene from this, and it stays canon for the whole campaign.`}
                                rows={5}
                                maxLength={CAMPAIGN_PREMISE_MAX_LENGTH}
                            />
                            <CharCountdown length={premise.length} max={CAMPAIGN_PREMISE_MAX_LENGTH} />
                        </div>
                    )}

                    <input
                        ref={importInputRef}
                        type="file"
                        accept=".json,application/json"
                        style={{ display: 'none' }}
                        onChange={handleImportFile}
                    />

                    <div className="char-creation-actions">
                        <button className="btn btn-secondary" onClick={() => { setRosterError(null); setPhase('start'); }}>
                            ← Back
                        </button>
                        <button className="btn btn-secondary" onClick={() => importInputRef.current?.click()}>
                            Import File
                        </button>
                        <div style={{ flex: 1 }} />
                        <button className="btn btn-primary" onClick={handleBeginFromRoster} disabled={!selectedHero}>
                            Begin Adventure
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="char-creation-overlay">
            <div className="char-creation-modal">
                <h2 className="char-creation-title">Forge Your Hero</h2>

                <div className="char-creation-steps">
                    {STEPS.map((s, i) => (
                        <div key={s} className={`step-indicator ${i <= step ? 'active' : ''} ${i === step ? 'current' : ''}`}>
                            {i + 1}
                        </div>
                    ))}
                </div>

                <div className="char-creation-content">
                    {currentStep === 'name' && (
                        <div className="creation-step">
                            <h3>Who is your hero?</h3>
                            <input
                                type="text"
                                className="creation-input"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Enter your character's name..."
                                autoFocus
                                maxLength={30}
                            />
                            <input
                                type="text"
                                className="creation-input"
                                value={gender}
                                onChange={(e) => setGender(e.target.value)}
                                placeholder="Gender — woman, man, nonbinary, anything else… (optional)"
                                maxLength={60}
                            />
                            <CharCountdown length={gender.length} max={60} />
                            <textarea
                                className="creation-input creation-premise"
                                value={appearance}
                                onChange={(e) => setAppearance(e.target.value)}
                                placeholder={'Appearance (optional) — build, face, hair, scars, how they carry themselves. Becomes established canon: the DM keeps it consistent, and it feeds portraits and scene art.'}
                                rows={3}
                                maxLength={600}
                            />
                            <CharCountdown length={appearance.length} max={600} />
                            <textarea
                                className="creation-input creation-premise"
                                value={background}
                                onChange={(e) => setBackground(e.target.value)}
                                placeholder={'Background (optional) — where they come from, what they did before, debts, family, the wound that set them on the road. Personal canon that travels with the hero across campaigns.'}
                                rows={4}
                                maxLength={2000}
                            />
                            <CharCountdown length={background.length} max={2000} />
                            <p className="creation-hint">
                                Gender, appearance, and background are optional — but whatever you
                                write here is canon the DM will honor.
                            </p>
                        </div>
                    )}

                    {currentStep === 'race' && (
                        <div className="creation-step">
                            <h3>Choose your race</h3>
                            <div className="creation-grid">
                                {RACE_LIST.map(r => (
                                    <button
                                        key={r}
                                        className={`creation-card ${race === r ? 'selected' : ''}`}
                                        onClick={() => setRace(r)}
                                    >
                                        <div className="card-name">{RACES[r].name}</div>
                                        <div className="card-desc">{RACES[r].description}</div>
                                        <div className="card-bonus">
                                            {Object.entries(RACES[r].abilityBonuses).map(([a, b]) =>
                                                `${ABILITY_SHORT[a]} +${b}`
                                            ).join(', ')}
                                        </div>
                                        {RACES[r].skillProficiencies?.length > 0 && (
                                            <div className="card-bonus">
                                                Skills: {RACES[r].skillProficiencies.map(s => SKILL_LABELS[s] || s).join(', ')}
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {currentStep === 'class' && (
                        <div className="creation-step">
                            <h3>Choose your class</h3>
                            <div className="creation-grid">
                                {CLASS_LIST.map(c => (
                                    <button
                                        key={c}
                                        className={`creation-card ${charClass === c ? 'selected' : ''}`}
                                        onClick={() => handleClassSelect(c)}
                                    >
                                        <div className="card-name">{CLASSES[c].name}</div>
                                        <div className="card-desc">{CLASSES[c].description}</div>
                                        <div className="card-bonus">Hit Die: d{CLASSES[c].hitDie}</div>
                                    </button>
                                ))}
                            </div>
                            {/* Lives here, not on the race step: the choice depends on the
                                class picked above, and it steers the next step's advice. */}
                            {charClass === 'fighter' && (
                                <>
                                    <h3>Choose your fighting style</h3>
                                    <div className="creation-grid">
                                        {Object.entries(CLASSES.fighter.fightingStyles).map(([key, style]) => (
                                            <button
                                                key={key}
                                                className={`creation-card ${fightingStyle === key ? 'selected' : ''}`}
                                                onClick={() => setFightingStyle(key)}
                                            >
                                                <div className="card-name">{style.label}</div>
                                                <div className="card-desc">{style.description}</div>
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {currentStep === 'stats' && (
                        <div className="creation-step">
                            <h3>Assign ability scores</h3>
                            <p className="creation-hint">Click an ability, then click a value to assign it. Standard array: {STANDARD_ARRAY.join(', ')}</p>
                            {abilityGuidance && (
                                <div className="stat-recommendation">
                                    <div className="stat-rec-text">
                                        <div className="stat-rec-title">
                                            Recommended for a {classData.name}
                                            {charClass === 'fighter' && CLASSES.fighter.fightingStyles[fightingStyle]
                                                ? ` (${CLASSES.fighter.fightingStyles[fightingStyle].label})`
                                                : ''}
                                        </div>
                                        <div className="stat-rec-order">
                                            {abilityGuidance.priority.map((a, i) => (
                                                <span key={a} className={`stat-rec-chip${i === 0 ? ' primary' : ''}`}>
                                                    {ABILITY_SHORT[a]} {abilityGuidance.recommended[a]}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <button className="stat-rec-apply" onClick={handleApplyRecommendedStats}>
                                        Use this spread
                                    </button>
                                </div>
                            )}
                            <div className="stat-assignment">
                                {ABILITY_NAMES.map(ability => {
                                    const rank = abilityGuidance ? abilityGuidance.priority.indexOf(ability) : -1;
                                    const suggested = abilityGuidance?.recommended[ability];
                                    const racialBonus = raceData?.abilityBonuses?.[ability];
                                    return (
                                        <div key={ability} className="stat-row">
                                            <div className="stat-row-main">
                                                <span className="stat-label">{ABILITY_SHORT[ability]}</span>
                                                {rank === 0 && <span className="stat-rec-tag primary">Primary</span>}
                                                {rank === 1 && <span className="stat-rec-tag">Secondary</span>}
                                                {racialBonus > 0 && (
                                                    <span className="stat-race-bonus">{raceData.name} +{racialBonus}</span>
                                                )}
                                                {statAssignment[ability] !== undefined ? (
                                                    <button
                                                        className="stat-value assigned"
                                                        onClick={() => handleUnassignStat(ability)}
                                                    >
                                                        {statAssignment[ability]}
                                                        <span className="stat-remove">✕</span>
                                                    </button>
                                                ) : (
                                                    <div className="stat-choices">
                                                        {availableValues.map(v => (
                                                            <button
                                                                key={v}
                                                                className={`stat-choice${v === suggested ? ' recommended' : ''}`}
                                                                title={v === suggested ? `Recommended for a ${classData.name}` : undefined}
                                                                onClick={() => handleAssignStat(ability, v)}
                                                            >
                                                                {v}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            {abilityGuidance?.notes[ability] && (
                                                <p className="stat-why">{abilityGuidance.notes[ability]}</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {currentStep === 'skills' && (
                        <div className="creation-step">
                            <h3>Choose your skills</h3>
                            <p className="creation-hint">
                                Pick {numChoices} skill{numChoices > 1 ? 's' : ''} from your class list.
                                {racialSkills.length > 0 && (
                                    <> Your race grants: <strong>{racialSkills.map(s => SKILL_LABELS[s] || s).join(', ')}</strong>.</>
                                )}
                            </p>
                            <div className="skill-selection-grid">
                                {selectableSkills.map(skill => {
                                    const isChosen = chosenSkills.includes(skill);
                                    const abilityKey = SKILL_ABILITIES[skill];
                                    return (
                                        <button
                                            key={skill}
                                            className={`skill-choice-card ${isChosen ? 'selected' : ''} ${!isChosen && allSkillsChosen ? 'disabled' : ''}`}
                                            onClick={() => handleToggleSkill(skill)}
                                            disabled={!isChosen && allSkillsChosen}
                                        >
                                            <div className="skill-choice-name">{SKILL_LABELS[skill] || skill}</div>
                                            <div className="skill-choice-ability">{ABILITY_SHORT[abilityKey]}</div>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="skill-selection-count">
                                {chosenSkills.length} / {numChoices} selected
                            </div>

                            {charClass === 'rogue' && allSkillsChosen && (
                                <div className="expertise-selection" style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
                                    <h3>Choose two skills for Expertise</h3>
                                    <p className="creation-hint">Double your proficiency bonus for these skills.</p>
                                    <div className="skill-selection-grid">
                                        {allSkillProficiencies.map(skill => {
                                            const isExpert = expertiseSkills.includes(skill);
                                            const abilityKey = SKILL_ABILITIES[skill];
                                            const maxExpertiseSelected = expertiseSkills.length >= 2;
                                            return (
                                                <button
                                                    key={skill}
                                                    className={`skill-choice-card ${isExpert ? 'selected' : ''} ${!isExpert && maxExpertiseSelected ? 'disabled' : ''}`}
                                                    onClick={() => {
                                                        setExpertiseSkills(previous => {
                                                            if (previous.includes(skill)) return previous.filter(s => s !== skill);
                                                            return previous.length < 2 ? [...previous, skill] : previous;
                                                        });
                                                    }}
                                                    disabled={!isExpert && maxExpertiseSelected}
                                                >
                                                    <div className="skill-choice-name">{SKILL_LABELS[skill] || skill}</div>
                                                    <div className="skill-choice-ability">{ABILITY_SHORT[abilityKey]}</div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="skill-selection-count">
                                        {expertiseSkills.length} / 2 selected
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {currentStep === 'confirm' && preview && (
                        <div className="creation-step hero-reveal">
                            <h3>{name.trim()} stands ready</h3>
                            <div className="reveal-layout">
                                <div className="reveal-portrait">
                                    {portraitUrl ? (
                                        <img src={portraitUrl} alt={`Portrait of ${name.trim()}`} />
                                    ) : (
                                        <div className="reveal-portrait-empty">
                                            {appearance.trim()
                                                ? (isGeneratingPortrait ? 'The painter works…' : 'No portrait yet')
                                                : 'Describe an appearance on the first step to give your hero a face.'}
                                        </div>
                                    )}
                                    {portraitUrl && portraitProvider && portraitProvider !== 'xai' && (
                                        <div className="reveal-portrait-note">
                                            Rendered by {portraitProvider === 'gemini' ? 'Gemini (quality fallback)' : portraitProvider}
                                        </div>
                                    )}
                                    {appearance.trim() && imageKeyAvailable && (
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={handleGeneratePortrait}
                                            disabled={isGeneratingPortrait}
                                        >
                                            {isGeneratingPortrait ? 'Painting…' : (portraitUrl ? 'Reroll portrait' : 'Generate portrait')}
                                        </button>
                                    )}
                                    {appearance.trim() && !imageKeyAvailable && (
                                        <div className="reveal-portrait-note">
                                            Add an image key (Settings → AI Provider) to generate a portrait.
                                        </div>
                                    )}
                                    {portraitError && <div className="roster-error">{portraitError}</div>}
                                </div>
                                <div className="reveal-identity">
                                    <div className="reveal-meta">
                                        {gender.trim() && <>{gender.trim()} · </>}
                                        {RACES[race]?.name} {CLASSES[charClass]?.name} · Level 1
                                        {charClass === 'fighter' && <> · {CLASSES.fighter.fightingStyles[fightingStyle]?.label}</>}
                                    </div>
                                    <div className="reveal-chips">
                                        <div className="reveal-chip"><span>HP</span><strong>{preview.character.maxHP}</strong></div>
                                        <div className="reveal-chip"><span>AC</span><strong>{computeACFromInventory(preview.inventory, preview.character)}</strong></div>
                                        <div className="reveal-chip"><span>Initiative</span><strong>{formatModifier(getModifier(preview.character.abilityScores.dexterity))}</strong></div>
                                        <div className="reveal-chip"><span>Proficiency</span><strong>+{getProficiencyBonus(1)}</strong></div>
                                        <div className="reveal-chip"><span>Speed</span><strong>{preview.character.speed} ft</strong></div>
                                        <div className="reveal-chip"><span>Hit Die</span><strong>d{CLASSES[charClass]?.hitDie}</strong></div>
                                        {preview.character.spellSlots && (
                                            <div className="reveal-chip">
                                                <span>Spell Slots</span>
                                                <strong>
                                                    {Object.entries(preview.character.spellSlots)
                                                        .filter(([, slot]) => slot?.max > 0)
                                                        .map(([lvl, slot]) => `L${lvl} ×${slot.max}`)
                                                        .join(' · ') || '—'}
                                                </strong>
                                            </div>
                                        )}
                                    </div>
                                    <div className="reveal-abilities">
                                        {ABILITY_NAMES.map(a => (
                                            <div key={a} className="reveal-ability">
                                                <span>{ABILITY_SHORT[a]}</span>
                                                <strong>{preview.character.abilityScores[a]}</strong>
                                                <em>{formatModifier(getModifier(preview.character.abilityScores[a]))}</em>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="reveal-columns">
                                <div className="reveal-section">
                                    <h4>Skills</h4>
                                    <div className="reveal-skill-list">
                                        {allSkillProficiencies.map(s => (
                                            <div key={s} className={`reveal-skill${expertiseSkills.includes(s) ? ' expertise' : ''}`}>
                                                <span>{SKILL_LABELS[s] || s}</span>
                                                <strong>{formatModifier(getSkillModifier(preview.character, s))}</strong>
                                                {expertiseSkills.includes(s) && <em>expertise</em>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="reveal-section">
                                    <h4>Starting gear</h4>
                                    <ul className="reveal-gear">
                                        {preview.inventory.map((item, i) => (
                                            <li key={item.id || `${item.name}-${i}`}>
                                                {item.name}
                                                {item.quantity > 1 ? ` ×${item.quantity}` : ''}
                                                {item.equipped ? ' — equipped' : ''}
                                            </li>
                                        ))}
                                    </ul>
                                    {preview.character.gold > 0 && (
                                        <div className="reveal-wealth">{preview.character.gold} gp</div>
                                    )}
                                </div>
                            </div>
                            {(appearance.trim() || background.trim()) && (
                                <div className="creation-summary reveal-canon">
                                    {appearance.trim() && <div className="summary-row"><strong>Appearance:</strong> {appearance.trim()}</div>}
                                    {background.trim() && <div className="summary-row"><strong>Background:</strong> {background.trim()}</div>}
                                </div>
                            )}
                        </div>
                    )}

                    {currentStep === 'adventure' && (
                        <div className="creation-step">
                            <h3>Set the stage</h3>
                            <p className="creation-hint">
                                Name your tale, then describe the opening situation — where {name || 'your hero'} is,
                                what's happening, and any places, people, or history that matter. The DM opens the
                                very first scene from this, and it stays permanent canon for the whole campaign.
                            </p>
                            <input
                                type="text"
                                className="creation-input"
                                value={adventureName}
                                onChange={(e) => setAdventureName(e.target.value)}
                                placeholder={`${name}'s Adventure`}
                                autoFocus
                                maxLength={60}
                            />
                            <textarea
                                className="creation-input creation-premise"
                                value={premise}
                                onChange={(e) => setPremise(e.target.value)}
                                placeholder={`Exiled from the city of Tanelorn, ${name || 'your hero'} arrives at the rain-soaked frontier town of Jewelglade with a borrowed sword and a grudge. The town has been losing people to the woods...`}
                                rows={5}
                                maxLength={CAMPAIGN_PREMISE_MAX_LENGTH}
                            />
                            <CharCountdown length={premise.length} max={CAMPAIGN_PREMISE_MAX_LENGTH} />
                        </div>
                    )}
                </div>

                <div className="char-creation-actions">
                    <button
                        className="btn btn-secondary"
                        onClick={() => (step > 0 ? setStep(step - 1) : setPhase('start'))}
                    >
                        ← Back
                    </button>
                    <div style={{ flex: 1 }} />
                    {currentStep === 'adventure' ? (
                        <button className="btn btn-primary" onClick={handleCreate}>
                            Begin Adventure
                        </button>
                    ) : (
                        <button
                            className="btn btn-primary"
                            onClick={() => setStep(step + 1)}
                            disabled={
                                (currentStep === 'name' && !name.trim()) ||
                                (currentStep === 'race' && !race) ||
                                (currentStep === 'class' && !charClass) ||
                                (currentStep === 'stats' && !allStatsAssigned) ||
                                (currentStep === 'skills' && (!allSkillsChosen || (charClass === 'rogue' && expertiseSkills.length !== 2)))
                            }
                        >
                            Next →
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
