/**
 * Latency results as tables and as a blind read. Pure functions over the
 * cell result files `headless.mjs` writes; no app code, no network.
 */

/** Quantile by linear interpolation between the two nearest ranks (the usual spreadsheet / numpy default). */
export function quantile(values, p) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const position = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const sum = (values) => values.filter(Number.isFinite).reduce((total, value) => total + value, 0);
const secs = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : 'n/a');
const whole = (value) => (Number.isFinite(value) ? String(Math.round(value)) : 'n/a');
const range = (values) => {
    const clean = values.filter(Number.isFinite);
    if (clean.length === 0) return 'n/a';
    return clean.length === 1 ? secs(clean[0]) : `${secs(quantile(clean, 50))} (${secs(Math.min(...clean))} to ${secs(Math.max(...clean))})`;
};

export const cellLabel = (cell) => `${cell.model} · ${cell.setting}`;

/** The DM's own coin channels, as the parser names them. */
const COIN_CHANNELS = ['purchases', 'sells', 'coinTo', 'goldLost', 'silverLost', 'copperLost'];

/** What the request carried, in words. */
export function describeWire(result) {
    const wire = result.wire;
    if (!wire) {
        // The request as the app built it: say what the app itself sent.
        const sent = result.turns?.[0]?.dmCalls?.[0]?.sentThinking;
        const field = sent ? Object.entries(sent).map(([name, value]) => `${name}: ${value}`).join(', ') : 'no thinking field';
        return `the app as it ships (${field})`;
    }
    if (wire.unset) return 'no thinking field (the provider default)';
    if ('thinkingLevel' in wire) return `thinkingLevel: ${wire.thinkingLevel}`;
    if ('thinkingBudget' in wire) return `thinkingBudget: ${wire.thinkingBudget}`;
    if ('reasoning_effort' in wire) return `reasoning_effort: ${wire.reasoning_effort}`;
    return JSON.stringify(wire);
}

/** Every number the tables need, from one cell's result file. */
export function summarizeCell(result) {
    const turns = result.turns || [];
    const firstCalls = turns.map(turn => ({ turn, call: turn.dmCalls?.[0] || null })).filter(({ call }) => call && !call.error && Number.isFinite(call.totalMs));
    const usage = firstCalls.map(({ call }) => call.usage).filter(Boolean);
    const plain = turns.filter(turn => !turn.error && !turn.checkProposed && !turn.combatStarted && !turn.correction && (turn.dmCalls || []).length === 1);
    const coinTurns = turns.filter(turn => turn.kind === 'coin' && !turn.error);
    const checks = (result.checks || []).map(rep => rep.attempts.find(attempt => attempt.proposed && !attempt.error)).filter(Boolean);
    const checkTries = (result.checks || []).flatMap(rep => rep.attempts);
    const rounds = (result.rounds || []).filter(round => round.intentAccepted && Number.isFinite(round.roundMs) && !round.error);
    const lookups = plain.map(turn => sum((turn.otherCalls || []).filter(call => call.kind === 'embed-query').map(call => call.totalMs)));
    return {
        cell: result.cell,
        label: cellLabel(result.cell),
        wire: describeWire(result),
        aborted: result.aborted || null,
        call: {
            n: firstCalls.length,
            ttft50: quantile(firstCalls.map(({ call }) => call.ttftMs), 50),
            ttft90: quantile(firstCalls.map(({ call }) => call.ttftMs), 90),
            total50: quantile(firstCalls.map(({ call }) => call.totalMs), 50),
            total90: quantile(firstCalls.map(({ call }) => call.totalMs), 90),
            think50: quantile(usage.map(u => u.thinkTokens), 50),
            thinkMax: usage.length ? Math.max(...usage.map(u => u.thinkTokens)) : null,
            answer50: quantile(usage.map(u => u.answerTokens), 50),
            prompt50: quantile(usage.map(u => u.promptTokens), 50),
            cachedShare: sum(usage.map(u => u.promptTokens)) > 0 ? sum(usage.map(u => u.cachedTokens)) / sum(usage.map(u => u.promptTokens)) : null,
            words50: quantile(firstCalls.filter(({ turn }) => turn.words > 0).map(({ turn }) => turn.words), 50),
            refused: sum(firstCalls.map(({ call }) => (call.refused || []).length)),
            errors: turns.filter(turn => turn.error).length,
        },
        turn: {
            n: plain.length,
            lookup50: quantile(lookups, 50),
            pre50: quantile(plain.map(turn => turn.preStreamMs), 50),
            firstWord50: quantile(plain.map(turn => turn.firstVisibleMs), 50),
            firstWord90: quantile(plain.map(turn => turn.firstVisibleMs), 90),
            whole50: quantile(plain.map(turn => turn.turnMs), 50),
            whole90: quantile(plain.map(turn => turn.turnMs), 90),
            post50: quantile(plain.map(turn => turn.postStreamMs), 50),
        },
        check: {
            reps: (result.checks || []).length,
            done: checks.length,
            missed: checkTries.filter(attempt => !attempt.proposed).length,
            setup: checks.map(check => check.setupMs),
            outcomeFirstWord: checks.map(check => check.outcomeFirstVisibleMs),
            outcome: checks.map(check => check.outcomeMs),
            whole: checks.map(check => check.wholeMs),
            firstLastingWord: checks.map(check => check.firstLastingWordMs),
            dmCalls: checks.map(check => check.dmCallCount),
            flashCalls: checks.map(check => [...(check.otherCallsSetup || []), ...(check.otherCallsOutcome || [])].filter(call => call.kind === 'generate').length),
            setupWords: checks.map(check => check.setupWords),
        },
        round: {
            reps: (result.rounds || []).length,
            done: rounds.length,
            rejected: (result.rounds || []).filter(round => !round.intentAccepted).length,
            intent: rounds.map(round => round.intentMs),
            firstWord: rounds.map(round => round.firstNarrationWordMs),
            whole: rounds.map(round => round.roundMs),
            intentThink: rounds.map(round => round.dmCalls?.[0]?.usage?.thinkTokens),
            narrationThink: rounds.map(round => round.dmCalls?.[1]?.usage?.thinkTokens),
        },
        mechanics: {
            turns: turns.length,
            eventBlock: turns.filter(turn => turn.eventBlock).length,
            unreadable: turns.filter(turn => turn.eventsUnreadable).length,
            empty: turns.filter(turn => !turn.error && !turn.checkProposed && !String(turn.narrative || '').trim()).length,
            checksOnOrdinary: turns.filter(turn => turn.checkProposed).length,
            corrections: turns.filter(turn => turn.correction).length,
            coinTurns: coinTurns.length,
            coinEvented: coinTurns.filter(turn => (turn.eventChannels || []).some(name => COIN_CHANNELS.includes(name))).length,
            coinBooked: coinTurns.filter(turn => turn.coinDelta !== 0).length,
            warnings: sum(turns.map(turn => (turn.warnings || []).length)),
        },
    };
}

