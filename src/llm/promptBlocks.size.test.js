/**
 * Byte ceilings for every DYNAMIC prompt block, the prefix's byte-stability
 * across two live states, and the per-call-type dynamic half (2026-09-30
 * prompt-building Lap-3, test depth). The budget test builds ONE clean maxed
 * state and asserts the total under PROMPT_CHAR_BUDGET; nothing pinned the
 * prefix share, the intent call's half, or any block's own worst case — the
 * cheap insurance the 09-18 "no runtime ceiling" note asked for, in the
 * `directorContexts.size.test.js` shape: every list long, every text at its
 * cap, one pinned ceiling per block. A tripped ceiling means a block grew —
 * investigate the new weight, then move the number with the reason.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPromptParts, PROMPT_CHAR_BUDGET } from './promptBuilder.js';
import { createCharacter } from '../engine/characterUtils.js';
import { awardExperience, getExperienceThreshold } from '../engine/progression.js';

const fill = (label, length) => `${label} `.repeat(Math.ceil(length / (label.length + 1))).slice(0, length);
const ABILITY_SCORES = { strength: 14, dexterity: 10, constitution: 16, intelligence: 10, wisdom: 18, charisma: 12 };

function maxedNpc(i, extra = {}) {
    return {
        id: `n${i}`, name: `Notable Person ${i}`, rosterTier: 'character', kind: 'character', disposition: 'hostile', importance: 5, pinned: i < 3,
        gender: fill('woman', 40), species: fill('human', 40), trust: 55,
        appearance: fill(`look ${i}`, 600), personality: fill('personality', 600), goals: fill('goals', 600), secrets: fill('secret', 600),
        agenda: fill('agenda', 600), relationshipTension: fill('tension', 600), stanceToPlayer: fill('stance', 600), lastNotes: fill('notes', 600),
        openThread: fill('thread', 200), openThreadMessage: 300, lastSeenMessage: 390, lastLocation: 'Jewelglade', basedIn: 'Jewelglade',
        callbackHooks: Array.from({ length: 5 }, (_, k) => fill(`hook ${k}`, 160)),
        bondMoments: Array.from({ length: 10 }, (_, k) => ({ text: fill(`moment ${k}`, 300), at: k, atMessage: 20 + k * 30, kind: k % 2 ? 'promise' : 'rescue', salience: 5 })),
        recentImpressions: Array.from({ length: 6 }, (_, k) => ({ field: 'stanceToPlayer', text: fill(`impression ${k}`, 200), atMessage: 380 + k })),
        relationshipHistory: Array.from({ length: 6 }, (_, k) => ({ from: 'friendly', to: 'hostile', atMessage: 50 + k * 40 })),
        ...extra,
    };
}

function maxedState({ messageCount = 400, live = 0, inCombat = false } = {}) {
    const messages = Array.from({ length: messageCount }, (_, i) => ({
        id: `m${i}`, role: i % 2 ? 'assistant' : 'user',
        content: i === messageCount - 1 ? 'Notable Person 4 and Notable Person 5 wait at the weir with Companion 0.' : fill(`row ${i}`, 200),
    }));
    const party = Array.from({ length: 4 }, (_, i) => ({
        id: `c${i}`, name: `Companion ${i}`, hp: 9 + live, maxHp: 30, ac: 16, level: 5, affinity: 60, role: 'ally', weapon: 'Longsword +2', damage: '1d8+2', attackBonus: 5, weaponBonus: 2,
        conditions: ['Poisoned', 'Frightened'], keepsakes: Array.from({ length: 5 }, (_, k) => fill(`keepsake ${k}`, 120)), spellAcBonus: 2,
    }));
    const npcs = [
        ...Array.from({ length: 40 }, (_, i) => maxedNpc(i)),
        ...party.map((c, i) => maxedNpc(100 + i, { name: c.name, pinned: false })),
    ];
    const cardAt = (i, type) => ({
        id: `card-${type}-${i}`, type, status: 'active', salience: 5, emotionalCharge: 5, subject: fill(`subject ${i}`, 80),
        text: fill(`card ${type} ${i}`, 600), linkedNpcNames: Array.from({ length: 4 }, (_, k) => `Notable Person ${k}`), knownBy: ['Notable Person 1', 'Notable Person 2'],
        tags: Array.from({ length: 5 }, (_, k) => `tag${k}`), location: 'Jewelglade', lastSeenMessage: 390, score: 40 - i,
    });
    return {
        character: createCharacter('Testa Longname', 'dwarf', 'cleric', ABILITY_SCORES, ['insight', 'medicine', 'religion', 'persuasion']),
        characterExtras: {
            level: 10, currentHP: 21 + live, maxHP: 68, gender: fill('gender', 60), appearance: fill('appearance', 600), background: fill('background', 2000),
            conditions: ['Poisoned', 'Frightened', 'Prone'], hitDice: { total: 10, remaining: 4, die: 8 },
            spellSlots: { 1: { used: 2, max: 4 }, 2: { used: 1, max: 3 }, 3: { used: 0, max: 3 }, 4: { used: 1, max: 3 }, 5: { used: 0, max: 2 } },
            sustainedSpell: { key: 'shieldOfFaith', name: 'Shield of Faith', acBonus: 2, targetType: 'self' },
            pendingAbilityScoreImprovements: 1, pendingActionSurge: false,
        },
        inventory: Array.from({ length: 60 }, (_, i) => ({ id: `item-${i}`, name: fill(`Trade good ${i}`, 80), type: i < 3 ? 'weapon' : 'gear', quantity: 3, priceCp: 1250, damage: '1d8', equipped: i < 2, magicBonus: 1 })),
        quests: Array.from({ length: 30 }, (_, i) => ({ id: `q-${i}`, name: fill(`Errand ${i}`, 160), status: 'active', description: fill('quest description', 800), openedAtMessage: 10 + i })),
        rollHistory: Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, notation: '1d20+5', total: 17, rolls: [12], modifier: 5, description: fill(`roll ${i}`, 120), timestamp: i })),
        journal: Array.from({ length: 40 }, (_, i) => ({
            id: `j-${i}`, timestamp: i, location: i % 3 ? 'Brackwater' : 'Jewelglade', messageRange: [i * 10, i * 10 + 10],
            summary: fill(`Entry ${i} summary`, 2000),
            keyDecisions: Array.from({ length: 8 }, (_, k) => fill(`decision ${k}`, 300)),
            consequences: Array.from({ length: 8 }, (_, k) => fill(`consequence ${k}`, 300)),
            npcs_encountered: ['Notable Person 1'],
        })),
        npcs,
        party,
        currentLocation: 'Jewelglade',
        locations: [
            { id: 'jewelglade', name: 'Jewelglade', aliases: ['the glade'], region: 'the Toll Country', signature: fill('signature', 160), lastState: fill('state', 200), visitCount: 4, theaterFrontIds: ['front-0', 'front-1'],
              links: Array.from({ length: 8 }, (_, k) => ({ id: `loc-${k}`, direction: 'east', travelTime: fill('two days', 40), route: fill('the River Road', 60), atMessage: 2 })) },
            ...Array.from({ length: 8 }, (_, k) => ({ id: `loc-${k}`, name: `Waystation ${k}`, region: 'the Toll Country' })),
        ],
        combat: !inCombat ? { active: false } : {
            active: true, round: 4, phase: 'awaiting_intent', surprise: 'none', flankedEnemyIds: ['e0', 'e1'],
            enemies: Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, name: fill(`Marsh Reaver ${i}`, 60), hp: 12, maxHp: 30, ac: 14, condition: 'bloodied', conditions: ['prone', 'restrained', 'blinded'], combatStatus: 'active', attackBonus: 5, damage: '2d6+3', is_undead: true })),
            turnOrder: [{ type: 'player', name: 'Testa Longname', initiative: 15 }, ...Array.from({ length: 8 }, (_, i) => ({ type: 'enemy', id: `e${i}`, name: `Marsh Reaver ${i}`, initiative: 10 - i }))],
        },
        worldFacts: Array.from({ length: 60 }, (_, i) => ({ id: `f-${i}`, fact: `Canonical truth ${i}: ${fill('the weir wardens answer to the Pike', 300)}`, category: i % 2 ? 'threat' : 'lore', timestamp: i, atMessage: 5 + i, knownBy: ['Notable Person 1'] })),
        // Three live fronts and one RESOLVED (the victory echo reads `resolvedAtMessage` off the front; a theater is the LOCATION's `theaterFrontIds`) — 2026-10-15.
        fronts: Array.from({ length: 4 }, (_, i) => (i === 3
            ? { id: 'front-3', status: 'resolved', title: fill('Pressure 3', 100), goal: fill('goal', 300), clock: 8, maxClock: 8, stage: 4, faction: { name: fill('Faction 3', 100) }, grimPortents: [], publicHints: [], resolvedAtMessage: messageCount - 20, resolution: fill('resolution', 300) }
            : { id: `front-${i}`, status: 'active', title: fill(`Pressure ${i}`, 100), goal: fill('goal', 300), clock: 3, maxClock: 8, stage: 2, faction: { name: fill(`Faction ${i}`, 100) }, grimPortents: [], publicHints: Array.from({ length: 3 }, (_, k) => fill(`hint ${k}`, 140)) })),
        worldTempo: {
            directive: { frontId: 'front-0', maxIntensity: 'presence', inTheater: true, where: 'Jewelglade', suggestedSymptom: fill('symptom', 300), rationale: fill('rationale', 200), quietHook: '', grantedAtMessage: messageCount - 5, activationDistance: 2, expiryDistance: 24 },
            lastCadenceId: 'cad-1',
        },
        recentEncounters: Array.from({ length: 10 }, (_, i) => ({ messageIndex: messageCount - 2 - i, name: fill(`Skirmish ${i}`, 80), outcome: 'victory', foeFamilies: ['reaver'], mark: fill('mark', 160) })),
        recentChecks: Array.from({ length: 4 }, (_, i) => ({ messageIndex: messageCount - 1 - i, dc: 15 })),
        recentRulings: Array.from({ length: 5 }, (_, i) => ({ id: `rul-${i}`, text: fill(`ruling ${i}`, 300), messageIndex: messageCount - 2 - i, outcome: i % 2 ? 'withdrawn' : 'set_aside', skill: 'persuasion', dc: 12, location: 'Jewelglade' })),
        storyMemory: [...Array.from({ length: 5 }, (_, i) => cardAt(i, 'mystery'))],
        storyMemoryPool: [...Array.from({ length: 5 }, (_, i) => cardAt(i, 'mystery')), ...Array.from({ length: 12 }, (_, i) => cardAt(10 + i, 'promise'))],
        retrievedMemories: Array.from({ length: 16 }, (_, i) => ({ text: fill(`memory ${i}`, 1000), category: 'journal', score: 0.9 - i * 0.01, atMessage: i, location: 'Jewelglade', knownBy: ['Notable Person 1'] })),
        premise: fill('premise', 8000),
        customSystemPrompt: fill('custom dm instructions', 4000),
        // Staged under the keys the blocks READ (2026-10-15 living-world test-depth
        // P2: the old keys rendered '' while the props pretended the windows were staged).
        regionalHearsay: { locationName: 'Jewelglade', arrivedAtMessage: messageCount - 3, items: Array.from({ length: 2 }, (_, i) => ({ key: `deed-${i}`, source: 'front', text: fill(`hearsay ${i}`, 300), grade: 'legend' })) },
        absenceDrift: { locationName: 'Jewelglade', arrivedAtMessage: messageCount - 3, awayDistance: 40, developments: Array.from({ length: 2 }, (_, i) => ({ name: `Notable Person ${i}`, visible: fill(`development ${i}`, 300) })), fact: fill('fact', 300), frontSymptom: { frontId: 'front-1', maxIntensity: 'whispers', text: fill('symptom', 240) } },
        relationshipBeat: { npcId: 'n1', npcName: 'Notable Person 1', stage: 'intimate', thread: fill('thread', 200), mintedAtMessage: messageCount - 30, opensAtMessage: messageCount - 10, closesAtMessage: messageCount + 14 },
        wonder: { id: 'w1', hook: { text: fill('wonder hook', 400), register: 'relic', standalone: true }, mintedAtMessage: messageCount - 5, opensAtMessage: messageCount - 2, closesAtMessage: messageCount + 10, residueCardId: 'card-mystery-0' },
        heroTells: Array.from({ length: 24 }, (_, i) => ({ id: `tell-${i}`, text: fill(`tell ${i}`, 200), kind: i % 4 ? 'manner' : 'intimate', status: 'active', witnesses: ['Companion 0', 'Notable Person 4'], sightings: [10, 60, 120], lastSeenMessage: 380, voicedCount: 1, voicedBy: ['Companion 0'], public: true })),
        heroTellBeat: { tellId: 'tell-1', mode: 'remark', mintedAtMessage: messageCount - 5, opensAtMessage: messageCount - 2, closesAtMessage: messageCount + 20 },
        messages,
        messageCount,
    };
}

function build(state, flags = {}) {
    const { characterExtras, ...rest } = state;
    return buildSystemPromptParts({
        ...rest,
        character: { ...state.character, ...characterExtras },
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        paceDial: 'breakneck',
        ...flags,
    });
}

const sizes = (parts) => Object.fromEntries(parts.map(p => [p.name, p.text.length]));
const PREFIX_END = 'heroSheet'; // the last per-campaign constant block (2026-09-26: HERO IDENTITY → SPELLBOOK → HERO SHEET)

/**
 * Per-block ceilings, measured 2026-09-30 on this fixture (every input at its
 * cap; the block's own clamps do the bounding) with ~10 % headroom. A block
 * absent from the map has no ceiling of its own — it is covered by the total.
 */
