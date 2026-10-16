/**
 * Pure SceneArt helpers, extracted from the component (the
 * components/Chat/turnVisibility.js pattern — 2026-09-01 scene-art audit) so
 * the prompt text the painter receives and the "current situation" picker
 * are unit-testable without React.
 */
import { isRecordEntry } from '../../engine/journalEntry.js';
import { classDisplayName, raceDisplayName } from '../../engine/characterUtils.js';
import { findLatestNarration } from '../../llm/narrativeMessages.js';
import { IDENTITY_LOCK_REMINDER } from '../../engine/appearanceIdentity.js';
import { castLookOrContext, castNameTag, describeCastMember } from '../../engine/castMember.js';
import { isPromptRosterNpc, resolveCompanionLook } from '../../engine/npcRoster.js';
import { PORTRAIT_STYLE } from '../CharacterSheet/portraitPrompt.js';
import { isMissingKeyFallback, isXaiFilteredFallback } from '../../llm/providers/imageGen.js';

export function equippedSummary(inventory = []) {
    return (inventory || [])
        .filter(i => i.equipped)
        .map(i => i.name)
        .filter(Boolean)
        .join(', ');
}

/**
 * The figures the focus-mode Character dropdown offers: the hero, the party
 * (painted from the linked roster record — the Scribe-merged living look,
 * DECISIONS.md 2026-07-23 / 2026-09-12), the roster's CHARACTERS, and the
 * fight's enemies. Archived creatures and the load-archived descriptive
 * labels ("A guard sharpening a spear") are the rows the Journal tab hides and
 * the director skips — the select used to list every named roster row, dozens
 * of "Guard" rows in a long campaign (2026-10-16 audit nit). Pure, so the
 * list is testable without React.
 */
export function listVisualTargets(state, gear = '') {
    const npcs = Array.isArray(state?.npcs) ? state.npcs : [];
    return [
        state?.character && {
            id: 'player',
            type: 'player',
            label: state.character.name || 'Player character',
            entity: state.character,
            gear,
        },
        ...(Array.isArray(state?.party) ? state.party : []).map(c => ({
            id: `companion:${c.id || c.name}`,
            type: 'companion',
            label: c.name,
            entity: { ...c, ...resolveCompanionLook(c, npcs) },
        })),
        ...npcs.filter(n => n?.name && isPromptRosterNpc(n)).map(n => ({
            id: `npc:${n.id || n.name}`,
            type: 'npc',
            label: n.name,
            entity: n,
        })),
        ...(Array.isArray(state?.combat?.enemies) ? state.combat.enemies : []).filter(e => e?.name).map(e => ({
            id: `enemy:${e.id || e.name}`,
            type: 'enemy',
            label: e.name,
            entity: e,
        })),
    ].filter(Boolean);
}

/** The focus target as the shelf's cast member — one read for the description and the lock. */
function castMemberOf(target) {
    return describeCastMember(target.type, target.entity, { gear: target.gear });
}

export function describeEntity(target) {
    if (!target) return '';
    if (!['player', 'companion', 'npc', 'enemy'].includes(target.type)) return target.label || '';
    return describeMember(target, castMemberOf(target));
}

/** `describeEntity` over a cast member already composed (the focused prompt reads the lock from the same one). */
function describeMember(target, member) {
    // The registered species + gender ride right beside the name — the art
    // director's inviolable-identity rule keys on this "(goblin woman)" tag.
    const head = `${castNameTag(member)}, ${member.role}`;
    if (target.type === 'enemy') {
        return [head, member.context && `Condition: ${member.context}.`].filter(Boolean).join('. ');
    }
    if (target.type === 'player') {
        return [head, member.look, member.gear && `Wearing/wielding: ${member.gear}.`].filter(Boolean).join('. ');
    }
    const lastLocation = typeof target.entity?.lastLocation === 'string' ? target.entity.lastLocation.trim() : '';
    return [
        head,
        // The look, or the notes under a "Context:" label — never notes painted
        // as a look (2026-10-03 audit: a focused NPC with no appearance record
        // was painted from last-scene notes).
        castLookOrContext(member),
        member.gear && `Wielding ${member.gear}.`,
        target.type === 'npc' && lastLocation && `Last seen at ${lastLocation}.`,
    ].filter(Boolean).join('. ');
}

export function buildFocusedPrompt(target, location) {
    // ONE cast member for the description and the lock (it was composed twice).
    const member = target && ['player', 'companion', 'npc', 'enemy'].includes(target.type) ? castMemberOf(target) : null;
    const description = member ? describeMember(target, member) : describeEntity(target);
    // Identity lock leads (2026-09-12) — see engine/appearanceIdentity.js.
    const lock = member?.lock || '';
    return [
        lock,
        `Focused waist-up portrait of ${target.label}.`,
        description,
        location && `Current setting: ${location}.`,
        PORTRAIT_STYLE,
        lock && IDENTITY_LOCK_REMINDER,
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
    // The newest REAL summary: a `fallback` entry is the "Auto-summary was
    // unavailable…" apology, never a scene (the 2026-09-06 "never embedded"
    // rule, one consumer over — 2026-09-09 audit P2).
    const lastJournal = (Array.isArray(journal) ? journal : [])
        .slice()
        .reverse()
        .find(isRecordEntry)
        ?.summary || '';
    const narrationText = typeof narration?.content === 'string' ? narration.content : '';
    const situation = (narrationText || lastJournal || `The scene at ${location}.`).trim();
    return { situation, narrationId: narration?.id ?? null };
}

/**
 * Why a render did not come from xAI, in the player's words. The reason
 * string's grammar belongs to imageGen.js; this reads it only through that
 * module's own predicates, never by matching its text.
 */
export function fallbackNotice(result) {
    if (!result || result.provider === 'xai') return '';
    const noKey = isMissingKeyFallback(result.fallbackReason);
    const filtered = isXaiFilteredFallback(result.fallbackReason);
    if (result.provider === 'gemini') {
        // Gemini is a full-quality provider — only explain WHY xAI didn't render.
        if (noKey) {
            return 'Rendered with Gemini (your machinery key). Add an xAI Image API Key in Settings for Grok Imagine art.';
        }
        if (filtered) {
            return 'xAI returned no image (possibly filtered) — rendered with Gemini instead.';
        }
        return 'xAI rendering failed — rendered with Gemini (your machinery key) instead.';
    }
    if (noKey) {
        return 'Free fallback render — add an xAI Image API Key (or a Gemini machinery key) in Settings for the intended high-quality scene art.';
    }
    if (filtered) {
        return 'No image provider produced an image, possibly because the prompt was filtered. This is a lower-quality free fallback.';
    }
    return 'Image rendering failed on the real providers, so this is a lower-quality free fallback. Check the image key or try again.';
}
