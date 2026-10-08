/**
 * Spell slots, casting math, and spell-effect notation building.
 *
 * The engine owns everything numeric here: slot bookkeeping, save DCs, attack
 * bonuses, cantrip scaling, and upcast dice. The DM only ever names a spell,
 * its targets, and optionally a slot level — never dice or outcomes.
 */
import { CLASSES } from '../data/classes.js';
import { findSpell, SPELL_LIST } from '../data/spells.js';
import { getModifier, getProficiencyBonus } from './rules.js';

export const MAX_SPELL_LEVEL = 5;

// A caster is a class the spell catalog lists at least once (2026-10-08
// spellcasting Lap-4 P2): the old two-name literal beside a catalog that
// already names each spell's `classes` made a new caster class three edits.
const CASTER_CLASSES = new Set(SPELL_LIST.flatMap(spell => spell.classes || []));

export function isSpellcaster(className) {
    return typeof className === 'string' && CASTER_CLASSES.has(className);
}

/** Most distinct cast targets either wire keeps; each lane clamps to the SPELL's own limit with a visible note. */
export const MAX_CAST_TARGETS = 6;
/** Raw wire entries scanned for those targets (a flooded list is not walked). */
const MAX_CAST_TARGET_SCAN = 30;

/**
 * Dedupe-THEN-cap a cast's target refs — the one rule behind both wires
 * (the combat slot's `targets`, 2026-09-26; the out-of-combat `spell_cast`
 * list, 2026-10-08 — it sliced three RAW entries first, so Mass Healing Word
 * with `["self", "Jorun", "Jorun", "Mika"]` healed two and left Mika at 5 HP
 * with no line). `toRef` types one raw entry to a string or null; the cap
 * sits above every catalog limit so the lanes post the "extra targets are
 * unaffected" note instead of a wire silently losing a recipient.
 */
export function dedupeCastTargets(raw, toRef) {
    const unique = [];
    for (const value of (Array.isArray(raw) ? raw : []).slice(0, MAX_CAST_TARGET_SCAN)) {
        const target = toRef(value);
        if (!target || unique.includes(target)) continue;
        unique.push(target);
        if (unique.length >= MAX_CAST_TARGETS) break;
    }
    return unique;
}

/** How many recipients a spell's catalog targeting allows. */
export function spellTargetLimit(spell) {
    return spell?.targeting?.mode === 'upTo3' ? 3 : 1;
}

const SELF_ALIASES = new Set(['', 'self', 'me', 'player']);

/**
 * THE recipient ladder for a self/ally/any-side cast — read by CAST_SPELL
 * (out of combat) and the exchange's support lane alike (2026-10-08
 * spellcasting Lap-4 P2: two bodies disagreed — out of combat, Mage Armor
 * aimed at "Jorun" settled on the COMPANION with the hero's AC recomputed
 * without it, a sheet the fight lane could never produce, and Spare the
 * Dying accepted a DEAD companion as its recipient). The rules, once:
 * - a `side: 'self'` spell lands on the caster whatever was named
 *   (`redirected` carries the first other name so the lane can say so);
 * - '' / self / me / player / the hero's own name resolve to the hero;
 * - a party member matches by exact id or case-folded name — dead never,
 *   on every side;
 * - a `side: 'any'` spell may name a creature outside the party (Spare the
 *   Dying's NPC): `{ type: 'other', name }`, the fiction's own;
 * - invalid refs never cost a slot: recipients dedupe by identity, THEN the
 *   first `spellTargetLimit` win and `overflow` counts the rest.
 * Companion recipients are the caller's own objects (the exchange mutates
 * its working copies in place).
 */
export function resolveSpellRecipients(spell, character, party, refs) {
    const side = spell?.targeting?.side;
    const heroName = String(character?.name || '').trim().toLowerCase();
    const named = (Array.isArray(refs) ? refs : [refs])
        .map(ref => String(ref ?? '').trim())
        .filter(Boolean);
    const requested = named.length > 0 ? named : [''];
    const resolveOne = (ref) => {
        const lc = ref.toLowerCase();
        if (SELF_ALIASES.has(lc) || (heroName && lc === heroName)) return { type: 'self' };
        const companion = (party || []).find(c => c && (c.id === ref || String(c.name || '').toLowerCase() === lc)) || null;
        if (companion) return companion.status === 'dead' ? null : { type: 'companion', companion };
        return side === 'any' ? { type: 'other', name: ref.slice(0, 60) } : null;
    };
    let redirected = null;
    if (side === 'self') {
        redirected = requested.find(ref => resolveOne(ref)?.type !== 'self') ?? null;
        return { recipients: [{ type: 'self' }], invalid: [], overflow: 0, redirected };
    }
    const valid = [];
    const invalid = [];
    for (const ref of requested) {
        const resolved = resolveOne(ref);
        if (!resolved) {
            invalid.push(ref);
        } else if (!valid.some(r => r.type === resolved.type && r.companion?.id === resolved.companion?.id && r.name === resolved.name)) {
            valid.push(resolved);
        }
    }
    const limit = spellTargetLimit(spell);
    return { recipients: valid.slice(0, limit), invalid, overflow: Math.max(0, valid.length - limit), redirected };
}

