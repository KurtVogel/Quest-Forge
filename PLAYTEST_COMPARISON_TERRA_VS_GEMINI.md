# Head-to-head: `gemini-3.1-pro-preview` vs `gpt-5.6-terra` as DM narrator

**Date:** 2026-08-22 · **Method:** `scripts/playtest_provider_compare.cjs` (new, committed) — two fully scripted 13-action runs against the production preview build, identical in every controlled variable: same premise (Salt-Lantern Ledger / Greywater Reach), same hero (Ilta Kuura, elf wizard, same appearance canon, recommended spread), same player messages verbatim, same Gemini 3.7-flash machinery, isolated Chrome profiles. Only the narrator differs. Outputs in `test-results/provider_compare/{gemini,terra}/` (log.json + full transcript.json). Dice and story naturally diverge — the comparison is per-dimension, not per-turn.

## Scoreboard

| Dimension | gemini-3.1-pro-preview | gpt-5.6-terra |
|---|---|---|
| TTFT median / max | 12.3s / 25.7s | **2.0s / 5.3s** |
| LLM total median | 14.7s | **5.7s** |
| Avg DM words/turn | 224 (max 465) | **146** (max 220) |
| JSON discipline | perfect (0 rescues) | perfect (0 rescues) |
| Parser/console errors | 0 | 0 |
| Contract events | all correct | all correct |
| Roll proposals | 3 (DC 10/12/10, all well-formed) | 2 (DC 10/10, all well-formed) |
| Combat exercised | **yes — full cycle incl. defeat** | no (fiction never escalated) |
| Scribe audit stand-downs | items ×2 + coins | items ×2 + coins |
| POV | second person ("you") | third person ("Ilta …") |
| Quest completion XP | 0 awarded | +75 via `exp_awarded` |

Both runs: quest opened on acceptance and completed on resolution, purchase charged exactly (1 gp 2 cp in both runs, amusingly), Mage Armor slot spent + sustained set, reward paid once with the coin audit standing down, zero double-grants, zero errors. **On engine cooperation this window is a tie — both are contract-clean.**

## Narration — what actually differs

**Gemini is the dramatist.** It read the same premise as creature horror and escalated hard: dead gulls stranded above the waterline, a buckled floor grate, Osmo's frantic logbook, and finally his corpse under a "Trench-Born Scavenger" — a fight Ilta **lost** (crit for 7, downed at 1/8 HP). The whole defeat pipeline fired flawlessly: non-lethal setback honored, wake-up narration threading the fiction ("it left you for dead"), quest still completable via the logbook, and Valk's payout exactly the 10 silver she'd negotiated — after she'd refused prepayment in character ("Coin comes when the job's done"). Rich sensory prose, real stakes, correct second-person camera. Costs: half again wordier per turn than the north star's "brief ordinary turns" wants, TTFT you feel on every message, and it re-lists the hero's appearance markers (ash-blonde / burn scar / ink stains) nearly every turn — canon faithfulness shading into formula.

**Terra is the plotter.** It read the same premise as suspense and kept the monster off-screen: Osmo found *alive* in the lamp room, gaff hook raised, warning "don't light the lens — it sees the light." No combat — instead a rescue, a rope descent, and an 8 gp payout as agreed. Two moves stood out as genuinely better craft than Gemini's run: it wove the **player's personal hook** (the mother's tide-compass / forbidden chart) into the mystery unprompted, twice, through NPC dialogue ("That compass. Your mother's, wasn't it? I saw one like it once, on a chart that should've stayed drowned") — exactly the callback magic the WOW layer exists to produce; and its NPC voices are more distinct per line with less scenery around them (Valk's eye patch and "deaf as ballast," the chandler's "keep three points of yourself on the ground, elf"). Prose is tighter and closer to the house pacing rule. Costs: the **third-person camera** (a consistent OpenAI-family habit — gpt-5 did it too; one prompt line would fix it), and a gentler default temperament — a player who wants danger may find Terra slow-burn where Gemini swings.

## Caveats that matter

- **One run per model.** Directional, not statistical. Story divergence means some differences (combat vs no combat) are part temperament, part dice.
- **Terra has still never been observed in the combat exchange machine** — not here, not in the 2-turn manual retest. Its combat-intent JSON discipline is unproven. This is the single open question before calling it a fully validated narrator. (gpt-5 handled combat correctly, which is weak evidence in Terra's favor, same family.)
- Gemini awarded no quest-completion XP while Terra paid +75 via the prompt-only `exp_awarded` channel — the XP guidance is interpreted differently across providers; worth a look if XP pacing matters.
- The harness initially shipped with a React-controlled-input bug (raw `el.value` writes that React ignores) — both first runs silently played zero turns. Fixed with native-setter fills + step assertions; the committed version fails loudly.

## Verdict

**Both are production-viable narrators, and they are good at different games.** Gemini Pro is the stronger *dramatist* — atmosphere, stakes, correct POV, and it exercised the deepest engine machinery (combat, defeat, narration binding) without a scratch. Terra is the stronger *table companion* — a sixth of the latency, ~35% fewer words per turn, sharper NPC voices, and the best personal-hook integration seen in any run. If turn feel (TTFT) is weighted the way the focus plan weights it, Terra's 2s vs 12s is not a small difference — it's the difference between conversation and correspondence.

Recommendation: keep **Gemini-first production posture** (machinery coupling, cache prefix, eval baselines, proven combat behavior) but treat Terra as a near-peer alternate, not a fallback. Next probes when wanted: (1) a Terra combat run to close the exchange-machine gap; (2) a second-person POV line in the DM prompt gated to OpenAI providers; (3) a long-campaign memory/callback eval on both (eval:memory pattern) — Terra's callback instincts in this window suggest it might excel there.
