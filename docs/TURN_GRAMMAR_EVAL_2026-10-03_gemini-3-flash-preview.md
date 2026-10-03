# Turn-grammar eval — 2026-10-03

Proof step for the 2026-09-11 wow audit (ordinary-turn, W1: `## THE ORDINARY TURN`). 20 chained ordinary player turns on the `saltmere-debt` starter, BEFORE (pre-block prompt rebuilt by string surgery: "end by asking" step, "Leave space" line, old custom-prompt closing line) vs AFTER (the shipped block). Judge: `gemini-3.7-flash`, thinking-free, JSON-only, temperature 0. Word counts are local. Rubric rows are the audit's own: echo-of-action / particular present / abstraction tic / motion present / ask shape.

| Provider | Variant | Scored | Median words | Range | In 60–180 | Echo ↓ | Particular ↑ | Tic ↓ | Motion ↑ | Ask: live | earned WDYD | redundant WDYD ↓ | menu ↓ | none ↓ | Rolls proposed | Combat starts | Empty | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini (gemini-3-flash-preview) | before | 19/20 | 219 | 133–288 | 16% | 21% | 100% | 11% | 100% | 63% | 5% | 16% | 0% | 16% | 5 | 0 | 0 | 0 |
| gemini (gemini-3-flash-preview) | after | 20/20 | 203 | 126–256 | 30% | 5% | 100% | 15% | 100% | 65% | 5% | 15% | 0% | 15% | 2 | 0 | 0 | 0 |

Arrows mark the desired direction. "Scored" excludes turns that proposed a roll with no prose, started combat (a combat-intent turn, not an ordinary one), came back empty, or errored; word statistics are over scored turns only.

## gemini · before — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 167 | yes | yes | no | yes | live_question | Contains minor echoes of jumping down and gripping crates, but grounds the scene with rich sensory detail and introduces an approaching NPC to drive action. |
| 2 | 257 | no | yes | no | yes | live_question | Rich characterization and introduces Orsa with an immediate financial conflict for the player to address. |
| 3 | 191 | no | yes | no | yes | live_question | Strong NPC dialogue and immediate stakes drive the scene forward with a concrete offer and threat. |
| 4 | 222 | no | yes | yes | yes | what_do_you_do_redundant | Strong sensory details and a clear NPC ultimatum, though bogged down by 'air is thick with' and a redundant closing question. |
| 5 | 192 | no | yes | no | yes | what_do_you_do_redundant | Strong sensory details and a direct NPC ultimatum make the tacked-on closing question redundant. |
| 6 | 196 | no | yes | no | yes | live_question | Strong NPC agency with a concrete ledger breakdown, physical coins counted out, and an active quest offer. |
| 7 | 187 | no | yes | no | yes | live_question | Strong NPC agency, specific local detail, and an active offer with clear stakes. |
| 8 | 229 | no | yes | yes | yes | live_question | Contains the 'air thick' abstraction tic, but delivers rich particulars and an active NPC prompt. |
| 9 | 268 | yes | yes | no | yes | live_question | Contains an action echo at the start of paragraph two, but provides excellent local color and a natural NPC rumor hook. |
| 10 | 152 | — | — | — | — | — | roll proposed (not an ordinary turn) |
| 11 | 212 | no | yes | no | yes | live_question | Rich characterization and clear actionable framing without echoing the player's action. |
| 12 | 133 | yes | yes | no | yes | no_ask | Strong sensory details and an intriguing focal point at the waterline, but opens with an echo and lacks a closing handle. |
| 13 | 217 | no | yes | no | yes | no_ask | Rich dialogue and environmental detail with NPC initiative, though it concludes without an explicit handle. |
| 14 | 288 | no | yes | no | yes | live_question | Rich sensory details and proactive NPCs immediately supply a concrete rumor hook without generic prompts. |
| 15 | 237 | no | yes | no | yes | live_question | Richly textured NPC dialogue and tavern color that naturally hangs on the ominous sailor's remark without echoing the player's prompt. |
| 16 | 254 | no | yes | no | yes | live_question | Tammo pushes the narrative forward with concrete time pressure and ends on a direct, characterful question. |
| 17 | 257 | no | yes | no | yes | what_do_you_do_redundant | Tammo gives concrete advice and offers a whetstone, making the final prompt redundant. |
| 18 | 219 | yes | yes | no | yes | no_ask | The reply echoes the stated actions and pilots the character back to the pier, ending on static description without a prompt. |
| 19 | 173 | no | yes | no | yes | what_do_you_do_earned | Strong atmospheric sensory details and dynamic environmental motion without echoing the player's arrival. |
| 20 | 230 | no | yes | no | yes | live_question | Strong characterization and clear stakes with two concrete demands presented by Hekka. |

