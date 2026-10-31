import { describe, expect, it } from 'vitest';
import { compactWantList, dropPlaceholderClauses, inferSpeciesFromName, isPlaceholderClause, migrateLegacyNpc } from './npcRoster.js';
import { deriveRelationshipArc } from './relationshipArc.js';
import { buildKnownStances } from '../llm/scribe.js';

// 2026-10-31, Vesa's megacampaign appendix: a steady companion's "Relationship
// arc" read "friendly → neutral, neutral → friendly ×8" (the log recorded the
// Scribe's per-scene mood guess at every journal cadence), Wit — a goblin in
// 189 DM messages — was recorded only as "(woman)", and her SECRET carried
// "None revealed" and "unknown" as if they were facts.
const m = (text, kind, salience, atMessage) => ({ text, kind, salience, atMessage, at: atMessage });

describe('the arc is derived from the bond moments (2026-10-31)', () => {
    it('walks the moments and keeps only the stage changes, each with the moment that moved it', () => {
        const arc = deriveRelationshipArc({
            name: 'Ketta Mor',
            disposition: 'neutral', // a quiet scene's mood does not move the arc
            bondMoments: [
                m('Shared a fire on the salt road.', 'other', 3, 2),
                m('Ketta took the bolt meant for the hero.', 'rescue', 5, 10),
                m('Talked until dawn.', 'other', 3, 14),
                m('Their first night together.', 'intimacy', 5, 30),
            ],
        });
        expect(arc.map(step => step.stage)).toEqual(['familiar', 'trusted', 'intimate']);
        expect(arc[1].since).toBe('Ketta took the bolt meant for the hero.');
        expect(arc[2].since).toBe('Their first night together.');
    });

    it('a betrayal after warmth, then a mend: the arc tells the story without flicker', () => {
        const arc = deriveRelationshipArc({
            name: 'Maren',
            disposition: 'friendly',
            bondMoments: [
                m('She saved the hero at the ford.', 'rescue', 5, 1),
                m('Maren sold the hero to the watch.', 'betrayal', 5, 8),
                m('Maren begged forgiveness and the hero gave it.', 'reconciliation', 4, 20),
            ],
        });
        expect(arc.map(step => step.stage)).toEqual(['trusted', 'estranged', 'trusted']);
    });

    it('closes on the stage the record reads now: a hostile turn, a trust-written lift', () => {
        const rows = [m('Shared a fire on the salt road.', 'other', 3, 2)];
        expect(deriveRelationshipArc({ name: 'Odo', disposition: 'hostile', bondMoments: rows }).map(s => s.stage)).toEqual(['familiar', 'rival']);
        expect(deriveRelationshipArc({ name: 'Odo', trust: 85, bondMoments: rows }).map(s => s.stage)).toEqual(['familiar', 'trusted']);
        expect(deriveRelationshipArc({ name: 'Odo', lastNotes: 'Sells eels.' })).toEqual([]);
        expect(deriveRelationshipArc(null)).toEqual([]);
    });

    it('the retired log leaves the record at load', () => {
        const healed = migrateLegacyNpc({
            name: 'Ketta Mor', disposition: 'friendly', arcDisposition: 'friendly',
            relationshipHistory: [{ from: 'friendly', to: 'neutral' }, { from: 'neutral', to: 'friendly' }],
        });
        expect('relationshipHistory' in healed).toBe(false);
        expect('arcDisposition' in healed).toBe(false);
    });
});