export function renderTables(summaries) {
    const lines = [];
    const row = (cells) => `| ${cells.join(' | ')} |`;

    lines.push('### Table 1. The DM call on an ordinary turn');
    lines.push('');
    lines.push('One DM call per turn, measured as the app measures it (`[LLM timing]`): from the request to the first text chunk, and to the end of the reply. A refused attempt that the app retried is inside the number.');
    lines.push('');
    lines.push(row(['Model', 'Setting sent', 'Calls', 'First word p50', 'First word p90', 'Whole call p50', 'Whole call p90', 'Thinking tokens p50 (max)', 'Reply tokens p50', 'Reply words p50', 'Prompt tokens p50', 'Cached share', 'Refused then retried', 'Failed turns']));
    lines.push(row(Array(14).fill('---')));
    for (const s of summaries) {
        lines.push(row([
            s.cell.model, s.wire, s.call.n,
            secs(s.call.ttft50), secs(s.call.ttft90), secs(s.call.total50), secs(s.call.total90),
            `${whole(s.call.think50)} (${whole(s.call.thinkMax)})`, whole(s.call.answer50), whole(s.call.words50), whole(s.call.prompt50),
            s.call.cachedShare === null ? 'n/a' : `${Math.round(s.call.cachedShare * 100)} %`,
            s.call.refused, s.call.errors,
        ]));
    }
    lines.push('');

    lines.push('### Table 2. The whole ordinary turn, as the player waits');
    lines.push('');
    lines.push('From sending the line: the memory lookup the turn waits on, then the DM call. "Input back" is when the turn has committed and the player can type again. Turns where the DM proposed a check are left out and counted in table 5.');
    lines.push('');
    lines.push(row(['Model', 'Setting sent', 'Turns', 'Before the DM call p50', 'of which memory lookup p50', 'Send to first word p50', 'Send to first word p90', 'Send to input back p50', 'Send to input back p90']));
    lines.push(row(Array(9).fill('---')));
    for (const s of summaries) {
        lines.push(row([s.cell.model, s.wire, s.turn.n, secs(s.turn.pre50), secs(s.turn.lookup50), secs(s.turn.firstWord50), secs(s.turn.firstWord90), secs(s.turn.whole50), secs(s.turn.whole90)]));
    }
    lines.push('');

    lines.push('### Table 3. One whole skill check');
    lines.push('');
    lines.push('The same line, from the same saved state, each time. Median of the repetitions, lowest to highest in brackets. The check is two DM calls with a Flash arbiter call between them; the player\'s click on the check card is not timed. The setup call\'s prose is held back once a check is staged, so the first words that stay on screen come from the second call.');
    lines.push('');
    lines.push(row(['Model', 'Setting sent', 'Checks timed', 'Send to check card', 'Click to first word', 'Click to done', 'Whole check, both waits', 'Send to the first lasting word, click excluded', 'DM calls', 'Flash calls', 'Tries with no check proposed', 'Words of setup prose held back, each check']));
    lines.push(row(Array(12).fill('---')));
    for (const s of summaries) {
        lines.push(row([
            s.cell.model, s.wire, `${s.check.done} of ${s.check.reps}`,
            range(s.check.setup), range(s.check.outcomeFirstWord), range(s.check.outcome), range(s.check.whole), range(s.check.firstLastingWord),
            s.check.dmCalls.length ? whole(quantile(s.check.dmCalls, 50)) : 'n/a',
            s.check.flashCalls.length ? whole(quantile(s.check.flashCalls, 50)) : 'n/a',
            s.check.missed,
            s.check.setupWords.length ? s.check.setupWords.join(', ') : 'n/a',
        ]));
    }
    lines.push('');

    lines.push('### Table 4. One whole fight round');
    lines.push('');
    lines.push('The same attack line against the same two foes. A round is a JSON-only intent call, the engine\'s dice, then a narration call. Median of the repetitions, lowest to highest in brackets.');
    lines.push('');
    lines.push(row(['Model', 'Setting sent', 'Rounds timed', 'Send to dice on screen (intent call)', 'Send to first narration word', 'Whole round', 'Thinking tokens: intent / narration (p50)', 'Intent rejected']));
    lines.push(row(Array(8).fill('---')));
    for (const s of summaries) {
        lines.push(row([
            s.cell.model, s.wire, `${s.round.done} of ${s.round.reps}`,
            range(s.round.intent), range(s.round.firstWord), range(s.round.whole),
            `${whole(quantile(s.round.intentThink, 50))} / ${whole(quantile(s.round.narrationThink, 50))}`,
            s.round.rejected,
        ]));
    }
    lines.push('');

    lines.push('### Table 5. Did the mechanics still arrive');
    lines.push('');
    lines.push('Counts over the twenty ordinary turns. The two purchase turns are the hot pie and the small beer. "Coin event" is the DM\'s own event; "booked at once" is the hero\'s coin changing inside the turn. The engine sets aside a payment that looks like a repeat of a recent one, and the app settles it after the turn, which a measured turn does not run, so the first of the two columns is the one that speaks about the DM.');
    lines.push('');
    lines.push(row(['Model', 'Setting sent', 'Replies with an event block', 'Event block unreadable', 'Empty replies', 'Purchase turns with a coin event', 'of those, booked at once', 'Checks proposed on ordinary turns', 'Corrections sent', 'Warnings logged']));
    lines.push(row(Array(10).fill('---')));
    for (const s of summaries) {
        lines.push(row([
            s.cell.model, s.wire,
            `${s.mechanics.eventBlock} of ${s.mechanics.turns}`, s.mechanics.unreadable, s.mechanics.empty,
            `${s.mechanics.coinEvented} of ${s.mechanics.coinTurns}`, s.mechanics.coinBooked, s.mechanics.checksOnOrdinary, s.mechanics.corrections, s.mechanics.warnings,
        ]));
    }
    lines.push('');
    return lines.join('\n');
}

