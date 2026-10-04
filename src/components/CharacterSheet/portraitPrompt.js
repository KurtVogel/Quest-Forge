/**
 * THE portrait style line, shared by every portrait prompt in the app —
 * the hero portrait (Character Profile + creation reveal), NPC portraits,
 * and SceneArt's focused-portrait mode (2026-08-20 audit P2: SceneArt carried
 * a drifted hand copy). A stated gender always rides beside the name as a
 * "(woman)"/"(man)" tag — the exact token the art director's inviolable-gender
 * rule keys on (DECISIONS.md 2026-07-25); the hero prompt used a bare prefix
 * that convention never covered.
 */
import { IDENTITY_LOCK_REMINDER } from '../../engine/appearanceIdentity.js';
import { castNameTag, describeCastMember } from '../../engine/castMember.js';

export const PORTRAIT_STYLE = 'Adult low-fantasy tabletop RPG portrait, grounded and believable, expressive face, sharp eyes, practical clothing and gear, moody painterly realism, dark neutral background, soft rim light, no text, no frame.';

export function buildPortraitPrompt(character, appearance, equippedItems = []) {
    // One cast-member shelf (engine/castMember.js): string-or-empty fields
    // (2026-09-09 audit P1 — the sheet computes this at RENDER, so an object
    // gender crashed the whole panel into its boundary), display names never
    // data keys ('halfOrc' painted as "a halfOrc fighter", 2026-09-01 P2), and
    // the identity lock that LEADS the prompt (2026-09-12): skin tone, hair
    // state, build, and age from the record itself — image models weight the
    // opening tokens and drift on exactly these features.
    const hero = describeCastMember('player', character, { appearance, gear: equippedItems.join(', ') });
    return [
        hero.lock,
        `Waist-up character portrait of ${castNameTag(hero)}, ${hero.role}.`,
        hero.look,
        hero.gear && `Wearing/carrying: ${hero.gear}.`,
        PORTRAIT_STYLE,
        hero.lock && IDENTITY_LOCK_REMINDER,
    ].filter(Boolean).join(' ');
}

/**
 * Portrait prompt for a roster NPC, built from Scribe-captured continuity:
 * the registered species and gender ride beside the name ("(goblin woman)" —
 * the same inviolable-identity convention as scene art; without species the
 * painter defaults every figure to human) and the merged appearance
 * record is the likeness. lastNotes gives the painter role CONTEXT — labeled,
 * never the look; privateNotes stays private by design.
 */
export function buildNpcPortraitPrompt(npc) {
    const figure = describeCastMember('npc', npc);
    return [
        figure.lock,
        `Waist-up character portrait of ${castNameTag(figure)}.`,
        figure.look,
        figure.context && `Context: ${figure.context}`,
        PORTRAIT_STYLE,
        figure.lock && IDENTITY_LOCK_REMINDER,
    ].filter(Boolean).join(' ');
}
