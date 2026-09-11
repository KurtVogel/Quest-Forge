/**
 * THE portrait style line, shared by every portrait prompt in the app —
 * the hero portrait (Character Profile + creation reveal), NPC portraits,
 * and SceneArt's focused-portrait mode (2026-08-20 audit P2: SceneArt carried
 * a drifted hand copy). A stated gender always rides beside the name as a
 * "(woman)"/"(man)" tag — the exact token the art director's inviolable-gender
 * rule keys on (DECISIONS.md 2026-07-25); the hero prompt used a bare prefix
 * that convention never covered.
 */
import { classDisplayName, raceDisplayName } from '../../engine/characterUtils.js';
import { buildIdentityLockLine, IDENTITY_LOCK_REMINDER } from '../../engine/appearanceIdentity.js';

export const PORTRAIT_STYLE = 'Adult low-fantasy tabletop RPG portrait, grounded and believable, expressive face, sharp eyes, practical clothing and gear, moody painterly realism, dark neutral background, soft rim light, no text, no frame.';

export function buildPortraitPrompt(character, appearance, equippedItems = []) {
    const gear = equippedItems.length > 0 ? ` Wearing/carrying: ${equippedItems.join(', ')}.` : '';
    // String-or-empty belt (2026-09-09 audit P1): the sheet computes this at
    // RENDER, so an object gender crashed the whole panel into its boundary.
    const genderText = typeof character.gender === 'string' ? character.gender.trim() : '';
    const gender = genderText ? ` (${genderText})` : '';
    // The identity lock LEADS the prompt (2026-09-12): skin tone, hair state
    // (baldness included), build, and age extracted from the record itself
    // and stated in the least ambiguous wording — image models weight the
    // opening tokens and drift on exactly these features.
    const lock = buildIdentityLockLine(character.name, appearance, { species: raceDisplayName(character), gender: genderText });
    return [
        lock,
        // Display names, never data keys: 'halfOrc' painted as "a halfOrc
        // fighter" under an inviolable-species rule (2026-09-01 P2).
        `Waist-up character portrait of ${character.name}${gender}, a ${raceDisplayName(character)} ${classDisplayName(character)}.`,
        appearance,
        gear,
        PORTRAIT_STYLE,
        lock && IDENTITY_LOCK_REMINDER,
    ].filter(Boolean).join(' ');
}

/**
 * Portrait prompt for a roster NPC, built from Scribe-captured continuity:
 * the registered species and gender ride beside the name ("(goblin woman)" —
 * the same inviolable-identity convention as scene art; without species the
 * painter defaults every figure to human) and the merged appearance
 * record is the likeness. lastNotes gives the painter role context;
 * privateNotes stays private by design.
 */
export function buildNpcPortraitPrompt(npc) {
    const identity = [npc.species, npc.gender].map(v => String(v || '').trim()).filter(Boolean).join(' ');
    const tag = identity ? ` (${identity})` : '';
    const role = String(npc.lastNotes || npc.notes || '').trim();
    const appearance = String(npc.appearance || '').trim();
    // Same identity lock as the hero portrait (2026-09-12): a recorded bald,
    // dark-skinned, statuesque woman was coming back with cornrows or as a
    // pale heavy figure — the record was right, the prose was being drifted.
    const lock = buildIdentityLockLine(npc.name, appearance, { species: npc.species, gender: npc.gender });
    return [
        lock,
        `Waist-up character portrait of ${npc.name}${tag}.`,
        appearance,
        role ? `Context: ${role.slice(0, 200)}` : '',
        PORTRAIT_STYLE,
        lock && IDENTITY_LOCK_REMINDER,
    ].filter(Boolean).join(' ');
}
