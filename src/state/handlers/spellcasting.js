/**
 * Out-of-combat spellcasting (DM-emitted spell_cast): validation, slot
 * spending, engine-rolled effects, and the spell replay guard.
 */
import { computeACFromInventory } from '../../engine/rules.js';
import { describeHeroCannotAct } from '../../engine/combatPredicates.js';
import { rollNotation } from '../../engine/dice.ts';
import {
    buildSustainedSpell,
    chooseSlotLevel,
    describeRecipientClamp,
    describeSlotChoice,
    resolveSpellForCharacter,
    resolveSpellRecipients,
    spellHealingNotation,
    spendSpellSlot,
    spellTargetLimit,
    summarizeSpellSlots,
} from '../../engine/spellcasting.js';
import { findExactSourceReplay, findNearbyReplayEntry, rememberLedgerEntry } from '../../engine/replayLedger.js';
import { repeatCard, repeatContext } from './ledger.js';
import { isPromptRosterNpc, isRecordedDead, namesMatch } from '../../engine/npcRoster.js';
import {
    appendRollHistory,
    clearSustainedSpellState,
    companionStatus,
    currentMessageIndex,
    describeFaces,
    healHero,
    normalizeCompanion,
    RECENT_SPELL_CAST_LIMIT,
    systemMessage,
    withCondition,
} from './shared.js';

// Spell replay window matches the coin-grant one: the observed failure is the DM
// re-emitting spell_cast on the very next turn while narrating what the spell did.
const RECENT_SPELL_CAST_MESSAGE_WINDOW = 4;

/**
 * The identity of a cast's RECIPIENTS for the replay ledger (2026-10-20
 * spellcasting P1): the ledger used to key on the spell alone, so "Cure
 * Wounds → Jorun" on one turn made "Cure Wounds → Mika" on the next a replay —
 * dropped silently, no slot spent, Mika still bleeding. A second cast may
 * legitimately differ in WHO it lands on, so the recipient set is part of the
 * key; the same spell re-emitted on the same people inside the window is still
 * the DM narrating the aftermath. `|` is the ledger's own separator and is
 * stripped from a name; recipients sort so the order the DM named them in
 * never makes two keys of one cast.
 */
function recipientIdentity(recipients) {
    return recipients.map(r => r.type === 'companion'
        ? `c:${r.companion.id}`
        : (r.type === 'other' ? `o:${String(r.name || '').toLowerCase().replace(/\|/g, '')}` : 'self'))
        .sort()
        .join('+');
}

function describeRecipients(recipients, character) {
    return recipients.map(r => r.type === 'companion' ? r.companion.name : (r.type === 'other' ? r.name : (character.name || 'the hero'))).join(', ');
}

