# Turn latency experiment, 2026-11-11 (review queue item 2)

**Status:** measured on real providers, then shipped the same day on Vesa's pick ("Ship low"); see "What shipped" at the end. Everything above that section was measured before the change, with the setting put on the request by the harness.

- The replies, lettered: `docs/LATENCY_EVAL_2026-11-11_BLIND_READ.md`. Read it before the key.
- The key to the letters: `docs/LATENCY_EVAL_2026-11-11_KEY.md`.
- The harness: `npm.cmd run eval:latency` (`scripts/latencyEval.mjs`, `scripts/latency/`).

## The result in short

1. **On Gemini 3.8 Flash, the wait before the first word is the model thinking.** The app sends no thinking setting on the DM call, so the model thinks at its default (medium, by Google's documentation). It spent 311 to 2,193 thinking tokens a turn, median 842. Time to first word followed the thinking-token count almost exactly over the 20 turns (r = 0.98): about 2.6 s, plus about 9 ms for each thinking token.
2. **`thinkingLevel: "low"` took the thinking to zero on all 20 turns.** First word p50 went from 10.6 s to 2.0 s and p90 from 19.6 s to 3.3 s. The whole call went from 12.2 s to 4.4 s at p50 and from 21.3 s to 6.0 s at p90. Low was faster on 20 of 20 turns; the median gap was 8.7 s.
3. **Call count is the other half, and a setting does not remove it.** A skill check is two DM calls with a Flash arbiter call between them: 33.4 s at the default, 11.9 s at low (median of three). A fight round is two DM calls: 18.1 s at the default, 10.8 s at low. The arbiter call took 1.7 to 3.1 s, median about 1.9 s.
4. **The older `thinkingBudget: 0` measured the same as low on 3.8 Flash.** It is not the field to ship: Gemini 3.5 Flash-Lite refuses it with HTTP 400, and Google's thinking guide no longer documents it. `low` is accepted by all four Gemini models in the picker.
5. **GPT-6.1 Sol at `reasoning_effort: "low"`:** first word p50 3.8 s to 1.7 s, whole call 8.5 s to 6.0 s. A smaller gain, because Sol reasons little at its default on these turns (median 53 reasoning tokens).
6. **Gemini 3.5 Flash-Lite is the fastest and dropped the mechanics.** First word 0.7 s, whole call 1.3 s. But 1 reply in 20 carried an event block, neither purchase produced a coin event, the check line produced a check in 1 of 9 tries, and 1 of 3 combat intents came back as prose. It is not a candidate for the DM on this evidence.
7. **What low cost on 3.8 Flash, as far as counting shows.** The prose itself is for the blind read. Counted: replies ran longer (median 154 words against 127; 2 of 20 over 180 words against 1 of 20); the reply that proposes a check carried 76, 0 and 107 words of prose that the game then withholds, where the default wrote 17 to 20; and the check line was narrated straight through, with no check, in 1 of 4 tries (default 0 of 3). Both purchases still produced a coin event, no event block was unreadable, and all three combat intents were accepted.

The earlier measurement reproduces for the first word (10.9 s / 18.6 s then, 10.6 s / 19.6 s now). The earlier "27 to 30 s" does not match the 12.2 s call here. That figure was the browser playtest driver's wait per turn across a whole session (`docs/OPUS_PLAYTEST_2026-10-31.md`: "DM latency p50 29 s / p90 41 s"), which mixes ordinary turns, checks and fight rounds; I did not check exactly what its timer spans. This run reports the three shapes apart: 12.6 s, 33.4 s and 18.1 s at the default.

## The tables

Six cells, each one model at one setting. Every cell answered the same 20 lines from the same saved campaign states, then the same check line three times and the same fight round three times. p50 and p90 are over the 20 turns, by linear interpolation. All six cells ran side by side between 11:19 and 11:28 UTC, so they saw the same provider load.

### Table 1. The DM call on an ordinary turn

One DM call per turn, measured as the app measures it (`[LLM timing]`): from the request to the first text chunk, and to the end of the reply. A refused attempt that the app retried is inside the number.

| Model | Setting sent | Calls | First word p50 | First word p90 | Whole call p50 | Whole call p90 | Thinking tokens p50 (max) | Reply tokens p50 | Reply words p50 | Prompt tokens p50 | Cached share | Refused then retried | Failed turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.8-flash | nothing sent (the app as it ships) | 20 | 10.6 s | 19.6 s | 12.2 s | 21.3 s | 842 (2193) | 180 | 127 | 23143 | 5 % | 0 | 0 |
| gemini-3.8-flash | thinkingLevel: low | 20 | 2.0 s | 3.3 s | 4.4 s | 6.0 s | 0 (0) | 223 | 154 | 23145 | 14 % | 0 | 0 |
| gemini-3.8-flash | thinkingBudget: 0 | 20 | 2.0 s | 2.5 s | 4.8 s | 6.4 s | 0 (0) | 227 | 145 | 23145 | 4 % | 0 | 0 |
| gemini-3.5-flash-lite | nothing sent (the app as it ships) | 20 | 0.7 s | 0.8 s | 1.3 s | 1.6 s | 0 (0) | 142 | 105 | 23140 | 0 % | 0 | 0 |
| gpt-6.1-sol | nothing sent (the app as it ships) | 20 | 3.8 s | 7.7 s | 8.5 s | 11.8 s | 53 (181) | 143 | 95 | 22674 | 79 % | 0 | 0 |
| gpt-6.1-sol | reasoning_effort: low | 20 | 1.7 s | 3.7 s | 6.0 s | 8.4 s | 0 (94) | 119 | 87 | 22674 | 75 % | 0 | 0 |

### Table 2. The whole ordinary turn, as the player waits

From sending the line: the memory lookup the turn waits on, then the DM call. "Input back" is when the turn has committed and the player can type again. Turns where the DM proposed a check are left out and counted in table 5.

| Model | Setting sent | Turns | Before the DM call p50 | of which memory lookup p50 | Send to first word p50 | Send to first word p90 | Send to input back p50 | Send to input back p90 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.8-flash | nothing sent (the app as it ships) | 20 | 0.5 s | 0.4 s | 11.0 s | 19.9 s | 12.6 s | 21.7 s |
| gemini-3.8-flash | thinkingLevel: low | 20 | 0.4 s | 0.4 s | 2.4 s | 3.4 s | 4.9 s | 6.4 s |
| gemini-3.8-flash | thinkingBudget: 0 | 20 | 0.4 s | 0.4 s | 2.4 s | 3.0 s | 5.3 s | 6.8 s |
| gemini-3.5-flash-lite | nothing sent (the app as it ships) | 19 | 0.3 s | 0.3 s | 1.1 s | 1.3 s | 1.8 s | 2.0 s |
| gpt-6.1-sol | nothing sent (the app as it ships) | 20 | 0.5 s | 0.4 s | 4.1 s | 8.1 s | 8.9 s | 12.2 s |
| gpt-6.1-sol | reasoning_effort: low | 20 | 0.5 s | 0.5 s | 2.1 s | 5.7 s | 6.4 s | 10.3 s |

### Table 3. One whole skill check

The same line, from the same saved state, each time. Median of the repetitions, lowest to highest in brackets. The check is two DM calls with a Flash arbiter call between them; the player's click on the check card is not timed. The setup call's prose is held back once a check is staged, so the first words that stay on screen come from the second call.

| Model | Setting sent | Checks timed | Send to check card | Click to first word | Click to done | Whole check, both waits | Send to the first lasting word, click excluded | DM calls | Flash calls | Tries with no check proposed | Words of setup prose held back, each check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.8-flash | nothing sent (the app as it ships) | 3 of 3 | 21.1 s (10.5 s to 26.5 s) | 9.0 s (7.4 s to 9.6 s) | 10.6 s (9.3 s to 12.2 s) | 33.4 s (21.0 s to 35.9 s) | 30.8 s (19.5 s to 33.9 s) | 2 | 1 | 0 | 20, 19, 17 |
| gemini-3.8-flash | thinkingLevel: low | 3 of 3 | 6.6 s (5.6 s to 7.5 s) | 2.2 s (1.9 s to 4.2 s) | 5.4 s (4.6 s to 6.3 s) | 11.9 s (11.2 s to 13.0 s) | 9.7 s (8.5 s to 9.8 s) | 2 | 1 | 1 | 76, 0, 107 |
| gemini-3.8-flash | thinkingBudget: 0 | 3 of 3 | 6.9 s (5.9 s to 8.2 s) | 1.9 s (1.9 s to 2.0 s) | 4.6 s (4.6 s to 6.1 s) | 11.5 s (10.5 s to 14.3 s) | 8.9 s (7.8 s to 10.2 s) | 2 | 1 | 1 | 115, 81, 25 |
| gemini-3.5-flash-lite | nothing sent (the app as it ships) | 1 of 3 | 4.1 s | 0.9 s | 1.5 s | 5.5 s | 5.0 s | 2 | 1 | 8 | 126 |
| gpt-6.1-sol | nothing sent (the app as it ships) | 3 of 3 | 10.9 s (8.0 s to 15.3 s) | 5.3 s (5.0 s to 6.1 s) | 10.4 s (10.2 s to 11.4 s) | 21.4 s (18.2 s to 26.7 s) | 16.0 s (13.3 s to 21.4 s) | 2 | 1 | 0 | 11, 25, 22 |
| gpt-6.1-sol | reasoning_effort: low | 3 of 3 | 7.3 s (7.0 s to 8.3 s) | 1.7 s (1.5 s to 2.0 s) | 7.7 s (7.1 s to 7.9 s) | 15.0 s (14.1 s to 16.2 s) | 9.1 s (8.8 s to 10.1 s) | 2 | 1 | 0 | 11, 14, 12 |

### Table 4. One whole fight round

The same attack line against the same two foes. A round is a JSON-only intent call, the engine's dice, then a narration call. Median of the repetitions, lowest to highest in brackets.

| Model | Setting sent | Rounds timed | Send to dice on screen (intent call) | Send to first narration word | Whole round | Thinking tokens: intent / narration (p50) | Intent rejected |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.8-flash | nothing sent (the app as it ships) | 3 of 3 | 9.0 s (6.6 s to 9.4 s) | 16.7 s (12.9 s to 17.0 s) | 18.1 s (14.3 s to 19.1 s) | 554 / 553 | 0 |
| gemini-3.8-flash | thinkingLevel: low | 3 of 3 | 4.6 s (2.8 s to 10.7 s) | 6.9 s (4.8 s to 12.8 s) | 10.8 s (7.2 s to 14.8 s) | 0 / 0 | 0 |
| gemini-3.8-flash | thinkingBudget: 0 | 3 of 3 | 3.5 s (3.0 s to 11.8 s) | 5.4 s (5.0 s to 13.8 s) | 7.0 s (7.0 s to 15.9 s) | 0 / 0 | 0 |
| gemini-3.5-flash-lite | nothing sent (the app as it ships) | 2 of 3 | 1.1 s (1.1 s to 1.2 s) | 1.9 s (1.7 s to 2.1 s) | 2.5 s (2.2 s to 2.8 s) | 0 / 0 | 1 |
| gpt-6.1-sol | nothing sent (the app as it ships) | 3 of 3 | 2.8 s (2.2 s to 2.8 s) | 4.4 s (3.6 s to 4.7 s) | 7.4 s (6.9 s to 7.5 s) | 0 / 0 | 0 |
| gpt-6.1-sol | reasoning_effort: low | 3 of 3 | 2.2 s (2.0 s to 2.2 s) | 3.6 s (3.5 s to 3.8 s) | 7.2 s (6.6 s to 8.1 s) | 0 / 0 | 0 |

### Table 5. Did the mechanics still arrive

Counts over the twenty ordinary turns. The two purchase turns are the hot pie and the small beer. "Coin event" is the DM's own event; "booked at once" is the hero's coin changing inside the turn. The engine sets aside a payment that looks like a repeat of a recent one, and the app settles it after the turn, which a measured turn does not run, so the first of the two columns is the one that speaks about the DM.

| Model | Setting sent | Replies with an event block | Event block unreadable | Empty replies | Purchase turns with a coin event | of those, booked at once | Checks proposed on ordinary turns | Corrections sent | Warnings logged |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.8-flash | nothing sent (the app as it ships) | 8 of 20 | 0 | 0 | 2 of 2 | 2 | 0 | 0 | 0 |
| gemini-3.8-flash | thinkingLevel: low | 11 of 20 | 0 | 0 | 2 of 2 | 1 | 0 | 0 | 0 |
| gemini-3.8-flash | thinkingBudget: 0 | 10 of 20 | 0 | 0 | 2 of 2 | 2 | 0 | 0 | 0 |
| gemini-3.5-flash-lite | nothing sent (the app as it ships) | 1 of 20 | 0 | 0 | 0 of 2 | 0 | 1 | 0 | 1 |
| gpt-6.1-sol | nothing sent (the app as it ships) | 8 of 20 | 0 | 0 | 2 of 2 | 1 | 0 | 0 | 0 |
| gpt-6.1-sol | reasoning_effort: low | 6 of 20 | 0 | 0 | 1 of 2 | 1 | 0 | 0 | 0 |

## Limits of this evidence

- **One nine-minute window, one key, one machine.** Provider load moves through the day; earlier playtests met hours of 503 "high demand" on 3.8 Flash. This run met none: no call was refused, no turn failed. The gap between settings is far larger than run-to-run noise, but the absolute seconds are those of this window.
- **20 turns per cell, 3 checks, 3 rounds.** p90 over 20 values rests on the two slowest turns. One slow call shows in the ranges of table 4 (10.7 s and 11.8 s intent calls at low and budget 0, against a median near 4 s).
- **A fresh campaign at turn 20,** not the megacampaign: 18 facts, 10 people, 13 story cards, 3 journal summaries, a prompt of about 23,000 tokens. A long campaign's prompt is larger; the thinking-token share of the wait should hold, the seconds will not be the same.
- **No browser.** The harness runs the app's turn pipeline in Node. React rendering, paint and the autosave are not in the numbers. The Scribe is not either: it runs after the turn and the player does not wait on it.
- **Mechanics counts are small.** Two purchase turns, three or four check tries, three rounds per cell. They can show a collapse (Flash-Lite) and cannot rank two settings that both mostly work. The Scribe's audits, which catch a missed event in the app, did not run on measured turns.
- **Gemini's cache did not carry the prefix.** 0 to 14 % of prompt tokens were reported as cached on the Gemini cells, against 75 to 79 % on GPT-6.1 Sol, where the app sets an explicit breakpoint. Cells ran in parallel from separate processes, which may be part of it. It does not change the comparison between settings (all Gemini cells were alike), but item 3's cost estimate assumes a cached prefix and should measure it.

## How it was measured

- **The app's own pipeline, headless.** `scripts/latency/headless.mjs` drives `createTurnRunner` from `src/llm/turnOrchestrator.js` with a reducer-backed store. The prompt builder, adapter, providers, parser, roll arbiter, dice and combat engine are the shipped modules. What the harness adds is what `ChatPanel.jsx` does around the runner: posting the player's row, routing the reply, and the combat round's effects.
- **The setting is set on the wire.** A `fetch` wrapper adds the thinking field to the DM stream's request body as it leaves. No file under `src/` changed. `default` sends the body as the app builds it.
- **The same story for every cell.** `record` played the 20 lines once on the shipped default with the Scribe, the journal cadence and the opening front director running, and saved the campaign state before each turn (`scripts/latency/fixture.json`). Each cell replays every turn from its saved state, with the memory store seeded as a Continue would seed it. So each reply answers the same line with the same history, facts and memories, and the replies can be read side by side.
- **What each number spans.** "First word" and "whole call" are per DM call, from the request to the first text chunk and to the end of the stream, as the app's `[LLM timing]` log measures them. "Send to first word" and "send to input back" start when the player sends, so they include the memory lookup (0.3 to 0.5 s) and anything after the stream. Thinking tokens are the provider's own usage figures.
- **The check and the round.** The check line is played from the state after turn 20; a reply that proposes no check is counted and the line is tried again, up to three times. The player's click on the check card is not timed, and the two waits are added. The fight is opened by a scripted DM reply so every cell fights the same two foes; the round is the intent call, the engine's dice, and the narration call.
- **Each cell in its own process,** because the memory store and its query memo are module-level.

## What the providers accept (documentation read 2026-11-11, then one live call per setting)

- **Gemini,** on the endpoint the app uses (`v1beta/models/{model}:streamGenerateContent`): `generationConfig.thinkingConfig.thinkingLevel`, one of `minimal`, `low`, `medium`, `high`. `thinkingBudget` is the older field in the same object; the API reference still lists it and the thinking guide no longer mentions it.
- **OpenAI,** on Chat Completions: top-level `reasoning_effort`.

| Model | Nothing sent | Accepted | Refused (HTTP 400) |
|---|---|---|---|
| gemini-3.8-flash | thinks (documented default: medium) | low, medium, high, thinkingBudget 0 | minimal |
| gemini-3-flash-preview | thinks (documented default: high) | minimal, low, medium, high, thinkingBudget 0 | |
| gemini-3.5-flash-lite | does not think (documented default: minimal) | minimal, low, medium, high | thinkingBudget 0 |
| gemini-3.1-flash-lite | does not think | minimal, low, medium, high, thinkingBudget 0 | |
| gpt-6.1-sol | default medium | low, medium, high, xhigh | none, minimal |
| gpt-6-luna | default medium | none, low, medium, high, xhigh | minimal |

Two things follow for the app as it is. The Scribe and the roll arbiter send `thinkingBudget: 0` to 3.8 Flash, which works today (the arbiter spent no thinking tokens here). And a single field value does not fit every model: `low` is the one Gemini level all four picker models accept, and Sol and Luna share only `low` and above.

## Seen in passing, not fixed

- At low thinking, 3.8 Flash writes a paragraph before a check. The game shows it while it streams and removes it when the check card appears. The default keeps that reply to a line or two, as the prompt asks.
- A purchase at the same price as a recent one (the 2-copper beer after the 2-copper pie) is set aside by the transaction log inside the turn and left to the repeat judge. That is the 2026-11-01 design working; it is why "booked at once" in table 5 is not a measure of the DM.
- Gemini's implicit cache reported almost nothing cached (above).

## Running it again

```
npm.cmd run eval:latency -- probe                  # which settings each model accepts
npm.cmd run eval:latency -- record                 # only when the script or the save version changes
npm.cmd run eval:latency -- run <label>            # the six default cells
npm.cmd run eval:latency -- report scripts/.eval-out/latency/<label> --docs
$env:QF_LAT_CELLS="gemini:gemini-3.8-flash:low,gemini:gemini-3.8-flash:high"   # any provider:model:setting
```

The scripted lines are data in `scripts/latency/script.mjs` and the saved states in `scripts/latency/fixture.json`, so another loop (the rebuild spike, queue item 4) can be timed on the same lines from the same states. Raw results of this run are in `scripts/.eval-out/latency/2026-11-11/` on this machine (git-ignored).

## The decision

The queue's rule: the default changes only if a setting is clearly faster and Vesa sees no loss in the replies. The speed half is answered for 3.8 Flash: low is about five times faster to the first word and about three times faster to the end of the turn. The reading half is the blind file. If the pick is to ship a setting, the change is to send a thinking level on the DM stream, by model; it is not built.

## What shipped (the same day, after the pick)

Vesa: "Ship low". The DM stream now asks for low thinking on the two models where it was measured: `thinkingLevel: "low"` on Gemini 3.8 Flash and `reasoning_effort: "low"` on GPT-6.1 Sol (`DECISIONS.md` 2026-11-11, item 2). The level is a per-model fact in `src/llm/modelCatalog.js`; the other picker rows send nothing, as before. Only the play loop's lanes ask for it; the opening scene and table talk keep the provider default.

Proof on the changed app: the same harness with no setting of its own (`default`), six turns, one check and one round, with the old default (`unset`, the field removed) run beside it in the same minutes.

| Model | What the request carried | First word p50 / p90 | Whole call p50 / p90 | Thinking tokens p50 | Whole check | Whole round |
|---|---|---|---|---|---|---|
| gemini-3.8-flash | the app as it ships: thinkingLevel low | 2.2 / 3.0 s | 4.6 / 5.1 s | 0 | 11.4 s | 6.2 s |
| gemini-3.8-flash | field removed: the old default | 9.2 / 12.7 s | 10.5 / 15.2 s | 695 | no check proposed in 3 tries | 16.6 s |
| gpt-6.1-sol | the app as it ships: reasoning_effort low | 2.0 / 2.5 s | 6.0 / 7.1 s | 0 | 19.3 s | 6.7 s |

One correction to point 7 of the result: in this run the old default narrated straight through the check line in 3 of 3 tries, where the morning run had it at 0 of 3 and low at 1 of 4. Whether the DM proposes a check for that line does not separate the settings.

Seen in the browser on the dev build: one real turn on 3.8 Flash sent `thinkingConfig: { thinkingLevel: "low" }` and the app's own log read `TTFT 2035ms, total 5075ms`. Unit tests pin the request bodies (`src/llm/dmThinking.test.js`). Not verified: the deployed bundle was not played (same source; the built files carry the level). Vesa's played verdict is open.
