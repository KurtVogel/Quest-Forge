import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { createCharacter, STANDARD_ARRAY, ABILITY_NAMES, ABILITY_SHORT, getStartingEquipment } from '../../engine/characterUtils.js';
import { RACES, RACE_LIST } from '../../data/races.js';
import { CLASSES, CLASS_LIST } from '../../data/classes.js';
import './CharacterSheet.css';

const STEPS = ['name', 'race', 'class', 'stats', 'confirm'];

export default function CharacterCreation() {
    const { dispatch } = useGame();
    const [step, setStep] = useState(0);
    const [name, setName] = useState('');
    const [race, setRace] = useState('');
    const [charClass, setCharClass] = useState('');
    const [statAssignment, setStatAssignment] = useState({});

    const currentStep = STEPS[step];

    const handleAssignStat = (ability, value) => {
        // Remove the value from any other ability it's assigned to
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

    const handleCreate = () => {
        const abilityScores = {};
        for (const ability of ABILITY_NAMES) {
            abilityScores[ability] = statAssignment[ability];
        }

        const character = createCharacter(name, race, charClass, abilityScores);
        dispatch({ type: 'SET_CHARACTER', payload: character });

        // Add starting equipment to inventory
        const equipment = getStartingEquipment(charClass);
        for (const item of equipment) {
            dispatch({ type: 'ADD_ITEM', payload: { ...item } });
        }

        // Create session
        dispatch({
            type: 'UPDATE_SESSION',
            payload: {
                id: `session-${Date.now()}`,
                name: `${name}'s Adventure`,
                createdAt: Date.now(),
                lastPlayedAt: Date.now(),
            },
        });

        // Welcome message
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `🎭 **${name}** the **${RACES[race]?.name} ${CLASSES[charClass]?.name}** has entered the world. Send a message to begin your adventure!`,
            },
        });

        dispatch({ type: 'SET_UI', payload: { isCharacterCreationOpen: false } });
    };

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
                                        onClick={() => setCharClass(c)}
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

                    {currentStep === 'confirm' && (
                        <div className="creation-step">
                            <h3>Your Hero</h3>
                            <div className="creation-summary">
                                <div className="summary-row"><strong>Name:</strong> {name}</div>
                                <div className="summary-row"><strong>Race:</strong> {RACES[race]?.name}</div>
                                <div className="summary-row"><strong>Class:</strong> {CLASSES[charClass]?.name}</div>
                                <div className="summary-row">
                                    <strong>Stats:</strong>{' '}
                                    {ABILITY_NAMES.map(a => `${ABILITY_SHORT[a]}: ${statAssignment[a]}`).join(', ')}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="char-creation-actions">
                    {step > 0 && (
                        <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>
                            ← Back
                        </button>
                    )}
                    <div style={{ flex: 1 }} />
                    {currentStep === 'confirm' ? (
                        <button className="btn btn-primary" onClick={handleCreate}>
                            ⚔️ Begin Adventure
                        </button>
                    ) : (
                        <button
                            className="btn btn-primary"
                            onClick={() => setStep(step + 1)}
                            disabled={
                                (currentStep === 'name' && !name.trim()) ||
                                (currentStep === 'race' && !race) ||
                                (currentStep === 'class' && !charClass) ||
                                (currentStep === 'stats' && !allStatsAssigned)
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
