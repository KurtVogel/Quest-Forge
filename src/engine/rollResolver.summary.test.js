/**
 * `formatRollSummary` — the [ROLL RESULT] lines the post-roll prompt carries
 * for every result type the out-of-combat resolver can produce (2026-09-26
 * coverage sweep: only the player check / attack branches were pinned; the
 * companion, NPC, damage, and death-save renderers were unexercised).
 */
import { describe, expect, it } from 'vitest';
import { formatRollSummary } from './rollResolver.js';

const HP_APPLIED = '(HP applied by the system — do NOT adjust it via damage_taken)';

describe('formatRollSummary — every result type renders a line the DM can act on', () => {
    it('notes and NPC saves', () => {
        expect(formatRollSummary([{ type: 'note', text: 'Roll skipped: no skill named' }])).toBe('[Roll skipped: no skill named]');
        expect(formatRollSummary([{ type: 'npc_save', attacker: 'Cultist', dc: 13, rolled: 15, success: true }]))
            .toBe('[ROLL RESULT: Cultist save vs DC 13, rolled 15 — SUCCESS]');
        expect(formatRollSummary([{ type: 'npc_save', description: 'Wisdom save against the hymn', dc: 13, rolled: 4, success: false }]))
            .toBe('[ROLL RESULT: Wisdom save against the hymn vs DC 13, rolled 4 — FAILURE]');
    });

    it('companion attacks: miss, hit with damage (and the downed marker), hit without damage', () => {
        const base = { type: 'companion_attack', attacker: 'Jorun', dc: 14, rolled: 9, success: false };
        expect(formatRollSummary([base])).toBe('[ROLL RESULT: Jorun attack vs AC 14, rolled 9 — MISS]');
        expect(formatRollSummary([{ ...base, rolled: 18, success: true, damage: 6, targetName: 'Goblin', targetHp: 4, targetMaxHp: 10 }]))
            .toBe(`[ROLL RESULT: Jorun attack vs AC 14, rolled 18 — HIT for 6 damage. Goblin now 4/10 HP. ${HP_APPLIED}]`);
        expect(formatRollSummary([{ ...base, rolled: 18, success: true, damage: 11, targetName: 'Goblin', targetHp: 0, targetMaxHp: 10 }]))
            .toBe(`[ROLL RESULT: Jorun attack vs AC 14, rolled 18 — HIT for 11 damage. Goblin now 0/10 HP — Goblin is DOWNED. ${HP_APPLIED}]`);
        expect(formatRollSummary([{ ...base, description: 'Jorun swings', rolled: 18, success: true, damage: null }]))
            .toBe('[ROLL RESULT: Jorun swings vs AC 14, rolled 18 — HIT]');
    });

    it('NPC attacks: the hero downed reads differently from a companion downed', () => {
        const base = { type: 'npc_attack', attacker: 'Bandit', dc: 16, rolled: 17, success: true, damage: 9, targetMaxHp: 9, targetHp: 0 };
        expect(formatRollSummary([{ ...base, targetIsPlayer: true, targetName: 'Vesa' }]))
            .toBe(`[ROLL RESULT: Bandit attack vs AC 16, rolled 17 — HIT for 9 damage. Vesa now 0/9 HP — the player is DOWNED (0 HP). ${HP_APPLIED}]`);
        expect(formatRollSummary([{ ...base, targetName: 'Jorun' }]))
            .toBe(`[ROLL RESULT: Bandit attack vs AC 16, rolled 17 — HIT for 9 damage. Jorun now 0/9 HP — Jorun is DOWNED. ${HP_APPLIED}]`);
        expect(formatRollSummary([{ type: 'npc_attack', dc: 16, rolled: 3, success: false }]))
            .toBe('[ROLL RESULT: Enemy attack vs AC 16, rolled 3 — MISS]');
        expect(formatRollSummary([{ type: 'npc_attack', attacker: 'Bandit', dc: 16, rolled: 17, success: true }]))
            .toBe('[ROLL RESULT: Bandit attack vs AC 16, rolled 17 — HIT]');
    });

    it('damage rolls carry their notation and total', () => {
        expect(formatRollSummary([{ type: 'damage_roll', description: 'Falling rubble', notation: '2d6', rolled: 7 }]))
            .toBe('[ROLL RESULT: Falling rubble, 2d6, total damage: 7]');
        expect(formatRollSummary([{ type: 'damage_roll', notation: '1d4', rolled: 3 }]))
            .toBe('[ROLL RESULT: Damage roll, 1d4, total damage: 3]');
    });

    it('death saves: each outcome states the clock and whether the hero can act', () => {
        const line = (extra) => formatRollSummary([{ type: 'death_save', rolled: 10, successes: 1, failures: 1, ...extra }]);
        expect(line({ outcome: 'revived', rolled: 20 })).toBe('[ROLL RESULT: Death saving throw, rolled 20 — NATURAL 20 — the player regains consciousness at 1 HP and can act again]');
        expect(line({ outcome: 'stable', successes: 3 })).toBe('[ROLL RESULT: Death saving throw, rolled 10 — third success — the player is STABLE: unconscious at 0 HP, no longer dying]');
        expect(line({ outcome: 'success', successes: 2 })).toBe('[ROLL RESULT: Death saving throw, rolled 10 — success (2/3) — the player is still dying and unconscious]');
        expect(line({ outcome: 'failure', failures: 2 })).toBe('[ROLL RESULT: Death saving throw, rolled 10 — failure (2/3) — the player is still dying and unconscious]');
        expect(line({ outcome: 'dead', failures: 3 })).toContain('THE PLAYER CHARACTER IS DEAD (the system has recorded it; narrate the death, do not emit player_death)');
        // An unknown outcome still renders the tally rather than "undefined".
        expect(line({ outcome: 'junk' })).toBe('[ROLL RESULT: Death saving throw, rolled 10 — 1/3 successes, 1/3 failures]');
    });

    it('a player attack that hit and resolved its damage inline reads like an NPC hit', () => {
        expect(formatRollSummary([{ type: 'attack_roll', description: 'Longsword', dc: 13, rolled: 16, success: true, damage: 8, targetName: 'Goblin', targetHp: 0, targetMaxHp: 7 }]))
            .toBe(`[ROLL RESULT: Longsword vs AC 13, rolled 16 — HIT for 8 damage. Goblin now 0/7 HP — Goblin is DOWNED. ${HP_APPLIED}]`);
    });
});
