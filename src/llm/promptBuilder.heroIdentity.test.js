/**
 * HERO IDENTITY block (2026-09-24 character-vault Lap-3 P2): the hero's
 * name / gender / background are campaign-constant, so they END the cached
 * prefix right after the premise instead of riding the live PLAYER CHARACTER
 * block behind HP / XP / wealth. Extends DECISIONS.md 2026-07-18 (the prefix
 * grows; nothing live enters it). Appearance stays live: the Scribe merges it.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';

/** Deterministic filler that reaches exactly `len` characters. */
function longText(seed, len) {
    return seed.repeat(Math.ceil(len / seed.length)).slice(0, len);
}

const GENDER_AT_CAP = longText('a battle-scarred woman of the border shrines ', 60);
const BACKGROUND_AT_CAP = longText('Raised in the toll-shrines of the flooded delta, she buried three brothers before her twentieth year. ', 2000);
const APPEARANCE_AT_CAP = longText('Tall and broad-shouldered, silver-streaked black hair in a crown braid, a burn scar across the left jaw. ', 600);

function makeCharacter(overrides = {}) {
    return {
        name: 'Astra',
        race: 'human',
        class: 'fighter',
        level: 1,
        exp: 0,
        currentHP: 12,
        maxHP: 12,
        armorClass: 16,
        gold: 5,
        silver: 2,
        copper: 3,
        speed: 30,
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
        savingThrowProficiencies: ['strength', 'constitution'],
        skillProficiencies: ['athletics'],
        conditions: [],
        classResources: {},
        features: [],
        ...overrides,
    };
}

function prompt(overrides = {}) {
    return buildSystemPrompt({
        character: 'character' in overrides ? overrides.character : makeCharacter(),
        inventory: [],
        quests: overrides.quests ?? [],
        rollHistory: overrides.rollHistory ?? [],
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        customSystemPrompt: 'Grim, grounded tone.',
        journal: [],
        npcs: [],
        party: overrides.party ?? [],
        currentLocation: overrides.currentLocation ?? 'Jewelglade',
        combat: overrides.combat ?? { active: false },
        worldFacts: overrides.worldFacts ?? [],
        locations: [],
        fronts: [],
        storyMemory: [],
        retrievedMemories: [],
        premise: 'premise' in overrides ? overrides.premise : 'The barony of Kolkanmaa is starving and the toll-weirs keep failing.',
        recentRulings: [],
        messages: [],
        messageCount: 0,
        relationshipBeat: null,
    });
}

/** The live PLAYER CHARACTER block: from its heading to the next `## ` heading. */
function characterBlock(text) {
    const start = text.indexOf('## PLAYER CHARACTER');
    expect(start).toBeGreaterThan(0);
    const next = text.indexOf('\n## ', start + 1);
    return next === -1 ? text.slice(start) : text.slice(start, next);
}

function identityBlock(text) {
    const start = text.indexOf('## HERO IDENTITY');
    expect(start).toBeGreaterThan(0);
    const next = text.indexOf('\n## ', start + 1);
    return text.slice(start, next);
}

