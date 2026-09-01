/**
 * The Scribe-machinery art director (split from scribe.js 2026-08-24 audit
 * P2): composes ONE finished image-generation prompt for the current scene on
 * demand, from the latest situation plus the accumulated visual canon of the
 * characters in frame. The image itself is rendered by providers/imageGen.js.
 */
import { sendMessage } from './adapter.js';
import { getBackgroundConfig } from './machinery.js';
import { curateNpcsForPrompt } from '../engine/npcRoster.js';
import { classDisplayName, raceDisplayName } from '../engine/characterUtils.js';

/**
 * One foe's state for the art director's cast list (2026-09-01 P2): combat
 * stays active until the LAST foe is overcome, so a bare name list told the
 * painter Kraul was still fighting beside a situation in which Kraul lies
 * dead — and the director is instructed to preserve defeated foes.
 */
export function describeEnemyForScene(enemy) {
    const name = String(enemy?.name || '').trim();
    if (!name) return '';
    const dead = enemy.combatStatus === 'defeated' || enemy.condition === 'dead' || (Number.isFinite(enemy.hp) && enemy.hp <= 0);
    const tag = dead
        ? 'dead'
        : (['fled', 'surrendered'].includes(enemy.combatStatus)
            ? enemy.combatStatus
            : (['bloodied', 'critical'].includes(enemy.condition) ? enemy.condition : 'fighting'));
    return `${name} (${tag})`;
}

const ART_DIRECTOR_PROMPT = `You are the art director for a gritty, mature, dark-fantasy RPG. Given the current scene and the known visual details of the characters and things present, write ONE vivid image-generation prompt that an image model will render.

Rules:
- Output ONLY the prompt text — no preamble, no quotes, no JSON, no explanation.
- 100-170 words. Concrete and visual: describe the characters in frame (using the provided appearances), the setting, composition/framing, lighting, weather, mood, and art style.
- Render the EXACT latest moment and its consequences, not a generic establishing shot. Preserve every visually important subject, species, count, action, body, wound, pose, and reaction stated in the current situation—especially defeated foes, witnesses, kneeling/cowering figures, and the player's decisive gesture.
- Do not add generic party members, soldiers, bystanders, creatures, or props that are not supported by the supplied situation and entity details.
- Make the player character the visual anchor when present. State other subjects' spatial relationship to them so the image model cannot quietly omit half the scene.
- Use the EXACT appearance details provided for each named character so they look consistent across scenes. If a character has no given appearance, infer modestly from their race/class/equipment — do not contradict known details.
- A character's stated gender and species are inviolable: when a name carries "(woman)", "(man)", "(goblin woman)", or the situation establishes them, the rendered figure MUST read unmistakably as that gender and species — never default a described woman to a generic male figure, and never default a goblin, dwarf, or other non-human to a human figure.
- Depict only what the situation supports. This is an adult, gritty world: render violence, grime, and mature/sensual content frankly and unvarnished when the scene calls for it — bodies as established, not idealized — but keep it grounded, never gratuitous. Describe bodies in neutral anatomical language, never profanity or crude slang.
- End with this quality direction: "grounded cinematic dark-fantasy realism, professional concept art, anatomically coherent figures, detailed materials, dramatic natural lighting, not cartoonish or childlike".
- Do NOT include any on-image text, captions, watermarks, UI, or speech bubbles.`;

/** Keep both the setup and decisive aftermath when a long narration feeds scene art. */
export function preserveSceneSituation(situation, maxLength = 1800) {
    const text = String(situation || '').trim();
    if (text.length <= maxLength) return text;
    const tailLength = Math.min(650, Math.floor(maxLength * 0.4));
    const headLength = maxLength - tailLength;
    return `${text.slice(0, headLength).trimEnd()}\n[Later in the same moment]\n${text.slice(-tailLength).trimStart()}`;
}

/**
 * Compose a single image-generation prompt for the current scene. Runs on demand
 * (when the player requests scene art), not every turn. Pulls together the current
 * situation and the accumulated visual details of the entities likely in frame, and
 * asks the Scribe model to art-direct a finished prompt.
 *
 * @returns {Promise<string|null>} A finished image prompt, or null on failure.
 */
export async function composeScenePrompt({ situation, character, party = [], npcs = [], combat, currentLocation, settings }) {
    const background = getBackgroundConfig(settings);
    if (!background.apiKey) return null;

    const lines = [];
    if (currentLocation) lines.push(`Location: ${currentLocation}`);
    if (situation) lines.push(`Current situation: ${preserveSceneSituation(situation)}`);

    if (character) {
        const equipped = (character.equippedSummary || '').trim();
        const gender = character.gender?.trim() || '';
        const desc = character.appearance?.trim()
            || `a ${gender ? `${gender} ` : ''}${raceDisplayName(character)} ${classDisplayName(character) || 'adventurer'}`.replace(/\s+/g, ' ').trim();
        lines.push(`Player character — ${character.name}${gender ? ` (${gender})` : ''}: ${desc}${equipped ? ` Wearing/wielding: ${equipped}.` : ''}`);
    }

    // Party companions stand beside the hero in nearly every frame — they get
    // guaranteed lines BEFORE any roster NPC (2026-08-20 audit P2: a quiet
    // companion lost their frame slot to a shopkeeper two towns back).
    const companionNames = new Set();
    for (const c of (party || []).filter(c => c?.name)) {
        companionNames.add(c.name.toLowerCase());
        const identity = [c.species, c.gender].map(v => String(v || '').trim()).filter(Boolean).join(' ');
        const desc = (c.appearance || c.notes || '').trim() || `${c.role || 'companion'}`.trim();
        lines.push(`Party companion — ${c.name}${identity ? ` (${identity})` : ''}: ${desc}${c.weapon ? ` Wielding ${c.weapon}.` : ''}`);
    }

    // Roster NPCs likely in frame: the shared prompt curation (location-aware,
    // pinned-first) replaces raw recency; companions already listed are skipped.
    // Filter BEFORE the cap — a nameless roster entry in the top slots must not
    // silently shrink the cast the art director is told about.
    const recentNpcs = curateNpcsForPrompt(npcs.filter(n => n.name), { location: currentLocation || '', limit: 6 })
        .filter(n => !companionNames.has(n.name.toLowerCase()))
        .slice(0, 4);
    for (const n of recentNpcs) {
        const identity = [n.species, n.gender].map(v => String(v || '').trim()).filter(Boolean).join(' ');
        const desc = n.appearance?.trim() || `${n.disposition || ''} NPC`.trim();
        lines.push(`NPC — ${n.name}${identity ? ` (${identity})` : ''}: ${desc}`);
    }

    if (combat?.active && combat.enemies?.length > 0) {
        const cast = combat.enemies.map(describeEnemyForScene).filter(Boolean);
        if (cast.length > 0) {
            lines.push(`In combat against: ${cast.join(', ')}. Foes marked dead, fled, or surrendered are no longer fighting — depict their state, not a fight.`);
        }
    }

    try {
        const prompt = await sendMessage({
            ...background,
            systemPrompt: ART_DIRECTOR_PROMPT,
            messageHistory: [],
            userMessage: lines.join('\n'),
        });
        const cleaned = String(prompt || '').trim();
        return cleaned || null;
    } catch (e) {
        console.log('[Scribe] Image-prompt composition failed:', e.message || e);
        return null;
    }
}
