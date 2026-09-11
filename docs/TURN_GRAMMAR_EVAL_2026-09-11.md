# Turn-grammar eval — 2026-09-11

Proof step for the 2026-09-11 wow audit (ordinary-turn, Lap 1, W1: `## THE ORDINARY TURN`).
Script: `npm run eval:turns` (`scripts/turnGrammarEval.mjs`; keys from `.env`). 20 chained ordinary
player turns (talk, walk, look, small errands — the same fixed list every run) on the `saltmere-debt`
premise starter, a level-1 human fighter, seeded fronts (so the WORLD TEMPO QUIET line renders as in
play). Two DM providers: Gemini `gemini-3.1-pro-preview` and xAI `grok-4.3`. BEFORE = the pre-block
prompt rebuilt by string surgery ("end by asking" step, "Leave space" line, the old custom-prompt
closing line); AFTER = the shipped block. Judge: `gemini-3.7-flash`, thinking-free, JSON-only,
temperature 0, on the audit's own rubric — echo-of-action / particular present / abstraction tic /
motion present / ask shape. Word counts are local. Chained runs diverge, so each row is one
20-turn conversation, not a paired sample; read the direction, not the last few percent.

## Iteration log

- **Round 1 — the block as first shipped.** Grok moved on every column (live-question endings
  0% → 90%, redundant "What do you do?" 40% → 5%, every turn inside 60–180, floor 18 → 66 words).
  Gemini improved on length and ask shape but kept echoing the action, and its AFTER run drifted
  into a brawl by turn 5 (an NPC grabs the hero's collar, then a club): "the world moves" was being
  read as "an NPC attacks". Two causes: the eval passed no fronts, so the DM never saw the tempo
  QUIET line; and MOTION had no guard against escalation. Round 1 also predates the raw-reply
  capture, so its four short Gemini AFTER turns (combat starts) are scored as ordinary turns — a
  known distortion of that one row.
- **Round 2 — MOTION guard + seeded fronts.** MOTION now reads "Motion is LIFE, not escalation: it
  is never a new threat, an attack, a grab, or a hostile act unless the WORLD TEMPO section grants
  one or the player's own action provoked it", and the eval seeds fronts like a real campaign. No
  combat starts in any run. Grok: motion 58% → 95%, live endings 95%, redundant 0%. Gemini: in-band
  11% → 45%, median 210 → 184, but the trailing generic prompt got WORSE (redundant 80%) — with
  NPCs now asking questions of their own, Gemini's habitual "What do you do?" was redundant almost
  every time — and the echo did not move.
- **Round 3 — THE ASK as a stop rule + a first-sentence rule (AFTER only; the BEFORE baselines are
  unchanged).** "If a character's last line or the situation itself already asks something of the
  player, that IS the ask — do not append 'What do you do?' or any generic prompt after it" and
  "the first sentence names something NEW — never the player's own movement or speech". Gemini:
  in-band 94% (median 147, range 115–181), redundant prompt 80% → 33%, tics 0%, motion 100%.
  Grok: echo 65% → 10%, every turn in band, live endings 85%. Gemini's echo (61%) is the one column
  three wordings did not shift — a model habit, left for a later lap rather than a fourth prompt
  edit. **This is the shipped wording.**

Two Gemini AFTER turns in rounds 2–3 were JSON-only roll proposals (a Perception check to inspect
the hull / scan Gannet Rock) — the roll contract working as designed, excluded from scoring.

| Provider | Variant | Scored | Median words | Range | In 60–180 | Echo ↓ | Particular ↑ | Tic ↓ | Motion ↑ | Ask: live | earned WDYD | redundant WDYD ↓ | menu ↓ | none ↓ | Rolls proposed | Combat starts | Empty | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini · round1 (gemini-3.1-pro-preview) | before | 16/20 | 204 | 104–283 | 19% | 56% | 100% | 6% | 94% | 6% | 19% | 75% | 0% | 0% | 0 | 0 | 4 | 0 |
| gemini · round1 (gemini-3.1-pro-preview) | after | 20/20 | 162 | 11–253 | 40% | 65% | 100% | 0% | 100% | 40% | 5% | 45% | 0% | 10% | 0 | 0 | 0 | 0 |
| xai · round1 (grok-4.3) | before | 20/20 | 78 | 18–107 | 85% | 40% | 100% | 5% | 85% | 0% | 55% | 40% | 0% | 5% | 0 | 0 | 0 | 0 |
| xai · round1 (grok-4.3) | after | 20/20 | 94 | 66–120 | 100% | 40% | 100% | 0% | 95% | 90% | 5% | 5% | 0% | 0% | 0 | 0 | 0 | 0 |
| gemini · round2 (gemini-3.1-pro-preview) | before | 18/20 | 210 | 101–368 | 11% | 67% | 100% | 6% | 94% | 11% | 39% | 50% | 0% | 0% | 2 | 0 | 1 | 0 |
| gemini · round2 (gemini-3.1-pro-preview) | after | 20/20 | 184 | 86–281 | 45% | 70% | 100% | 10% | 100% | 10% | 10% | 80% | 0% | 0% | 1 | 0 | 0 | 0 |
| xai · round2 (grok-4.3) | before | 19/20 | 69 | 35–116 | 84% | 63% | 100% | 11% | 58% | 5% | 63% | 32% | 0% | 0% | 2 | 0 | 0 | 0 |
| xai · round2 (grok-4.3) | after | 20/20 | 92 | 70–109 | 100% | 65% | 100% | 5% | 95% | 95% | 0% | 0% | 0% | 5% | 0 | 0 | 0 | 0 |
| gemini · round3 (gemini-3.1-pro-preview) | after | 18/20 | 147 | 115–181 | 94% | 61% | 100% | 0% | 100% | 44% | 22% | 33% | 0% | 0% | 2 | 0 | 0 | 0 |
| xai · round3 (grok-4.3) | after | 20/20 | 86 | 64–117 | 100% | 10% | 100% | 10% | 100% | 85% | 0% | 10% | 0% | 5% | 0 | 0 | 0 | 0 |

Arrows mark the desired direction. "Scored" excludes turns that proposed a roll with no prose, started combat (a combat-intent turn, not an ordinary one), came back empty, or errored; word statistics are over scored turns only.

## gemini · round1 · before — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 179 | yes | yes | no | yes | what_do_you_do_redundant | The reply echoes the climb and lift before Old Tammo provides vivid local motion and an unneeded generic question. |
| 2 | 217 | no | yes | no | yes | what_do_you_do_redundant | Tammo offers strong hooks, specific details, and active business, but the closing 'What do you do?' is unnecessary given the clear prompt in dialogue. |
| 3 | 207 | no | yes | no | yes | what_do_you_do_redundant | Strong local rumors and details provide natural momentum, making the closing question redundant. |
| 4 | 273 | yes | yes | no | yes | what_do_you_do_redundant | Strong character details and a clear NPC offer, but the narration echoes the walk to the office and tacks on a redundant prompt. |
| 5 | 121 | no | yes | no | yes | live_question | Strong NPC initiative driving the scene forward with a concrete ultimatum and crisp physical details. |
| 6 | 183 | no | yes | no | yes | what_do_you_do_redundant | Strong, grounded physical details and active NPC movement, but spoiled slightly by a redundant trailing prompt after Orsa's explicit question. |
| 7 | 200 | no | yes | no | yes | what_do_you_do_redundant | Gives specific, grounded tasks and physical movement, but unnecessarily tacks on the generic prompt after giving a direct order. |
| 8 | 194 | no | yes | yes | yes | what_do_you_do_redundant | Good scene setting and NPC dynamic, but uses 'the air is thick with' and adds a redundant prompt after laying out the dilemma. |
| 9 | 0 | — | — | — | — | — | empty reply |
| 10 | 0 | — | — | — | — | — | empty reply |
| 11 | 256 | yes | yes | no | yes | what_do_you_do_redundant | The reply rewinds time to narrate unprompted past events and echoes the ask, though Fenn's specific dialogue provides a solid handle undermined by the redundant prompt. |
| 12 | 0 | — | — | — | — | — | empty reply |
| 13 | 193 | yes | yes | no | yes | what_do_you_do_earned | The reply echoes the movement along the quay before delivering vivid concrete character details and setting up a clear stakes-driven prompt. |
| 14 | 219 | yes | yes | no | yes | what_do_you_do_redundant | Good particular details and dynamic NPC interaction, but echoes the bar order and tacks on a redundant closing prompt. |
| 15 | 222 | yes | yes | no | yes | what_do_you_do_earned | Strong NPC dialogue and specific local lore, though it opens by narrating the player's listening and asking back to them. |
| 16 | 104 | yes | yes | no | yes | what_do_you_do_redundant | Tammo asks a direct, characterful question, making the appended 'What do you do?' prompt completely redundant. |
| 17 | 283 | no | yes | no | yes | what_do_you_do_redundant | Tammo gives vivid advice and offers an item, making the closing prompt redundant. |
| 18 | 0 | — | — | — | — | — | empty reply |
| 19 | 198 | yes | yes | no | no | what_do_you_do_earned | The DM over-narrates the player's morning routine and gear check before describing the stormy harbor setting. |
| 20 | 239 | yes | yes | no | yes | what_do_you_do_redundant | Fenn's dialogue and the bounty complication move the scene forward well, but the reply opens with an echo and tacks on a redundant final prompt. |

## gemini · round1 · after — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 234 | yes | yes | no | yes | live_question | Strong sensory details and immediate NPC agenda, though it begins by narrating the player finishing the hauling. |
| 2 | 192 | yes | yes | no | yes | live_question | Tammo's gesture and Orsa's arrival provide immediate narrative pressure, ending on a crisp ultimatum. |
| 3 | 250 | no | yes | no | yes | live_question | Vivid sensory details ground the scene while Orsa aggressively drives the plot forward with a direct ultimatum. |
| 4 | 217 | yes | yes | no | yes | what_do_you_do_redundant | The reply echoes the approach up the planks and tacks on a redundant prompt after a direct confrontation is established. |
| 5 | 29 | yes | yes | no | yes | no_ask | The reply rewrites the player's movement into 'march forward' before introducing an active physical interception by an NPC. |
| 6 | 164 | no | yes | no | yes | what_do_you_do_redundant | Vivid sensory details and active escalation from the NPCs make the closing 'What do you do?' redundant. |
| 7 | 27 | yes | yes | no | yes | live_question | The reply explicitly echoes the player's dialogue before delivering an immediate physical attack that creates a live situation. |
| 8 | 11 | no | yes | no | yes | live_question | An NPC acts decisively to intercept the player, grounding the prompt entirely in physical motion. |
| 9 | 156 | no | yes | no | yes | what_do_you_do_redundant | Vane's physical confrontation and Corl chaining the boat create clear forward motion, making the final prompt redundant. |
| 10 | 176 | yes | yes | no | yes | what_do_you_do_redundant | The GM echoes the inspection of the planks before introducing Corl's confrontation and adds a redundant prompt after a clear threat. |
| 11 | 138 | yes | yes | no | yes | what_do_you_do_redundant | Corl escalates actively with a direct physical threat, making the closing prompt redundant after an opening action echo. |
| 12 | 104 | yes | yes | no | yes | what_do_you_do_redundant | The reply echoes the player looking toward the rock and tacks a redundant prompt onto Corl's attack. |
| 13 | 52 | yes | yes | no | yes | no_ask | The reply echoes the movement before interrupting it with an immediate physical attack from Corl. |
| 14 | 115 | no | yes | no | yes | what_do_you_do_redundant | An NPC strikes and creates an active standoff, rendering the final generic prompt redundant. |
| 15 | 253 | yes | yes | no | yes | live_question | Contains vivid local color and ends on an NPC question, though it unnecessarily narrates the player stepping up to ask. |
| 16 | 186 | no | yes | no | yes | live_question | Tammo delivers concrete plot friction through specific, grounded harbor dialogue and ends on a natural narrative hook. |
| 17 | 159 | no | yes | no | yes | live_question | Sharp dialogue that immediately establishes concrete obstacles and ends on a pointed, character-driven challenge. |
| 18 | 191 | yes | yes | no | yes | what_do_you_do_earned | The narration directly echoes checking coin and rope before advancing the clock and setting up the worsening gale. |
| 19 | 194 | yes | yes | no | yes | what_do_you_do_redundant | A vivid, high-stakes storm scene with the boat in active peril, slightly marred by opening with an echo of the player's movement. |
| 20 | 156 | yes | yes | no | yes | what_do_you_do_redundant | The storm damages the Kittiwake to create urgent stakes, but the DM opens by narrating the player shouting and ends with a tacked-on prompt. |

## xai · round1 · before — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 91 | yes | yes | yes | yes | what_do_you_do_earned | Narrates the climbing and hauling back to the player, relies on 'the air below is thick', but introduces Tammo and the burning lamp. |
| 2 | 83 | no | yes | no | yes | what_do_you_do_redundant | Tammo's dialogue already presents a clear conversational demand before the redundant closing prompt. |
| 3 | 85 | no | yes | no | yes | what_do_you_do_redundant | Tammo's direct counter-question already set up the prompt before the redundant closing question was added. |
| 4 | 82 | no | yes | no | yes | what_do_you_do_redundant | Pellwyn's dialogue clearly hands the turn to the player, making the final prompt redundant. |
| 5 | 107 | no | yes | no | yes | what_do_you_do_redundant | A vivid NPC response and implicit demand are undercut by a tacked-on generic prompt. |
| 6 | 77 | no | yes | no | yes | what_do_you_do_redundant | Orsa drives the scene with specific ledger debts and an ultimatum, making the trailing prompt redundant. |
| 7 | 60 | no | yes | no | yes | what_do_you_do_redundant | Orsa drives the scene forward with concrete demands, making the tacked-on prompt redundant. |
| 8 | 52 | no | yes | no | yes | what_do_you_do_earned | Provides solid physical details and NPC activity answering the player's check before closing on an earned prompt. |
| 9 | 76 | yes | yes | no | yes | what_do_you_do_earned | The reply echoes the transaction and stance, but delivers vivid coastal sensory details and a subtle hook at the dark lighthouse. |
| 10 | 75 | yes | yes | no | no | what_do_you_do_earned | Echoes the player climbing down and checking the hull, but provides good concrete physical details on the boat's condition. |
| 11 | 74 | no | yes | no | yes | what_do_you_do_redundant | The NPC's demand sets up a clear decision point, making the final prompt redundant. |
| 12 | 54 | yes | yes | no | no | what_do_you_do_earned | The reply echoes the resting and looking action, reports a static empty scene with solid sensory specifics, and ends with a generic prompt. |
| 13 | 96 | no | yes | no | yes | what_do_you_do_earned | Strong sensory character description and natural NPC dialogue followed by a standard prompt. |
| 14 | 100 | yes | yes | no | yes | what_do_you_do_earned | Strong sensory grounding and active NPC chatter, though it echoes the beer order and ends on a flat prompt. |
| 15 | 79 | no | yes | no | yes | what_do_you_do_redundant | Strong sensory details and NPC agency, but ends with a redundant prompt after the NPC already asked a direct question. |
| 16 | 65 | yes | yes | no | yes | what_do_you_do_earned | Narrates draining the beer and walking out back to the player, but grounds the pier scene well with sensory details. |
| 17 | 87 | no | yes | no | yes | what_do_you_do_earned | Tammo offers practical advice and an agreement to watch the Kittiwake without echoing the player's prompt. |
| 18 | 86 | yes | yes | no | yes | what_do_you_do_earned | The reply explicitly re-enacts checking the coins and coiling the rope before advancing to morning. |
| 19 | 66 | no | yes | no | yes | what_do_you_do_earned | Provides clean sensory weather details and introduces an active NPC detail before the prompt. |
| 20 | 18 | yes | yes | no | no | no_ask | The reply echoes the action and trails off into a passive reaction without moving the scene forward. |

## xai · round1 · after — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 97 | yes | yes | no | yes | live_question | The reply explicitly narrates the climbing and crate-hefting before introducing Tammo's prompt. |
| 2 | 115 | no | yes | no | yes | live_question | Tammo pushes the scene forward by offering an immediate, concrete proposition with clear stakes. |
| 3 | 95 | no | yes | no | yes | live_question | Tammo answers with sharp local color and immediately challenges the player with a live question. |
| 4 | 96 | yes | yes | no | yes | live_question | Opens by echoing the walk up the quay, but grounds the scene with strong physical details and an NPC prompt. |
| 5 | 104 | no | yes | no | yes | live_question | Pellwyn actively checks the numbers, recalculates the debt, and demands the player's purpose. |
| 6 | 96 | no | yes | no | yes | live_question | Grounds the interaction in specific physical details and sets up a clear financial dilemma with a live demand. |
| 7 | 78 | no | yes | no | yes | live_question | Grounds the scene with sharp physical texture and moves the negotiation forward with a direct counter-offer and prompt. |
| 8 | 93 | no | yes | no | yes | live_question | Grounds the scene immediately with concrete sensory detail and has an NPC drive the action with a trade offer. |
| 9 | 103 | yes | yes | no | yes | live_question | The reply echoes the eating and watching actions, but grounds the scene with specific sensory details and introduces an unprompted warning from a nearby fisherman. |
| 10 | 96 | yes | yes | no | yes | live_question | Echoes the climb down and inspection, but provides good sensory detail and a proactive NPC with a concrete offer. |
| 11 | 74 | no | yes | no | yes | live_question | The deckhand steps in with vivid physical detail and holds the action mid-push for the player's next move. |
| 12 | 68 | no | yes | no | yes | live_question | The deckhand steps in with physical detail and a direct challenge to drive the scene forward. |
| 13 | 66 | no | yes | no | yes | live_question | Grounds the scene quickly in sensory detail and delivers useful information before turning the question back on the player. |
| 14 | 91 | yes | yes | no | yes | live_question | The reply lightly echoes the coin drop and ordering, but effectively creates a live prompt via the veteran's gesture. |
| 15 | 88 | no | yes | no | yes | live_question | Grounds the scene immediately with specific physical details and gives the NPC an active, cautionary perspective. |
| 16 | 90 | yes | yes | no | yes | live_question | The reply lightly echoes draining the cup before grounding the scene with strong physical details and an active NPC prompt. |
| 17 | 90 | no | yes | no | yes | live_question | Tammo gives practical advice, continues his work, and asks a direct question. |
| 18 | 120 | yes | yes | no | no | what_do_you_do_earned | The DM narrates the player's routine actions back in detail before advancing the clock to morning with a standard prompt. |
| 19 | 99 | no | yes | no | yes | what_do_you_do_redundant | A vivid, atmospheric response with concrete physical details and an NPC gesture that made the trailing prompt unnecessary. |
| 20 | 93 | yes | yes | no | yes | live_question | The reply starts with a light echo of the inquiry but quickly introduces an active NPC with a concrete offer and a counter-question. |

## gemini · round2 · before — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 224 | yes | yes | no | yes | what_do_you_do_redundant | Rich sensory specifics and Tammo provides active motion, but the opening echoes the climb/haul and the ending tacks on a redundant prompt. |
| 2 | 168 | no | yes | no | yes | what_do_you_do_redundant | Tammo introduces a concrete plot hook and advice, rendering the trailing 'What do you do?' prompt redundant. |
| 3 | 194 | no | yes | no | yes | what_do_you_do_earned | Tammo gives specific lore and raises the stakes, followed by a generic prompt. |
| 4 | 246 | yes | yes | no | yes | live_question | The narration echoes the walk to the office but quickly introduces strong character details and a direct verbal prompt. |
| 5 | 294 | no | yes | no | yes | what_do_you_do_redundant | Strong characterization and quest hook with concrete physical details, but finishes with a redundant generic prompt after a clear job offer. |
| 6 | 201 | no | yes | no | yes | live_question | Strong character motion with concrete sensory details and an active job offer driving the scene. |
| 7 | 240 | no | yes | no | yes | what_do_you_do_redundant | Orsa makes a sharp, concrete ultimatum, but the closing prompt is redundant after the clear offer. |
| 8 | 211 | yes | yes | no | yes | what_do_you_do_earned | Strong sensory details and autonomous NPC activity, though it needlessly narrates the player exiting the room first. |
| 9 | 0 | — | — | — | — | — | roll proposed (not an ordinary turn) |
| 10 | 185 | yes | yes | no | yes | what_do_you_do_redundant | The narration echoes the player's transit and inspection before delivering rich detail, but tacks on a redundant prompt after an NPC's direct question. |
| 11 | 183 | yes | yes | no | yes | what_do_you_do_earned | The narration resolves the hauling effort fully with rich physical texture and sends Fenn off, earning the closing prompt. |
| 12 | 194 | yes | yes | no | yes | what_do_you_do_earned | Vivid coastal specifics with a drifting object introducing active motion, though it opens by narrating the player catching their breath. |
| 13 | 231 | yes | yes | no | yes | what_do_you_do_redundant | Strong specific details and NPC dialogue, but needlessly echoes the travel action and appends a redundant prompt after the NPC's direct question. |
| 14 | 0 | — | — | — | — | — | empty reply |
| 15 | 368 | yes | yes | yes | yes | what_do_you_do_redundant | Narrates entering and ordering beer before addressing the action, leans on 'air thick with', but introduces named lore and a hook. |
| 16 | 101 | yes | yes | no | yes | what_do_you_do_redundant | Echoes the player's drink and departure step-by-step, but provides good concrete details and NPC dialogue before tacking on a redundant prompt. |
| 17 | 254 | no | yes | no | yes | what_do_you_do_redundant | Tammo gives concrete advice and offers his skiff, making the final prompt redundant. |
| 18 | 208 | yes | yes | no | yes | what_do_you_do_earned | Strong sensory texture and good time transition, though it narrates the checking and sleeping back to the player. |
| 19 | 206 | yes | yes | no | no | what_do_you_do_earned | The reply walks through the player's morning routine step-by-step before delivering rich environmental details about the storm and Gannet Rock. |
| 20 | 216 | yes | yes | no | yes | what_do_you_do_earned | The reply assumes specific PC dialogue/actions and tacks on a standard prompt after establishing the sole dangerous option. |

## gemini · round2 · after — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 175 | yes | yes | no | yes | what_do_you_do_redundant | Strong sensory details and NPC motion, but it echoes the hauling action and tacks on a redundant closing prompt after Tammo's offer. |
| 2 | 171 | no | yes | no | yes | what_do_you_do_redundant | Strong specific details and an active NPC interruption, though the closing prompt is redundant with the harbormaster's arrival. |
| 3 | 196 | no | yes | no | yes | what_do_you_do_redundant | Strong sensory details and independent NPC motion, but tacks on a generic prompt after Orsa directly poses a demand. |
| 4 | 199 | yes | yes | no | yes | what_do_you_do_redundant | The DM narrates setup movement for the player and adds a redundant prompt after the NPC's concrete offer. |
| 5 | 153 | yes | yes | no | yes | what_do_you_do_redundant | Re-narrates the player's failed entry attempts, provides rich setting detail and NPC agency, but tacks on a redundant prompt after Orsa's direct offer. |
| 6 | 119 | no | yes | no | yes | what_do_you_do_redundant | Vivid specific details and a strong NPC offer, but the trailing prompt is redundant after Orsa explicitly demands an answer. |
| 7 | 172 | no | yes | no | yes | live_question | Strong character motion and leverage with a pointed, scene-driving question. |
| 8 | 186 | yes | yes | yes | yes | what_do_you_do_redundant | Good particular details and active NPC dialogue, but marred by echoing the player's exit, the stock 'air is thick' tic, and a redundant ending prompt. |
| 9 | 209 | yes | yes | no | yes | what_do_you_do_earned | Strong sensory texture and atmospheric pressure, though it narrates the transaction and eating out step-by-step. |
| 10 | 213 | yes | yes | no | yes | what_do_you_do_redundant | The reply narrates the player's movement and search process, reveals a specific physical clue, but tacks on a redundant prompt. |
| 11 | 181 | yes | yes | no | yes | what_do_you_do_redundant | Puppeteers the PC's dialogue and movement, but provides strong sensory detail and NPC momentum. |
| 12 | 159 | yes | yes | no | yes | live_question | The narration echoes the action by describing the player stepping to the slipway and dropping the line, but introduces a concrete hazard and an NPC's direct question. |
| 13 | 258 | yes | yes | no | yes | what_do_you_do_redundant | Strong sensory details and NPC dialogue deliver concrete new information, though it opens with an action echo and tacks on an unneeded prompt. |
| 14 | 268 | yes | yes | yes | yes | what_do_you_do_redundant | Hollis initiates a strong social confrontation, making the tacked-on generic prompt redundant alongside an abstraction tic. |
| 15 | 281 | yes | yes | no | yes | what_do_you_do_earned | Strong specific details and NPC testimony, though it lightly echoes the player's listening and asking actions. |
| 16 | 243 | yes | yes | no | yes | what_do_you_do_redundant | The reply opens by echoing the beer-drinking and thanking before introducing a concrete new threat via Tammo. |
| 17 | 223 | no | yes | no | yes | what_do_you_do_redundant | A dynamic NPC response that escalates with approaching enforcers, undermined slightly by a tacked-on prompt. |
| 18 | 163 | yes | yes | no | yes | what_do_you_do_redundant | The reply echoes the checking of coin and rope before escalating with an aggressive NPC confrontation. |
| 19 | 86 | no | yes | no | yes | what_do_you_do_redundant | The thugs act with clear physical presence and a demand, making the final question redundant. |
| 20 | 150 | yes | yes | no | yes | what_do_you_do_redundant | Echoes the attempt to ask around before interrupting it, but establishes immediate physical stakes and a concrete ultimatum. |

## xai · round2 · before — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 82 | yes | yes | no | no | what_do_you_do_earned | The reply echoes the player's climbing and hauling actions before resolving with minimal NPC reaction. |
| 2 | 69 | no | yes | no | yes | what_do_you_do_redundant | Tammo's hook provides a natural conversational opening, making the final prompt redundant. |
| 3 | 54 | no | yes | no | yes | what_do_you_do_earned | Tammo answers with specific local rumors and gestures while working, though the prompt ends on a generic handoff. |
| 4 | 91 | yes | yes | no | yes | what_do_you_do_redundant | The narration echoes the approach and tacks on a redundant prompt after the NPC asks a direct question. |
| 5 | 74 | yes | yes | no | yes | what_do_you_do_redundant | Re-narrates the knock while Orsa's prompt regarding the winter run already created a live handle before the generic sign-off. |
| 6 | 72 | no | yes | no | yes | what_do_you_do_redundant | Orsa directly answers with specific ledger details and waits for a response, making the tacked-on prompt redundant. |
| 7 | 76 | no | yes | no | yes | what_do_you_do_redundant | Orsa issues a concrete ultimatum and instructions, rendering the tacked-on prompt redundant. |
| 8 | 64 | no | yes | yes | yes | what_do_you_do_earned | Provides distinct NPCs pursuing their own business, though it uses a stock atmospheric phrase. |
| 9 | 74 | yes | yes | no | no | what_do_you_do_earned | The reply extensively narrates the character performing the declared action before settling into static scenery. |
| 10 | 62 | yes | yes | no | no | what_do_you_do_earned | The reply thoroughly puppeteers and echoes the player's action before delivering a grounded, concrete inspection result. |
| 11 | 63 | yes | yes | no | no | what_do_you_do_earned | Echoes the player's request directly at the start, but grounds the NPC with a specific physical detail. |
| 12 | 13 | — | — | — | — | — | roll proposed (not an ordinary turn) |
| 13 | 116 | no | yes | no | yes | what_do_you_do_redundant | Rich character details and a clear answer make the closing prompt unnecessary. |
| 14 | 102 | yes | yes | yes | no | what_do_you_do_earned | Narrates the character's movement and seating, relies on 'the air thick with' stock phrasing, and offers no autonomous world motion. |
| 15 | 68 | yes | yes | no | yes | what_do_you_do_earned | The reply echoes the ask via third person, provides grounded specifics, and tacks on a standard prompt after delivering new lore. |
| 16 | 63 | yes | yes | no | no | what_do_you_do_earned | The narration retraces the player's stated sequence step-by-step before arriving at a static NPC. |
| 17 | 99 | no | yes | no | yes | what_do_you_do_earned | Solid NPC reaction with concrete gestures and warning, ending on a clean prompt. |
| 18 | 56 | yes | yes | no | no | what_do_you_do_earned | Directly echoes the player's inventory check and bedding down before ending on an unprompted generic ask. |
| 19 | 69 | yes | yes | no | no | what_do_you_do_earned | Narrates the character stepping onto the pier before delivering the weather assessment and boat status. |
| 20 | 35 | yes | yes | no | yes | live_question | The reply lightly echoes the player's inquiry before introducing a specific NPC who stops to listen. |

## xai · round2 · after — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 95 | yes | yes | no | yes | live_question | The reply echoes the climb and haul directly, but introduces vivid sensory grit and NPC pressure. |
| 2 | 90 | yes | yes | no | yes | live_question | The reply opens by re-narrating the player's movement and seating before delivering strong sensory details and an NPC prompt. |
| 3 | 70 | yes | yes | no | yes | live_question | The reply opens by echoing the player's action before delivering Tammo's grounded response and counter-question. |
| 4 | 87 | yes | yes | no | yes | live_question | The narration echoes the walk up the quay before grounding the scene in sharp harbor sensory details and an active NPC prompt. |
| 5 | 95 | no | yes | no | yes | live_question | Great sensory detail and a proactive NPC offer delivered via a natural dialogue prompt. |
| 6 | 90 | no | yes | no | yes | live_question | Orsa consults specific ledgers and makes an active counter-offer that cleanly sets up the player's next move. |
| 7 | 84 | no | yes | no | yes | live_question | Strong sensory texture and clear NPC agency driven by a firm counter-demand. |
| 8 | 78 | yes | yes | no | yes | live_question | The reply lightly echoes the transition before introducing a specific fishmonger who takes initiative with an offer. |
| 9 | 109 | yes | yes | no | yes | live_question | The reply opens by echoing the player eating the pie and watching the breakwater before introducing an NPC with a direct question. |
| 10 | 95 | yes | yes | no | yes | live_question | The reply needlessly narrates the PC's physical search before giving the sensory result, but Old Tammo introduces a lively, characterful prompt. |
| 11 | 83 | no | yes | no | yes | live_question | Grounds the physical labor with sharp sensory details and introduces an NPC pushing a specific unresolved dilemma. |
| 12 | 84 | yes | yes | no | yes | live_question | The reply echoes the character's pause and gaze before introducing Tammo's active dialogue and pressuring question. |
| 13 | 99 | no | yes | yes | yes | live_question | Contains vivid physical details and an NPC counter-question, but falls into the 'air thick with' abstraction tic. |
| 14 | 93 | yes | yes | no | yes | live_question | The reply echoes Astra entering and ordering, but delivers great concrete texture and ends on an NPC's direct, actionable challenge. |
| 15 | 84 | yes | yes | no | yes | live_question | The reply lightly echoes Astra's eavesdropping and question, but provides specific local details and ends on a direct NPC query. |
| 16 | 95 | no | yes | no | yes | live_question | Tammo offers an oar and proposes a concrete deal, driving the situation forward immediately. |
| 17 | 95 | no | yes | no | yes | live_question | Rich sensory grounding and a direct conversational follow-up drive the scene forward naturally. |
| 18 | 102 | yes | yes | no | no | no_ask | The narration opens by echoing the character's inventory check and bunking down, ending with evocative world atmosphere but no active prompt. |
| 19 | 86 | yes | yes | no | yes | live_question | The narration opens by replaying the player's morning walk, but quickly establishes strong sensory texture and an NPC prompt. |
| 20 | 99 | yes | yes | no | yes | live_question | The narration echoes Astra's inquiries but immediately presents a concrete NPC with terms and a direct question. |

## gemini · round3 · after — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 181 | no | yes | no | yes | live_question | Great sensory detail and proactive NPC movement driving directly toward an immediate interaction. |
| 2 | 175 | yes | yes | no | yes | live_question | Contains an echo of sitting down, but immediately introduces Orsa Pellwyn with specific sensory details and an active dilemma. |
| 3 | 160 | no | yes | no | yes | live_question | Vivid sensory details and an active NPC intervention create immediate pressure. |
| 4 | 130 | yes | yes | no | yes | live_question | The opening echoes the player moving up the quay, but the harbormaster aggressively intercepts and demands a concrete choice. |
| 5 | 115 | yes | yes | no | yes | live_question | The reply needlessly echoes the player's knock and entry attempt before Orsa interrupts with a sharp ultimatum. |
| 6 | 125 | no | yes | no | yes | live_question | Great sensory detail with the ledger and pencil, moving cleanly into a direct demand. |
| 7 | 147 | no | yes | no | yes | live_question | Strong sensory details and a clear, high-stakes counter-offer driving the scene forward. |
| 8 | 162 | yes | yes | no | yes | what_do_you_do_redundant | The fishmonger's direct challenge already provides a sharp prompt, making the tacked-on closing question redundant. |
| 9 | 152 | yes | yes | no | yes | what_do_you_do_earned | Strong sensory detail and environmental motion advance the scene, though the opening echoes the purchase and eating. |
| 10 | 0 | — | — | — | — | — | roll proposed (not an ordinary turn) |
| 11 | 123 | no | yes | no | yes | what_do_you_do_redundant | Strong specific details and NPC pushback, but tacks on a redundant prompt after the escalating environmental pressure. |
| 12 | 0 | — | — | — | — | — | roll proposed (not an ordinary turn) |
| 13 | 152 | yes | yes | no | yes | what_do_you_do_redundant | The reply echoes the movement to the tower, provides vivid sensory details and NPC lore, but tacks on a redundant closing prompt. |
| 14 | 125 | no | yes | no | yes | what_do_you_do_earned | Strong sensory details and immediate NPC presence frame the scene cleanly. |
| 15 | 173 | yes | yes | no | yes | what_do_you_do_redundant | The DM restates the bar interaction and tacks on a generic prompt after the barkeep's specific demand. |
| 16 | 122 | yes | yes | no | yes | what_do_you_do_redundant | The reply narrates the player drinking and leaving in detail, but Tammo introduces active pressure before a redundant prompt. |
| 17 | 147 | no | yes | no | yes | live_question | Strong sensory details and character voice drive the scene forward with a direct, challenging prompt. |
| 18 | 129 | yes | yes | no | yes | what_do_you_do_earned | The reply explicitly echoes checking the pouch/rope before moving the clock forward into a howling gale. |
| 19 | 115 | yes | yes | no | yes | what_do_you_do_earned | The reply echoes the wake-up and walk before introducing vivid physical details and an immediate hazard with the ship. |
| 20 | 151 | yes | yes | no | yes | what_do_you_do_redundant | The narration echoes the player's approach and question before delivering vivid sensory details and an immediate environmental event. |

## xai · round3 · after — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 90 | no | yes | no | yes | what_do_you_do_redundant | Tammo's warning provides an active prompt, making the tacked-on question redundant. |
| 2 | 97 | no | yes | no | yes | live_question | Tammo serves tea, advances an immediate job opportunity, and asks a direct question. |
| 3 | 67 | no | yes | no | yes | live_question | Tammo immediately provides concrete information and presses the player with a direct question while tending the fire. |
| 4 | 117 | yes | yes | no | yes | live_question | Begins with a slight echo of the arrival, but grounds the scene with specific details and drives the narrative forward with an active offer from the harbormaster. |
| 5 | 83 | no | yes | no | yes | live_question | Strong, concrete reaction that moves the situation forward with a clear NPC offer and demand. |
| 6 | 68 | no | yes | no | yes | live_question | Orsa acts naturally with specific bookkeeping details and presses the player with a direct challenge. |
| 7 | 96 | no | yes | no | yes | live_question | Strong response that moves the situation forward with a specific counter-offer and distinct physical details. |
| 8 | 84 | no | yes | yes | yes | what_do_you_do_redundant | The NPC makes a concrete trade offer, but the narration includes a stock sensory abstraction and tacks on a redundant prompt. |
| 9 | 64 | no | yes | no | yes | no_ask | Gives evocative sensory details and an ambient NPC hook, but trails off without an explicit handoff. |
| 10 | 75 | no | yes | no | yes | live_question | Tammo speaks up unprompted to introduce time pressure regarding the tide and Orsa. |
| 11 | 71 | no | yes | no | yes | live_question | Grounds the physical labor with sharp sensory details and introduces active pressure via an observant NPC. |
| 12 | 78 | no | yes | no | yes | live_question | Grounds the scene with sharp sensory detail and passes initiative naturally through Tammo's question. |
| 13 | 85 | no | yes | no | yes | live_question | Grounds the scene with strong sensory details and immediately prompts the player through natural NPC dialogue. |
| 14 | 113 | yes | yes | yes | yes | live_question | Contains an action echo at the bar and 'the air thick' tic, but delivers strong NPC motion and a sharp live prompt. |
| 15 | 112 | no | yes | no | yes | live_question | The barkeep provides concrete lore, pitches a paid job, and ends on a direct character prompt. |
| 16 | 77 | no | yes | no | yes | live_question | Tammo continues mending his net and challenges the player with a direct, characterful question. |
| 17 | 94 | no | yes | no | yes | live_question | Tammo pauses his mending, provides concrete local lore, and counters with a pointed question. |
| 18 | 86 | no | yes | no | yes | live_question | Tammo offers a timely warning and specific hook as you leave, with crisp concrete details of coin and ship lines. |
| 19 | 89 | no | yes | no | yes | live_question | Tammo tends his brazier and delivers grounded local weather intel followed by a direct question. |
| 20 | 100 | no | yes | no | yes | live_question | Tammo provides an active counter-offer with specific terms and ends the beat on a direct query. |

