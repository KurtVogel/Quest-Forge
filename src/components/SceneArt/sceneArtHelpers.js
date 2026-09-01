/**
 * Pure SceneArt helpers, extracted from the component (the
 * components/Chat/turnVisibility.js pattern — 2026-09-01 scene-art audit) so
 * the prompt text the painter receives and the "current situation" picker
 * are unit-testable without React.
 */
import { classDisplayName, raceDisplayName } from '../../engine/characterUtils.js';
import { findLatestNarration } from '../../llm/narrativeMessages.js';
import { PORTRAIT_STYLE } from '../CharacterSheet/portraitPrompt.js';

export function equippedSummary(inventory = []) {
    return (inventory || [])
        .filter(i => i.equipped)
        .map(i => i.name)
        .filter(Boolean)
        .join(', ');
}

export function describeEntity(target) {
    if (!target) return '';
    if (target.type === 'player') {
        const c = target.entity;
        return [
            `${c.name}${c.gender ? ` (${c.gender})` : ''}, a ${raceDisplayName(c)} ${classDisplayName(c) || 'adventurer'}`.replace(/\s+/g, ' ').trim(),
            c.appearance,
            target.gear && `Wearing/wielding: ${target.gear}.`,
        ].filter(Boolean).join('. ');
    }
    if (target.type === 'companion') {
        const c = target.entity;
        const identity = [c.species, c.gender].filter(Boolean).join(' ');
        return [
            `${c.name}${identity ? ` (${identity})` : ''}, ${c.role || 'companion'}`,
            c.appearance || c.notes,
            c.weapon && `Wielding ${c.weapon}.`,
        ].filter(Boolean).join('. ');
    }
    if (target.type === 'npc') {
        const n = target.entity;
        const identity = [n.species, n.gender].filter(Boolean).join(' ');
        return [
            // The registered species + gender ride right beside the name — the art
            // director's inviolable-identity rule keys on this "(goblin woman)" tag.
            `${n.name}${identity ? ` (${identity})` : ''}, ${n.disposition || 'NPC'}`,
            n.appearance || n.lastNotes || n.notes,
            n.lastLocation && `Last seen at ${n.lastLocation}.`,
        ].filter(Boolean).join('. ');
    }
    if (target.type === 'enemy') {
        const e = target.entity;
        return [
            `${e.name}, hostile combatant`,
            e.condition && `Condition: ${e.condition}.`,
        ].filter(Boolean).join('. ');
    }
    return target.label || '';
}

export function buildFocusedPrompt(target, location) {
    const description = describeEntity(target);
    return [
        `Focused waist-up portrait of ${target.label}.`,
        description,
        location && `Current setting: ${location}.`,
        PORTRAIT_STYLE,
    ].filter(Boolean).join(' ');
}

export function buildCustomPrompt(subject, location, character) {
    return [
        subject,
        location && `Set in or near ${location}.`,
        character?.appearance && `Keep ${character.name}'s established look consistent if present: ${character.appearance}.`,
        'Dark fantasy tabletop RPG illustration, grounded details, cinematic lighting, painterly realism, no text, no UI, no watermark.',
    ].filter(Boolean).join(' ');
}

/**
 * Composer-unavailable fallback (no machinery key / compose call failed): a
 * deterministic scene prompt from the raw situation. Species and class ride
 * as display names, never data keys.
 */
export function buildFallbackScenePrompt({ location, character, situation }) {
    return [
        `Dark fantasy RPG scene at ${location}.`,
        character && `Featuring ${character.name}, a ${raceDisplayName(character)} ${classDisplayName(character)}${character.appearance ? `: ${character.appearance}` : ''}.`.replace(/\s+/g, ' '),
        situation,
        'Render this exact latest tableau and every stated subject, species, count, action, body, and reaction. Do not invent generic party members or bystanders.',
        'Grounded cinematic dark-fantasy realism, professional concept art, anatomically coherent figures, detailed materials, dramatic natural lighting, not cartoonish or childlike, no text, no watermark.',
    ].filter(Boolean).join(' ');
}

/**
 * The "current situation" the art director paints: the DM's latest genuine
 * narration (shared narrative-eligibility predicate — hidden, soft-deleted,
 * and OOC table-talk replies are never the situation: a scrubbed refusal was
 * being painted AND cached under its message id, 2026-09-01 P1), then the
 * newest journal summary, then the bare location.
 * @returns {{ situation: string, narrationId: string|null }}
 */
export function pickSceneSituation({ messages = [], journal = [], location = '' } = {}) {
    const narration = findLatestNarration(messages);
    const lastJournal = journal?.length ? journal[journal.length - 1]?.summary : '';
    const situation = (narration?.content || lastJournal || `The scene at ${location}.`).trim();
    return { situation, narrationId: narration?.id ?? null };
}

export function fallbackNotice(result) {
    if (!result || result.provider === 'xai') return '';
    if (result.provider === 'gemini') {
        // Gemini is a full-quality provider — only explain WHY xAI didn't render.
        if (result.fallbackReason === 'missing-key') {
            return 'Rendered with Gemini (your machinery key). Add an xAI Image API Key in Settings for Grok Imagine art.';
        }
        if (result.fallbackReason === 'xai-empty') {
            return 'xAI returned no image (possibly filtered) — rendered with Gemini instead.';
        }
        return 'xAI rendering failed — rendered with Gemini (your machinery key) instead.';
    }
    if (result.fallbackReason === 'missing-key') {
        return 'Free fallback render — add an xAI Image API Key (or a Gemini machinery key) in Settings for the intended high-quality scene art.';
    }
    if (result.fallbackReason?.includes('xai-empty')) {
        return 'No image provider produced an image, possibly because the prompt was filtered. This is a lower-quality free fallback.';
    }
    return 'Image rendering failed on the real providers, so this is a lower-quality free fallback. Check the image key or try again.';
}
