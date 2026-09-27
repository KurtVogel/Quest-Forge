/**
 * 2026-09-27 enemy-stats Lap-3 P2s — the combat block is DATA on both DM calls
 * of a round; its constant sentences live in COMBAT NOTES (cached prefix);
 * under `narrationOnly` it renders only what the narration prompt's
 * AUTHORITATIVE snapshot lacks (the standing flanks); the flank rule is said
 * once, not per flanked row.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';
import { buildSpellSlots } from '../engine/spellcasting.js';

const hero = (overrides = {}) => ({ name: 'Astra', race: 'human', class: 'fighter', level: 3, currentHP: 20, maxHP: 20, armorClass: 16, abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 }, conditions: [], classResources: {}, hitDice: { remaining: 3, total: 3, die: 10 }, traits: [], features: [], ...overrides });
const prompt = (combat, extra = {}) => buildSystemPrompt({
    character: extra.character || hero(), inventory: [], quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e', customSystemPrompt: '', journal: [], npcs: [], party: [],
    currentLocation: 'Old road', combat, worldFacts: [], locations: [], fronts: [], storyMemory: [], retrievedMemories: [], premise: '', recentRulings: [], messages: [], messageCount: 0,
    ...(extra.narrationOnly !== undefined && { narrationOnly: extra.narrationOnly }),
});
const block = (text) => {
    const start = text.indexOf('\n## ACTIVE COMBAT — ');
    expect(start).toBeGreaterThan(0);
    const end = text.indexOf('\n## ', start + 1);
    return text.slice(start + 1, end === -1 ? undefined : end);
};
const count = (text, needle) => text.split(needle).length - 1;

const foes = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, name: `Marsh bandit ${i}`, hp: 20, maxHp: 34, ac: 14, attackBonus: 4, damage: '1d8+2', condition: 'bloodied', conditions: ['prone', 'poisoned'], combatStatus: 'active', defending: i % 2 === 0 }));
const empty = { active: true, round: 3, phase: 'awaiting_player', surprise: 'none', enemies: [], turnOrder: [], currentTurn: 0, flankedEnemyIds: [] };
const six = { ...empty, enemies: foes, turnOrder: [{ type: 'player', name: 'Astra', initiative: 14 }, ...foes.map(f => ({ type: 'enemy', id: f.id, name: f.name, initiative: 9 }))], flankedEnemyIds: foes.map(f => f.id) };

const MOVED = [
    'LIVE COMBAT STATE OVERRIDES any contradictory earlier narration, journal entry, retrieved memory, or world fact about these combatants',
    'The engine owns every combat die and state transition.',
    'translate the committed player action into one combat_exchange intent envelope',
    'declare no actions',
    'A foe marked FLANKED is under a standing, engine-applied advantage',
];

describe('buildCombatBlock — constant share moved to the prefix', () => {
    it('at 0 foes the block is data only (202 chars measured, was 694): header, empty lists, the live surge line', () => {
        const b = block(prompt(empty));
        expect(b.length).toBeLessThan(260);
        expect(b).toContain('## ACTIVE COMBAT — Round 3 | Phase: awaiting_player | Surprise: none');
        expect(b).toContain('Action Surge: inactive — exactly one player_slot required.');
        for (const sentence of MOVED) expect(b).not.toContain(sentence);
        expect(block(prompt(empty, { character: hero({ pendingActionSurge: true }) }))).toContain('Action Surge: ACTIVE — exactly two player_slots required.');
    });

    it('the moved rules sit ONCE in COMBAT NOTES, inside the cached prefix, for both class formats, with or without a fight', () => {
        for (const character of [hero(), hero({ class: 'wizard', spellSlots: buildSpellSlots(3) })]) {
            for (const combat of [empty, { active: false }]) {
                const text = prompt(combat, { character });
                const prefixEnd = text.indexOf('## PLAYER CHARACTER');
                for (const sentence of MOVED) {
                    expect(count(text, sentence), sentence).toBe(1);
                    expect(text.indexOf(sentence)).toBeLessThan(prefixEnd);
                }
                expect(text.indexOf('COMBAT NOTES — INTENT ONLY')).toBeLessThan(text.indexOf(MOVED[0]));
            }
        }
    });

    it('6 flanked foes with two conditions each stay under 1,400 chars (1,175 measured, was 2,191 + 582 of repeated flank text): FLANKED on each row, the rule nowhere in the block', () => {
        const text = prompt(six);
        const b = block(text);
        expect(b.length).toBeLessThan(1400);
        expect(count(b, '| FLANKED')).toBe(6);
        expect(b).not.toContain('engine-applied');
        expect(b).not.toContain('flank_broken');
        expect(count(text, 'A foe marked FLANKED is under a standing, engine-applied advantage')).toBe(1);
        expect(b).toContain('- **Marsh bandit 5** (id: e5) | HP: 20/34 | AC: 14 | Atk: +4 | Dmg: 1d8+2 | Health: bloodied | Conditions: prone, poisoned | FLANKED');
        expect(b).toContain('| DEFENDING | FLANKED');
        expect(b).toContain('→ Astra (init: 14)');
    });
});

describe('buildCombatBlock under narrationOnly — header + standing flanks only', () => {
    it('drops the rows, the turn order, and the surge line (the narration prompt carries the authoritative snapshot) and keeps the flanks', () => {
        const b = block(prompt({ ...six, phase: 'awaiting_narration' }, { narrationOnly: true }));
        expect(b).toBe('## ACTIVE COMBAT — Round 3 | Phase: awaiting_narration | Surprise: none\n**Flanked (standing advantage, engine-applied):** Marsh bandit 0, Marsh bandit 1, Marsh bandit 2, Marsh bandit 3, Marsh bandit 4, Marsh bandit 5\n');
        expect(b).not.toContain('**Enemies:**');
        expect(b).not.toContain('Turn Order');
        expect(b).not.toContain('Action Surge');
        expect(b.length).toBeLessThan(300);
    });

    it('with no standing flank it is the header alone; the full prompt is untouched by the flag\'s absence', () => {
        const b = block(prompt({ ...six, phase: 'awaiting_narration', flankedEnemyIds: [] }, { narrationOnly: true }));
        expect(b).toBe('## ACTIVE COMBAT — Round 3 | Phase: awaiting_narration | Surprise: none\n');
        const full = block(prompt({ ...six, phase: 'awaiting_narration' }));
        expect(full).toContain('**Enemies:**');
        expect(full).toContain('**Turn Order:**');
        expect(block(prompt({ ...six, phase: 'awaiting_narration' }, { narrationOnly: false }))).toBe(full);
    });
});
