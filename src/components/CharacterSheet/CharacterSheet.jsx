import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { getModifier, formatModifier, getProficiencyBonus, getAllSkills, SKILL_ABILITIES } from '../../engine/rules.js';
import { ABILITY_NAMES, ABILITY_SHORT, SKILL_LABELS } from '../../engine/characterUtils.js';
import { RACES } from '../../data/races.js';
import { CLASSES } from '../../data/classes.js';
import './CharacterSheet.css';

export default function CharacterSheet() {
    const { state } = useGame();
    const { character } = state;
    const [isExpanded, setIsExpanded] = useState(false);
    const [showSkills, setShowSkills] = useState(false);

    if (!character) return null;

    const race = RACES[character.race];
    const charClass = CLASSES[character.class];
    const hpPercent = Math.round((character.currentHP / character.maxHP) * 100);

    const exp = character.exp || 0;
    const expThreshold = character.level * 1000;
    const expPercent = Math.min(100, Math.round((exp / expThreshold) * 100));

    let hpColor = 'var(--hp-high)';
    if (hpPercent <= 25) hpColor = 'var(--hp-critical)';
    else if (hpPercent <= 50) hpColor = 'var(--hp-low)';

    // Skills data
    const skills = getAllSkills(character);

    // Group skills by ability for display
    const skillsByAbility = {};
    for (const s of skills) {
        if (!skillsByAbility[s.ability]) skillsByAbility[s.ability] = [];
        skillsByAbility[s.ability].push(s);
    }

    // Class resources
    const classResources = character.classResources || {};
    const resourceDefs = charClass?.resources || {};
    const activeResources = Object.entries(resourceDefs).filter(
        ([key, def]) => character.level >= (def.minLevel || 1) && classResources[key]
    );

    // Hit dice
    const hitDice = character.hitDice || { total: character.level, remaining: character.level, die: charClass?.hitDie || 8 };

    return (
        <div className="character-sheet">
            <button
                className="cs-dropdown-btn"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <span className="cs-dropdown-title">👤 Character Profile</span>
                <span className="cs-dropdown-icon">{isExpanded ? '▲' : '▼'}</span>
            </button>

            {isExpanded && (
                <div className="cs-expanded-content">
                    <div className="cs-header">
                        <h2 className="cs-name">{character.name}</h2>
                        <div className="cs-subtitle">
                            {race?.name || character.race} {charClass?.name || character.class} · Level {character.level}
                        </div>
                    </div>

                    <div className="cs-hp-section">
                        <div className="cs-hp-label">
                            <span>HP</span>
                            <span className="cs-hp-numbers">{character.currentHP} / {character.maxHP}</span>
                        </div>
                        <div className="cs-hp-bar">
                            <div
                                className="cs-hp-fill"
                                style={{ width: `${hpPercent}%`, background: hpColor }}
                            />
                        </div>
                    </div>

                    <div className="cs-exp-section">
                        <div className="cs-exp-label">
                            <span>Experience</span>
                            <span className="cs-exp-numbers">{exp} / {expThreshold} XP</span>
                        </div>
                        <div className="cs-exp-bar">
                            <div
                                className="cs-exp-fill"
                                style={{ width: `${expPercent}%` }}
                            />
                        </div>
                    </div>

                    {character.conditions?.length > 0 && (
                        <div className="cs-conditions">
                            {character.conditions.map((c, i) => (
                                <span key={i} className="cs-condition-badge">⚠️ {c}</span>
                            ))}
                        </div>
                    )}

                    <div className="cs-combat-stats">
                        <div className="cs-combat-stat">
                            <div className="cs-stat-value">{character.armorClass}</div>
                            <div className="cs-stat-label">AC</div>
                        </div>
                        <div className="cs-combat-stat">
                            <div className="cs-stat-value">{formatModifier(getModifier(character.abilityScores.dexterity))}</div>
                            <div className="cs-stat-label">Initiative</div>
                        </div>
                        <div className="cs-combat-stat">
                            <div className="cs-stat-value">{character.speed}</div>
                            <div className="cs-stat-label">Speed</div>
                        </div>
                        <div className="cs-combat-stat">
                            <div className="cs-stat-value">{formatModifier(getProficiencyBonus(character.level))}</div>
                            <div className="cs-stat-label">Prof.</div>
                        </div>
                    </div>

                    <div className="cs-abilities">
                        {ABILITY_NAMES.map(ability => {
                            const score = character.abilityScores[ability];
                            const mod = getModifier(score);
                            return (
                                <div key={ability} className="cs-ability">
                                    <div className="cs-ability-name">{ABILITY_SHORT[ability]}</div>
                                    <div className="cs-ability-mod">{formatModifier(mod)}</div>
                                    <div className="cs-ability-score">{score}</div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Class Resources */}
                    {activeResources.length > 0 && (
                        <div className="cs-section">
                            <h4 className="cs-section-title">Resources</h4>
                            <div className="cs-resources">
                                {activeResources.map(([key, def]) => {
                                    const res = classResources[key];
                                    const available = res.max - res.used;
                                    return (
                                        <div key={key} className="cs-resource-row">
                                            <span className="cs-resource-name">{def.label}</span>
                                            <span className="cs-resource-pips">
                                                {Array.from({ length: res.max }, (_, i) => (
                                                    <span key={i} className={`cs-pip ${i < available ? 'available' : 'spent'}`} />
                                                ))}
                                            </span>
                                            <span className="cs-resource-reset">{def.resetOn} rest</span>
                                        </div>
                                    );
                                })}
                                <div className="cs-resource-row">
                                    <span className="cs-resource-name">Hit Dice (d{hitDice.die})</span>
                                    <span className="cs-resource-count">{hitDice.remaining}/{hitDice.total}</span>
                                    <span className="cs-resource-reset">long rest</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Skills section */}
                    <div className="cs-section">
                        <button className="cs-skills-toggle" onClick={() => setShowSkills(!showSkills)}>
                            <h4 className="cs-section-title" style={{ margin: 0 }}>Skills</h4>
                            <span className="cs-dropdown-icon">{showSkills ? '▲' : '▼'}</span>
                        </button>
                        {showSkills && (
                            <div className="cs-skills-list">
                                {Object.entries(skillsByAbility).map(([ability, abilitySkills]) => (
                                    <div key={ability} className="cs-skill-group">
                                        <div className="cs-skill-group-label">{ABILITY_SHORT[ability]}</div>
                                        {abilitySkills.map(s => (
                                            <div key={s.skill} className={`cs-skill-row ${s.isProficient ? 'proficient' : ''}`}>
                                                <span className="cs-skill-prof">
                                                    {s.hasExpertise ? '◆◆' : s.isProficient ? '◆' : '○'}
                                                </span>
                                                <span className="cs-skill-name">{SKILL_LABELS[s.skill] || s.skill}</span>
                                                <span className="cs-skill-mod">{formatModifier(s.total)}</span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {character.traits?.length > 0 && (
                        <div className="cs-section">
                            <h4 className="cs-section-title">Traits</h4>
                            <ul className="cs-list">
                                {character.traits.map((trait, i) => (
                                    <li key={i}>{trait}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {character.features?.length > 0 && (
                        <div className="cs-section">
                            <h4 className="cs-section-title">Features</h4>
                            <ul className="cs-list">
                                {character.features.map((feature, i) => (
                                    <li key={i}>{feature}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