/**
 * The note a lane posts when the DM named more recipients than the spell
 * takes, or aimed a self-only spell elsewhere — one wording on both lanes.
 */
export function describeRecipientClamp(spell, { overflow = 0, redirected = null } = {}) {
    if (redirected) return `${spell.name} can only settle on the caster — "${redirected}" is unaffected.`;
    if (overflow > 0) {
        const limit = spellTargetLimit(spell);
        return `${spell.name} affects ${limit === 1 ? 'only one recipient' : `up to ${limit} recipients`}; extra targets are unaffected.`;
    }
    return null;
}

/** `conditions` without `condition`, case-folded — the sustained release's one filter. */
export function dropCondition(conditions, condition) {
    const lc = String(condition || '').toLowerCase();
    return (conditions || []).filter(c => String(c).toLowerCase() !== lc);
}

/**
 * THE sustained-spell record (2026-10-08 spellcasting Lap-4 P2: it had three
 * composers — CAST_SPELL, the exchange's support lane, and the load twin,
 * which alone clamped the target fields). Mechanics come from the catalog
 * entry, never from a caller; `companion` is the party record it settles on,
 * or null for the caster. Returns null for a spell that is not sustained.
 */
export function buildSustainedSpell(spell, companion = null) {
    if (!spell?.sustained) return null;
    const targetId = typeof companion?.id === 'string' && companion.id ? companion.id.slice(0, 100) : '';
    const targetName = typeof companion?.name === 'string' && companion.name ? companion.name.slice(0, 100) : '';
    return {
        key: spell.key,
        name: spell.name,
        ...(spell.acBonus && { acBonus: spell.acBonus }),
        ...(spell.condition && { condition: spell.condition }),
        targetType: companion ? 'companion' : 'self',
        ...(targetId && { targetId }),
        ...(targetName && { targetName }),
    };
}

export function getCastingAbility(className) {
    return CLASSES[className]?.primaryAbility || 'intelligence';
}

/**
 * Slots per spell level for a character level. Real 5e numbers for levels 1-10;
 * frozen afterward because RAW growth beyond 10 only feeds the 6th-9th level
 * slots this game deliberately cuts (rpg-balance-master spec 2026-07-17).
 */
export function getSpellSlotTable(level) {
    const l = Math.max(1, Math.min(20, Math.trunc(level || 1)));
    if (l === 1) return { 1: 2 };
    if (l === 2) return { 1: 3 };
    if (l === 3) return { 1: 4, 2: 2 };
    if (l === 4) return { 1: 4, 2: 3 };
    if (l === 5) return { 1: 4, 2: 3, 3: 2 };
    if (l === 6) return { 1: 4, 2: 3, 3: 3 };
    if (l === 7) return { 1: 4, 2: 3, 3: 3, 4: 1 };
    if (l === 8) return { 1: 4, 2: 3, 3: 3, 4: 2 };
    if (l === 9) return { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 };
    return { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 };
}

export function getMaxSpellLevel(level) {
    return Math.max(...Object.keys(getSpellSlotTable(level)).map(Number));
}

/**
 * Build the per-level slot state for a character level. When `previous` is
 * given (level-up, save load), spent slots carry over clamped to the new max —
 * gaining a level never silently refills the day's magic.
 */
export function buildSpellSlots(level, previous = null) {
    const table = getSpellSlotTable(level);
    const slots = {};
    for (const [lvl, max] of Object.entries(table)) {
        // Numeric-string parity with every sibling heal (2026-09-13 audit P2):
        // `used: "4"` used to reset to 0 — the load REFILLED the day's magic.
        const prevUsed = Number(previous?.[lvl]?.used);
        slots[lvl] = {
            used: Number.isFinite(prevUsed) ? Math.max(0, Math.min(max, Math.trunc(prevUsed))) : 0,
            max,
        };
    }
    return slots;
}

