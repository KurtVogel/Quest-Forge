/**
 * Strengthening queue 2026-10-26 (prompt-building, Lap 1): pinned facts ride
 * WORLD FACTS first; the threat scan reads whole words in the present tense
 * and honors a fact's aspect; the living-world family is off the intent lane.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildSystemPromptParts, MAX_PINNED_WORLD_FACTS, isThreatFact } from './promptBuilder.js';
import { createCharacter } from '../engine/characterUtils.js';

const ABILITY_SCORES = { strength: 14, dexterity: 12, constitution: 13, intelligence: 10, wisdom: 11, charisma: 8 };
const makeCharacter = () => createCharacter('Astra', 'human', 'fighter', ABILITY_SCORES, ['athletics', 'perception']);

function options(overrides = {}) {
    return {
        character: makeCharacter(),
        inventory: [], quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e', customSystemPrompt: '',
        journal: [], npcs: [], party: [], currentLocation: 'Rimehollow', combat: { active: false },
        worldFacts: [], locations: [], fronts: [], storyMemory: [], retrievedMemories: [], premise: '', recentRulings: [],
        messages: [], messageCount: 0,
        ...overrides,
    };
}
const prompt = (overrides) => buildSystemPrompt(options(overrides));
const worldFactsBlock = (text) => (text.split('## WORLD FACTS')[1] ?? '').split('\n## ')[0];
const reminderBlock = (text) => (text.split('## DM REMINDERS — MAINTAIN THESE PRESSURES')[1] ?? '').split('\n## ')[0];
const factLines = (block) => block.split('\n').filter(l => l.startsWith('- '));

const fact = (i, extra = {}) => ({ id: `f${i}`, fact: `Fact number ${i} about the valley.`, category: 'event', atMessage: i, timestamp: i, ...extra });

describe('WORLD FACTS — pinned live facts ride first (queue 2026-10-26 P2)', () => {
    it('one pinned fact + 15 newer facts: the pinned fact is IN the block and the overflow counts one', () => {
        const pinned = { id: 'reveal', fact: 'The Salt Tithe has ended; Rimehollow is free of the guild.', category: 'event', pinned: true, atMessage: 1, timestamp: 1 };
        const newer = Array.from({ length: 15 }, (_, i) => fact(10 + i));
        const block = worldFactsBlock(prompt({ worldFacts: [pinned, ...newer] }));
        expect(block).toContain('The Salt Tithe has ended');
        expect(block).toContain('(1 older facts available via RETRIEVED MEMORIES when relevant)');
        // The pinned fact took a slot: the OLDEST newer fact (10) is the one that fell out.
        expect(block).not.toContain('Fact number 10 about');
        expect(block).toContain('Fact number 11 about');
        expect(factLines(block).length).toBe(15);
    });

    it('four pinned facts: exactly MAX_PINNED_WORLD_FACTS newest pinned ride the pinned slots; the fourth competes by recency and is absent when old', () => {
        expect(MAX_PINNED_WORLD_FACTS).toBe(3);
        const pinned = [1, 2, 3, 4].map(i => ({ id: `p${i}`, fact: `Pinned pressure ${i} came to pass.`, category: 'event', pinned: true, atMessage: i, timestamp: i }));
        const newer = Array.from({ length: 20 }, (_, i) => fact(100 + i));
        const block = worldFactsBlock(prompt({ worldFacts: [...pinned, ...newer] }));
        for (const i of [4, 3, 2]) expect(block).toContain(`Pinned pressure ${i} came to pass.`);
        expect(block).not.toContain('Pinned pressure 1 came to pass.');
        expect(factLines(block).length).toBe(15);
        expect(block).toContain('(9 older facts available');
    });

    it('a pinned fact that is no longer live (superseded) does not take a pinned slot', () => {
        const dead = { id: 'old', fact: 'The bridge still stands.', category: 'event', pinned: true, atMessage: 1, timestamp: 1, supersededBy: 'flip', supersededAtMessage: 5 };
        const flip = { id: 'flip', fact: 'The bridge does not still stand.', category: 'event', atMessage: 5, timestamp: 5, supersedes: 'old' };
        const newer = Array.from({ length: 15 }, (_, i) => fact(10 + i));
        const block = worldFactsBlock(prompt({ worldFacts: [dead, flip, ...newer] }));
        expect(block).not.toContain('The bridge still stands.');
        expect(factLines(block).length).toBe(15);
    });
});

describe('DM REMINDERS threat scan — whole words, present tense, aspect-aware (queue 2026-10-26 P2)', () => {
    it('still surfaces a present-tense pursuit', () => {
        const block = reminderBlock(prompt({ worldFacts: [{ id: 'b', fact: 'A bounty hunter is pursuing the player.', category: 'event', atMessage: 1 }] }));
        expect(block).toContain('Active threats/pressures:');
        expect(block).toContain('- A bounty hunter is pursuing the player.');
    });

    it('does not bill an intent fact, a past-tense "hunting lodge", or "Nobody wanted the mill" as standing pressures', () => {
        const worldFacts = [
            { id: 'i', fact: 'Tammo wanted to apologize to the hero before the feast.', category: 'event', aspect: 'intent', atMessage: 3 },
            { id: 'l', fact: 'The old hunting lodge north of Rimehollow burned down.', category: 'lore', atMessage: 4 },
            { id: 'm', fact: 'Nobody wanted the mill after the flood.', category: 'lore', atMessage: 5 },
            { id: 'bountiful', fact: 'The harvest was bountiful this year.', category: 'lore', atMessage: 6 },
        ];
        const text = prompt({ worldFacts });
        expect(text).not.toContain('Active threats/pressures:');
        for (const f of worldFacts) expect(isThreatFact(f)).toBe(false);
    });

    it('an intent fact whose words would otherwise match is skipped — a plan is not a pressure; the present-tense forms match', () => {
        expect(isThreatFact({ fact: 'The reeve is hunting the hero.', aspect: 'intent' })).toBe(false);
        expect(isThreatFact({ fact: 'The reeve is hunting the hero.' })).toBe(true);
        expect(isThreatFact({ fact: 'The guild wants the hero dead.' })).toBe(true);
        expect(isThreatFact({ fact: 'A bounty on the hero stands at fifty gold.' })).toBe(true);
        expect(isThreatFact({ fact: 'Astra is wanted for murder in Saltmarsh.' })).toBe(true);
        expect(isThreatFact({ fact: 'The deadline for the tithe is the new moon.' })).toBe(true);
        expect(isThreatFact(null)).toBe(false);
    });

    it('a state fact renders WITH its age tag, as WORLD FACTS prints it', () => {
        const messages = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `row ${i}` }));
        const text = prompt({ messages, messageCount: 40, worldFacts: [{ id: 's', fact: 'The guards are hunting the thief.', category: 'event', aspect: 'state', atMessage: 4 }] });
        expect(reminderBlock(text)).toMatch(/- for now \(as of \d+ turns ago\): The guards are hunting the thief\./);
        expect(worldFactsBlock(text)).toMatch(/for now \(as of \d+ turns ago\): The guards are hunting the thief\./);
    });
});

describe('the living-world family is off the combat INTENT lane (queue 2026-10-26 P2)', () => {
    const front = { id: 'f1', title: 'The Salt Tithe', faction: { name: 'The Guild', goal: 'own the ferry' }, status: 'active', clock: 2, stage: 1, portents: ['a', 'b', 'c', 'd', 'e'], publicHints: [] };
    const base = {
        fronts: [front], worldTempo: { directive: null }, paceDial: 'standard',
        combat: { active: true, phase: 'awaiting_player', enemies: [{ id: 'e1', name: 'Bandit', hp: 8, maxHp: 8, ac: 12, health: 'healthy', conditions: [] }], round: 1, turnOrder: [] },
    };
    const names = (parts) => parts.map(p => p.name);

    it('the intent lane carries no tempo / away / hearsay / beat / wonder part; the narration lane and the ordinary turn keep the tempo block', () => {
        const intent = names(buildSystemPromptParts(options({ ...base, intentOnly: true })));
        for (const name of ['worldTempo', 'absenceDrift', 'regionalHearsay', 'relationshipBeat', 'wonder']) expect(intent).not.toContain(name);
        expect(names(buildSystemPromptParts(options({ ...base, narrationOnly: true })))).toContain('worldTempo');
        expect(names(buildSystemPromptParts(options(base)))).toContain('worldTempo');
    });
});