const DYNAMIC_CEILINGS = {
    character: 1500,       // 1,108
    party: 14000,          // 12,728 — four companions, every bond field at its cap (one bond composer + Wants / Their business now since 2026-10-13)
    inventory: 3000,       // 2,551 — 60 rows, names + values only
    quests: 7500,          // 6,554 — the block's own row cap + the 8-name overflow tail
    recentRolls: 1000,     // 744
    recentRulings: 1000,   // 876
    worldFacts: 6500,      // 5,631 — 15 lines
    place: 1500,           // the place card + 6 known ways
    sessionHistory: 8500,  // 3 × (2,000 + 3 × 150) + headers
    transitionHistory: 900, // two referenced entries or two clamped 300-char summaries
    knownNpcs: 28000,      // 8 maxed KNOWN NPCs lines + the header (2026-10-14: four parts, four ceilings)
    heroTells: 3000,       // 2,344 — HERO_TELLS_BLOCK_CHAR_CEILING is the block's own belt
    storyMemory: 6000,     // 5,501 — 5 cards with their age and speakers (2026-10-14)
    retrievedMemories: 9500, // 8,378 — RETRIEVED_MEMORIES_CHAR_CEILING 8,000 + header
    worldTempo: 6000,      // pinned at 5,200 by worldTempo's own test; 1,638 here
    relationshipBeat: 1500, // 862
    regionalHearsay: 1600, // the block's own pin (regionalHearsay.test); 1,528 since the header names a doom too (2026-10-22)
    absenceDrift: 2200,    // 2 developments × 300 + a 300-char fact + a 240-char symptom (yields under a tempo window — staged closed here)
    // The one-shot private blocks (wonder, hearsay, absence drift, the tell
    // beat, DM REMINDERS) are pinned by their feature tests; this fixture
    // does not stage their windows.
};

