/**
 * The 2026-10-13 prompt-building queue (Lap 4): one record, one render — a
 * party companion is never a KNOWN NPCs line and the party line's bond is the
 * one composer's; the intent lane's party is mechanics only; the hero's state
 * has one composer; the response MODE is a part the assembler pushes; the
 * nudge lane's projection; facts on the conversational clock; `isWornArmor`
 * at the inventory annotation. Real-shaped names on purpose: the size
 * fixture's `Notable Person N` roster makes every NPC "present" to the
 * tokenizer, so the duplicate render could not be measured there.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildSystemPromptParts, COMBAT_INTENT_RESPONSE_MODE, describeHeroStatus, RESPONSE_MODES } from './promptBuilder.js';
import { EPILOGUE_RESPONSE_MODE, TABLE_TALK_RESPONSE_MODE } from './tableTalk.js';
import { createCharacter } from '../engine/characterUtils.js';
import { describeBondForPrompt } from './journalBlocks.js';

const ABILITY_SCORES = { strength: 14, dexterity: 10, constitution: 16, intelligence: 10, wisdom: 18, charisma: 12 };

const sectionOf = (text, heading) => {
    const start = text.indexOf(heading);
    if (start < 0) return '';
    const next = text.indexOf('\n## ', start + heading.length);
    return next < 0 ? text.slice(start) : text.slice(start, next);
};

function companionRecord(name, extra = {}) {
    return {
        id: `npc-${name.toLowerCase().replace(/\s+/g, '-')}`, name, rosterTier: 'character', kind: 'character', disposition: 'friendly',
        gender: 'woman', species: 'human', trust: 80, appearance: 'Tall, scar across the brow, grey-streaked braid.',
        personality: 'Dry, exact, slow to forgive.', stanceToPlayer: 'Trusts the hero with her life and says so rarely.',
        lastNotes: 'Sharpening her axe by the fire.', openThread: 'Waiting for the hero to say whether they go north.', openThreadMessage: 3,
        bondMoments: [{ text: 'The hero pulled Saima from the river at the ford.', at: 1, atMessage: 2, kind: 'rescue', salience: 5 }],
        lastSeenMessage: 5,
        ...extra,
    };
}

function baseOptions(overrides = {}) {
    const party = [{ id: 'c1', name: 'Saima Aallotar', role: 'shieldmaiden', level: 2, hp: 18, maxHp: 18, ac: 15, weapon: 'Longsword', attackBonus: 4, damage: '1d8+2', affinity: 75 }];
    const npcs = [
        companionRecord('Saima Aallotar'),
        { id: 'npc-reeve', name: 'Reeve Holt', rosterTier: 'character', kind: 'character', disposition: 'wary', lastNotes: 'Keeps the toll gate.', lastSeenMessage: 5 },
    ];
    const messages = [
        { id: 'u0', role: 'user', content: 'I sit by the fire with Saima Aallotar and Reeve Holt.' },
        { id: 'a0', role: 'assistant', content: 'Saima Aallotar nods; Reeve Holt counts his coins.' },
    ];
    return {
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        inventory: [{ id: 'sword', name: 'Longsword', type: 'weapon', damage: '1d8', equipped: true }],
        quests: [{ id: 'q1', name: 'Find the wardens', status: 'active', description: 'Track the missing weir wardens.' }],
        rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e', journal: [], npcs, party,
        currentLocation: 'Toll gate', combat: { active: false }, worldFacts: [], fronts: [], storyMemory: [], retrievedMemories: [],
        messages, messageCount: messages.length,
        ...overrides,
    };
}

describe('a party companion renders ONCE (2026-10-13 prompt-building P2)', () => {
    it('a present companion is never a KNOWN NPCs line; the other present person still is', () => {
        const text = buildSystemPrompt(baseOptions());
        const known = sectionOf(text, '## KNOWN NPCs');
        expect(known).toContain('**Reeve Holt**');
        expect(known).not.toContain('**Saima Aallotar**');
        // Not "available via RETRIEVED MEMORIES" either — the party line has her.
        expect(known).not.toContain('other NPCs available');
        const party = sectionOf(text, '## COMPANIONS (PARTY)');
        expect(party).toContain('**Saima Aallotar**');
    });

    it('the party line\'s bond lines are describeBondForPrompt\'s, sentence-cased — one composer, one cap', () => {
        const options = baseOptions();
        const text = buildSystemPrompt(options);
        const party = sectionOf(text, '## COMPANIONS (PARTY)');
        const lines = describeBondForPrompt(options.npcs[0], [], { messages: options.messages, messageCount: options.messageCount });
        expect(lines.length).toBeGreaterThanOrEqual(3);
        for (const line of lines) {
            expect(party).toContain(`  ${line[0].toUpperCase()}${line.slice(1)}`);
        }
        expect(party).toContain('Toward the hero: Trusts the hero with her life');
        expect(party).toContain('Key moments with the hero: The hero pulled Saima from the river');
        expect(party).toContain('Between you now: Waiting for the hero');
    });

    it('a companion whose roster record is found by short form is excluded by that same record', () => {
        const options = baseOptions({ npcs: [companionRecord('Saima'), { id: 'npc-reeve', name: 'Reeve Holt', rosterTier: 'character', lastNotes: 'Keeps the toll gate.', lastSeenMessage: 5 }] });
        const text = buildSystemPrompt(options);
        expect(sectionOf(text, '## KNOWN NPCs')).not.toContain('**Saima**');
        expect(sectionOf(text, '## COMPANIONS (PARTY)')).toContain('Key moments with the hero');
    });
});

describe('the intent lane\'s party is mechanics only (2026-10-13 prompt-building P2)', () => {
    it('keeps the id / HP / AC / attack / status line and drops every bond line', () => {
        const fight = { active: true, round: 1, phase: 'awaiting_intent', enemies: [{ id: 'e1', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, condition: 'healthy' }], turnOrder: [] };
        const options = baseOptions({ combat: fight });
        const ordinary = sectionOf(buildSystemPrompt(options), '## COMPANIONS (PARTY)');
        const intent = sectionOf(buildSystemPrompt({ ...options, intentOnly: true }), '## COMPANIONS (PARTY)');
        expect(intent).toContain('**Saima Aallotar** (id: c1) | Role: shieldmaiden');
        expect(intent).toContain('HP: 18/18 | AC: 15');
        for (const label of ['Looks', 'Toward the hero:', 'Bond:', 'Between you now:', 'Key moments with the hero:']) {
            expect(ordinary).toContain(label);
            expect(intent).not.toContain(label);
        }
        expect(intent.length).toBeLessThan(ordinary.length);
    });
});

describe('the hero\'s state has ONE composer (2026-10-13 prompt-building P2)', () => {
    it('describeHeroStatus composes the STATUS line and the reminder; the prompt carries both verbatim', () => {
        const dying = { ...createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']), level: 5, dying: true, deathSaves: { successes: 1, failures: 2 } };
        const outOfCombat = describeHeroStatus(dying, { active: false });
        const inCombat = describeHeroStatus(dying, { active: true });
        expect(outOfCombat.line).toContain('1/3 successes, 2/3 failures');
        expect(outOfCombat.reminder).toContain('1/3 successes, 2/3 failures');
        expect(outOfCombat.line).toContain('{ "type": "death_save" }');
        expect(outOfCombat.reminder).toContain('via requested_rolls');
        expect(inCombat.line).toContain('{ "action": "death_save" }');
        expect(inCombat.reminder).toContain('inside combat_exchange');
        expect(inCombat.line).not.toContain('requested_rolls');

        const text = buildSystemPrompt(baseOptions({ character: dying, party: [], npcs: [] }));
        expect(text).toContain(outOfCombat.line.trim());
        expect(text).toContain(outOfCombat.reminder);
    });

    it('DEAD has a line and a reminder, DEFEATED a line only, a living hero neither', () => {
        const hero = createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']);
        expect(describeHeroStatus({ ...hero, isDead: true }).reminder).toMatch(/THE HERO IS DEAD/);
        expect(describeHeroStatus({ ...hero, lowLevelDefeat: true })).toMatchObject({ reminder: '' });
        expect(describeHeroStatus({ ...hero, lowLevelDefeat: true }).line).toContain('STATUS: DEFEATED');
        expect(describeHeroStatus(hero)).toEqual({ line: '', reminder: '' });
        expect(describeHeroStatus(null)).toEqual({ line: '', reminder: '' });
    });

    it('the solo-safety block and its reminder render together, judged once', () => {
        const text = buildSystemPrompt(baseOptions({ party: [], npcs: [] }));
        expect(text).toContain('HARD SYSTEM CONSTRAINT — LOW-LEVEL SOLO SAFETY');
        expect(text).toContain('Low-level solo safety is active');
        const withParty = buildSystemPrompt(baseOptions());
        expect(withParty).not.toContain('## HARD SYSTEM CONSTRAINT — LOW-LEVEL SOLO SAFETY');
        expect(withParty).not.toContain('Low-level solo safety is active');
    });
});

describe('the response MODE is a part the assembler pushes (2026-10-13 prompt-building P2)', () => {
    it('each mode is the named tail part after the format reminder, byte-equal to its constant', () => {
        for (const [mode, constant] of [['combatIntent', COMBAT_INTENT_RESPONSE_MODE], ['tableTalk', TABLE_TALK_RESPONSE_MODE], ['epilogue', EPILOGUE_RESPONSE_MODE]]) {
            const parts = buildSystemPromptParts(baseOptions({ mode }));
            expect(parts.at(-1)).toEqual({ name: 'responseMode', text: constant });
            expect(parts.at(-2).name).toBe('formatReminder');
        }
        expect(RESPONSE_MODES).toEqual({ combatIntent: COMBAT_INTENT_RESPONSE_MODE, tableTalk: TABLE_TALK_RESPONSE_MODE, epilogue: EPILOGUE_RESPONSE_MODE });
    });

    it('no mode, or an unknown one, leaves the format reminder as the tail', () => {
        expect(buildSystemPromptParts(baseOptions()).at(-1).name).toBe('formatReminder');
        expect(buildSystemPromptParts(baseOptions({ mode: 'nonsense' })).at(-1).name).toBe('formatReminder');
    });
});

describe('the nudge lane\'s projection (2026-10-13 chat-orchestration P2)', () => {
    it('carries the prefix, the character line, INVENTORY and ACTIVE QUESTS — nothing else of the dynamic half', () => {
        const parts = buildSystemPromptParts(baseOptions({
            nudgeOnly: true,
            worldFacts: [{ id: 'f1', fact: 'The Pike buys captives.', category: 'lore', timestamp: 1, atMessage: 1 }],
            journal: [{ id: 'j1', summary: 'A hard week at the weir.', keyDecisions: [], consequences: [], messageRange: [0, 2], location: 'Toll gate', timestamp: 1 }],
            retrievedMemories: [{ text: 'A memory.', category: 'journal' }],
            storyMemory: [{ id: 'card-1', type: 'promise', status: 'active', subject: 'Saima', text: 'The hero swore to bury her brother.', salience: 5 }],
        }));
        const names = parts.map(p => p.name);
        const prefixEnd = names.indexOf('heroSheet');
        expect(prefixEnd).toBeGreaterThan(0);
        expect(names.slice(prefixEnd + 1)).toEqual(['character', 'inventory', 'quests', 'formatReminder']);
    });
});

describe('the nits (2026-10-13)', () => {
    it('WORLD FACTS orders by atMessage, not the wall clock; a legacy row without one sorts by its timestamp', () => {
        const facts = [
            { id: 'old', fact: 'Old fact with a late clock.', category: 'lore', timestamp: 900, atMessage: 2 },
            { id: 'new', fact: 'New fact with an early clock.', category: 'lore', timestamp: 100, atMessage: 40 },
            { id: 'legacy', fact: 'Legacy fact without a message stamp.', category: 'lore', timestamp: 500 },
        ];
        const block = sectionOf(buildSystemPrompt(baseOptions({ worldFacts: facts })), '## WORLD FACTS');
        expect(block.indexOf('New fact')).toBeLessThan(block.indexOf('Old fact'));
        expect(block.indexOf('Old fact')).toBeLessThan(block.indexOf('Legacy fact'));
    });

    it('a gear row with a stray baseAC is not annotated as armor; worn armor is', () => {
        const inventory = [
            { id: 'costume', name: 'Festival costume', type: 'gear', baseAC: 12, equipped: true },
            { id: 'mail', name: 'Chain mail', type: 'armor', armorType: 'heavy', baseAC: 16, equipped: true },
        ];
        const block = sectionOf(buildSystemPrompt(baseOptions({ inventory })), '## INVENTORY');
        expect(block).toContain('Chain mail [AC 16, heavy armor]');
        expect(block).toContain('Festival costume');
        expect(block).not.toContain('Festival costume [AC');
    });

    it('a quest row with a non-string description reads "No details", never "[object Object]"', () => {
        const block = sectionOf(buildSystemPrompt(baseOptions({ quests: [{ id: 'q1', name: 'Odd job', status: 'active', description: { nested: true } }] })), '## ACTIVE QUESTS');
        expect(block).toContain('**Odd job** [id: q1]: No details');
        expect(block).not.toContain('[object Object]');
    });
});
