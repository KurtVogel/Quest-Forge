import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { getModifier, formatModifier, getProficiencyBonus, getAllSkills, SKILL_ABILITIES } from '../../engine/rules.js';
import { ABILITY_NAMES, ABILITY_SHORT, SKILL_LABELS } from '../../engine/characterUtils.js';
import { downloadCharacterExport } from '../../engine/characterVault.js';
import { saveRosterCharacter } from '../../state/persistence.js';
import { getExperienceThreshold, isMaxLevel } from '../../engine/progression.js';
import { generatePortraitImage } from '../../llm/providers/imageGen.js';
import { RACES } from '../../data/races.js';
import { CLASSES } from '../../data/classes.js';
import { getKnownSpells, getSpellAttackBonus, getSpellSaveDC, isSpellcaster } from '../../engine/spellcasting.js';
import CharacterScreen from './CharacterScreen.jsx';
import './CharacterSheet.css';

function buildPortraitPrompt(character, appearance, equippedItems = []) {
    const gear = equippedItems.length > 0 ? ` Wearing/carrying: ${equippedItems.join(', ')}.` : '';
    return [
        `Waist-up character portrait of ${character.name}, a ${character.race} ${character.class}.`,
        appearance,
        gear,
        'Adult low-fantasy tabletop RPG portrait, grounded and believable, expressive face, sharp eyes, practical clothing and gear, moody painterly realism, dark neutral background, soft rim light, no text, no frame.',
    ].filter(Boolean).join(' ');
}