describe('prompt blocks — per-block ceilings, prefix stability, per-call-type dynamic half (2026-09-30)', () => {
    const stateA = maxedState({ live: 0 });
    const stateB = maxedState({ live: 3, messageCount: 600 });
    const fight = maxedState({ live: 0, inCombat: true });
    const partsA = build(stateA);
    const partsB = build(stateB);

    it('the static prefix is byte-identical across two live states (HP, transcript length, party HP changed) and reaches the hero identity block', () => {
        const prefixNames = [];
        for (const part of partsA) {
            prefixNames.push(part.name);
            if (part.name === PREFIX_END) break;
        }
        expect(prefixNames).toContain('coreInstructions');
        expect(prefixNames).toContain('premise');
        expect(prefixNames[prefixNames.length - 1]).toBe(PREFIX_END);
        const prefixA = partsA.filter(p => prefixNames.includes(p.name)).map(p => p.text).join('\n\n');
        const prefixB = partsB.filter(p => prefixNames.includes(p.name)).map(p => p.text).join('\n\n');
        expect(prefixB).toBe(prefixA);
        const total = partsA.reduce((n, p) => n + p.text.length, 0);
        // Measured 60 % on the audit's mature state; this fixture maxes the
        // dynamic half harder, so pin a floor for the prefix's SHARE.
        expect(prefixA.length / total).toBeGreaterThan(0.33);
        // This fixture is deliberately FATTER than the budget test's (every
        // roster field at its cap on eight lines, a 4k custom prompt, an 8k
        // premise): it measures ceilings, it does not re-assert the budget.
        expect(total).toBeLessThan(PROMPT_CHAR_BUDGET * 1.25);
    });

    it('every dynamic block stays under its measured ceiling', () => {
        const measured = sizes(partsA);
        const over = Object.entries(DYNAMIC_CEILINGS)
            .filter(([name, ceiling]) => (measured[name] || 0) > ceiling)
            .map(([name, ceiling]) => `${name}: ${measured[name]} > ${ceiling}`);
        expect(over, JSON.stringify(measured)).toEqual([]);
        // The fixture actually exercised the blocks the ceilings name.
        for (const name of Object.keys(DYNAMIC_CEILINGS)) {
            expect(measured[name], name).toBeGreaterThan(0);
        }
    });

    it('the intent call\'s dynamic half is a fraction of the ordinary turn\'s, and the narration call\'s sits between', () => {
        const dynamicOf = (parts) => {
            let seenPrefixEnd = false;
            return parts.reduce((n, p) => {
                if (seenPrefixEnd) n += p.text.length;
                if (p.name === PREFIX_END) seenPrefixEnd = true;
                return n;
            }, 0);
        };
        const ordinary = dynamicOf(build(fight));
        const intent = dynamicOf(build(fight, { intentOnly: true, storyMemory: [], retrievedMemories: [] }));
        const narration = dynamicOf(build(fight, { narrationOnly: true, storyMemory: [], retrievedMemories: [] }));
        expect(sizes(build(fight)).combat).toBeGreaterThan(0);
        expect(intent).toBeLessThan(ordinary * 0.35);
        expect(narration).toBeLessThan(ordinary * 0.6);
        expect(intent).toBeLessThan(narration);
        // Ceilings for the two combat calls (measured 2026-09-30, ~10 % headroom;
        // the intent call re-measured 2026-10-13 at 12,370 once its party line
        // went mechanics-only — 8.5k of bond prose off every round, and
        // 2026-10-15 at 16,263 once the fixture staged the tempo state under
        // its real keys: three fronts' shown-symptom ledgers and a victory echo).
        expect(intent).toBeLessThan(18000);
        expect(narration).toBeLessThan(52000); // 47,192 on the 2026-10-15 fixture
    });

    // 2026-10-13 chat-orchestration P2: the missing-events nudge used to build
    // the ORDINARY prompt (82.5k dynamic chars on this fixture) for a reply
    // whitelisted to quest_updates / starting_items. Its projection is the
    // character line, INVENTORY and ACTIVE QUESTS — measured 10,568.
    it('the nudge lane\'s dynamic half is the character line, the inventory and the quests', () => {
        const parts = build(stateA, { nudgeOnly: true, storyMemory: [], retrievedMemories: [] });
        const names = parts.map(p => p.name);
        expect(names.slice(names.indexOf(PREFIX_END) + 1)).toEqual(['character', 'inventory', 'quests', 'formatReminder']);
        const dynamic = parts.slice(names.indexOf(PREFIX_END) + 1).reduce((n, p) => n + p.text.length, 0);
        expect(dynamic).toBeLessThan(12000);
        // The prefix is the same bytes as the ordinary turn's — the cache holds.
        const prefixOf = (list) => list.slice(0, list.findIndex(p => p.name === PREFIX_END) + 1).map(p => p.text).join('\n\n');
        expect(prefixOf(parts)).toBe(prefixOf(partsA));
    });

    // 2026-10-02 progression Lap-3: the prefix-stability pin above varies LIVE
    // state only. A regression that interpolated the level into HERO IDENTITY,
    // the premise, or the core rules would re-bill 100 % of the prefix on every
    // level-up with that test green. A level-up may move the sheet's own blocks
    // and nothing before them — measured: the first differing byte sits in the
    // LAST prefix block, so a provider caching by prefix keeps ~99 %.
    it('a level-up changes ONLY the heroSheet / spellbook prefix blocks', () => {
        for (const [race, cls] of [['human', 'fighter'], ['dwarf', 'cleric']]) {
            const level1 = createCharacter('Testa Longname', race, cls, ABILITY_SCORES, ['insight', 'religion']);
            const level2 = awardExperience(level1, getExperienceThreshold(1)).character;
            expect(level2.level).toBe(2);
            const prefixOf = (character) => {
                const parts = build({ ...maxedState(), character, characterExtras: {} });
                const end = parts.findIndex(part => part.name === PREFIX_END);
                expect(end).toBeGreaterThan(0);
                return parts.slice(0, end + 1);
            };
            const before = prefixOf(level1);
            const after = prefixOf(level2);
            expect(after.map(part => part.name)).toEqual(before.map(part => part.name));
            const changed = before.filter((part, i) => part.text !== after[i].text).map(part => part.name);
            expect(changed).toContain('heroSheet');
            expect(changed.filter(name => !['heroSheet', 'spellbook'].includes(name)), cls).toEqual([]);
        }
    });
});