// Every line CAST_SPELL posts is a receipt the DM must see (2026-09-25
// spellcasting Lap-3 P2): the success line carries the healing the DM narrates
// around and the slots left, and each rejection ("no level N+ slot remains",
// not on the list, combat-only, an incapacitated caster, no valid recipient)
// is the one signal that the cure the DM already narrated did NOT happen.
// Without `dmVisible` buildMessageWindow dropped all of them (measured), so a
// refused cast left fiction and sheet disagreeing until the next HP line and a
// re-emission failed again the same way, silently. The coin lane's rejections
// are receipts for exactly this reason (2026-08-31).
function spellLine(content) {
    return systemMessage(content, { dmVisible: true });
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
            return { ...state, messages: [...state.messages, spellLine('Combat spells are cast through the combat exchange — the spell_cast event is ignored during a fight.')] };
        }
        const spell = resolveSpellForCharacter(character, payload.spell);
        if (!spell) {
            return { ...state, messages: [...state.messages, spellLine(`"${String(payload.spell || '').slice(0, 60)}" is not on ${character.name || 'the hero'}'s engine-owned spell list — nothing was spent or applied.`)] };
        }
        if (!spell.outOfCombatAvailable) {
            return { ...state, messages: [...state.messages, spellLine(`${spell.name} only has a combat effect; outside battle no slot was spent.`)] };
        }
        // The caster's own state is gated (2026-09-04 audit P1): a DM narrating
        // a "gasped prayer" and emitting spell_cast out of combat used to
        // self-revive a dying cleric and erase the death-save clock. THE actor
        // gate is the 10-18 shelf shared with the check lane and the exchange
        // (2026-10-20 P2: a private copy here called a STABLE or DEFEATED hero
        // "at 0 HP and dying"). The out-of-combat rescue is a companion-
        // administered potion (USE_ITEM).
        const incapacity = describeHeroCannotAct(character);
        if (incapacity) {
            return { ...state, messages: [...state.messages, spellLine(`${incapacity.text} and cannot cast ${spell.name} — an unconscious caster has no voice for it. Nothing was spent; a companion's healing potion is the rescue outside combat.`)] };
        }

        // Recipients: the hero by default, or named living companions. upTo3
        // ally spells (Mass Healing Word / Mass Cure Wounds) accept a `targets`
        // list of up to 3 allies — the combat resolver's per-ally loop finally
        // has an out-of-combat parallel; a promised group heal used to be
        // mechanically impossible outside a fight (2026-08-29 audit P1). THE
        // ladder is the exchange's own since 2026-10-08 (resolveSpellRecipients):
        // a self-only spell lands on the caster whatever was named, a dead
        // companion is never a recipient, dedupe then the spell's cap. Resolved
        // BEFORE the ledger since 2026-10-20: the recipients are part of the key.
        const targetRefs = Array.isArray(payload.targets) && payload.targets.length > 0
            ? payload.targets
            : [payload.target];
        const resolved = resolveSpellRecipients(spell, character, state.party, targetRefs);
        let { recipients, invalid: invalidRefs } = resolved;
        let { overflow } = resolved;
        const { redirected } = resolved;
        // A heal on a living PERSON of the roster outside the party (2026-10-31,
        // the Opus playtest: Cure Wounds on the fevered Sister Ottilie was
        // refused, no slot spent, and the DM narrated the cure — free magic).
        // The cast happens: the slot is spent, no hit points are tracked for
        // them, and the DM narrates the effect. Never the dead, never a name
        // the roster does not know.
        if (recipients.length === 0 && spell.healing) {
            // One record, one recipient, then the spell's own cap (2026-11-04
            // spellcasting P2): "Ottilie" and "Sister Ottilie" are one person,
            // and Cure Wounds heals ONE — the party lane's ladder already did
            // both; this lane healed every name it was handed.
            const people = [];
            for (const ref of invalidRefs) {
                const npc = (state.npcs || []).find(entry => entry?.name && isPromptRosterNpc(entry) && !isRecordedDead(entry) && namesMatch(entry.name, ref));
                if (npc && !people.includes(npc)) people.push(npc);
            }
            if (people.length > 0) {
                const limit = spellTargetLimit(spell);
                overflow += Math.max(0, people.length - limit);
                recipients = people.slice(0, limit).map(npc => ({ type: 'other', name: npc.name }));
                invalidRefs = invalidRefs.filter(ref => !people.some(npc => namesMatch(npc.name, ref)));
            }
        }
        if (recipients.length === 0) {
            return { ...state, messages: [...state.messages, spellLine(`${spell.name} has no valid recipient "${invalidRefs.join('", "')}" — nothing was spent or applied.`)] };
        }
        const clampNote = describeRecipientClamp(spell, { overflow, redirected });

        const meta = payload._meta || {};
        const sourceId = String(meta.sourceId || '').slice(0, 160);
        const ledgerKey = `${spell.key}@${recipientIdentity(recipients)}`;
        const castKey = sourceId ? `${sourceId}|${ledgerKey}` : null;
        const recentCasts = state.recentSpellCasts || [];
        const recipientNames = describeRecipients(recipients, character);
        // Both replay exits are RECEIPTS (2026-10-20 P1): the DM's window
        // carried nothing from a suppressed cast, so it narrated a heal that
        // never landed and no lane could tell it the slot was not spent.
        if (findExactSourceReplay(recentCasts, castKey)) {
            return { ...state, messages: [...state.messages, spellLine(`${spell.name} on ${recipientNames} was already applied from this same response — not cast again, no second slot spent.`)] };
        }
        // Cross-message replay: the DM re-emitting the same spell on the same
        // recipients on a later turn (narrating the aftermath of a cast it
        // already declared) must not spend a second slot. Whether a nearby
        // same-cast is a NEW cast was the player's phrasing's to say ("again",
        // the spell by name) until lane 11 (2026-11-08): now the engine
        // spends nothing and asks the repeat judge on a card, which reads
        // both turns; "new" casts exactly this spell on the judge lane, which
        // is never second-guessed here. Windows measure conversational
        // distance, not raw index: a dice turn burns ~5 raw messages and
        // silently expired the raw-index coin windows (proven live
        // 2026-07-22) — the same hole existed here until 2026-07-30.
        const castMessageIndex = currentMessageIndex(state);
        const decided = meta.lane === 'judge' || meta.lane === 'player';
        const nearbyReplay = decided ? null : findNearbyReplayEntry(recentCasts, {
            key: ledgerKey,
            messages: state.messages,
            currentIndex: castMessageIndex,
            window: RECENT_SPELL_CAST_MESSAGE_WINDOW,
        });
        if (nearbyReplay) {
            const line = `${spell.name} on ${recipientNames} was NOT cast again — the engine read this as the cast from a few turns ago re-emitted; no slot spent, no effect applied.`;
            const requested = payload.slotLevel ?? payload.slot_level;
            const card = repeatCard(state, repeatContext(meta), { sourceId: nearbyReplay.sourceId }, line, {
                type: 'CAST_SPELL',
                payload: {
                    spell: String(payload.spell || ''),
                    ...(typeof payload.target === 'string' && payload.target && { target: payload.target }),
                    ...(Array.isArray(payload.targets) && payload.targets.length > 0 && { targets: payload.targets }),
                    ...(Number.isFinite(Number(requested)) && requested !== null && requested !== undefined && { slotLevel: Number(requested) }),
                },
            }, { earlier: `the hero cast ${spell.name} on ${recipientNames}` });
            return { ...state, messages: [...state.messages, card || spellLine(line)] };
        }

        let spellSlots = character.spellSlots || null;
        let slotLevel = 0;
        const requestedLevel = payload.slotLevel ?? payload.slot_level;
        if (spell.level > 0) {
            slotLevel = chooseSlotLevel(spellSlots, spell, requestedLevel);
            if (slotLevel === null) {
                return { ...state, messages: [...state.messages, spellLine(`${spell.name} fails — no level ${spell.level}+ spell slot remains. Rest to recover slots.`)] };
            }
            spellSlots = spendSpellSlot(spellSlots, slotLevel);
        }
        // The dead-hero heal guard that lived here (2026-08-29) is subsumed by
        // casterIncapacity above: a dead or dying hero never reaches this point,
        // so a self-heal can never mint a currentHP>0 corpse state.
        // Single-target branches below (cleanse/sustain/stabilize) keep their
        // one-recipient semantics; only the healing branch loops recipients.
        const companion = recipients[0].type === 'companion' ? recipients[0].companion : null;

        let nextCharacter = { ...character, ...(spell.level > 0 && { spellSlots }) };
        let nextParty = state.party || [];
        // An out-of-combat heal rolls hero dice — they enter the ledger like a
        // potion's (the membership rule in appendRollHistory, 2026-10-04).
        const healingRolls = [];
        const lines = [`**${character.name || 'The hero'} casts ${spell.name}**${describeSlotChoice(spell, slotLevel, requestedLevel)}${spell.level > 0 ? ` (slots left: ${summarizeSpellSlots(spellSlots)})` : ''}.`];
        if (clampNote) lines.push(clampNote);

        if (spell.healing) {
            // One roll per recipient — the combat resolver's per-ally pattern.
            for (const recipient of recipients) {
                if (recipient.type === 'other') {
                    lines.push(`${recipient.name} is healed — the engine keeps no hit points for them; the DM narrates the cure.`);
                    continue;
                }
                const roll = rollNotation(spellHealingNotation(spell, character, slotLevel), spell.name);
                healingRolls.push(roll);
                if (recipient.type === 'companion') {
                    const target = recipient.companion;
                    const maxHp = target.maxHp || target.hp || 1;
                    const priorHp = nextParty.find(c => c.id === target.id)?.hp ?? target.hp ?? 0;
                    const hp = Math.min(maxHp, priorHp + roll.total);
                    nextParty = nextParty.map(c => c.id === target.id
                        ? normalizeCompanion({ hp, status: companionStatus(hp, maxHp) }, c)
                        : c);
                    lines.push(`${target.name} recovers **${roll.total}** HP (now ${hp}/${maxHp}). Rolled: ${describeFaces(roll)}.`);
                } else {
                    const { healed, gained, character: healedHero } = healHero(nextCharacter, roll.total);
                    nextCharacter = healedHero;
                    lines.push(`${character.name || 'The hero'} recovers **${gained}** HP (now ${healed}/${character.maxHP}). Rolled: ${describeFaces(roll)}.`);
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
            nextCharacter = { ...nextCharacter, sustainedSpell: buildSustainedSpell(spell, companion) };
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
            const first = recipients[0];
            const spared = first.type === 'companion' ? first.companion.name : (first.type === 'other' ? first.name : 'the dying creature');
            lines.push(`${spared} is kept from death's door — no HP restored; the DM narrates who was spared.`);
        } else {
            lines.push('The magic takes hold — the DM narrates what it reveals, opens, or aids.');
        }

        return {
            ...state,
            character: nextCharacter,
            party: nextParty,
            ...(healingRolls.length > 0 && { rollHistory: appendRollHistory(state, healingRolls) }),
            ...(castKey && {
                recentSpellCasts: rememberLedgerEntry(recentCasts, {
                    sourceId,
                    key: ledgerKey,
                    messageIndex: castMessageIndex,
                    cap: RECENT_SPELL_CAST_LIMIT,
                }),
            }),
            messages: [...state.messages, spellLine(lines.join(' '))],
        };
    },
};
