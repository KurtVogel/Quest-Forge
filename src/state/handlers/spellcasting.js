/**
 * Out-of-combat spellcasting (DM-emitted spell_cast): validation, slot
 * spending, engine-rolled effects, and the spell replay guard.
 */
import { computeACFromInventory, getIncapacitatingCondition } from '../../engine/rules.js';
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
    repeatIntentNearNoun,
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
    // The spell must be named as an ORDERED phrase ("cure wounds", "Cure-Wounds"):
    // the compacted-text containment below is ordered and adjacent by
    // construction. The old every-word rung fired on "These wounds will not
    // cure themselves; I bind them with cloth" and spent a second slot
    // (2026-09-04 audit).
    const compact = normalizeRefToken(text);
    const tokens = [spell.key, spell.name].map(normalizeRefToken).filter(Boolean);
    if (tokens.some(token => compact.includes(token))) return true;
    // "I cast it again", "another casting" — explicit repeat intent without
    // naming the spell. Proximity required: a stray repeat word plus a stray
    // pronoun anywhere in the message is not recast intent (2026-08-22).
    if (repeatIntentNearNoun(text, /(?:cast|casting|spell)/)) return true;
    // A bare pronoun ("that again") counts only inside a clause that also
    // casts: "I try that again, the lock is stubborn" is not a recast
    // (2026-09-04 — the quantifier-attaches-to-noun rule reaching this ledger).
    return text.split(/[.!?;]+/).some(clause =>
        /\bcast(?:ing|s)?\b/.test(clause) && repeatIntentNearNoun(clause, /(?:it|that)/));
}

/**
 * Why the CASTER cannot act right now, or null. The combat lane structurally
 * cannot cast from a dying hero (the exchange slot is death_save only), but a
 * DM narrating a "gasped prayer" and emitting spell_cast out of combat used to
 * be accepted whole: a hero at 0 HP with 2/3 death-save failures self-cast
 * Cure Wounds, revived, and erased the clock (2026-09-04 audit P1). The
 * out-of-combat rescue is a companion-administered potion (USE_ITEM).
 */
function casterIncapacity(character) {
    if (character.isDead) return 'is dead';
    if (character.dying || (Number(character.currentHP) || 0) <= 0) return 'is at 0 HP and dying';
    const condition = getIncapacitatingCondition(character.conditions);
    return condition ? `is ${condition}` : null;
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
        const incapacity = casterIncapacity(character);
        if (incapacity) {
            return { ...state, messages: [...state.messages, systemMessage(`${character.name || 'The hero'} ${incapacity} and cannot cast ${spell.name} — an unconscious caster has no voice for it. Nothing was spent; a companion's healing potion is the rescue outside combat.`)] };
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

        // Recipients: the hero by default, or named living companions. upTo3
        // ally spells (Mass Healing Word / Mass Cure Wounds) accept a `targets`
        // list of up to 3 allies — the combat resolver's per-ally loop finally
        // has an out-of-combat parallel; a promised group heal used to be
        // mechanically impossible outside a fight (2026-08-29 audit P1).
        const resolveRecipient = (ref) => {
            const targetRef = String(ref || '').trim();
            const lcTarget = targetRef.toLowerCase();
            const targetsSelf = !targetRef || ['self', 'me', 'player'].includes(lcTarget)
                || lcTarget === String(character.name || '').toLowerCase();
            if (targetsSelf) return { type: 'self' };
            const found = (state.party || []).find(c => c.id === targetRef || c.name?.toLowerCase() === lcTarget);
            if (spell.targeting.side === 'ally' && (!found || found.status === 'dead')) {
                return { type: 'invalid', ref: targetRef };
            }
            return found ? { type: 'companion', companion: found } : { type: 'self' };
        };
        const targetLimit = spell.targeting.mode === 'upTo3' ? 3 : 1;
        const targetRefs = targetLimit > 1 && Array.isArray(payload.targets) && payload.targets.length > 0
            ? payload.targets.slice(0, targetLimit)
            : [payload.target];
        const recipients = [];
        const invalidRefs = [];
        for (const ref of targetRefs) {
            const resolved = resolveRecipient(ref);
            if (resolved.type === 'invalid') {
                invalidRefs.push(resolved.ref);
            } else if (!recipients.some(r => r.type === resolved.type && r.companion?.id === resolved.companion?.id)) {
                recipients.push(resolved);
            }
        }
        if (recipients.length === 0) {
            return { ...state, messages: [...state.messages, systemMessage(`${spell.name} has no valid recipient "${invalidRefs.join('", "')}" — nothing was spent or applied.`)] };
        }
        // The dead-hero heal guard that lived here (2026-08-29) is subsumed by
        // casterIncapacity above: a dead or dying hero never reaches this point,
        // so a self-heal can never mint a currentHP>0 corpse state.
        // Single-target branches below (cleanse/sustain/stabilize) keep their
        // one-recipient semantics; only the healing branch loops recipients.
        const companion = recipients[0].type === 'companion' ? recipients[0].companion : null;

        let nextCharacter = { ...character, ...(spell.level > 0 && { spellSlots }) };
        let nextParty = state.party || [];
        const lines = [`**${character.name || 'The hero'} casts ${spell.name}**${slotLevel > spell.level ? ` using a level ${slotLevel} slot` : ''}${spell.level > 0 ? ` (slots left: ${summarizeSpellSlots(spellSlots)})` : ''}.`];

        if (spell.healing) {
            // One roll per recipient — the combat resolver's per-ally pattern.
            for (const recipient of recipients) {
                const roll = rollNotation(spellHealingNotation(spell, character, slotLevel), spell.name);
                if (recipient.type === 'companion') {
                    const target = recipient.companion;
                    const maxHp = target.maxHp || target.hp || 1;
                    const priorHp = nextParty.find(c => c.id === target.id)?.hp ?? target.hp ?? 0;
                    const hp = Math.min(maxHp, priorHp + roll.total);
                    nextParty = nextParty.map(c => c.id === target.id
                        ? normalizeCompanion({ hp, status: companionStatus(hp, maxHp) }, c)
                        : c);
                    lines.push(`${target.name} recovers **${roll.total}** HP (now ${hp}/${maxHp}). Rolled: ${roll.rolls.join(', ')}${roll.modifier ? ` (+${roll.modifier})` : ''}.`);
                } else {
                    const priorHp = nextCharacter.currentHP;
                    const healed = Math.min(character.maxHP, priorHp + roll.total);
                    const gained = healed - priorHp;
                    nextCharacter = gained > 0
                        ? reviveCharacter({ ...nextCharacter, currentHP: healed })
                        : nextCharacter;
                    lines.push(`${character.name || 'The hero'} recovers **${gained}** HP (now ${healed}/${character.maxHP}). Rolled: ${roll.rolls.join(', ')}${roll.modifier ? ` (+${roll.modifier})` : ''}.`);
                }
            }
            for (const missed of invalidRefs) {
                lines.push(`No valid recipient "${missed}" — that share of the spell is lost.`);
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
            // Narrative cantrip (DECISIONS.md 2026-09-04): the hero cannot cast
            // while dying (gate above) and companions never bleed out ("down but
            // stable"), so the creature it keeps alive is always an NPC in the
            // DM's fiction — no engine clock exists to stop.
            const spared = companion ? companion.name : (String(payload.target || '').trim().slice(0, 60) || 'the dying creature');
            lines.push(`${spared} is kept from death's door — no HP restored; the DM narrates who was spared.`);
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