export default function CharacterSheet() {
    const { state, dispatch } = useGame();
    const { character } = state;
    const [isExpanded, setIsExpanded] = useState(false);
    const [showSkills, setShowSkills] = useState(false);
    const [showSpells, setShowSpells] = useState(false);
    const [showFullScreen, setShowFullScreen] = useState(false);
    const [portraitDraft, setPortraitDraft] = useState('');
    const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false);
    const [portraitError, setPortraitError] = useState('');
    const [asiDraft, setAsiDraft] = useState({});
    const characterId = character?.id;
    const characterAppearance = character?.appearance || '';

    useEffect(() => {
        if (characterId) setPortraitDraft(characterAppearance);
    }, [characterId, characterAppearance]);

    useEffect(() => {
        setAsiDraft({});
    }, [characterId, character?.pendingAbilityScoreImprovements]);

    const equippedItems = useMemo(() => (state.inventory || [])
        .filter(i => i.equipped && i.name)
        .map(i => i.name), [state.inventory]);
    const confirmedAppearance = characterAppearance.trim();
    const hasConfirmedLook = !!portraitDraft.trim() && portraitDraft.trim() === confirmedAppearance;

    if (!character) return null;

    const race = RACES[character.race];
    const charClass = CLASSES[character.class];
    const hpPercent = Math.round((character.currentHP / character.maxHP) * 100);

    const exp = character.exp || 0;
    const maxLevel = isMaxLevel(character.level);
    const expThreshold = getExperienceThreshold(character.level);
    const expPercent = maxLevel ? 100 : Math.min(100, Math.round((exp / expThreshold) * 100));

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

    // Spellcasting (wizard/cleric)
    const caster = isSpellcaster(character.class);
    const spellSlots = caster ? (character.spellSlots || {}) : {};
    const knownSpells = caster ? getKnownSpells(character) : [];
    const spellsByLevel = knownSpells.reduce((acc, spell) => {
        (acc[spell.level] = acc[spell.level] || []).push(spell);
        return acc;
    }, {});

    // Hit dice
    const hitDice = character.hitDice || { total: character.level, remaining: character.level, die: charClass?.hitDie || 8 };
    const currentCombatant = state.combat?.turnOrder?.[state.combat?.currentTurn];
    const isPlayerCombatTurn = !!state.combat?.active && currentCombatant?.type === 'player';
    const bonusActionUsed = !!state.combat?.active && !!state.combat?.bonusActionUsed;
    const portraitPrompt = buildPortraitPrompt(character, portraitDraft.trim(), equippedItems);
    const pendingAsi = character.pendingAbilityScoreImprovements || 0;
    const asiUsed = Object.values(asiDraft).reduce((sum, value) => sum + value, 0);
    const asiRemaining = Math.max(0, 2 - asiUsed);

    const handleSaveToRoster = async () => {
        try {
            await saveRosterCharacter(character, state.inventory);
            dispatch({
                type: 'ADD_MESSAGE',
                payload: {
                    role: 'system',
                    content: `**${character.name}** (Level ${character.level}) saved to the character roster.`,
                },
            });
        } catch (e) {
            console.warn('Failed to save hero to roster:', e);
        }
    };

    const handleExportHero = () => {
        downloadCharacterExport(character, state.inventory);
    };

    const handleConfirmLook = () => {
        const appearance = portraitDraft.trim();
        if (!appearance) return;
        setPortraitError('');
        dispatch({ type: 'UPDATE_CHARACTER', payload: { appearance } });
    };

    const handleGeneratePortrait = async () => {
        const appearance = portraitDraft.trim();
        if (!appearance) {
            setPortraitError('Appearance is required.');
            return;
        }
        if (appearance !== (character.appearance || '').trim()) {
            setPortraitError('Confirm the look first.');
            return;
        }

        setIsGeneratingPortrait(true);
        setPortraitError('');
        try {
            const portraitUrl = await generatePortraitImage(portraitPrompt, state.settings.imageApiKey);
            if (!portraitUrl) throw new Error('No portrait returned.');
            dispatch({
                type: 'UPDATE_CHARACTER',
                payload: {
                    appearance,
                    portraitUrl,
                    portraitPrompt,
                    portraitUpdatedAt: Date.now(),
                },
            });
        } catch (e) {
            setPortraitError(e.message || 'Portrait failed.');
        } finally {
            setIsGeneratingPortrait(false);
        }
    };

    const adjustAsiDraft = (ability, delta) => {
        setAsiDraft(prev => {
            const current = prev[ability] || 0;
            const nextValue = current + delta;
            if (nextValue < 0 || nextValue > 2) return prev;
            if (delta > 0 && Object.values(prev).reduce((sum, value) => sum + value, 0) >= 2) return prev;
            if (delta > 0 && (character.abilityScores[ability] || 0) + current >= 20) return prev;
            const next = { ...prev };
            if (nextValue === 0) delete next[ability];
            else next[ability] = nextValue;
            return next;
        });
    };

    const handleApplyAsi = () => {
        if (asiUsed !== 2) return;
        dispatch({ type: 'APPLY_ABILITY_SCORE_IMPROVEMENT', payload: { increases: asiDraft } });
        setAsiDraft({});
    };

    return (
        <div className="character-sheet">
            <div className="cs-header-row">
                <button
                    className="cs-dropdown-btn"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <span className="cs-dropdown-title">Character Profile</span>
                    {pendingAsi > 0 && <span className="cs-dropdown-badge">ASI</span>}
                    <span className="cs-dropdown-icon">{isExpanded ? '▲' : '▼'}</span>
                </button>
                <button
                    className="cs-fullscreen-btn"
                    onClick={() => setShowFullScreen(true)}
                    title="Open the full character screen"
                >
                    ⛶
                </button>
            </div>
            <CharacterScreen
                character={character}
                inventory={state.inventory}
                isOpen={showFullScreen}
                onClose={() => setShowFullScreen(false)}
            />

            {isExpanded && (
                <div className="cs-expanded-content">
                    <div className="cs-header">
                        {character.portraitUrl && (
                            <img
                                className="cs-portrait"
                                src={character.portraitUrl}
                                alt={`${character.name} portrait`}
                            />
                        )}
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
                            <span className="cs-exp-numbers">{maxLevel ? `${exp} XP · Max level` : `${exp} / ${expThreshold} XP`}</span>
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
                                <span key={i} className="cs-condition-badge">{c}</span>
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

                    {pendingAsi > 0 && (
                        <div className="cs-section cs-asi-section">
                            <h4 className="cs-section-title">Ability Score Improvement</h4>
                            <div className="cs-asi-grid">
                                {ABILITY_NAMES.map(ability => {
                                    const draft = asiDraft[ability] || 0;
                                    const score = character.abilityScores[ability];
                                    const canAdd = asiRemaining > 0 && draft < 2 && score + draft < 20;
                                    return (
                                        <div key={ability} className="cs-asi-row">
                                            <span className="cs-asi-name">{ABILITY_SHORT[ability]}</span>
                                            <span className="cs-asi-score">{score + draft}</span>
                                            <div className="cs-asi-controls">
                                                <button
                                                    className="cs-asi-btn"
                                                    onClick={() => adjustAsiDraft(ability, -1)}
                                                    disabled={draft <= 0}
                                                    title={`Remove ${ABILITY_SHORT[ability]} increase`}
                                                >
                                                    -
                                                </button>
                                                <span className="cs-asi-draft">{draft ? `+${draft}` : ''}</span>
                                                <button
                                                    className="cs-asi-btn"
                                                    onClick={() => adjustAsiDraft(ability, 1)}
                                                    disabled={!canAdd}
                                                    title={`Increase ${ABILITY_SHORT[ability]}`}
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="cs-asi-footer">
                                <span>{asiUsed}/2 points selected · {pendingAsi} improvement{pendingAsi > 1 ? 's' : ''} pending</span>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={handleApplyAsi}
                                    disabled={asiUsed !== 2}
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="cs-section cs-portrait-section">
                        <h4 className="cs-section-title">Portrait</h4>
                        <textarea
                            className="cs-portrait-appearance"
                            value={portraitDraft}
                            onChange={(e) => setPortraitDraft(e.target.value)}
                            placeholder="Face, hair, build, skin tone, clothing, scars, symbols, mood..."
                            rows={4}
                        />
                        <div className="cs-portrait-actions">
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={handleConfirmLook}
                                disabled={!portraitDraft.trim() || isGeneratingPortrait}
                            >
                                {hasConfirmedLook ? 'Look Confirmed' : 'Confirm Look'}
                            </button>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={handleGeneratePortrait}
                                disabled={!hasConfirmedLook || isGeneratingPortrait}
                            >
                                {isGeneratingPortrait ? 'Painting...' : (character.portraitUrl ? 'Regenerate' : 'Generate')}
                            </button>
                        </div>
                        {portraitError && <div className="cs-portrait-error">{portraitError}</div>}
                    </div>

                    {/* Class Resources */}
                    {activeResources.length > 0 && (
                        <div className="cs-section">
                            <h4 className="cs-section-title">Resources</h4>
                            <div className="cs-resources">
                                {activeResources.map(([key, def]) => {
                                    const res = classResources[key];
                                    const available = res.max - res.used;
                                    const isBonusAction = def.actionType === 'bonus';
                                    const bonusActionBlocked = isBonusAction && state.combat?.active && (!isPlayerCombatTurn || bonusActionUsed);
                                    const disabledReason = available <= 0
                                        ? `${def.label} spent — rest to recharge`
                                        : bonusActionBlocked
                                            ? (!isPlayerCombatTurn ? `${def.label} is a bonus action on your turn` : 'Bonus action already used this turn')
                                            : `Use ${def.label}`;
                                    return (
                                        <div key={key} className="cs-resource-row">
                                            <span className="cs-resource-name">
                                                {def.label}
                                                {isBonusAction && <span className="cs-resource-tag">Bonus</span>}
                                            </span>
                                            <span className="cs-resource-pips">
                                                {Array.from({ length: res.max }, (_, i) => (
                                                    <span key={i} className={`cs-pip ${i < available ? 'available' : 'spent'}`} />
                                                ))}
                                            </span>
                                            <span className="cs-resource-reset">{def.resetOn} rest</span>
                                            <button
                                                className="cs-resource-use"
                                                onClick={() => dispatch({ type: 'ACTIVATE_RESOURCE', payload: key })}
                                                disabled={available <= 0 || bonusActionBlocked}
                                                title={disabledReason}
                                            >
                                                Use
                                            </button>
                                        </div>
                                    );
                                })}
                                {state.combat?.active && (
                                    <div className={`cs-bonus-action ${bonusActionUsed ? 'spent' : 'available'}`}>
                                        Bonus action: {bonusActionUsed ? 'used this turn' : (isPlayerCombatTurn ? 'available' : 'waiting for your turn')}
                                    </div>
                                )}
                                <div className="cs-resource-row">
                                    <span className="cs-resource-name">Hit Dice (d{hitDice.die})</span>
                                    <span className="cs-resource-count">{hitDice.remaining}/{hitDice.total}</span>
                                    <span className="cs-resource-reset">short rest</span>
                                </div>
                                <div className="cs-rest-actions" aria-label="Rest actions">
                                    <button
                                        className="cs-rest-btn"
                                        onClick={() => dispatch({ type: 'TAKE_REST', payload: 'short', meta: { narrate: true } })}
                                        disabled={character.isDead}
                                        title={character.isDead ? 'Dead characters cannot recover by resting' : 'Take a short rest: spend hit dice and recharge short-rest resources'}
                                    >
                                        Short Rest
                                    </button>
                                    <button
                                        className="cs-rest-btn"
                                        onClick={() => dispatch({ type: 'TAKE_REST', payload: 'long', meta: { narrate: true } })}
                                        disabled={character.isDead}
                                        title={character.isDead ? 'Dead characters cannot recover by resting' : 'Take a long rest: restore HP, recover hit dice, and recharge resources'}
                                    >
                                        Long Rest
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Spellcasting (wizard/cleric) */}
                    {caster && (
                        <div className="cs-section">
                            <h4 className="cs-section-title">Spellcasting</h4>
                            <div className="cs-resources">
                                <div className="cs-spell-meta">
                                    Save DC {getSpellSaveDC(character)} · Spell attack {formatModifier(getSpellAttackBonus(character))}
                                    {character.sustainedSpell && (
                                        <span className="cs-sustained"> · Sustaining: {character.sustainedSpell.name || character.sustainedSpell.key}{character.sustainedSpell.targetName ? ` (on ${character.sustainedSpell.targetName})` : ''}</span>
                                    )}
                                </div>
                                {Object.entries(spellSlots).map(([lvl, slot]) => (
                                    <div key={lvl} className="cs-resource-row">
                                        <span className="cs-resource-name">Level {lvl} slots</span>
                                        <span className="cs-resource-pips">
                                            {Array.from({ length: slot.max }, (_, i) => (
                                                <span key={i} className={`cs-pip ${i < slot.max - slot.used ? 'available' : 'spent'}`} />
                                            ))}
                                        </span>
                                        <span className="cs-resource-reset">long rest</span>
                                    </div>
                                ))}
                                <button className="cs-skills-toggle" onClick={() => setShowSpells(!showSpells)}>
                                    <span className="cs-resource-name" style={{ margin: 0 }}>Known spells ({knownSpells.length})</span>
                                    <span className="cs-dropdown-icon">{showSpells ? '▲' : '▼'}</span>
                                </button>
                                {showSpells && (
                                    <div className="cs-spell-list">
                                        {Object.entries(spellsByLevel).map(([lvl, spells]) => (
                                            <div key={lvl} className="cs-spell-group">
                                                <div className="cs-spell-group-title">{lvl === '0' ? 'Cantrips (at will)' : `Level ${lvl}`}</div>
                                                {spells.map(spell => (
                                                    <div key={spell.key} className="cs-spell-row" title={spell.summary}>
                                                        <span className="cs-spell-name">
                                                            {spell.name}
                                                            {spell.castTime === 'bonus' && <span className="cs-resource-tag">Bonus</span>}
                                                        </span>
                                                        <span className="cs-spell-summary">{spell.summary}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                        <div className="cs-spell-hint">Cast by saying so in the story — the engine owns slots, dice, and effects.</div>
                                    </div>
                                )}
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
                                    <li key={i}>
                                        {feature === 'Fighting Style' && character.class === 'fighter' && character.fightingStyle
                                            ? `Fighting Style: ${CLASSES.fighter.fightingStyles[character.fightingStyle]?.label || character.fightingStyle}`
                                            : feature === 'Martial Archetype' && character.class === 'fighter' && character.martialArchetype
                                                ? `Martial Archetype: ${CLASSES.fighter.martialArchetypes[character.martialArchetype]?.label || character.martialArchetype}`
                                                : feature}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="cs-section cs-hero-actions">
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={handleSaveToRoster}
                            title="Snapshot this hero (with gear) to the local roster for reuse in future adventures"
                        >
                            Save to Roster
                        </button>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={handleExportHero}
                            title="Download this hero as a JSON file — share it or move it to another device"
                        >
                            Export File
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