## gemini · after — per-turn

| # | Words | Echo | Particular | Tic | Motion | Ask | Judge note |
|---|---|---|---|---|---|---|---|
| 1 | 210 | no | yes | no | yes | live_question | Richly detailed narration with proactive NPCs introducing both local stakes and an ominous wider situation. |
| 2 | 169 | no | yes | no | yes | live_question | Rich sensory grounding, natural NPC initiative, and ends on a compelling character prompt. |
| 3 | 218 | no | yes | no | yes | live_question | Tammo answers with rich world details and immediately pressures Astra with an organic question about her debts. |
| 4 | 255 | no | yes | no | yes | live_question | Richly textured NPC interaction that naturally creates leverage and advances the scene with an offer. |
| 5 | 195 | no | yes | no | yes | live_question | Strong sensory details and a clear NPC-driven proposition that drives play forward. |
| 6 | 126 | no | yes | no | yes | live_question | Strong sensory details and a proactive NPC offer that drives the situation forward. |
| 7 | 193 | no | yes | no | yes | live_question | Sharp dialogue, specific sensory details, and an urgent ultimatum from the NPC. |
| 8 | 256 | no | yes | yes | yes | live_question | Contains an abstraction tic ('the air thick with...') but drives the narrative forward with concrete physical details and an NPC proposition. |
| 9 | 190 | no | yes | no | yes | live_question | Rich, grounding sensory particulars with immediate world pressure returning via Maren's expectant gaze. |
| 10 | 146 | yes | yes | no | yes | no_ask | Tammo offers useful specifics and sensory detail, though the DM echoes the player's inspection and ends on an internal framing statement. |
| 11 | 166 | no | yes | no | yes | no_ask | Rich characterization and vivid sensory details drive the refusal, though it trails off into atmosphere without a clear immediate hook. |
| 12 | 129 | no | yes | no | yes | no_ask | Rich maritime specifics and an ominous visual reveal, though it trails off without an explicit prompt. |
| 13 | 231 | no | yes | yes | yes | live_question | Great character detail and dialogue, though it opens with a stock atmospheric tic ('the air is thick with...'). |
| 14 | 220 | no | yes | no | yes | what_do_you_do_redundant | Harl delivers specific setting hooks and tension before tacking on a redundant generic prompt. |
| 15 | 243 | no | yes | no | yes | live_question | Strong, concrete scene-setting with organic NPC dialogue and an active closing question. |
| 16 | 246 | no | yes | no | yes | live_question | Tammo acts with clear motivation and hands over an item while asking a direct, grounded question. |
| 17 | 220 | no | yes | no | yes | what_do_you_do_redundant | Tammo gives urgent, flavorful advice and asks a direct question about gear, making the generic trailing prompt redundant. |
| 18 | 191 | no | yes | yes | yes | what_do_you_do_earned | Strong sensory transition and environmental shift, though it trips on the 'air so thick' stock abstraction. |
| 19 | 242 | no | yes | no | yes | live_question | Strong atmospheric detail and immediate NPC-driven crisis with an urgent, threatening demand. |
| 20 | 180 | no | yes | no | yes | what_do_you_do_redundant | Vivid character confrontation with great sensory details, though the final prompt is redundant given Orsa's ultimatum. |

