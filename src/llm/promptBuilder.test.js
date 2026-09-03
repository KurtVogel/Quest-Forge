/**
 * General coverage for buildSystemPrompt's own assembly logic and the
 * block-builder helpers not already exercised by the feature-specific
 * promptBuilder.*.test.js files (fronts, story memory, action surge, combat pacing).
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, PROMPT_CHAR_BUDGET } from './promptBuilder.js';

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

    it('prescribes exactly one death-save channel per combat state (2026-08-31 P2)', () => {
        // (The static combat-notes rule mentions the exchange slot in general
        // terms; these assertions pin the DYNAMIC dying instructions, which
        // used to prescribe both channels at once.)
        // Out of combat: only the requested_rolls lane — the exchange slot has
        // no machine to resolve it.
        const outOfCombat = prompt({ character: makeCharacter({ dying: true }) });
        expect(outOfCombat).toContain('Request { "type": "death_save" } as their roll each round.');
        expect(outOfCombat).toContain('Request { "type": "death_save" } via requested_rolls each round.');
        expect(outOfCombat).not.toContain('Declare { "action": "death_save" }');
        expect(outOfCombat).not.toContain('Their only player slot is');
        // Mid-combat: only the combat_exchange slot — requested_rolls are
        // rejected while combat is active.
        const inCombat = prompt({
            character: makeCharacter({ dying: true }),
            combat: { active: true, enemies: [], turnOrder: [], round: 1 },
        });
        expect(inCombat).toContain('Declare { "action": "death_save" } as their only player slot in each combat_exchange.');
        expect(inCombat).toContain('Their only player slot is { "action": "death_save" } inside combat_exchange.');
        expect(inCombat).not.toContain('Request { "type": "death_save" }');
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

    it('tells the DM that a premise-fixed price is canon over the catalog (2026-09-03 money playtests)', () => {
        // Both Gemini and OpenAI refused a premise-priced potion by quoting the
        // catalog's 50 gp, and both renegotiated a premise-fixed delivery fee.
        const text = prompt({});
        expect(text).toContain('A price the CAMPAIGN PREMISE fixes is canon.');
        expect(text).toContain('overrides the catalog\'s list price');
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
        // Stutter guard (playtest #14): stance emission is a full rewrite of the
        // stored record, never a this-turn fragment that appends a contradiction.
        expect(text).toContain('REWRITE of the whole record');
        expect(text).toContain('restating still-true parts in their existing wording');
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

    it('caps the Carried list, prioritizing mechanical items and keeping equipped complete', () => {
        // 2026-08-05 audit: a hoarder campaign paid ~1k tokens/turn in carried
        // annotations. 30 misc trinkets + 2 unequipped mechanical items → the
        // mechanical items always render, the oldest trinkets overflow.
        const inventory = [
            { id: 'sword', name: 'Spare Longsword', type: 'weapon', damage: '1d8', equipped: false },
            { id: 'potion', name: 'Healing Potion', type: 'consumable', equipped: false },
            ...Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, name: `Trinket ${i}`, type: 'gear', equipped: false })),
            { id: 'armor', name: 'Chain Mail', type: 'armor', armorType: 'heavy', baseAC: 16, equipped: true },
        ];
        const text = prompt({ inventory });
        expect(text).toContain('Chain Mail'); // equipped always complete
        expect(text).toContain('Spare Longsword');
        expect(text).toContain('Healing Potion');
        expect(text).toContain('Trinket 29'); // newest minor kept
        expect(text).not.toContain('Trinket 0'); // oldest minor overflowed
        expect(text).toContain('…and 7 more minor items (still owned; full list in the Inventory panel)');
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

    it('caps the rendered block at the newest 12, keeping older names in an overflow line', () => {
        const quests = Array.from({ length: 15 }, (_, i) => ({
            id: `q${i}`, name: `Quest ${i}`, description: `Details ${i}`, status: 'active',
        }));
        const text = prompt({ quests });
        // Newest 12 render fully; the 3 oldest keep name-only presence.
        expect(text).toContain('**Quest 14**');
        expect(text).toContain('**Quest 3**');
        expect(text).not.toContain('**Quest 2**');
        expect(text).toContain('…plus 3 older active quest(s), tracked and still open: Quest 0, Quest 1, Quest 2');
    });

    it('clamps a parser-max description to ~250 chars in the prompt only', () => {
        const text = prompt({
            quests: [{ id: 'q1', name: 'Long tale', description: 'x'.repeat(800), status: 'active' }],
        });
        expect(text).toContain('x'.repeat(250) + '…');
        expect(text).not.toContain('x'.repeat(251));
    });
});

describe('recent rolls block', () => {
    it('shows the most recent rolls with critical markers on ATTACK rolls', () => {
        const text = prompt({
            rollHistory: [
                { description: 'Attack roll', notation: '1d20', total: 20, rolls: [20], modifier: 0, isCritical: true, kind: 'attack' },
                { description: 'Attack roll', notation: '1d20', total: 1, rolls: [1], modifier: 0, isCritFail: true, kind: 'attack' },
            ],
        });
        expect(text).toContain('## RECENT DICE ROLLS');
        expect(text).toContain('★ CRITICAL HIT!');
        expect(text).toContain('✗ CRITICAL FAIL!');
    });

    it('labels a natural 20 on a check, save, or initiative as a natural 20 — never a critical HIT (2026-09-01 P2)', () => {
        // 5e has no crits on checks/saves; the RNG-layer flag is kind-blind
        // and the old rendering told the DM a Perception 20 was a critical hit.
        const text = prompt({
            rollHistory: [
                { description: 'Perception check', notation: '1d20', total: 22, rolls: [20], modifier: 2, isCritical: true },
                { description: 'Initiative', notation: '1d20', total: 21, rolls: [20], modifier: 1, isCritical: true },
                { description: 'Death Saving Throw', notation: '1d20', total: 1, rolls: [1], modifier: 0, isCritFail: true },
            ],
        });
        expect(text).not.toContain('CRITICAL HIT');
        expect(text).not.toContain('CRITICAL FAIL');
        expect(text).toContain('Perception check: **22** (20 +2) (natural 20)');
        expect(text).toContain('Initiative: **21** (20 +1) (natural 20)');
        expect(text).toContain('Death Saving Throw: **1** (1) (natural 1)');
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
    it('does not duplicate the quest list the ACTIVE QUESTS block already carries', () => {
        // 2026-08-04 audit: the reminder re-listed every active quest name a few
        // hundred lines below the full block — pure token spend.
        const text = prompt({ quests: [{ id: 'q1', name: 'Find the relic', status: 'active' }] });
        expect(text).toContain('## ACTIVE QUESTS');
        expect(text).not.toContain('Active quests in progress');
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

describe('DM REMINDERS threat re-injection (2026-08-18 audit)', () => {
    const reminderBlock = text => (text.split('## DM REMINDERS — MAINTAIN THESE PRESSURES')[1] ?? '').split('\n## ')[0];

    it('renders only the 6 newest threat facts, each line clamped to 200 chars', () => {
        const worldFacts = Array.from({ length: 10 }, (_, i) => ({
            id: `t-${i}`,
            timestamp: i,
            category: 'event',
            fact: `Threat ${i}: a bounty stands on the hero. ${'x'.repeat(400)}`,
        }));
        const block = reminderBlock(prompt({ worldFacts }));
        const lines = block.split('\n').filter(line => line.startsWith('- Threat'));
        // Newest first, capped at 6 — facts 9 down to 4; 0-3 aged out of the reminders.
        expect(lines.map(line => line.slice(0, 10).trim())).toEqual(
            ['- Threat 9', '- Threat 8', '- Threat 7', '- Threat 6', '- Threat 5', '- Threat 4']
        );
        for (const line of lines) {
            expect(line.length).toBeLessThanOrEqual('- '.length + 200);
        }
    });

    it("no longer bills ordinary 'before the' prose facts as standing threats", () => {
        const worldFacts = [{
            id: 'vow',
            timestamp: 1,
            category: 'lore',
            fact: 'The hero swore the lantern vow before the shrine of the drowned god.',
        }];
        expect(prompt({ worldFacts })).not.toContain('Active threats/pressures');
    });
});

describe('prompt size budget (tripwire against unbounded growth)', () => {
    /** Deterministic filler that reaches exactly `len` characters. */
    function longText(seed, len) {
        return seed.repeat(Math.ceil(len / seed.length)).slice(0, len);
    }

    it('keeps a deliberately maxed-out mature-campaign prompt under PROMPT_CHAR_BUDGET', () => {
        const messageCount = 400;

        const character = makeCharacter({
            class: 'cleric',
            level: 10,
            exp: 61000,
            currentHP: 21,
            maxHP: 68,
            gender: longText('a battle-scarred woman of the border shrines ', 60),
            appearance: longText('Tall and broad-shouldered, silver-streaked black hair in a crown braid, a burn scar across the left jaw, hands wrapped in prayer cords. ', 600),
            background: longText('Raised in the toll-shrines of the flooded delta, she buried three brothers before her twentieth year and swore the lantern vow against the drowned god\'s tithe-takers. ', 2000),
            abilityScores: { strength: 14, dexterity: 10, constitution: 16, intelligence: 10, wisdom: 18, charisma: 12 },
            savingThrowProficiencies: ['wisdom', 'charisma'],
            skillProficiencies: ['insight', 'medicine', 'religion', 'persuasion'],
            expertiseSkills: [],
            conditions: ['Poisoned', 'Frightened'],
            classResources: { channelDivinity: { used: 1, max: 2 } },
            hitDice: { total: 10, remaining: 4, die: 8 },
            spellSlots: {
                1: { used: 2, max: 4 }, 2: { used: 1, max: 3 }, 3: { used: 0, max: 3 },
                4: { used: 1, max: 3 }, 5: { used: 0, max: 2 },
            },
            sustainedSpell: { key: 'shieldOfFaith', name: 'Shield of Faith', acBonus: 2, targetType: 'self' },
            pendingAbilityScoreImprovements: 1,
            traits: ['Darkvision', 'Dwarven Resilience', 'Stonecunning'],
            features: ['Channel Divinity', 'Turn Undead', 'Destroy Undead', 'Divine Domain'],
        });

        const npcs = Array.from({ length: 12 }, (_, i) => ({
            id: `npc-${i}`,
            name: `Dossier Notable ${i}`,
            kind: 'character',
            rosterTier: 'character',
            disposition: 'wary',
            gender: 'woman',
            importance: 5,
            pinned: i < 4,
            trust: 60,
            basedIn: 'Kolkanmaa Delta',
            lastLocation: 'Jewelglade',
            lastNotes: longText(`Notable ${i} brokered the weir-toll truce and still holds the hero's marker from the flood night. `, 300),
            appearance: longText('Rope-scarred forearms, a tin votive round the neck, half an ear lost to the tithe-takers, eyes the grey of floodwater. ', 600),
            personality: longText('Outwardly patient and ledger-minded, privately sentimental about debts of rescue and merciless about debts of coin. ', 600),
            goals: longText('Wants the weir-tolls back in local hands and the drowned god\'s tithe barges burned to the waterline before the spring flood. ', 600),
            secrets: longText('Has been feeding barge schedules to the tithe-takers under duress since her son was taken as surety last winter. ', 600),
            agenda: longText('Is quietly buying grain against a flood-season famine and needs the hero seen at her side in the market to steady prices. ', 600),
            relationshipTension: longText('Owes the hero her life but resents that the rescue is known; every public thanks costs her standing with the weir-guild. ', 600),
            stanceToPlayer: longText('Trusts the hero with her ledgers and her son\'s name, flinches when they draw steel indoors, and is slowly letting warmth show through the broker\'s mask. ', 600),
            bondMoments: Array.from({ length: 6 }, (_, j) => ({
                text: longText(`Moment ${j}: the hero stood surety for her at the weir-court and paid the fine in front of the whole guild. `, 200),
                at: j,
            })),
            callbackHooks: Array.from({ length: 5 }, (_, j) => longText(`Hook ${j}: the unopened letter from the tithe-barge still sits sealed in her strongbox. `, 120)),
            relationshipHistory: [{ from: 'hostile', to: 'wary', at: 3 }],
        }));

        const party = Array.from({ length: 3 }, (_, i) => ({
            id: `comp-${i}`,
            name: `Dossier Notable ${i}`,
            role: 'shieldbearer',
            level: 8,
            hp: 40 - i * 12,
            maxHp: 52,
            ac: 17,
            weapon: 'Longsword +2',
            attackBonus: 6,
            damage: '1d8+4',
            weaponBonus: 2,
            affinity: 85,
            status: i === 2 ? 'downed' : 'healthy',
            conditions: i === 1 ? ['prone', 'poisoned'] : [],
            keepsakes: Array.from({ length: 5 }, (_, j) => longText(`keepsake ${j}: a river-glass pendant from the ford night `, 80)),
        }));

        const inventory = Array.from({ length: 24 }, (_, i) => ({
            id: `item-${i}`,
            name: `Campaign Relic ${i} of the Drowned Vow`,
            type: i % 4 === 0 ? 'weapon' : 'gear',
            damage: i % 4 === 0 ? '1d8' : undefined,
            damageType: i % 4 === 0 ? 'slashing' : undefined,
            quantity: (i % 3) + 1,
            valueCp: 1500 + i,
            equipped: i < 3,
        }));

        const quests = Array.from({ length: 10 }, (_, i) => ({
            id: `quest-${i}`,
            name: `Standing Obligation ${i}`,
            status: 'active',
            description: longText(`Recover the weir-deed ${i} from the tithe-barge before the spring flood, without the guild learning who paid for the job. `, 300),
        }));

        // 60 facts, every one threat-shaped ("hunting"/"bounty"/"deadline"), so this
        // fixture also sweeps the DM REMINDERS threat re-injection cap: production
        // growth in worldFacts must never re-bloat the reminders block (2026-08-18).
        const worldFacts = Array.from({ length: 60 }, (_, i) => ({
            id: `fact-${i}`,
            timestamp: i,
            category: ['event', 'location', 'faction', 'lore'][i % 4],
            // 400 chars = WORLD_FACT_MAX_LENGTH, the reducer's clamp.
            fact: longText(`Canonical truth ${i}: the tithe-barge fleet is hunting the hero and a bounty stands posted at every weir before the flood deadline. `, 400),
        }));

        const journal = Array.from({ length: 12 }, (_, i) => ({
            id: `journal-${i}`,
            location: i >= 10 ? 'Jewelglade' : `Waystation ${i}`,
            // 2000 chars = the journal summary clamp.
            summary: longText(`Chapter ${i}: the party crossed the drowned causeway, bargained with the weir-guild, lost the pack mule to the tithe-takers, and swore the lantern vow again at the shrine. `, 2000),
            consequences: [
                longText('The weir-guild now owes the hero a flood-season favor. ', 200),
                longText('The tithe-takers know which road the party took. ', 200),
            ],
        }));

        const storyMemory = Array.from({ length: 10 }, (_, i) => ({
            id: `mem-${i}`,
            type: 'promise',
            salience: 4,
            subject: `the lantern vow ${i}`,
            linkedNpcNames: ['Dossier Notable 1', 'Dossier Notable 2'],
            location: 'Jewelglade',
            text: longText(`The hero promised ${i} to return the weir-deed before the spring flood or forfeit the shrine lantern. `, 300),
        }));

        const retrievedMemories = Array.from({ length: 8 }, (_, i) => ({
            category: i % 2 === 0 ? 'journal' : 'player',
            location: 'Jewelglade',
            text: longText(`Retrieved memory ${i}: three sessions ago the hero spared the tithe-captain at the ford and took his signet as surety. `, 400),
        }));

        const combat = {
            active: true,
            round: 6,
            phase: 'awaiting_player',
            surprise: 'none',
            bonusActionUsed: true,
            flankedEnemyIds: ['tithe-guard-1', 'tithe-guard-2'],
            enemies: Array.from({ length: 6 }, (_, i) => ({
                id: `tithe-guard-${i}`,
                name: `Tithe-Guard Veteran ${i}`,
                hp: 20 - i * 3,
                maxHp: 26,
                ac: 16,
                attackBonus: 5,
                damage: '1d10+3',
                condition: i > 3 ? 'critical' : 'bloodied',
                conditions: i % 2 === 0 ? ['prone', 'frightened'] : [],
                combatStatus: 'active',
                defending: i === 5,
            })),
            turnOrder: Array.from({ length: 10 }, (_, i) => ({ name: `Combatant ${i}`, initiative: 20 - i })),
            currentTurn: 2,
        };

        const fronts = Array.from({ length: 4 }, (_, i) => ({
            id: `front-${i}`,
            status: 'active',
            clock: 4,
            stage: 2,
            goal: `Front ${i} wants the delta tolls`,
            faction: { name: `Faction ${i} of the Drowned Tithe`, goal: 'Claim every weir before the flood' },
        }));

        const recentRulings = Array.from({ length: 5 }, (_, i) => ({
            objective: longText(`Convince the weir-clerk ${i} to unseal the toll ledgers without guild countersign `, 160),
            skill: 'persuasion',
            dc: 12,
            outcome: i % 2 === 0 ? 'withdrawn' : 'set_aside',
            finalRuling: i === 3,
            challenge: 'The clerk already owes the hero a flood-debt',
            atMessageCount: messageCount - i,
            location: 'Jewelglade',
            t: Date.now(),
        }));

        const text = buildSystemPrompt({
            character,
            inventory,
            quests,
            rollHistory: Array.from({ length: 8 }, (_, i) => ({
                description: `Persuasion check ${i} against the weir-guild council`,
                notation: '1d20+5',
                total: 14 + (i % 6),
                rolls: [9 + (i % 6)],
                modifier: 5,
            })),
            preset: 'classicFantasy',
            ruleset: 'simplified5e',
            customSystemPrompt: longText('Grim, grounded low fantasy. Consequences are real, mercy is expensive, and the weather is always wrong. Describe smells and textures. ', 4000),
            journal,
            npcs,
            party,
            currentLocation: 'Jewelglade',
            combat,
            worldFacts,
            fronts,
            storyMemory,
            retrievedMemories,
            premise: longText('The barony of Kolkanmaa straddles a drowned river delta where toll-weirs hold back both the flood and the drowned god\'s tithe-barges. ', 8000),
            recentRulings,
            worldTempo: {
                directive: {
                    frontId: 'front-1',
                    maxIntensity: 'presence',
                    where: 'Jewelglade',
                    suggestedSymptom: 'A tithe-barge moors at the public weir flying quarantine colors',
                    activatesAtMessage: messageCount - 1,
                    expiresAtMessage: messageCount + 6,
                },
            },
            recentEncounters: Array.from({ length: 6 }, (_, i) => ({
                messageIndex: messageCount - 2 - i,
                name: `Skirmish ${i} at the weir`,
                outcome: 'victory',
            })),
            recentChecks: Array.from({ length: 4 }, (_, i) => ({ messageIndex: messageCount - 1 - i, dc: 15 })),
            paceDial: 'breakneck',
            messageCount,
        });

        // Sanity: the heavyweight dynamic blocks actually made it into the prompt —
        // an accidentally-omitted block would make the budget assertion meaningless.
        expect(text).toContain('## CAMPAIGN PREMISE');
        expect(text).toContain('## WORLD FACTS');
        expect(text).toContain('## KNOWN NPCs');
        expect(text).toContain('## COMPANIONS (PARTY)');
        expect(text).toContain('## DRAMATIC CALLBACK OPPORTUNITIES');
        expect(text).toContain('## RETRIEVED MEMORIES');
        expect(text).toContain('## ACTIVE COMBAT');
        expect(text).toContain('## WORLD TEMPO — PRIVATE PACING STATE');
        expect(text).toContain('## RECENT TABLE RULINGS — BINDING');

        // The threat re-injection cap held: 15 fact lines render in WORLD FACTS
        // and at most 6 (newest, clamped) in DM REMINDERS — never all 60.
        expect((text.match(/^- Canonical truth /gm) || []).length).toBe(15 + 6);

        // Measured 139,035 chars on 2026-07-30. If this trips, the prompt genuinely
        // grew — investigate the new weight before even thinking about the budget.
        expect(text.length).toBeLessThan(PROMPT_CHAR_BUDGET);
    });
});

