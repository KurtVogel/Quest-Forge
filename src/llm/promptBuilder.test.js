/**
 * General coverage for buildSystemPrompt's own assembly logic and the
 * block-builder helpers not already exercised by the feature-specific
 * promptBuilder.*.test.js files (fronts, story memory, action surge, combat pacing).
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';

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
        character: overrides.character ?? makeCharacter(),
        inventory: overrides.inventory ?? [],
        quests: overrides.quests ?? [],
        rollHistory: overrides.rollHistory ?? [],
        preset: overrides.preset ?? 'classicFantasy',
        ruleset: overrides.ruleset ?? 'simplified5e',
        customSystemPrompt: overrides.customSystemPrompt ?? '',
        journal: overrides.journal ?? [],
        npcs: overrides.npcs ?? [],
        party: overrides.party ?? [],
        currentLocation: overrides.currentLocation ?? 'Jewelglade',
        combat: overrides.combat ?? { active: false },
        worldFacts: overrides.worldFacts ?? [],
        fronts: overrides.fronts ?? [],
        storyMemory: overrides.storyMemory ?? [],
        retrievedMemories: overrides.retrievedMemories ?? [],
        premise: overrides.premise ?? '',
        recentRulings: overrides.recentRulings ?? [],
    });
}

describe('stable cache prefix (DECISIONS.md 2026-07-18)', () => {
    it('keeps every byte up through the premise identical across turns with different dynamic state', () => {
        const premise = 'The barony of Kolkanmaa is starving and the toll-weirs keep failing.';
        const a = prompt({ premise, customSystemPrompt: 'Grim, grounded tone.' });
        const b = prompt({
            premise,
            customSystemPrompt: 'Grim, grounded tone.',
            character: makeCharacter({ currentHP: 3, exp: 250, conditions: ['Poisoned'] }),
            party: [{ id: 'c1', name: 'Osma', hp: 9, maxHp: 18, ac: 16, level: 2, affinity: 60 }],
            quests: [{ id: 'q1', name: 'Find the wardens', status: 'active', description: 'x' }],
            worldFacts: [{ id: 'f1', fact: 'The Pike buys captives.', timestamp: 1 }],
            combat: { active: true, round: 2, enemies: [{ id: 'g1', name: 'Goblin', hp: 5, maxHp: 11, ac: 12 }], turnOrder: [] },
            rollHistory: [{ description: 'Stealth', total: 14, notation: '1d20+2', rolls: [12], modifier: 2 }],
        });
        const prefixEnd = a.indexOf(premise) + premise.length;
        expect(prefixEnd).toBeGreaterThan(1000);
        expect(b.slice(0, prefixEnd)).toBe(a.slice(0, prefixEnd));
    });

    it('places the static contract blocks in the prefix and only the short reminder at the tail', () => {
        const text = prompt({ premise: 'A premise.' });
        expect(text.indexOf('## RESPONSE FORMAT')).toBeLessThan(text.indexOf('## CAMPAIGN PREMISE'));
        expect(text.indexOf('## ITEM CATALOG')).toBeLessThan(text.indexOf('## CAMPAIGN PREMISE'));
        expect(text.indexOf('## RESPONSE FORMAT')).toBeLessThan(text.indexOf('## PLAYER CHARACTER'));
        expect(text.trimEnd().endsWith('never leave a required event out of the block.')).toBe(true);
    });
});

describe('recent table rulings block', () => {
    const baseRuling = {
        objective: 'Convince Maren to share gossip about Odo',
        skill: 'persuasion',
        dc: 12,
        atMessageCount: 4,
        location: 'Jewelglade',
        t: Date.now(),
    };

    it('is absent when there are no recent rulings', () => {
        expect(prompt()).not.toContain('RECENT TABLE RULINGS');
    });

    it('binds a withdrawn ruling to no-dice resolution', () => {
        const text = prompt({ recentRulings: [{ ...baseRuling, outcome: 'withdrawn', challenge: 'No opposition here', finalRuling: false }] });
        expect(text).toContain('## RECENT TABLE RULINGS — BINDING');
        expect(text).toContain('WITHDREW');
        expect(text).toContain('persuasion DC 12');
        expect(text).toContain('Convince Maren to share gossip about Odo');
        expect(text).toContain('without dice');
    });

    it('demands the identical check when a set-aside proposal is retried', () => {
        const text = prompt({ recentRulings: [{ ...baseRuling, outcome: 'set_aside', finalRuling: false }] });
        expect(text).toContain('SET ASIDE');
        expect(text).toContain('SAME check unchanged');
    });

    it('keeps an upheld final ruling final after a set-aside', () => {
        const text = prompt({ recentRulings: [{ ...baseRuling, outcome: 'set_aside', finalRuling: true }] });
        expect(text).toContain('FINAL post-challenge ruling');
        expect(text).toContain('challenge is already spent');
    });
});

describe('companion gear prompt contract (COMPANION_GEAR_SPEC.md)', () => {
    it('documents the gear fields and the companion-gear rule in the static blocks', () => {
        const text = prompt();
        expect(text).toContain('"weapon": "Longsword +1"');
        expect(text).toContain('**COMPANION GEAR:**');
        expect(text).toContain('NEVER supply "damage" or "attackBonus" for a gear change');
    });

    it('folds a companion weaponBonus into the party block attack line', () => {
        const text = prompt({
            party: [{ id: 'c1', name: 'Kaarina', role: 'shieldmaiden', level: 2, hp: 18, maxHp: 18, ac: 16, weapon: 'Longsword +1', attackBonus: 3, damage: '1d8+2', weaponBonus: 1, affinity: 60, status: 'healthy' }],
        });
        expect(text).toContain('Longsword +1 +4 (1d8+2+1)');
    });
});

describe('buildSystemPrompt top-level assembly', () => {
    it('always includes the core DM instructions and response format', () => {
        const text = prompt();
        expect(text).toContain('# YOU ARE THE DUNGEON MASTER');
        expect(text).toContain('## RESPONSE FORMAT');
    });

    it('always includes the out-of-character table-talk rule', () => {
        const text = prompt();
        expect(text).toContain('## OUT-OF-CHARACTER TABLE TALK');
        expect(text).toMatch(/never as character actions/i);
    });

    it('forbids re-granting items the hero already owns and merely uses', () => {
        const text = prompt();
        expect(text).toContain('items_found is ONLY for items NEWLY entering the hero\'s possession');
        expect(text).toMatch(/flint and steel, torch, or rope grants NOTHING/i);
    });

    it('shows the hero\'s established appearance so DM prose stays visually consistent', () => {
        const text = prompt({
            character: makeCharacter({ appearance: 'A scarred human fighter with a shaved head and a notched ear.' }),
        });
        expect(text).toContain('**Appearance (established canon — keep it exactly consistent in narration):** A scarred human fighter');
    });

    it('omits the appearance line until a look is established', () => {
        const text = prompt();
        expect(text).not.toContain('Appearance (established canon');
    });

    it('includes the simplified 5e ruleset block when requested', () => {
        const text = prompt({ ruleset: 'simplified5e' });
        expect(text).toContain('## GAME MECHANICS (Simplified D&D 5e)');
        expect(text).not.toContain('## GAME MECHANICS (Narrative Mode)');
    });

    it('falls back to the narrative ruleset block for any other value', () => {
        const text = prompt({ ruleset: 'narrative' });
        expect(text).toContain('## GAME MECHANICS (Narrative Mode)');
        expect(text).not.toContain('## GAME MECHANICS (Simplified D&D 5e)');
    });

    it('includes the preset tone/setting section for a known preset', () => {
        const text = prompt({ preset: 'classicFantasy' });
        expect(text).toContain('## SETTING & TONE');
    });

    it('omits the setting/tone section for an unknown preset key', () => {
        const text = prompt({ preset: 'not-a-real-preset' });
        expect(text).not.toContain('## SETTING & TONE');
    });

    it('includes custom DM instructions when provided', () => {
        const text = prompt({ customSystemPrompt: 'Always describe smells vividly.' });
        expect(text).toContain('## CUSTOM DM INSTRUCTIONS (from the player)');
        expect(text).toContain('Always describe smells vividly.');
    });

    it('omits custom DM instructions when blank or whitespace-only', () => {
        const text = prompt({ customSystemPrompt: '   ' });
        expect(text).not.toContain('## CUSTOM DM INSTRUCTIONS');
    });

    it('includes the campaign premise block, marked as permanent canon', () => {
        const text = prompt({ premise: 'The hero was exiled from Vantry for a crime they did not commit.' });
        expect(text).toContain('## CAMPAIGN PREMISE');
        expect(text).toContain('permanent canon');
        expect(text).toContain('exiled from Vantry');
    });

    it('omits the campaign premise block when there is no premise', () => {
        const text = prompt({ premise: '' });
        expect(text).not.toContain('## CAMPAIGN PREMISE');
    });
});

describe('low-level solo safety block', () => {
    it('is included for a solo level-1 character', () => {
        const text = prompt({ character: makeCharacter({ level: 1 }), party: [] });
        expect(text).toContain('HARD SYSTEM CONSTRAINT — LOW-LEVEL SOLO SAFETY');
        expect(text).toContain('Level 1 solo budget');
    });

    it('uses the level-2 budget wording for a solo level-2 character', () => {
        const text = prompt({ character: makeCharacter({ level: 2 }), party: [] });
        expect(text).toContain('Level 2 solo budget');
    });

    it('is omitted once the character outgrows the low-level window', () => {
        const text = prompt({ character: makeCharacter({ level: 3 }), party: [] });
        expect(text).not.toContain('HARD SYSTEM CONSTRAINT — LOW-LEVEL SOLO SAFETY');
    });

    it('is omitted when the character has a battle-ready companion even at low level', () => {
        const text = prompt({ character: makeCharacter({ level: 1 }), party: [{ id: 'c1', name: 'Garrick', hp: 12, maxHp: 18, status: 'healthy' }] });
        expect(text).not.toContain('HARD SYSTEM CONSTRAINT — LOW-LEVEL SOLO SAFETY');
    });

    it('stays active when the only companion is downed — the hero is effectively solo', () => {
        const text = prompt({ character: makeCharacter({ level: 1 }), party: [{ id: 'c1', name: 'Garrick', hp: 0, maxHp: 18, status: 'downed' }] });
        expect(text).toContain('HARD SYSTEM CONSTRAINT — LOW-LEVEL SOLO SAFETY');
    });
});

describe('character block', () => {
    it('shows DEAD status', () => {
        const text = prompt({ character: makeCharacter({ isDead: true }) });
        expect(text).toContain('**STATUS: DEAD**');
    });

    it('shows DEFEATED status for a non-lethal low-level setback', () => {
        const text = prompt({ character: makeCharacter({ lowLevelDefeat: true }) });
        expect(text).toContain('**STATUS: DEFEATED**');
        expect(text).toContain('do NOT request death saves');
    });

    it('shows DYING status with death save tally', () => {
        const text = prompt({ character: makeCharacter({ dying: true, deathSaves: { successes: 1, failures: 2 } }) });
        expect(text).toContain('**STATUS: DYING**');
        expect(text).toContain('1/3 successes, 2/3 failures');
    });

    it('lists class resources with remaining uses', () => {
        const text = prompt({
            character: makeCharacter({
                class: 'cleric',
                classResources: { channelDivinity: { used: 0, max: 1 } },
            }),
        });
        expect(text).toContain('channelDivinity: 1/1');
    });

    it('shows a hit dice line when hitDice is present', () => {
        const text = prompt({ character: makeCharacter({ hitDice: { remaining: 2, total: 3, die: 10 } }) });
        expect(text).toContain('**Hit Dice:** 2/3 d10');
    });

    it('shows a pending Ability Score Improvement reminder', () => {
        const text = prompt({ character: makeCharacter({ pendingAbilityScoreImprovements: 2 }) });
        expect(text).toContain('**Pending Ability Score Improvement:** 2');
    });

    it('lists traits and features when present', () => {
        const text = prompt({ character: makeCharacter({ traits: ['Brave'], features: ['Second Wind'] }) });
        expect(text).toContain('**Traits:** Brave');
        expect(text).toContain('**Features:** Second Wind');
    });
});

describe('party block', () => {
    it('lists companions with computed status and affinity', () => {
        const text = prompt({
            party: [
                { id: 'c1', name: 'Garrick', role: 'guard', level: 2, hp: 10, maxHp: 10, ac: 14, weapon: 'Longsword', attackBonus: 3, damage: '1d8+3', affinity: 60 },
                { id: 'c2', name: 'Mira', level: 1, hp: 0, maxHp: 8, ac: 12, affinity: 40, conditions: ['prone'] },
            ],
        });
        expect(text).toContain('## COMPANIONS (PARTY)');
        expect(text).toContain('**Garrick**');
        expect(text).toContain('Status: healthy');
        expect(text).toContain('**Mira**');
        expect(text).toContain('Status: downed');
        expect(text).toContain('Conditions: prone');
    });

    it('is omitted when there is no party', () => {
        const text = prompt({ party: [] });
        expect(text).not.toContain('## COMPANIONS');
    });

    it('renders creation identity fields (gender + background) in the character block', () => {
        const text = prompt({
            character: makeCharacter({
                gender: 'nonbinary',
                appearance: 'White hair in a tight braid.',
                background: 'A disgraced lamplighter who still knows every toll-gate code.',
            }),
        });
        expect(text).toContain('- **Gender:** nonbinary');
        expect(text).toContain('**Appearance (established canon');
        expect(text).toContain('player-authored personal canon');
        expect(text).toContain('A disgraced lamplighter who still knows every toll-gate code.');
    });

    it('omits gender and background lines when the fields are empty', () => {
        const text = prompt({});
        expect(text).not.toContain('- **Gender:**');
        expect(text).not.toContain('player-authored personal canon');
    });

    it('surfaces the companion\'s roster stance and bond moments on the party line', () => {
        const text = prompt({
            party: [
                { id: 'c1', name: 'Kaarina', role: 'shieldmaiden', level: 2, hp: 18, maxHp: 18, ac: 15, weapon: 'Longsword +1', attackBonus: 4, damage: '1d8+2', affinity: 75 },
            ],
            npcs: [
                {
                    id: 'npc-1', name: 'Kaarina', disposition: 'friendly', rosterTier: 'character', kind: 'character',
                    stanceToPlayer: 'Trusts the hero with her life after the ford rescue; hides how much his recklessness frightens her.',
                    bondMoments: [
                        { text: 'The hero pulled Kaarina from the river at the ford.', at: 1 },
                        { text: 'Kaarina gave the hero her mother\'s iron ring.', at: 2 },
                    ],
                },
            ],
        });
        expect(text).toContain('Toward the hero: Trusts the hero with her life');
        expect(text).toContain('Personal history with the hero: The hero pulled Kaarina from the river at the ford.; Kaarina gave the hero her mother\'s iron ring.');
        // The DM contract: stance/bond updates route through npc_updates, not update_companions.
        expect(text).toContain('`npc_updates` with `stanceToPlayer`');
    });

    it('renders a plain party line when the companion has no roster dossier', () => {
        const text = prompt({
            party: [
                { id: 'c1', name: 'Terho', level: 1, hp: 9, maxHp: 9, ac: 12, affinity: 50 },
            ],
        });
        expect(text).toContain('**Terho**');
        expect(text).not.toContain('Toward the hero:');
        expect(text).not.toContain('Personal history with the hero:');
    });
});

describe('inventory block', () => {
    it('separates equipped and carried items with mechanical annotations', () => {
        const text = prompt({
            character: makeCharacter({ class: 'wizard', skillProficiencies: [] }),
            inventory: [
                { id: 'i1', name: 'Chain Mail', type: 'armor', armorType: 'heavy', baseAC: 16, equipped: true },
                { id: 'i2', name: 'Shield', type: 'shield', isShield: true, shieldAC: 2, equipped: true },
                { id: 'i3', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', damageType: 'slashing', attackBonus: 0, equipped: true },
                { id: 'i4', name: 'Torch', type: 'gear', quantity: 3, valueCp: 1, equipped: false },
            ],
        });
        expect(text).toContain('## INVENTORY');
        expect(text).toContain('**Equipped:**');
        expect(text).toContain('[AC 16, heavy armor]');
        expect(text).toContain('[+2 AC shield]');
        expect(text).toContain('[1d8 slashing]');
        expect(text).toContain('**Carried:**');
        expect(text).toContain('Torch (x3)');
        expect(text).toContain('NOT proficient');
    });

    it('is omitted when inventory is empty', () => {
        const text = prompt({ inventory: [] });
        expect(text).not.toContain('## INVENTORY');
    });
});

describe('quest block', () => {
    it('lists only active quests', () => {
        const text = prompt({
            quests: [
                { id: 'q1', name: 'Find the relic', description: 'It was lost long ago.', status: 'active' },
                { id: 'q2', name: 'Old business', description: 'Already done.', status: 'completed' },
            ],
        });
        expect(text).toContain('## ACTIVE QUESTS');
        expect(text).toContain('Find the relic');
        expect(text).not.toContain('Old business');
    });

    it('is omitted when there are no active quests', () => {
        const text = prompt({ quests: [{ id: 'q1', name: 'Done', status: 'completed' }] });
        expect(text).not.toContain('## ACTIVE QUESTS');
    });
});

describe('recent rolls block', () => {
    it('shows the most recent rolls with critical markers', () => {
        const text = prompt({
            rollHistory: [
                { description: 'Attack roll', notation: '1d20', total: 20, rolls: [20], modifier: 0, isCritical: true },
                { description: 'Save', notation: '1d20', total: 1, rolls: [1], modifier: 0, isCritFail: true },
            ],
        });
        expect(text).toContain('## RECENT DICE ROLLS');
        expect(text).toContain('★ CRITICAL HIT!');
        expect(text).toContain('✗ CRITICAL FAIL!');
    });

    it('is omitted when there is no roll history', () => {
        const text = prompt({ rollHistory: [] });
        expect(text).not.toContain('## RECENT DICE ROLLS');
    });
});

describe('world facts block', () => {
    it('groups facts by category and marks canonical status', () => {
        const text = prompt({
            worldFacts: [
                { fact: 'The bandit captain is dead.', category: 'event', timestamp: 2 },
                { fact: 'Thornhaven burned down.', category: 'location', timestamp: 1 },
            ],
        });
        expect(text).toContain('## WORLD FACTS (canonical — never contradict these)');
        expect(text).toContain('**[EVENT]**');
        expect(text).toContain('**[LOCATION]**');
        expect(text).toContain('The bandit captain is dead.');
    });

    it('shows an overflow note when there are more facts than the prompt limit', () => {
        const worldFacts = Array.from({ length: 20 }, (_, i) => ({ fact: `Fact ${i}`, category: 'general', timestamp: i }));
        const text = prompt({ worldFacts });
        expect(text).toContain('older facts available via RETRIEVED MEMORIES');
    });

    it('is omitted when there are no world facts', () => {
        const text = prompt({ worldFacts: [] });
        expect(text).not.toContain('## WORLD FACTS (canonical');
    });
});

describe('active constraints (DM reminders)', () => {
    it('reminds the DM of active quests', () => {
        const text = prompt({ quests: [{ id: 'q1', name: 'Find the relic', status: 'active' }] });
        expect(text).toContain('## DM REMINDERS — MAINTAIN THESE PRESSURES');
        expect(text).toContain('Active quests in progress: Find the relic');
    });

    it('surfaces world facts matching threat keywords', () => {
        const text = prompt({ worldFacts: [{ fact: 'A bounty hunter is pursuing the player.', category: 'event' }] });
        expect(text).toContain('Active threats/pressures:');
        expect(text).toContain('A bounty hunter is pursuing the player.');
    });

    it('reminds the DM the character is dead', () => {
        const text = prompt({ character: makeCharacter({ isDead: true }) });
        expect(text).toContain("The player's original character is dead");
    });

    it('reminds the DM the character is dying with death save counts', () => {
        const text = prompt({ character: makeCharacter({ dying: true, deathSaves: { successes: 2, failures: 1 } }) });
        expect(text).toContain('THE PLAYER IS DYING');
        expect(text).toContain('2/3 successes, 1/3 failures');
    });

    it('reminds the DM that low-level solo safety is active', () => {
        const text = prompt({ character: makeCharacter({ level: 1 }), party: [] });
        expect(text).toContain('Low-level solo safety is active');
    });

    it('is omitted entirely when nothing warrants a reminder', () => {
        const text = prompt({ character: makeCharacter({ level: 5 }), party: [{ id: 'c1' }], quests: [], worldFacts: [] });
        expect(text).not.toContain('## DM REMINDERS');
    });
});

describe('item catalog block', () => {
    it('is always included, independent of inventory', () => {
        const text = prompt({ inventory: [] });
        expect(text).toContain('## ITEM CATALOG (common mechanical items)');
    });
});

describe('loot persistence contract', () => {
    it('requires every narrated acquisition to carry its event in the same response', () => {
        const text = prompt();
        expect(text).toContain('EVERY narrated acquisition MUST carry its matching event in the SAME response');
        expect(text).toContain('Never attach loot to a response that proposes requested_rolls');
        expect(text).toContain('Purchases and sales are one-shot transaction events');
    });
});

describe(`spellcasting prompt contract`, () => {
    it(`injects the SPELLCASTING block with slots and spells for casters`, () => {
        const cleric = makeCharacter({
            class: `cleric`, level: 3,
            abilityScores: { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 },
            spellSlots: { 1: { used: 1, max: 4 }, 2: { used: 0, max: 2 } },
        });
        const text = prompt({ character: cleric });
        expect(text).toContain(`SPELLCASTING (engine-owned`);
        expect(text).toContain(`Spell slots remaining: L1 3/4`);
        expect(text).toContain(`Healing Word`);
        expect(text).toContain(`Spell save DC 13`); // 8 + prof 2 + WIS 3
        expect(text).toContain(`## SPELLCASTING INSTRUCTIONS`);
        expect(text).toContain(`"spell_cast"`);
    });

    it(`shows the active sustained spell and omits the block for non-casters`, () => {
        const sustained = makeCharacter({
            class: `wizard`, level: 1,
            spellSlots: { 1: { used: 0, max: 2 } },
            sustainedSpell: { key: `mageArmor`, name: `Mage Armor`, acBonus: 3, targetType: `self` },
        });
        expect(prompt({ character: sustained })).toContain(`Sustained spell active:`);
        expect(prompt()).not.toContain(`SPELLCASTING (engine-owned`);
    });
});