describe('a species the name states fills an empty field (2026-10-31)', () => {
    it('reads one whole ancestry word, the adjective folded', () => {
        expect(inferSpeciesFromName('Goblin Archer')).toBe('goblin');
        expect(inferSpeciesFromName('Grukk the Goblin')).toBe('goblin');
        expect(inferSpeciesFromName('the dwarven smith')).toBe('dwarf');
        expect(inferSpeciesFromName('Spear-bearer Goblin')).toBe('goblin');
    });

    it('never from a plural, a possessive, a compound, a target, a beast, or two ancestries', () => {
        expect(inferSpeciesFromName('the two goblins')).toBe('');
        expect(inferSpeciesFromName("the goblin's mother")).toBe('');
        expect(inferSpeciesFromName('Tam Goblin-slayer')).toBe('');
        expect(inferSpeciesFromName('Goblin Hunter Vale')).toBe('');
        expect(inferSpeciesFromName('Giant Spider')).toBe('');
        expect(inferSpeciesFromName('the elf and the dwarf')).toBe('');
        expect(inferSpeciesFromName('Wit')).toBe('');
        expect(inferSpeciesFromName({ x: 1 })).toBe('');
    });

    it('fills on every record write, never over a species on record', () => {
        expect(migrateLegacyNpc({ name: 'Goblin Scout' }).species).toBe('goblin');
        expect(migrateLegacyNpc({ name: 'Goblin Scout', species: 'hobgoblin' }).species).toBe('hobgoblin');
        expect(migrateLegacyNpc({ name: 'Wit' }).species).toBeUndefined();
    });
});

describe('a placeholder is not a fact (2026-10-31)', () => {
    it('recognizes the shapes the Scribe writes into an empty slot', () => {
        for (const clause of ['unknown', 'None revealed.', 'none', 'N/A', 'Not yet revealed', 'No known secrets', 'Goals are unknown', 'Unknown motives', 'nothing known so far']) {
            expect(isPlaceholderClause(clause)).toBe(true);
        }
        for (const clause of ['Knows the patrol routes.', 'Hates the unknown dark', 'None of the guards trust her.', 'Wants nothing from the hero but silence.']) {
            expect(isPlaceholderClause(clause)).toBe(false);
        }
    });

    it('Wit\'s SECRET keeps every real clause and loses the filler, at load and on every write', () => {
        const secret = 'Hit a spear-boy with a rock once to protect Dim. None revealed. Is pregnant with the player\'s offspring; Knows the dry-cracks. unknown';
        expect(dropPlaceholderClauses(secret)).toBe('Hit a spear-boy with a rock once to protect Dim. Is pregnant with the player\'s offspring. Knows the dry-cracks.');
        expect(migrateLegacyNpc({ name: 'Wit', secrets: 'None revealed' }).secrets).toBe('');
        expect(migrateLegacyNpc({ name: 'Ketch', goals: 'Unknown. To secure payment.' }).goals).toBe('To secure payment.');
        expect(dropPlaceholderClauses('Knows the gate password.')).toBe('Knows the gate password.');
    });
});

describe('goals fold want by want (2026-10-31)', () => {
    it('two wordings of one want keep the richer, in the first one\'s place', () => {
        expect(compactWantList('Protect and follow Vesa. Find her brother. Stay close to and protect Vesa.'))
            .toBe('Stay close to and protect Vesa. Find her brother.');
        expect(compactWantList('To capture or kill the player for the bounty. Capture or kill Vesa'))
            .toBe('To capture or kill the player for the bounty.');
    });

    it('distinct wants that share one word stay apart, and the fold is idempotent', () => {
        const wants = 'Protect the village from the duke. Kill the duke to avenge her family.';
        expect(compactWantList(wants)).toBe(wants);
        const folded = compactWantList('Survive alongside Vesa. To survive and follow Vesa\'s orders.');
        expect(compactWantList(folded)).toBe(folded);
    });

    it('the Scribe sees the wants and the secret on record under one rule', () => {
        const block = buildKnownStances({ npcs: [{ name: 'Wit', goals: 'Stay close to Vesa.', secrets: 'Knows the dry-cracks.' }] }, 'Wit sniffs the air.');
        expect(block).toContain('Wit — wants: "Stay close to Vesa." | secret: "Knows the dry-cracks."');
        expect(block.split('wants / secret = what is on record').length - 1).toBe(1);
    });
});
