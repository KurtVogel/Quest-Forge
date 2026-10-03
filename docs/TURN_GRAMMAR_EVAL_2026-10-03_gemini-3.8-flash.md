# Turn-grammar eval — 2026-10-03

Proof step for the 2026-09-11 wow audit (ordinary-turn, W1: `## THE ORDINARY TURN`). 20 chained ordinary player turns on the `saltmere-debt` starter, BEFORE (pre-block prompt rebuilt by string surgery: "end by asking" step, "Leave space" line, old custom-prompt closing line) vs AFTER (the shipped block). Judge: `gemini-3.7-flash`, thinking-free, JSON-only, temperature 0. Word counts are local. Rubric rows are the audit's own: echo-of-action / particular present / abstraction tic / motion present / ask shape.

| Provider | Variant | Scored | Median words | Range | In 60–180 | Echo ↓ | Particular ↑ | Tic ↓ | Motion ↑ | Ask: live | earned WDYD | redundant WDYD ↓ | menu ↓ | none ↓ | Rolls proposed | Combat starts | Empty | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini (gemini-3.8-flash) | before | 17/20 | 176 | 152–273 | 59% | 24% | 100% | 6% | 94% | 0% | 24% | 71% | 0% | 6% | 0 | 0 | 0 | 3 |
| gemini (gemini-3.8-flash) | after | 16/20 | 185 | 139–229 | 44% | 6% | 100% | 0% | 100% | 88% | 0% | 0% | 6% | 6% | 0 | 0 | 0 | 4 |

Arrows mark the desired direction. "Scored" excludes turns that proposed a roll with no prose, started combat (a combat-intent turn, not an ordinary one), came back empty, or errored; word statistics are over scored turns only.

## gemini · before — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 153 | yes | yes | no | yes | what_do_you_do_redundant | The narration echoes the hauling labor in detail, introduces Tammo's active prompt, but weakens it with a tacked-on question. |
| 2 | 176 | no | yes | no | yes | what_do_you_do_redundant | Tammo gives solid atmosphere and an actionable lead, making the tacked-on prompt redundant. |
| 3 | 169 | no | yes | no | yes | what_do_you_do_earned | Vivid sensory storytelling and active lore-dropping conclude with a standard prompted handoff. |
| 4 | 247 | yes | yes | yes | yes | what_do_you_do_redundant | Pellwyn's dialogue creates a strong live hook, but it is undercut by the opening echo and tacked-on final prompt. |
| 5 | 171 | no | yes | no | yes | what_do_you_do_redundant | Strong specific details and an active NPC counter-offer, but it tacks on a redundant final prompt. |
| 6 | 157 | no | yes | no | yes | what_do_you_do_redundant | Orsa's compelling trade offer already makes the next move obvious, rendering the final prompt redundant. |
| 7 | 212 | no | yes | no | yes | what_do_you_do_redundant | Strong sensory bookkeeping and physical props make the scene vivid, but the final question is unnecessary. |
| 8 | 0 | — | — | — | — | — | DM error: Gemini API error (503): This model is currently experiencing high demand. Spikes |
| 9 | 179 | yes | yes | no | yes | what_do_you_do_earned | Vividly detailed world-building and NPC interaction, though it extensively narrates the player's minor steps before revealing the dead lighthouse. |
| 10 | 0 | — | — | — | — | — | DM error: Gemini API error (503): This model is currently experiencing high demand. Spikes |
| 11 | 273 | no | yes | no | yes | what_do_you_do_redundant | Richly textured labor and dialogue introduce an eerie rumor, though it ends with a redundant prompt. |
| 12 | 157 | no | yes | no | yes | what_do_you_do_earned | Vivid maritime sensory details establish a drifting, swamped dory moving on the current as a clear hook. |
| 13 | 152 | no | yes | no | yes | what_do_you_do_redundant | Vivid sensory details and a sharp NPC hook make the final generic prompt redundant. |
| 14 | 183 | no | yes | no | yes | what_do_you_do_redundant | Strong sensory details and an active NPC event introduce a hook, though the final prompt is redundant. |
| 15 | 213 | no | yes | no | yes | what_do_you_do_redundant | Rich characterization and atmospheric detail deliver strong narrative momentum, though the final generic prompt is unnecessary given the tense scene. |
| 16 | 191 | no | yes | no | yes | what_do_you_do_redundant | Vivid harbor atmosphere and NPC dialogue, though the closing prompt is tacked onto an already compelling revelation. |
| 17 | 0 | — | — | — | — | — | DM error: Gemini API error (503): This model is currently experiencing high demand. Spikes |
| 18 | 152 | yes | yes | no | no | no_ask | The narration echoes the checking and returning to sleep with rich sensory details, but closes out the scene passively without prompting further action. |
| 19 | 163 | no | yes | no | yes | what_do_you_do_earned | Vividly establishes the weather, terrain, and a time-sensitive window to make the crossing before prompting for action. |
| 20 | 183 | no | yes | no | yes | what_do_you_do_redundant | Tammo volunteers a clear alternate path forward, making the trailing prompt redundant. |