/** Sanitize a loaded/LLM-supplied slot state against the authoritative table. */
export function sanitizeSpellSlots(level, value) {
    return buildSpellSlots(level, value && typeof value === 'object' ? value : null);
}

/**
 * Rebuild a loaded sustainedSpell from the catalog. The mechanical fields
 * (acBonus, condition) come from `findSpell(key)`, never from the save — a
 * hand-edited `{key:'mageArmor', acBonus:30}` used to flow raw into
 * computeACFromInventory as a permanent unclamped hero AC (the 2026-08-05
 * AC-clamp class, missed on the sustained-buff lane — 2026-08-29 audit).
 * Unknown or non-sustained keys drop to null.
 */
export function sanitizeSustainedSpell(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    // The load twin IS the composer: the same builder the two casting lanes
    // call, fed the stored target (typed string-or-drop inside it).
    return buildSustainedSpell(findSpell(raw.key), raw.targetType === 'companion'
        ? { id: raw.targetId, name: raw.targetName }
        : null);
}

export function getSpellSaveDC(character) {
    const ability = getCastingAbility(character?.class);
    return 8 + getProficiencyBonus(character?.level || 1) + getModifier(character?.abilityScores?.[ability] || 10);
}

export function getSpellAttackBonus(character) {
    const ability = getCastingAbility(character?.class);
    return getProficiencyBonus(character?.level || 1) + getModifier(character?.abilityScores?.[ability] || 10);
}

/** All catalog spells this character can know at their level (slots permitting). */
export function getKnownSpells(character) {
    if (!isSpellcaster(character?.class)) return [];
    const maxLevel = getMaxSpellLevel(character.level || 1);
    return SPELL_LIST.filter(spell =>
        spell.classes.includes(character.class) && spell.level <= maxLevel);
}

/** Resolve a DM/player spell reference for this character, or null. */
export function resolveSpellForCharacter(character, ref) {
    const spell = findSpell(ref);
    if (!spell || !isSpellcaster(character?.class)) return null;
    if (!spell.classes.includes(character.class)) return null;
    if (spell.level > getMaxSpellLevel(character.level || 1)) return null;
    return spell;
}

/**
 * Pick the slot level a cast consumes: the requested level when it is legal
 * and available, otherwise the lowest available slot at or above the spell's
 * base level. Cantrips return 0. Returns null when no slot can pay for it.
 */
export function chooseSlotLevel(spellSlots, spell, requestedLevel = null) {
    if (!spell) return null;
    if (spell.level === 0) return 0;
    const available = lvl => {
        const slot = spellSlots?.[lvl];
        return slot && (slot.max - slot.used) > 0;
    };
    // A numeric string ("2") is a real request — the wire normalizers coerce
    // too, but this is the belt for every other caller (2026-09-13 audit P2).
    const requestedNumber = requestedLevel === null || requestedLevel === '' ? NaN : Number(requestedLevel);
    const requested = Number.isFinite(requestedNumber) ? Math.trunc(requestedNumber) : null;
    if (requested !== null && requested >= spell.level && requested <= MAX_SPELL_LEVEL && available(requested)) {
        return requested;
    }
    for (let lvl = spell.level; lvl <= MAX_SPELL_LEVEL; lvl++) {
        if (available(lvl)) return lvl;
    }
    return null;
}

export function spendSpellSlot(spellSlots, slotLevel) {
    if (!slotLevel || !spellSlots?.[slotLevel]) return spellSlots;
    const slot = spellSlots[slotLevel];
    return {
        ...spellSlots,
        [slotLevel]: { ...slot, used: Math.min(slot.max, slot.used + 1) },
    };
}

/** Cantrip dice count at a character level: 1/2/3/4 at 1/5/11/17 (5e RAW). */
export function cantripDiceCount(level) {
    const l = level || 1;
    return l >= 17 ? 4 : l >= 11 ? 3 : l >= 5 ? 2 : 1;
}

function parseDiceBlock(dice) {
    const m = String(dice || '').replace(/\s+/g, '').match(/^(\d{1,2})d(\d{1,3})([+-]\d{1,3})?$/i);
    if (!m) return { count: 1, sides: 4, modifier: 0 };
    return { count: parseInt(m[1], 10), sides: parseInt(m[2], 10), modifier: m[3] ? parseInt(m[3], 10) : 0 };
}

