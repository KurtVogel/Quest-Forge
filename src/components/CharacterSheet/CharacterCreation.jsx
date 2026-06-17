import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { createCharacter, createStartingInventory, STANDARD_ARRAY, ABILITY_NAMES, ABILITY_SHORT, SKILL_LABELS } from '../../engine/characterUtils.js';
import { sanitizeCharacter, sanitizeInventory, parseCharacterExport, downloadCharacterExport } from '../../engine/characterVault.js';
import { listRosterCharacters, saveRosterCharacter, deleteRosterCharacter } from '../../state/persistence.js';
import { RACES, RACE_LIST } from '../../data/races.js';
import { CLASSES, CLASS_LIST } from '../../data/classes.js';
import { SKILL_ABILITIES } from '../../engine/rules.js';
import './CharacterSheet.css';

const STEPS = ['name', 'race', 'class', 'stats', 'skills', 'confirm', 'adventure'];

export default function CharacterCreation() {
    const { dispatch } = useGame();
    const [phase, setPhase] = useState('start'); // 'start' | 'wizard' | 'roster'
    const [step, setStep] = useState(0);
    const [name, setName] = useState('');
    const [race, setRace] = useState('');
    const [charClass, setCharClass] = useState('');
    const [fightingStyle, setFightingStyle] = useState('defense');
    const [statAssignment, setStatAssignment] = useState({});
    const [chosenSkills, setChosenSkills] = useState([]);
    const [adventureName, setAdventureName] = useState('');
    const [premise, setPremise] = useState('');
    const [roster, setRoster] = useState([]);
    const [selectedHeroId, setSelectedHeroId] = useState(null);
    const [rosterError, setRosterError] = useState(null);
    const importInputRef = useRef(null);

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
        if (chosenSkills.includes(skill)) {
            setChosenSkills(chosenSkills.filter(s => s !== skill));
        } else if (chosenSkills.length < numChoices) {
            setChosenSkills([...chosenSkills, skill]);
        }
    };

    // Reset skills when class changes
    const handleClassSelect = (c) => {
        setCharClass(c);
        setChosenSkills([]);
        setFightingStyle('defense');
    };

    const beginAdventure = (character, inventory) => {
        dispatch({ type: 'START_CHARACTER', payload: { character, inventory } });

        // Create session — the premise is pinned here as permanent campaign canon.
        const sessionName = adventureName.trim() || `${character.name}'s Adventure`;
        const trimmedPremise = premise.trim();
        dispatch({
            type: 'UPDATE_SESSION',
            payload: {
                id: `session-${Date.now()}`,
                name: sessionName,
                premise: trimmedPremise || undefined,
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
        const abilityScores = {};
        for (const ability of ABILITY_NAMES) {
            abilityScores[ability] = statAssignment[ability];
        }

        const character = createCharacter(name, race, charClass, abilityScores, chosenSkills, { fightingStyle });
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
                                maxLength={2000}
                            />
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
                            <h3>What is your name, adventurer?</h3>
                            <input
                                type="text"
                                className="creation-input"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Enter your character's name..."
                                autoFocus
                                maxLength={30}
                            />
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
                        </div>
                    )}

                    {currentStep === 'stats' && (
                        <div className="creation-step">
                            <h3>Assign ability scores</h3>
                            <p className="creation-hint">Click an ability, then click a value to assign it. Standard array: {STANDARD_ARRAY.join(', ')}</p>
                            <div className="stat-assignment">
                                {ABILITY_NAMES.map(ability => (
                                    <div key={ability} className="stat-row">
                                        <span className="stat-label">{ABILITY_SHORT[ability]}</span>
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
                                                        className="stat-choice"
                                                        onClick={() => handleAssignStat(ability, v)}
                                                    >
                                                        {v}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
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
                        </div>
                    )}

                    {currentStep === 'confirm' && (
                        <div className="creation-step">
                            <h3>Your Hero</h3>
                            <div className="creation-summary">
                                <div className="summary-row"><strong>Name:</strong> {name}</div>
                                <div className="summary-row"><strong>Race:</strong> {RACES[race]?.name}</div>
                                <div className="summary-row"><strong>Class:</strong> {CLASSES[charClass]?.name}</div>
                                {charClass === 'fighter' && (
                                    <div className="summary-row">
                                        <strong>Fighting Style:</strong> {CLASSES.fighter.fightingStyles[fightingStyle]?.label}
                                    </div>
                                )}
                                <div className="summary-row">
                                    <strong>Stats:</strong>{' '}
                                    {ABILITY_NAMES.map(a => `${ABILITY_SHORT[a]}: ${statAssignment[a]}`).join(', ')}
                                </div>
                                <div className="summary-row">
                                    <strong>Skills:</strong>{' '}
                                    {allSkillProficiencies.map(s => SKILL_LABELS[s] || s).join(', ')}
                                </div>
                            </div>
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
                                maxLength={2000}
                            />
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
                                (currentStep === 'skills' && !allSkillsChosen)
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