## gemini · after — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 159 | no | yes | no | yes | live_question | Rich tactile consequences, autonomous NPC action with local stakes, and a character-driven live prompt. |
| 2 | 191 | no | yes | no | yes | live_question | Rich sensory grounding paired with an active NPC driving the plot forward via a direct question. |
| 3 | 192 | no | yes | no | yes | live_question | Richly textured NPC dialogue and evocative sensory details naturally hand the initiative to the player. |
| 4 | 205 | no | yes | no | yes | live_question | Strong specific details and NPC action leading into an immediate, high-stakes proposition. |
| 5 | 199 | no | yes | no | yes | live_question | Rich tactile details, zero action echoing, and a sharp NPC proposition ending on an active decision. |
| 6 | 0 | — | — | — | — | — | DM error: Gemini API error (503): This model is currently experiencing high demand. Spikes |
| 7 | 160 | no | yes | no | yes | live_question | Strong sensory grounding and an NPC who immediately counters with specific demands and a hard choice. |
| 8 | 181 | no | yes | no | yes | live_question | Richly textured scene that seamlessly transitions into an NPC offer and query. |
| 9 | 167 | yes | yes | no | yes | no_ask | Rich sensory and regional detail, though it narrates the transaction and movement back to the player before settling into scene momentum. |
| 10 | 155 | no | yes | no | yes | live_question | Rich nautical particulars paired with an NPC arriving on cue with hauling gear and a time-sensitive prompt. |
| 11 | 0 | — | — | — | — | — | DM error: Gemini API error (503): This model is currently experiencing high demand. Spikes |
| 12 | 0 | — | — | — | — | — | DM error: Gemini API error (503): This model is currently experiencing high demand. Spikes |
| 13 | 0 | — | — | — | — | — | DM error: Gemini API error (503): This model is currently experiencing high demand. Spikes |
| 14 | 229 | no | yes | no | yes | live_question | Rich sensory grounding and immediate narrative momentum through an NPC's direct challenge. |
| 15 | 196 | no | yes | no | yes | live_question | Rich atmospheric detail and character voice that moves straight into a compelling narrative hook and direct question. |
| 16 | 164 | no | yes | no | yes | live_question | Rich sensory grounding and an NPC who immediately introduces active temporal stakes. |
| 17 | 189 | no | yes | no | yes | live_question | Tammo reframes the timeline and creates immediate pressure by pointing out Orsa and the landing key. |
| 18 | 139 | no | yes | no | yes | stacked_menu | Vivid sensory passage of time ending on a binary choice menu. |
| 19 | 195 | no | yes | no | yes | live_question | Vivid sensory details and an active NPC who presents a clear, urgent choice without echoing the player's setup. |
| 20 | 152 | no | yes | no | yes | live_question | Vividly creates immediate environmental stakes and an urgent NPC call to action without echoing the player. |