function buildNotation(block, character, spell, slotLevel) {
    const parsed = parseDiceBlock(block.dice);
    let count = parsed.count;
    if (block.cantripScaling) {
        count = cantripDiceCount(character?.level);
    } else if (block.upcastPerLevel && slotLevel > spell.level) {
        count += block.upcastPerLevel * (slotLevel - spell.level);
    }
    let modifier = parsed.modifier;
    if (block.addAbilityMod) {
        modifier += getModifier(character?.abilityScores?.[getCastingAbility(character?.class)] || 10);
    }
    return `${count}d${parsed.sides}${modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : ''}`;
}

/** Final damage notation for a cast (cantrip scaling / upcast / ability mod applied). */
export function spellDamageNotation(spell, character, slotLevel) {
    return spell?.damage ? buildNotation(spell.damage, character, spell, slotLevel) : null;
}

/** Final healing notation for a cast. */
export function spellHealingNotation(spell, character, slotLevel) {
    return spell?.healing ? buildNotation(spell.healing, character, spell, slotLevel) : null;
}

/**
 * Wizard Arcane Recovery: once per long-rest cycle, a short rest restores
 * spent slots worth `ceil(level / 2)` slot-levels, best (≤3rd) slots first.
 */
export function applyArcaneRecovery(spellSlots, level) {
    let budget = Math.ceil((level || 1) / 2);
    const next = { ...spellSlots };
    let recovered = 0;
    for (const lvl of [3, 2, 1]) {
        while (budget >= lvl && next[lvl] && next[lvl].used > 0) {
            next[lvl] = { ...next[lvl], used: next[lvl].used - 1 };
            budget -= lvl;
            recovered += lvl;
        }
    }
    return { spellSlots: next, recovered };
}

/** Fully refill every slot level (long rest). */
export function refillSpellSlots(spellSlots) {
    if (!spellSlots) return spellSlots;
    const next = {};
    for (const [lvl, slot] of Object.entries(spellSlots)) {
        next[lvl] = { ...slot, used: 0 };
    }
    return next;
}

/** "L1 2/4 · L2 3/3" — remaining/max per level, for prompts and system lines. */
export function summarizeSpellSlots(spellSlots) {
    if (!spellSlots) return '';
    return Object.entries(spellSlots)
        .map(([lvl, slot]) => `L${lvl} ${Math.max(0, slot.max - slot.used)}/${slot.max}`)
        .join(' · ');
}

/**
 * The LIVE half of the prompt's spellcasting text: slots remaining, save DC,
 * spell attack. Changes turn to turn (a cast, a rest, an ASI), so it rides the
 * PLAYER CHARACTER block. Empty for non-casters and slot-less characters.
 */
export function describeSpellSlotsForPrompt(character) {
    if (!isSpellcaster(character?.class) || !character.spellSlots) return '';
    return `Spell slots remaining: ${summarizeSpellSlots(character.spellSlots)}. Spell save DC ${getSpellSaveDC(character)}, spell attack +${getSpellAttackBonus(character)}.`;
}

/**
 * The CONSTANT half: the catalog lines of every spell that mechanically exists
 * for this hero. A function of class + level only (`getKnownSpells`), so it
 * changes at level-up and never between — it ends the cached prefix as the
 * `## SPELLBOOK` block (2026-09-25 spellcasting Lap-3 P2: 712 chars at L1 →
 * 1,731 at L10 were re-billed on every DM call, two per combat round, because
 * they were composed beside the live slots line). Same gate as the slots line
 * so the two halves always appear together.
 */
export function describeSpellbookForPrompt(character) {
    if (!isSpellcaster(character?.class) || !character.spellSlots) return '';
    const known = getKnownSpells(character);
    const targetingTag = targeting => {
        if (!targeting) return '';
        if (targeting.side === 'self') return ', self';
        if (targeting.side === 'any') return ', ONE creature (named in "target")';
        const noun = targeting.side === 'ally' ? 'ally' : 'foe';
        if (targeting.mode === 'upTo3') return `, up to 3 ${noun === 'ally' ? 'allies' : 'foes'} via "targets"`;
        if (targeting.mode === 'darts') return ', 3 darts (+1 per upcast level) — splittable among foes via "targets"';
        return `, ONE ${noun}`;
    };
    return known.map(spell => {
        const cost = spell.level === 0 ? 'cantrip, at will' : `level ${spell.level} slot`;
        const timing = spell.castTime === 'bonus' ? ', bonus action' : '';
        const scope = spell.combatAvailable && spell.outOfCombatAvailable
            ? ''
            : spell.combatAvailable ? ' [combat only]' : ' [out of combat only]';
        return `- ${spell.name} (${cost}${timing}${targetingTag(spell.targeting)})${scope}: ${spell.summary}`;
    }).join('\n');
}
