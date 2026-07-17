/**
 * Full-screen, read-only character screen — the "engine proof" view.
 *
 * Everything shown here is engine-computed (rules.js / spellcasting.js);
 * mutations (ASI, rests, portrait, roster) stay in the compact side panel.
 * Design goal (IDEAS.md 2026-06-28): a sheet that reads like a real game's
 * character screen, with first-class color-coded skills.
 */
import { createPortal } from 'react-dom';
import { formatModifier, getAllSkills, getModifier, getProficiencyBonus, getSavingThrowModifier } from '../../engine/rules.js';
import { ABILITY_NAMES, ABILITY_SHORT, SKILL_LABELS } from '../../engine/characterUtils.js';
import { getExperienceThreshold, isMaxLevel } from '../../engine/progression.js';
import { getKnownSpells, getSpellAttackBonus, getSpellSaveDC, isSpellcaster } from '../../engine/spellcasting.js';
import { RACES } from '../../data/races.js';
import { CLASSES } from '../../data/classes.js';
import { formatCurrency } from '../../engine/currency.js';
import './CharacterScreen.css';

export default function CharacterScreen({ character, inventory = [], isOpen, onClose }) {
    if (!isOpen || !character) return null;

    const race = RACES[character.race];
    const charClass = CLASSES[character.class];
    const hpPercent = Math.max(0, Math.min(100, Math.round((character.currentHP / character.maxHP) * 100)));
    const exp = character.exp || 0;
    const maxLevel = isMaxLevel(character.level);
    const expThreshold = getExperienceThreshold(character.level);
    const expPercent = maxLevel ? 100 : Math.min(100, Math.round((exp / expThreshold) * 100));
    const hpColor = hpPercent <= 25 ? 'var(--hp-critical)' : hpPercent <= 50 ? 'var(--hp-low)' : 'var(--hp-high)';

    const skills = getAllSkills(character).sort((a, b) =>
        (SKILL_LABELS[a.skill] || a.skill).localeCompare(SKILL_LABELS[b.skill] || b.skill));
    const equipped = inventory.filter(item => item.equipped && item.name);
    const carried = inventory.filter(item => !item.equipped && item.name);
    const resources = Object.entries(character.classResources || {})
        .filter(([key]) => charClass?.resources?.[key])
        .map(([key, res]) => ({ key, label: charClass.resources[key].label, ...res }));
    const caster = isSpellcaster(character.class);
    const knownSpells = caster ? getKnownSpells(character) : [];
    const hitDice = character.hitDice || { total: character.level, remaining: character.level, die: charClass?.hitDie || 8 };
    const wealthCp = (character.gold || 0) * 100 + (character.silver || 0) * 10 + (character.copper || 0);

    // Portal to <body>: the compact sheet lives inside the mobile drawer, whose
    // transform would otherwise trap this "fixed" overlay at drawer size.
    return createPortal(
        <div className="char-screen-overlay" onClick={onClose}>
            <div className="char-screen" onClick={e => e.stopPropagation()} role="dialog" aria-label="Character screen">
                <div className="char-screen-topbar">
                    <span className="char-screen-title">Character</span>
                    <button className="char-screen-close" onClick={onClose} title="Close">✕</button>
                </div>

                <div className="char-screen-scroll">
                    {/* Hero band */}
                    <div className="char-hero">
                        {character.portraitUrl
                            ? <img className="char-hero-portrait" src={character.portraitUrl} alt={`${character.name} portrait`} />
                            : <div className="char-hero-portrait char-hero-portrait-empty">{(character.name || '?').slice(0, 1)}</div>}
                        <div className="char-hero-id">
                            <h2 className="char-hero-name">{character.name}</h2>
                            <div className="char-hero-sub">
                                {race?.name || character.race} {charClass?.name || character.class} · Level {character.level}
                            </div>
                            <div className="char-hero-bars">
                                <div className="char-bar">
                                    <div className="char-bar-label"><span>HP</span><span>{character.currentHP} / {character.maxHP}</span></div>
                                    <div className="char-bar-track"><div className="char-bar-fill" style={{ width: `${hpPercent}%`, background: hpColor }} /></div>
                                </div>
                                <div className="char-bar">
                                    <div className="char-bar-label"><span>XP</span><span>{maxLevel ? `${exp} · max level` : `${exp} / ${expThreshold}`}</span></div>
                                    <div className="char-bar-track"><div className="char-bar-fill char-bar-xp" style={{ width: `${expPercent}%` }} /></div>
                                </div>
                            </div>
                            {character.conditions?.length > 0 && (
                                <div className="char-conditions">
                                    {character.conditions.map((condition, i) => (
                                        <span key={i} className="char-condition">{condition}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Derived chips */}
                    <div className="char-chips">
                        <div className="char-chip"><span className="char-chip-value">{character.armorClass}</span><span className="char-chip-label">AC</span></div>
                        <div className="char-chip"><span className="char-chip-value">{formatModifier(getModifier(character.abilityScores.dexterity))}</span><span className="char-chip-label">Initiative</span></div>
                        <div className="char-chip"><span className="char-chip-value">{formatModifier(getProficiencyBonus(character.level))}</span><span className="char-chip-label">Proficiency</span></div>
                        <div className="char-chip"><span className="char-chip-value">{character.speed}</span><span className="char-chip-label">Speed</span></div>
                        <div className="char-chip"><span className="char-chip-value">{hitDice.remaining}/{hitDice.total}</span><span className="char-chip-label">Hit Dice d{hitDice.die}</span></div>
                        <div className="char-chip"><span className="char-chip-value">{formatCurrency(wealthCp) || '0 cp'}</span><span className="char-chip-label">Wealth</span></div>
                    </div>

                    {/* Abilities + saves */}
                    <div className="char-abilities">
                        {ABILITY_NAMES.map(ability => {
                            const score = character.abilityScores[ability];
                            const saveProf = character.savingThrowProficiencies?.includes(ability);
                            return (
                                <div key={ability} className={`char-ability ${saveProf ? 'save-proficient' : ''}`}>
                                    <div className="char-ability-name">{ABILITY_SHORT[ability]}</div>
                                    <div className="char-ability-mod">{formatModifier(getModifier(score))}</div>
                                    <div className="char-ability-score">{score}</div>
                                    <div className="char-ability-save" title={saveProf ? 'Proficient saving throw' : 'Saving throw'}>
                                        save {formatModifier(getSavingThrowModifier(character, ability))}{saveProf ? ' ◆' : ''}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Skills — first-class, color-coded */}
                    <div className="char-section">
                        <h3 className="char-section-title">Skills</h3>
                        <div className="char-skills-grid">
                            {skills.map(s => (
                                <div
                                    key={s.skill}
                                    className={`char-skill ${s.hasExpertise ? 'expertise' : s.isProficient ? 'proficient' : 'untrained'}`}
                                    title={`${ABILITY_SHORT[s.ability]}${s.hasExpertise ? ' · expertise (double proficiency)' : s.isProficient ? ' · proficient' : ''}`}
                                >
                                    <span className="char-skill-name">{SKILL_LABELS[s.skill] || s.skill}</span>
                                    <span className="char-skill-mod">{formatModifier(s.total)}</span>
                                </div>
                            ))}
                        </div>
                        <div className="char-skills-legend">
                            <span className="char-legend expertise">expertise</span>
                            <span className="char-legend proficient">proficient</span>
                            <span className="char-legend untrained">untrained</span>
                        </div>
                    </div>

                    <div className="char-columns">
                        <div className="char-column">
                            {resources.length > 0 && (
                                <div className="char-section">
                                    <h3 className="char-section-title">Resources</h3>
                                    {resources.map(res => (
                                        <div key={res.key} className="char-kv">
                                            <span>{res.label}</span>
                                            <span className="char-kv-value">{res.max - res.used}/{res.max}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {caster && (
                                <div className="char-section">
                                    <h3 className="char-section-title">Spellcasting</h3>
                                    <div className="char-kv"><span>Spell save DC</span><span className="char-kv-value">{getSpellSaveDC(character)}</span></div>
                                    <div className="char-kv"><span>Spell attack</span><span className="char-kv-value">{formatModifier(getSpellAttackBonus(character))}</span></div>
                                    {Object.entries(character.spellSlots || {}).map(([lvl, slot]) => (
                                        <div key={lvl} className="char-kv">
                                            <span>Level {lvl} slots</span>
                                            <span className="char-kv-value">{Math.max(0, slot.max - slot.used)}/{slot.max}</span>
                                        </div>
                                    ))}
                                    {character.sustainedSpell && (
                                        <div className="char-sustained">Sustaining: {character.sustainedSpell.name || character.sustainedSpell.key}{character.sustainedSpell.targetName ? ` (on ${character.sustainedSpell.targetName})` : ''}</div>
                                    )}
                                    <div className="char-spell-names">
                                        {knownSpells.map(spell => (
                                            <span key={spell.key} className="char-spell-pill" title={spell.summary}>
                                                {spell.name}{spell.level > 0 ? ` ${spell.level}` : ''}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {character.features?.length > 0 && (
                                <div className="char-section">
                                    <h3 className="char-section-title">Features</h3>
                                    <ul className="char-list">
                                        {character.features.map((feature, i) => <li key={i}>{feature}</li>)}
                                    </ul>
                                </div>
                            )}

                            {character.traits?.length > 0 && (
                                <div className="char-section">
                                    <h3 className="char-section-title">Traits</h3>
                                    <ul className="char-list">
                                        {character.traits.map((trait, i) => <li key={i}>{trait}</li>)}
                                    </ul>
                                </div>
                            )}
                        </div>

                        <div className="char-column">
                            <div className="char-section">
                                <h3 className="char-section-title">Equipped</h3>
                                {equipped.length > 0
                                    ? equipped.map(item => (
                                        <div key={item.id} className="char-kv">
                                            <span>{item.name}</span>
                                            <span className="char-kv-value">
                                                {item.type === 'weapon' ? (item.damage || '') : item.baseAC ? `AC ${item.baseAC}` : item.isShield ? '+2 AC' : ''}
                                            </span>
                                        </div>
                                    ))
                                    : <div className="char-empty">Nothing equipped.</div>}
                            </div>
                            <div className="char-section">
                                <h3 className="char-section-title">Pack ({carried.length})</h3>
                                {carried.length > 0
                                    ? (
                                        <div className="char-pack">
                                            {carried.map(item => (
                                                <span key={item.id} className="char-pack-item">
                                                    {item.name}{(item.quantity || 1) > 1 ? ` ×${item.quantity}` : ''}
                                                </span>
                                            ))}
                                        </div>
                                    )
                                    : <div className="char-empty">The pack is empty.</div>}
                            </div>
                            {character.appearance?.trim() && (
                                <div className="char-section">
                                    <h3 className="char-section-title">Appearance</h3>
                                    <p className="char-appearance">{character.appearance.trim()}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
