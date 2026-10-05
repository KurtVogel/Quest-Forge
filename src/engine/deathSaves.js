/**
 * The death-save clock, judged ONCE and worded ONCE (WOW 2026-09-30,
 * death-and-stakes: "the count is on the page").
 *
 * Three lanes used to judge a death save with three private copies of the
 * 5e rule — the exchange engine's own projection (deleted 2026-10-05), the reducer's
 * DEATH_SAVE_RESULT, and the out-of-combat resolver — and only the resolver
 * put the OUTCOME on the page; the combat line was a bare "natural 13." with
 * no success / failure word and no tally, so the player read dice and the DM
 * narrated blind. `judgeDeathSave` is the one judge every lane reads, and
 * `deathSaveLine` is the one chat renderer both lanes write through, so the
 * chat line, the reducer's tally, and the narration prompt's PLAYER line can
 * never disagree. Pure; no dice here — the caller rolls (crypto) and hands
 * the natural in. The low-level-solo mercy is judged by its callers
 * (`isLowLevelSolo`) BEFORE any die exists; this module never sees it.
 */
import { normalizeDeathSaves } from './rules.js';

export const DEATH_SAVE_OUTCOMES = Object.freeze(['revived', 'stable', 'success', 'failure', 'dead']);

/** `postState.player.status` on a stored exchange result — the hero's state after the exchange. */
export const PLAYER_SNAPSHOT_STATUSES = Object.freeze(['active', 'dying', 'stable', 'revived', 'defeated', 'dead']);

const DEATH_SAVE_TALLY_MAX = 3;

/**
 * Judge one death save against the tally BEFORE it: the post-save tally and
 * the outcome. Natural 20 revives (1 HP), 10+ is a success (three stabilize),
 * below 10 a failure, natural 1 counts two (three kill). Returns null for a
 * non-integer die — a die-less dispatch is the "skipped" signal, never a
 * failure. Tallies are integers 0..3 (`normalizeDeathSaves`).
 */
export function judgeDeathSave(prevSaves, natural) {
    if (!Number.isInteger(natural)) return null;
    const prev = normalizeDeathSaves(prevSaves);
    if (natural === 20) {
        return { outcome: 'revived', natural, successes: prev.successes, failures: prev.failures };
    }
    if (natural >= 10) {
        const successes = Math.min(DEATH_SAVE_TALLY_MAX, prev.successes + 1);
        return { outcome: successes >= DEATH_SAVE_TALLY_MAX ? 'stable' : 'success', natural, successes, failures: prev.failures };
    }
    const failures = Math.min(DEATH_SAVE_TALLY_MAX, prev.failures + (natural === 1 ? 2 : 1));
    return { outcome: failures >= DEATH_SAVE_TALLY_MAX ? 'dead' : 'failure', natural, successes: prev.successes, failures };
}

function heroLabel(name) {
    const text = typeof name === 'string' ? name.trim() : '';
    return text || 'The hero';
}

const COUNT_WORDS = ['No more', 'One more', 'Two more', 'Three more'];

/**
 * The outcome clause after "natural **N** —". The hero is named, never
 * pronouned (the Scribe's own rule for the hero: the record must not guess a
 * gender). A junk `judged` (a hostile stored event) still renders a bounded
 * line — the renderer never prints `undefined`.
 */
export function describeDeathSaveOutcome(judged, heroName) {
    const name = heroLabel(heroName);
    const saves = normalizeDeathSaves(judged);
    const outcome = judged?.outcome;
    if (outcome === 'revived') return `NATURAL 20: ${name} is back on their feet with 1 HP.`;
    if (outcome === 'stable') return 'STABLE: unconscious, no longer dying.';
    if (outcome === 'dead') return `THE THIRD FAILURE. ${name} dies.`;
    if (outcome === 'success') {
        const left = DEATH_SAVE_TALLY_MAX - saves.successes;
        return `success (${saves.successes}/3). ${COUNT_WORDS[left]} and ${name} is stable.`;
    }
    if (outcome === 'failure') {
        const left = DEATH_SAVE_TALLY_MAX - saves.failures;
        const head = judged?.natural === 1 ? 'NATURAL 1, two failures' : 'failure';
        return `${head} (${saves.failures}/3). ${COUNT_WORDS[left]} and ${name} dies.`;
    }
    return `${saves.successes}/3 successes, ${saves.failures}/3 failures.`;
}

/**
 * THE death-save chat line — the combat exchange line and the out-of-combat
 * resolver both write through it:
 *   **Death Saving Throw:** natural **4** — failure (2/3). One more and Astra dies.
 *   **Death Saving Throw:** natural **13** — success (1/3). Two more and Astra is stable.
 *   **Death Saving Throw:** natural **20** — NATURAL 20: Astra is back on their feet with 1 HP.
 *   **Death Saving Throw:** natural **1** — THE THIRD FAILURE. Astra dies.
 */
export function deathSaveLine(judged, heroName) {
    const natural = Number.isInteger(judged?.natural) ? judged.natural : 0;
    return `**Death Saving Throw:** natural **${natural}** — ${describeDeathSaveOutcome(judged, heroName)}`;
}

/**
 * The tally as the narration prompt's PLAYER line carries it:
 *   "1 success / 2 failures — the next failure kills"
 * (", the next success stabilizes" joins when a success is one away).
 */
export function describeDeathSaveCount(saves) {
    const tally = normalizeDeathSaves(saves);
    const s = tally.successes;
    const f = tally.failures;
    const toDeath = DEATH_SAVE_TALLY_MAX - f;
    const deathClause = toDeath <= 1
        ? 'the next failure kills'
        : `${toDeath === 2 ? 'two' : 'three'} more failures kill`;
    const stableClause = DEATH_SAVE_TALLY_MAX - s === 1 ? ', the next success stabilizes' : '';
    return `${s} success${s === 1 ? '' : 'es'} / ${f} failure${f === 1 ? '' : 's'} — ${deathClause}${stableClause}`;
}
