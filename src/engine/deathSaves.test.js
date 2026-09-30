/**
 * The count is on the page (WOW 2026-09-30, death-and-stakes): ONE judge and
 * ONE renderer for the death-save clock, shared by the combat exchange line,
 * the reducer's DEATH_SAVE_RESULT, and the out-of-combat resolver.
 */
import { describe, expect, it } from 'vitest';
import { deathSaveLine, describeDeathSaveCount, describeDeathSaveOutcome, judgeDeathSave, DEATH_SAVE_OUTCOMES, PLAYER_SNAPSHOT_STATUSES } from './deathSaves.js';

describe('judgeDeathSave — the one judge', () => {
    it('10+ succeeds, three successes stabilize', () => {
        expect(judgeDeathSave({ successes: 0, failures: 0 }, 10)).toEqual({ outcome: 'success', natural: 10, successes: 1, failures: 0 });
        expect(judgeDeathSave({ successes: 2, failures: 1 }, 15)).toEqual({ outcome: 'stable', natural: 15, successes: 3, failures: 1 });
    });

    it('below 10 fails, natural 1 counts two, three failures kill', () => {
        expect(judgeDeathSave({ successes: 0, failures: 0 }, 4)).toEqual({ outcome: 'failure', natural: 4, successes: 0, failures: 1 });
        expect(judgeDeathSave({ successes: 0, failures: 0 }, 1)).toEqual({ outcome: 'failure', natural: 1, successes: 0, failures: 2 });
        expect(judgeDeathSave({ successes: 1, failures: 1 }, 1)).toEqual({ outcome: 'dead', natural: 1, successes: 1, failures: 3 });
        expect(judgeDeathSave({ successes: 0, failures: 2 }, 9)).toEqual({ outcome: 'dead', natural: 9, successes: 0, failures: 3 });
    });

    it('natural 20 revives without touching the tally', () => {
        expect(judgeDeathSave({ successes: 1, failures: 2 }, 20)).toEqual({ outcome: 'revived', natural: 20, successes: 1, failures: 2 });
    });

    it('a die-less call is null (the skipped signal), and a junk tally is typed first', () => {
        expect(judgeDeathSave({ successes: 0, failures: 0 }, null)).toBeNull();
        expect(judgeDeathSave({ successes: 0, failures: 0 }, '4')).toBeNull();
        // A string tally used to string-concatenate to "11" >= 3 and kill on the first failure.
        expect(judgeDeathSave({ successes: '0', failures: '1' }, 4)).toEqual({ outcome: 'failure', natural: 4, successes: 0, failures: 2 });
        expect(judgeDeathSave(undefined, 12)).toEqual({ outcome: 'success', natural: 12, successes: 1, failures: 0 });
    });
});

describe('deathSaveLine — the one renderer, reading as a countdown', () => {
    const at = (saves, natural) => deathSaveLine(judgeDeathSave(saves, natural), 'Astra');

    it('4 / 13 / 1 from a fresh clock counts down to the death', () => {
        expect(at({ successes: 0, failures: 0 }, 4)).toBe('**Death Saving Throw:** natural **4** — failure (1/3). Two more and Astra dies.');
        expect(at({ successes: 0, failures: 1 }, 13)).toBe('**Death Saving Throw:** natural **13** — success (1/3). Two more and Astra is stable.');
        expect(at({ successes: 1, failures: 1 }, 1)).toBe('**Death Saving Throw:** natural **1** — THE THIRD FAILURE. Astra dies.');
    });

    it('the other outcomes: one failure from death, one success from stable, stable, natural 1, natural 20', () => {
        expect(at({ successes: 0, failures: 1 }, 4)).toBe('**Death Saving Throw:** natural **4** — failure (2/3). One more and Astra dies.');
        expect(at({ successes: 1, failures: 0 }, 11)).toBe('**Death Saving Throw:** natural **11** — success (2/3). One more and Astra is stable.');
        expect(at({ successes: 2, failures: 0 }, 11)).toBe('**Death Saving Throw:** natural **11** — STABLE: unconscious, no longer dying.');
        expect(at({ successes: 0, failures: 0 }, 1)).toBe('**Death Saving Throw:** natural **1** — NATURAL 1, two failures (2/3). One more and Astra dies.');
        expect(at({ successes: 0, failures: 2 }, 20)).toBe('**Death Saving Throw:** natural **20** — NATURAL 20: Astra is back on their feet with 1 HP.');
    });

    it('never prints undefined: a junk judged object and a nameless hero still render a bounded line', () => {
        expect(deathSaveLine(null, null)).toBe('**Death Saving Throw:** natural **0** — 0/3 successes, 0/3 failures.');
        expect(deathSaveLine({ outcome: 'failure', natural: 4 }, { name: 'x' })).toBe('**Death Saving Throw:** natural **4** — failure (0/3). Three more and The hero dies.');
        expect(describeDeathSaveOutcome({ outcome: 'dead' }, '   ')).toBe('THE THIRD FAILURE. The hero dies.');
        for (const outcome of DEATH_SAVE_OUTCOMES) {
            expect(describeDeathSaveOutcome({ outcome, natural: 5, successes: 'x', failures: 99 }, 'Astra')).not.toContain('undefined');
        }
    });
});

describe('describeDeathSaveCount — the narration prompt tally clause', () => {
    it('names how many failures kill, and the stabilizing success when one away', () => {
        expect(describeDeathSaveCount({ successes: 1, failures: 2 })).toBe('1 success / 2 failures — the next failure kills');
        expect(describeDeathSaveCount({ successes: 0, failures: 1 })).toBe('0 successes / 1 failure — two more failures kill');
        expect(describeDeathSaveCount({ successes: 0, failures: 0 })).toBe('0 successes / 0 failures — three more failures kill');
        expect(describeDeathSaveCount({ successes: 2, failures: 2 })).toBe('2 successes / 2 failures — the next failure kills, the next success stabilizes');
        expect(describeDeathSaveCount(null)).toBe('0 successes / 0 failures — three more failures kill');
    });

    it('the status whitelist is the stored snapshot contract', () => {
        expect(PLAYER_SNAPSHOT_STATUSES).toEqual(['active', 'dying', 'stable', 'revived', 'defeated', 'dead']);
    });
});
