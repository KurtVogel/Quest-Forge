/**
 * Out-of-combat spellcasting (DM-emitted spell_cast): validation, slot
 * spending, engine-rolled effects, and the spell replay guard.
 */
import { computeACFromInventory } from '../../engine/rules.js';
import { rollNotation } from '../../engine/dice.ts';
import {
    chooseSlotLevel,
    resolveSpellForCharacter,
    spellHealingNotation,
    spendSpellSlot,
    summarizeSpellSlots,
} from '../../engine/spellcasting.js';
import { findExactSourceReplay, findNearbyReplay, rememberLedgerEntry } from '../../engine/replayLedger.js';
import {
    clearSustainedSpellState,
    companionStatus,
    currentMessageIndex,
    normalizeCompanion,
    normalizeRefToken,
    RECENT_SPELL_CAST_LIMIT,
    REPEAT_TRANSACTION_RE,
    reviveCharacter,
    systemMessage,
    withCondition,
} from './shared.js';

// Spell replay window matches the coin-grant one: the observed failure is the DM
// re-emitting spell_cast on the very next turn while narrating what the spell did.
const RECENT_SPELL_CAST_MESSAGE_WINDOW = 4;

function playerMessageRecastsSpell(spell, playerMessage) {
    const text = String(playerMessage || '').toLowerCase();
    if (!text.trim()) return false;
    const compact = normalizeRefToken(text);
    const tokens = [spell.key, spell.name].map(normalizeRefToken).filter(Boolean);
    if (tokens.some(token => compact.includes(token))) return true;
    const nameWords = String(spell.name || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
    if (nameWords.length > 0 && nameWords.every(word => text.includes(word))) return true;
    // "I cast it again" — explicit repeat intent without naming the spell.
    return REPEAT_TRANSACTION_RE.test(text) && /\b(cast|spell|it|that)\b/i.test(text);
}

export const handlers = {
    CAST_SPELL(state, action) {
        // Out-of-combat casting (DM-emitted spell_cast event). The engine
        // validates the spell, spends the slot, and rolls any dice; active
        // combat casting goes through the combat exchange instead.
        const payload = action.payload || {};
        const character = state.character;
        if (!character) return state;
        if (state.combat?.active) {
            return { ...state, messages: [...state.messages, systemMessage('Combat spells are cast through the combat exchange — the spell_cast event is ignored during a fight.')] };
        }
        const spell = resolveSpellForCharacter(character, payload.spell);
        if (!spell) {
            return { ...state, messages: [...state.messages, systemMessage(`"${String(payload.spell || '').slice(0, 60)}" is not on ${character.name || 'the hero'}'s engine-owned spell list — nothing was spent or applied.`)] };
        }
        if (!spell.outOfCombatAvailable) {
            return { ...state, messages: [...state.messages, systemMessage(`${spell.name} only has a combat effect; outside battle no slot was spent.`)] };
        }
        const meta = payload._meta || {};
        const sourceId = String(meta.sourceId || '').slice(0, 160);
        const castKey = sourceId ? `${sourceId}|${spell.key}` : null;
        const recentCasts = state.recentSpellCasts || [];
        if (findExactSourceReplay(recentCasts, castKey)) return state;
        // Cross-message replay: the DM re-emitting the same spell on a later turn
        // (narrating the aftermath of a cast it already declared) must not spend a
        // second slot. A nearby same-spell cast only counts as new when the player's
        // own message casts it again by name (or an explicit "again"-style repeat).
        // Windows measure conversational distance, not raw index: a dice turn
        // burns ~5 raw messages and silently expired the raw-index coin windows
        // (proven live 2026-07-22) — the same hole existed here until 2026-07-30.
        const castMessageIndex = currentMessageIndex(state);
        const nearbyReplay = findNearbyReplay(recentCasts, {
            key: spell.key,
            messages: state.messages,
            currentIndex: castMessageIndex,
            window: RECENT_SPELL_CAST_MESSAGE_WINDOW,
        });
        if (nearbyReplay && !playerMessageRecastsSpell(spell, meta.playerMessage)) return state;

        let spellSlots = character.spellSlots || null;
        let slotLevel = 0;
        if (spell.level > 0) {
            slotLevel = chooseSlotLevel(spellSlots, spell, payload.slotLevel ?? payload.slot_level);
            if (slotLevel === null) {
                return { ...state, messages: [...state.messages, systemMessage(`${spell.name} fails — no level ${spell.level}+ spell slot remains. Rest to recover slots.`)] };
            }
            spellSlots = spendSpellSlot(spellSlots, slotLevel);
        }

        // Recipient: the hero by default, or a named living companion.
        const targetRef = String(payload.target || '').trim();
        const lcTarget = targetRef.toLowerCase();
        const targetsSelf = !targetRef || ['self', 'me', 'player'].includes(lcTarget)
            || lcTarget === String(character.name || '').toLowerCase();
        const companion = !targetsSelf
            ? (state.party || []).find(c => c.id === targetRef || c.name?.toLowerCase() === lcTarget)
            : null;
        if (!targetsSelf && spell.targeting.side === 'ally' && (!companion || companion.status === 'dead')) {
            return { ...state, messages: [...state.messages, systemMessage(`${spell.name} has no valid recipient "${targetRef}" — nothing was spent or applied.`)] };
        }

        let nextCharacter = { ...character, ...(spell.level > 0 && { spellSlots }) };
        let nextParty = state.party || [];
        const lines = [`**${character.name || 'The hero'} casts ${spell.name}**${slotLevel > spell.level ? ` using a level ${slotLevel} slot` : ''}${spell.level > 0 ? ` (slots left: ${summarizeSpellSlots(spellSlots)})` : ''}.`];

        if (spell.healing) {
            const roll = rollNotation(spellHealingNotation(spell, character, slotLevel), spell.name);
            if (companion) {
                const maxHp = companion.maxHp || companion.hp || 1;
                const hp = Math.min(maxHp, (companion.hp || 0) + roll.total);
                nextParty = nextParty.map(c => c.id === companion.id
                    ? normalizeCompanion({ hp, status: companionStatus(hp, maxHp) }, c)
                    : c);
                lines.push(`${companion.name} recovers **${roll.total}** HP (now ${hp}/${maxHp}). Rolled: ${roll.rolls.join(', ')}${roll.modifier ? ` (+${roll.modifier})` : ''}.`);
            } else {
                const healed = Math.min(character.maxHP, character.currentHP + roll.total);
                const gained = healed - character.currentHP;
                nextCharacter = gained > 0
                    ? reviveCharacter({ ...nextCharacter, currentHP: healed })
                    : nextCharacter;
                lines.push(`${character.name || 'The hero'} recovers **${gained}** HP (now ${healed}/${character.maxHP}). Rolled: ${roll.rolls.join(', ')}${roll.modifier ? ` (+${roll.modifier})` : ''}.`);
            }
        } else if (spell.removeConditions) {
            const matches = condition => spell.removeConditions === 'any'
                || spell.removeConditions.includes(String(condition).toLowerCase());
            if (companion) {
                const removed = (companion.conditions || []).filter(matches);
                nextParty = nextParty.map(c => c.id === companion.id
                    ? { ...c, conditions: (c.conditions || []).filter(condition => !matches(condition)) }
                    : c);
                lines.push(removed.length > 0 ? `${companion.name} is cleansed of: ${removed.join(', ')}.` : `${companion.name} has no affliction the spell can lift.`);
            } else {
                const removed = (character.conditions || []).filter(matches);
                nextCharacter = { ...nextCharacter, conditions: (nextCharacter.conditions || []).filter(condition => !matches(condition)) };
                lines.push(removed.length > 0 ? `${character.name || 'The hero'} is cleansed of: ${removed.join(', ')}.` : 'There is no affliction the spell can lift.');
            }
        } else if (spell.sustained) {
            const released = clearSustainedSpellState(nextCharacter, nextParty, state.inventory);
            nextCharacter = released.character;
            nextParty = released.party;
            const sustained = {
                key: spell.key,
                name: spell.name,
                ...(spell.acBonus && { acBonus: spell.acBonus }),
                ...(spell.condition && { condition: spell.condition }),
                targetType: companion ? 'companion' : 'self',
                ...(companion && { targetId: companion.id, targetName: companion.name }),
            };
            nextCharacter = { ...nextCharacter, sustainedSpell: sustained };
            if (companion) {
                nextParty = nextParty.map(c => {
                    if (c.id !== companion.id) return c;
                    const buffed = { ...c };
                    if (spell.acBonus) buffed.spellAcBonus = spell.acBonus;
                    if (spell.condition) buffed.conditions = [...new Set([...(c.conditions || []), spell.condition])];
                    return buffed;
                });
            } else if (spell.condition) {
                nextCharacter = withCondition(nextCharacter, spell.condition);
            }
            nextCharacter = { ...nextCharacter, armorClass: computeACFromInventory(state.inventory || [], nextCharacter) };
            lines.push(`It settles over ${companion ? companion.name : (character.name || 'the hero')}${spell.acBonus ? ` (+${spell.acBonus} AC)` : ''} and holds until another sustained spell, a rest, or the end of a fight.`);
        } else if (spell.stabilizes) {
            lines.push(`${companion ? companion.name : 'The recipient'} is stabilized if dying — no HP restored.`);
        } else {
            lines.push('The magic takes hold — the DM narrates what it reveals, opens, or aids.');
        }

        return {
            ...state,
            character: nextCharacter,
            party: nextParty,
            ...(castKey && {
                recentSpellCasts: rememberLedgerEntry(recentCasts, {
                    sourceId,
                    key: spell.key,
                    messageIndex: castMessageIndex,
                    cap: RECENT_SPELL_CAST_LIMIT,
                }),
            }),
            messages: [...state.messages, systemMessage(lines.join(' '))],
        };
    },
};
