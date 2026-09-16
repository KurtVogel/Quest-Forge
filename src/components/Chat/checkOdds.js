/**
 * The odds on the card (WOW 2026-09-16, checks-and-consequence): the pure text
 * form of the line under a proposed roll's title — the hero's real modifier,
 * its source, the DC, and the engine-computed success chance, with the
 * advantage/disadvantage the conditions and the ruling grant folded in. Zero
 * LLM, zero state: the numbers `resolvePlayerRoll` would print one click
 * later, shown BEFORE the choice to roll, challenge, or change approach
 * (Disco Elysium's percentage). `CheckOddsLine.jsx` renders it.
 */
import { describeCheckOdds, formatModifier } from '../../engine/rules.js';
import { ABILITY_SHORT, SKILL_LABELS } from '../../engine/characterUtils.js';

const SOURCE_TEXT = {
    expertise: 'expertise',
    proficient: 'proficient',
    weapon: 'weapon',
    untrained: 'untrained',
};

function checkLabel(odds, roll) {
    if (odds.kind === 'save' && odds.ability) return `${ABILITY_SHORT[odds.ability] || odds.ability} save`;
    if (SKILL_LABELS[odds.key]) return SKILL_LABELS[odds.key];
    if (odds.kind === 'attack') return 'Attack';
    if (odds.ability) return `${ABILITY_SHORT[odds.ability] || odds.ability} check`;
    const raw = typeof roll?.skill === 'string' ? roll.skill.trim() : '';
    return raw ? `${raw.charAt(0).toUpperCase()}${raw.slice(1)}` : 'Check';
}

function sourceText(odds) {
    if (SOURCE_TEXT[odds.source]) return SOURCE_TEXT[odds.source];
    // A plain ability contribution (no proficiency): name the ability instead.
    if (odds.ability) return ABILITY_SHORT[odds.ability] || odds.ability;
    return 'untrained';
}

const pct = value => `${Math.round(value * 100)}%`;

/**
 * e.g. `Stealth +7 (proficient) · DC 12 · 80% — advantage: 96%`.
 * Returns '' for a roll the odds helper declines.
 */
export function formatCheckOddsLine(character, inventory, roll) {
    const odds = describeCheckOdds(character, inventory, roll);
    if (!odds) return '';
    const head = `${checkLabel(odds, roll)} ${formatModifier(odds.modifier)} (${sourceText(odds)}) · DC ${odds.dc} · ${pct(odds.flatChance)}`;
    if (odds.advantage) return `${head} — advantage: ${pct(odds.chance)}`;
    if (odds.disadvantage) return `${head} — disadvantage: ${pct(odds.chance)}`;
    if (odds.conditionSources.length) return `${head} — ${odds.conditionSources.join(', ').toLowerCase()} cancelled out`;
    return head;
}
