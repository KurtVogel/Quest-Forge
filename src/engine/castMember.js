/**
 * ONE description of a figure a painter may be asked to paint (2026-10-03
 * scene-art audit). Four composers each assembled "(species gender)" +
 * appearance + gear + identity lock on their own — the scene director's cast
 * lines, SceneArt's focus list, the hero portrait and the NPC portrait — and
 * they drifted twice: on 09-12 the focus list read the party record instead of
 * the roster, and until this module the focus list painted an NPC's last-scene
 * notes AS THE LOOK while the NPC portrait labeled the same text `Context:`.
 *
 * The parts every composer formats from:
 *   name     the figure's name
 *   tag      the identity that rides beside the name — "(woman)" for the hero,
 *            "(goblin woman)" for anyone else; the art director's
 *            inviolable-identity rule keys on it
 *   role     who they are when nothing visual is on record ("a human fighter",
 *            "sellsword", "wary")
 *   look     the appearance record and NOTHING else
 *   context  notes about them — never a look; a composer may show it only
 *            under a "Context:" label
 *   gear     what they visibly carry
 *   lock     the IDENTITY LOCK line (engine/appearanceIdentity.js), '' if none
 *
 * Every field is string-or-empty: three of the four composers run at render.
 */
import { classDisplayName, raceDisplayName } from './characterUtils.js';
import { buildIdentityLockLine } from './appearanceIdentity.js';
import { resolveCompanionLook } from './npcRoster.js';
import { cleanTextField } from '../config/contentLimits.js';

export const CAST_CONTEXT_MAX = 200;

export function describeCastMember(kind, entity, { gear = '', appearance, npcs = null } = {}) {
    const record = entity && typeof entity === 'object' ? entity : {};
    const name = cleanTextField(record.name);

    if (kind === 'player') {
        const gender = cleanTextField(record.gender);
        const species = raceDisplayName(record);
        // The sheet and the wizard paint from the DRAFT look, not the stored one.
        const look = cleanTextField(appearance !== undefined ? appearance : record.appearance);
        return {
            name,
            tag: gender,
            role: `a ${species} ${classDisplayName(record) || 'adventurer'}`.replace(/\s+/g, ' ').trim(),
            look,
            context: '',
            gear: cleanTextField(gear),
            lock: buildIdentityLockLine(name, look, { species, gender }),
        };
    }

    if (kind === 'enemy') {
        return { name, tag: '', role: 'hostile combatant', look: '', context: cleanTextField(record.condition), gear: '', lock: '' };
    }

    // A companion's look is ONE record (2026-09-12): the roster record first —
    // that is where the Scribe writes it — the party record as the fallback.
    const source = kind === 'companion' && Array.isArray(npcs) ? { ...record, ...resolveCompanionLook(record, npcs) } : record;
    const species = cleanTextField(source.species);
    const gender = cleanTextField(source.gender);
    const look = cleanTextField(source.appearance);
    const base = {
        name,
        tag: [species, gender].filter(Boolean).join(' '),
        look,
        lock: buildIdentityLockLine(name, look, { species, gender }),
    };
    if (kind === 'companion') {
        return {
            ...base,
            role: cleanTextField(source.role) || 'companion',
            context: cleanTextField(source.notes, CAST_CONTEXT_MAX),
            gear: cleanTextField(source.weapon),
        };
    }
    return {
        ...base,
        role: cleanTextField(source.disposition) || 'NPC',
        // privateNotes never rides a prompt; lastNotes is the public situation.
        context: cleanTextField(source.lastNotes || source.notes, CAST_CONTEXT_MAX),
        gear: '',
    };
}

/** "Name (tag)" — the name with its inviolable identity beside it. */
export function castNameTag(member) {
    return `${member.name}${member.tag ? ` (${member.tag})` : ''}`;
}

/** The look, or — when no look is on record — the notes under their own label. Never notes as a look. */
export function castLookOrContext(member) {
    return member.look || (member.context ? `Context: ${member.context}` : '');
}