describe('HERO IDENTITY ends the cached prefix (2026-09-24 character-vault P2, extends DECISIONS.md 2026-07-18)', () => {
    it('sits immediately after the CAMPAIGN PREMISE and ahead of the live PLAYER CHARACTER block', () => {
        const premise = 'The barony of Kolkanmaa is starving and the toll-weirs keep failing.';
        const text = prompt({ premise, character: makeCharacter({ gender: 'woman', background: 'A disgraced lamplighter.' }) });
        const premiseAt = text.indexOf('## CAMPAIGN PREMISE');
        const identityAt = text.indexOf('## HERO IDENTITY');
        const characterAt = text.indexOf('## PLAYER CHARACTER');
        expect(premiseAt).toBeGreaterThan(0);
        expect(identityAt).toBeGreaterThan(premiseAt);
        expect(identityAt).toBeLessThan(characterAt);
        // Nothing but whitespace between the premise text and the identity heading.
        const premiseEnd = text.indexOf(premise) + premise.length;
        expect(text.slice(premiseEnd, identityAt).trim()).toBe('');
        // The identity block carries the constant fields; the live block no longer does.
        const identity = identityBlock(text);
        expect(identity).toContain('- **Name:** Astra');
        expect(identity).toContain('- **Gender:** woman');
        expect(identity).toContain('player-authored personal canon');
        expect(identity).toContain('A disgraced lamplighter.');
        const live = characterBlock(text);
        expect(live).not.toContain('- **Gender:**');
        expect(live).not.toContain('player-authored personal canon');
    });

    it('keeps every byte up through the identity block identical across turns with different dynamic state', () => {
        const character = makeCharacter({ gender: GENDER_AT_CAP, background: BACKGROUND_AT_CAP, appearance: 'Scarred.' });
        const a = prompt({ character });
        const b = prompt({
            character: { ...character, currentHP: 3, exp: 250, conditions: ['Poisoned'], appearance: 'Scarred, and now limping.' },
            party: [{ id: 'c1', name: 'Osma', hp: 9, maxHp: 18, ac: 16, level: 2, affinity: 60 }],
            quests: [{ id: 'q1', name: 'Find the wardens', status: 'active', description: 'x' }],
            worldFacts: [{ id: 'f1', fact: 'The Pike buys captives.', timestamp: 1 }],
            combat: { active: true, round: 2, enemies: [{ id: 'g1', name: 'Goblin', hp: 5, maxHp: 11, ac: 12 }], turnOrder: [] },
            rollHistory: [{ description: 'Stealth', total: 14, notation: '1d20+2', rolls: [12], modifier: 2 }],
            currentLocation: 'Elsewhere',
        });
        const prefixEnd = a.indexOf(BACKGROUND_AT_CAP) + BACKGROUND_AT_CAP.length;
        expect(prefixEnd).toBeGreaterThan(a.indexOf('## HERO IDENTITY'));
        expect(prefixEnd).toBeLessThan(a.indexOf('## PLAYER CHARACTER'));
        expect(b.slice(0, prefixEnd)).toBe(a.slice(0, prefixEnd));
        // The next heading after the identity block is already dynamic state.
        expect(a.indexOf('\n## ', a.indexOf('## HERO IDENTITY') + 1)).toBeGreaterThanOrEqual(prefixEnd);
    });

    it('at the identity caps the live character block does not grow by a byte; the whole delta lands in the prefix', () => {
        const bare = prompt({ character: makeCharacter({ appearance: APPEARANCE_AT_CAP }) });
        const unit = prompt({ character: makeCharacter({ appearance: APPEARANCE_AT_CAP, gender: 'x', background: 'y' }) });
        const capped = prompt({ character: makeCharacter({ appearance: APPEARANCE_AT_CAP, gender: GENDER_AT_CAP, background: BACKGROUND_AT_CAP }) });

        // The live block is byte-for-byte the same size whatever the identity text is.
        expect(characterBlock(unit).length).toBe(characterBlock(bare).length);
        expect(characterBlock(capped).length).toBe(characterBlock(bare).length);

        // The two labels' fixed bytes, measured (one char of gender + one of background).
        const labelBytes = identityBlock(unit).length - identityBlock(bare).length - 2;
        expect(labelBytes).toBeGreaterThan(100);
        // At the caps the identity block grows by exactly 60 + 2,000 + the labels...
        const identityDelta = identityBlock(capped).length - identityBlock(bare).length;
        expect(identityDelta).toBe(60 + 2000 + labelBytes);
        // ...and every one of those bytes precedes the PLAYER CHARACTER heading.
        expect(capped.indexOf('## PLAYER CHARACTER') - bare.indexOf('## PLAYER CHARACTER')).toBe(identityDelta);
        expect(capped.length - bare.length).toBe(identityDelta);
    });

    it('appearance stays in the live block (the Scribe merges it), never in the cached identity', () => {
        const text = prompt({ character: makeCharacter({ gender: 'woman', appearance: APPEARANCE_AT_CAP, background: 'Born poor.' }) });
        expect(identityBlock(text)).not.toContain('Appearance');
        expect(characterBlock(text)).toContain('**Appearance (established canon — keep it exactly consistent in narration):** ');
        // The character block's 300-char appearance clamp still applies there.
        expect(characterBlock(text)).toContain(APPEARANCE_AT_CAP.slice(0, 300));
        expect(characterBlock(text)).not.toContain(APPEARANCE_AT_CAP.slice(0, 301));
    });

    it('clamps gender to 60 and background to 2,000 and renders only the name when both are empty', () => {
        const over = prompt({ character: makeCharacter({ gender: 'g'.repeat(500), background: 'b'.repeat(5000) }) });
        expect(identityBlock(over)).toContain(`- **Gender:** ${'g'.repeat(60)}`);
        expect(identityBlock(over)).not.toContain('g'.repeat(61));
        expect(identityBlock(over)).toContain('b'.repeat(2000));
        expect(identityBlock(over)).not.toContain('b'.repeat(2001));

        const empty = prompt({ character: makeCharacter({ gender: '', background: '   ' }) });
        expect(identityBlock(empty).trimEnd()).toBe('## HERO IDENTITY (who the player character is — constant for this campaign)\n- **Name:** Astra');
    });

    it('still ends the prefix without a premise, and a typed-wrong identity field renders nothing rather than throwing', () => {
        const noPremise = prompt({ premise: '', character: makeCharacter({ gender: { pronouns: 'she' }, background: ['x'] }) });
        expect(noPremise).not.toContain('## CAMPAIGN PREMISE');
        const identityAt = noPremise.indexOf('## HERO IDENTITY');
        expect(identityAt).toBeGreaterThan(noPremise.indexOf('## ITEM CATALOG'));
        expect(identityAt).toBeLessThan(noPremise.indexOf('## PLAYER CHARACTER'));
        expect(identityBlock(noPremise)).not.toContain('Gender');
        expect(identityBlock(noPremise)).not.toContain('[object Object]');
        expect(noPremise).not.toContain('[object Object]');
    });

    it('renders no identity block without a character', () => {
        expect(prompt({ character: null })).not.toContain('## HERO IDENTITY');
    });
});