// --- The blind read ---------------------------------------------------------

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Letters to cells, shuffled by `seed` so the order of the table says nothing. */
export function assignLetters(results, seed) {
    const random = mulberry32(seed);
    const order = results.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order.map((resultIndex, position) => ({ letter: String.fromCharCode(65 + position), result: results[resultIndex] }));
}

const quote = (text) => String(text || '').trim().split(/\r?\n/).map(line => `> ${line}`.trimEnd()).join('\n');

/**
 * The replies, lettered. Every lettered reply answers the same line from the
 * same saved state; the story between turns is the recording's, not any
 * letter's. The order the letters appear in rotates by turn.
 */
export function renderBlindRead({ fixture, lettered, date }) {
    const lines = [];
    const letters = lettered.map(entry => entry.letter);
    lines.push(`# Latency experiment: the replies, blind (${date})`);
    lines.push('');
    lines.push(`Each letter is one model at one thinking setting. Which is which is in the key file beside this one; read this first.`);
    lines.push('');
    lines.push('How to read it:');
    lines.push('');
    lines.push(`- Every lettered reply to a turn answers the same player line with the same story behind it (the same saved campaign state, the same last twenty rows, the same memory). The only difference between letters is the model and the setting.`);
    lines.push('- "The story so far" is the reply the recording run gave. The story moves on from that reply, not from any lettered one, so a lettered reply that sends the scene somewhere else is not carried into the next turn.');
    lines.push('- The text is what the player sees: the trailing event block is cut, as the game cuts it.');
    lines.push(`- The letters appear in a different order on each turn. ${letters.length} letters, ${fixture.transcript.length - 1} ordinary turns, then one skill check and one fight round each.`);
    lines.push('- A verdict per letter is what the decision needs: which letters, if any, read worse than the others, and whether any difference would matter in play.');
    lines.push('');
    const turnCount = Math.max(...lettered.map(entry => entry.result.turns.length));
    for (let i = 0; i < turnCount; i += 1) {
        const before = fixture.transcript[i];
        const line = lettered[0].result.turns[i]?.line || fixture.transcript[i + 1]?.player || '';
        lines.push(`## Turn ${i + 1}`);
        lines.push('');
        lines.push('**The story so far (the last reply before this line):**');
        lines.push('');
        lines.push(quote(before?.dm || ''));
        lines.push('');
        lines.push(`**The player:** ${line}`);
        lines.push('');
        for (let k = 0; k < lettered.length; k += 1) {
            const { letter, result } = lettered[(k + i) % lettered.length];
            const turn = result.turns[i];
            lines.push(`### ${letter}`);
            lines.push('');
            if (!turn) {
                lines.push('*[not run]*');
            } else if (turn.error) {
                lines.push(`*[no reply: the turn failed (${turn.error.slice(0, 120)})]*`);
            } else {
                if (turn.checkProposed) lines.push(`*[The DM proposed a check here (${turn.checkProposed.join(', ')}). The player sees a check card; any text below is held back until the dice.]*\n`);
                if (turn.correction) lines.push('*[The first reply was refused by the roll arbiter; this is the corrected reply.]*\n');
                lines.push(String(turn.narrative || '').trim() || '*[no prose]*');
            }
            lines.push('');
        }
    }
    lines.push('## The skill check');
    lines.push('');
    lines.push('The same line from the state after turn 20. The dice are real, so the letters did not all roll the same result; each reply is the outcome of its own roll.');
    lines.push('');
    lines.push(`**The player:** ${lettered[0].result.checks?.[0]?.attempts?.[0]?.line || ''}`.trimEnd());
    lines.push('');
    for (const { letter, result } of lettered) {
        const check = (result.checks || []).map(rep => rep.attempts.find(attempt => attempt.proposed && !attempt.error)).find(Boolean);
        lines.push(`### ${letter}`);
        lines.push('');
        if (!check) {
            lines.push('*[no check was proposed in any try]*');
        } else {
            lines.push(`*[Check: ${check.rolls.join(', ')}. ${(check.rollLines || []).join(' ')}]*`.replace(/\s+\]/, ']'));
            lines.push('');
            lines.push(String(check.narrative || '').trim() || '*[no prose]*');
        }
        lines.push('');
    }
    lines.push('## The fight round');
    lines.push('');
    lines.push('The same attack line against the same two foes. The engine rolled each letter\'s round separately; the resolved events are listed first.');
    lines.push('');
    lines.push(`**The player:** ${lettered[0].result.rounds?.[0]?.line || ''}`.trimEnd());
    lines.push('');
    for (const { letter, result } of lettered) {
        const fight = (result.rounds || []).find(round => round.intentAccepted && String(round.narrative || '').trim());
        lines.push(`### ${letter}`);
        lines.push('');
        if (!fight) {
            lines.push('*[no round was narrated]*');
        } else {
            for (const resolved of fight.resolved || []) lines.push(`- ${resolved}`);
            lines.push('');
            lines.push(String(fight.narrative || '').trim());
        }
        lines.push('');
    }
    return lines.join('\n');
}

export function renderKey({ lettered, seed, date }) {
    const lines = [];
    lines.push(`# Latency experiment: the key to the letters (${date})`);
    lines.push('');
    lines.push('Read the blind file first. This file says which model and setting each letter was.');
    lines.push('');
    lines.push('| Letter | Model | Setting sent on the DM call |');
    lines.push('|---|---|---|');
    for (const { letter, result } of lettered) lines.push(`| ${letter} | ${result.cell.model} | ${describeWire(result)} |`);
    lines.push('');
    lines.push(`Letters were assigned by a shuffle (seed ${seed}).`);
    lines.push('');
    return lines.join('\n');
}
