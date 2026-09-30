# Opening-scene eval — 2026-09-30

Proof step for "the opening ends on a handle and echoes the hero" (WOW 2026-09-09, first-ten-minutes W1; ANCHOR / ECHO / HANDLE on `buildCampaignOpeningPrompt`, DECISIONS.md 2026-09-10). 6 openings (the five premise starters + one custom premise) × 2 samples per provider, the real fresh-campaign system prompt and the real opening prompt. Judge: `gemini-3.7-flash`, thinking-free, JSON-only, temperature 0. PASS = normal life AND anchor AND echo AND handle AND no menu AND no urgency.

| Provider | Scored | Pass ↑ | Normal life ↑ | Anchor ↑ | Echo ↑ | Handle ↑ | Menu ↓ | Urgent ↓ | ≤ 3 paragraphs ↑ | Median words | Starting items emitted |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini (gemini-3.1-pro-preview) | 12/12 | 92% | 100% | 100% | 100% | 92% | 0% | 0% | 42% | 258 | 2 |
| openai (gpt-5.6-terra) | 12/12 | 75% | 100% | 100% | 83% | 92% | 0% | 0% | 100% | 219 | 2 |

## Findings

- **ANCHOR and ECHO hold on both providers.** 24/24 openings put one or two people the hero already knows on screen
  with lines of their own (Old Tammo, Orsa Pellwyn, Brannagh Fothergill, Dunstan Reeve, Wendel Rook…), and the rope-scarred
  palms / missing fingertip surfaced inside the scene in 22/24 — noticed by a child, catching on twine, tapped on wagon
  wood — not retold as biography. Normal life first: 24/24, no menus, no urgent summons.
- **HANDLE holds 22/24.** The two misses (Gemini varrowgate #1, Terra varrowgate #1) ended without concrete next
  things — the courier starter's opening tends to end on the errand itself rather than on choices around it.
- **Terra's two ECHO misses are the same shape:** brannocks-ford #2 and custom-wagon #1 dumped the appearance as a
  descriptive summary ("Astra, tall and rope-scarred…") instead of letting one detail surface in the moment. A prompt
  nuance, not a structural gap; the ECHO clause could say "never as a description of the hero — only as something that
  happens".
- **Gemini's openings run long.** Median 258 words and 7 of 12 over three paragraphs (the ordinary-turn ceiling; the
  opening is allowed "the ordinary opening length"); Terra 219 words, 12/12 within three paragraphs. Same finding as the
  09-20 full run's verbosity on Flash — Gemini's ceiling discipline is the one column no wording has moved.
- Starting-items reconciliation fired on 2 openings per provider (the starters that name possessions) — no duplicates, no
  invented mechanics.


## gemini — per opening

| Opening | # | Words | Paras | Pass | Normal | Anchor (who) | Echo (what) | Handle | Menu | Urgent | Judge note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| saltmere-debt | 1 | 249 | 3 | yes | yes | yes (Old Tammo) | yes (Rope-scarred palms and the throbbing snubbed end of the missing finger from a snapped deep-water line) | yes | no | no | Strong, grounded opening that integrates character details and everyday tasks naturally. |
| saltmere-debt | 2 | 280 | 4 | yes | yes | yes (Old Tammo, Orsa Pellwyn) | yes (rope-scars across your palms and the blunted stump of your missing finger) | yes | no | no | Strong atmospheric opening that seamlessly incorporates background details and anchor NPCs with organic options. |
| kettle-inn-winter | 1 | 300 | 3 | yes | yes | yes (Brannagh Fothergill) | yes (chill aching in rope-scarred palms and the stump of the missing fingertip) | yes | no | no | An excellent opening that hits all rubric requirements naturally. |
| kettle-inn-winter | 2 | 255 | 3 | yes | yes | yes (Brannagh Fothergill) | yes (rope-scarred palms and missing top of finger throbbing in the cold) | yes | no | no | An exemplary opening that grounds the character in routine chore work with natural echoes and hooks. |
| brannocks-ford-homecoming | 1 | 279 | 4 | yes | yes | yes (Dunstan Reeve) | yes (rope-scars across palms and missing fingertip noticed in the moment) | yes | no | no | Atmospheric opening that smoothly incorporates the background details, anchor character, and low-stakes opening hooks. |
| brannocks-ford-homecoming | 2 | 258 | 4 | yes | yes | yes (Dunstan Reeve) | yes (catching the mooring rope against scarred palms and missing fingertip) | yes | no | no | Strong, grounded opening that weaves the background details naturally into the ferry landing. |
| varrowgate-courier | 1 | 303 | 4 | no | yes | yes (Master Ludo Fenwright, Senna Vashti) | yes (rope-scarred calluses and missing fingertip from the snapped net line) | no | no | no | Good establishment of the setting and anchors, but ends on an open question rather than specific embedded handles. |
| varrowgate-courier | 2 | 244 | 3 | yes | yes | yes (Senna Vashti, Master Ludo Fenwright) | yes (rope-scars on palms and blunt stump of missing finger) | yes | no | no | Strong opening that integrates background details, known NPCs, and ordinary next steps without artificial urgency. |
| long-furrow-harvest | 1 | 244 | 4 | yes | yes | yes (Piet, Maud) | yes (rope-scars on palms and missing fingertip making tying knots awkward) | yes | no | no | Strong opening that integrates routine harvest chores, family dynamics, and physical details seamlessly. |
| long-furrow-harvest | 2 | 232 | 3 | yes | yes | yes (Piet, Maud) | yes (twine dragging across rope-scarred palms and shifting grip to spare the half-missing finger from a deep-water line) | yes | no | no | Grounds the scene effectively in daily harvest chores with family anchors and subtle background integration. |
| custom-wagon | 1 | 274 | 4 | yes | yes | yes (Wendel Rook) | yes (rope-scarred palms and missing fingertip tapped against the wagon wood) | yes | no | no | Strong, evocative opening that naturally weaves in mundane concerns, physical details, and anchor character dialogue. |
| custom-wagon | 2 | 237 | 4 | yes | yes | yes (Wendel Rook) | yes (resting rope-scarred palms and severed finger on pommel as an old deep-water habit) | yes | no | no | Strong mundane opening with natural anchors, character echoes, and everyday tasks embedded into the scene. |

## openai — per opening

| Opening | # | Words | Paras | Pass | Normal | Anchor (who) | Echo (what) | Handle | Menu | Urgent | Judge note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| saltmere-debt | 1 | 183 | 3 | yes | yes | yes (Old Tammo, Orsa Pellwyn) | yes (rope-scarred palms and missing top of a finger noticed by Tammo) | yes | no | no | Atmospheric opening that smoothly incorporates character details, familiar anchors, and clear immediate hooks. |
| saltmere-debt | 2 | 204 | 2 | yes | yes | yes (Old Tammo, Harbormaster Orsa Pellwyn) | yes (rope-scarred palms noticed by Tammo) | yes | no | no | Atmospheric opening that smoothly incorporates established NPCs, personal details, and natural immediate choices. |
| kettle-inn-winter | 1 | 198 | 3 | yes | yes | yes (Brannagh Fothergill, Ide Fothergill) | yes (rope-scarred palms stinging around the shovel) | yes | no | no | An evocative, grounded start that cleanly introduces familiar anchors, ordinary chores, and character texture. |
| kettle-inn-winter | 2 | 216 | 2 | yes | yes | yes (Brannagh Fothergill, Ide Fothergill) | yes (rope scars across Astra's palm) | yes | no | no | Atmospheric, low-stakes opening that neatly incorporates the NPCs, appearance detail, and clear immediate tasks. |
| brannocks-ford-homecoming | 1 | 246 | 3 | yes | yes | yes (Hesper Coyle, Dunstan Reeve) | yes (A child stares openly at Astra's rope-scarred palms and the missing top of one finger) | yes | no | no | An excellent opening that hits every rubric criterion smoothly and naturally. |
| brannocks-ford-homecoming | 2 | 287 | 3 | no | yes | yes (Hesper Coyle, Dunstan Reeve) | no | yes | no | no | Appearance and background details are dumped via descriptive summary rather than emerging organically in the scene. |
| varrowgate-courier | 1 | 219 | 3 | no | yes | yes (Master Ludo Fenwright, Senna Vashti) | yes (rope scars across palms noticed by Senna) | no | no | no | Strong scene setting and anchor dialogue, but the ending lacks concrete ordinary handles beyond a generic open-ended question. |
| varrowgate-courier | 2 | 239 | 3 | yes | yes | yes (Master Ludo Fenwright, Senna Vashti) | yes (rope-scarred palms) | yes | no | no | Grounds Astra's morning routine with both named anchors and specific local choices. |
| long-furrow-harvest | 1 | 173 | 3 | yes | yes | yes (Maud, Piet) | yes (rope-scarred palm) | yes | no | no | A grounded, atmospheric opening that smoothly incorporates background details and anchors. |
| long-furrow-harvest | 2 | 215 | 3 | yes | yes | yes (Maud, Piet) | yes (rope scars across palms catching chaff and shortened hand from deep-water nets) | yes | no | no | Grounds the harvest morning nicely with vivid family interactions and solid integration of character details. |
| custom-wagon | 1 | 230 | 3 | no | yes | yes (Wendel Rook) | no | yes | no | no | Appearance details are listed as direct description rather than emerging naturally through action or interaction. |
| custom-wagon | 2 | 219 | 2 | yes | yes | yes (Wendel Rook) | yes (loose sailcloth binding around the missing top of your finger) | yes | no | no | Captures the quiet travel routine effectively with well-grounded anchors, details, and low-stakes choices. |

## Transcripts

### openai · saltmere-debt #1

Saltmere wakes by the tide-bell: one bruised note rolling over slate roofs, fish scales, and the grey skin of the harbor. The *Kittiwake* rides low at her berth with the last herring of the run silvering her open hold, while gulls quarrel over offal on the seaward pier.

Old Tammo has saved his usual stool beside the brazier. The net-mender is a narrow, bent man with a tar-black beard braided close against the wind, red-rimmed eyes, and hands webbed in old cuts. He squints at Astra’s rope-scarred palms as she passes, then clicks his tongue at the missing top of one finger. “Deep-water work takes its due,” he says. “Saltmere only takes coin.” Across the quay, Harbormaster Orsa Pellwyn—broad-shouldered in a dark green oilskin, iron-grey hair pinned in a severe knot—writes in her brass-cornered ledger beneath the customs shed.

Orsa’s clerk has set the weighing hooks ready for the catch, Tammo’s brazier has a place for wet hands and stronger gossip, and the dark lighthouse on Gannet Rock sits beyond the breakwater like a broken tooth against the morning. What do you do?

### openai · saltmere-debt #2

Saltmere wakes by degrees: gulls worrying the fish guts beneath the stalls, winch-chains clanking along the seaward pier, the tide-bell giving its hard bronze note through a morning of flat grey rain. The *Kittiwake* rides low beside the quay, her nets heaped dark and glistening in the hold, silver herring staring from their own spilled scales. Old Tammo sits under his brazier’s lean-to with his wool cap steaming, a stool saved beside him as always. His eyes flick to Astra’s rope-scarred palms as she passes. “That old line taught you manners it never learned itself,” he says, feeding a twist of tarred cord into the coals. “Come have tea before Pellwyn starts counting your breath by the penny.”

Across the harbor, Harbormaster Orsa Pellwyn stands beneath the customs shed’s eaves, broad-shouldered in a black oilskin, her brass-cornered ledger tucked beneath one arm. She is already looking toward the *Kittiwake*, waiting for catch and debt to be reckoned before the boat is hauled clear of the coming gales. Beyond the breakwater, Gannet Rock is a smear in the rain; its lighthouse lantern remains unlit. Tammo has tea, Pellwyn has the ledger, and the morning’s catch still needs sorting aboard the *Kittiwake*. What do you do?

### openai · kettle-inn-winter #1

The first proper snow has packed itself against the Kettle Inn in pale, wind-sculpted ribs, turning the Hollin Pass beyond the yard into a white throat between black ridges. In the stable, old hay, horse sweat, and cold iron mingle beneath the low beams. Brannagh Fothergill stands by the trough in a patched wool coat, broad through the shoulders and thick at the waist, her iron-gray braid tucked beneath a felt cap; she raps its ice skin with a splitting maul. “If the mules crack teeth on it, Astra, I’m charging the mountains for replacements.”

Your rope-scarred palms sting briefly around the wood-handled shovel in the bitter air. Through the kitchen door, Ide Fothergill—lean, balding, sharp-nosed, with a floury apron tied over his dark shirt—has a ledger open beside the stove. The common room beyond holds the low snores and damp boots of the late tin-merchants. Ide glances up. “Storeroom before noon, if you please. I want numbers, not guesses. Then there’s the woodpile if Brannagh hasn’t drafted you into her private army.” He nudges a mug of weak ale toward the edge of the table. “Or warm yourself first. I’m not a monster.”

What do you do?

### gemini · saltmere-debt #1

The tide-bell of Saltmere rings the low hour, a dull iron clank that cuts through the freezing morning mist. You stand on the slick, scale-plastered deck of the *Kittiwake*, tying off the heavy mooring lines. The stiff hemp bites into your rope-scarred palms, and the snubbed end of your missing finger—lost to a snapped deep-water line three seasons back—throbs in the biting chill. It is the last morning of the herring run. In the hold below, the silver catch sits waiting to be counted, the final haul before the autumn gales force the boats onto dry land.

Up on the seaward pier, Old Tammo feeds a chunk of driftwood into his iron brazier, sparks dancing against the grey morning. He coughs, pulling his heavy wool cloak tighter, and waves a gnarled hand toward you. "Make it fast, Astra!" he wheezes over the crash of the surf, his breath pluming in the air. "Orsa's got the ledger open in the tollhouse, and she ain't in a forgiving mood today!"

Beyond the breakwater, the sea chop is violent, and the lighthouse on Gannet Rock remains a dead, sightless silhouette against the horizon. Two nights dark, and the harbor mutters about it only in hushed, nervous tones. You can head up the pier to warm your hands at Tammo's brazier, start hauling the heavy herring baskets to the tollhouse to settle your debt with the Harbormaster, or take a moment to finish securing the *Kittiwake* for the haul-out. What do you do?

### openai · kettle-inn-winter #2

The Kettle Inn wakes by degrees: first the stove’s iron tick, then the coughs and boots of tin-merchants in the common room below. Snow has packed itself against the shutters overnight, blue-grey in the early light, while the stable yard lies under a skin of untouched white except for the dark, steaming mouths of the horses. Brannagh Fothergill stands at the kitchen hearth, broad through the shoulders and red-cheeked beneath her iron-grey braid, levering yesterday’s ash from the grate with a poker. “Trough’ll be crusted hard,” she says without looking up. “See to it before the nags drink themselves sick.”

Ide Fothergill occupies the long table with a slate, a stub of chalk, and a face like a narrow hatchet made gentler by his soft brown eyes. His white beard is tucked into the collar of a patched wool coat. He taps the storeroom key against the slate. “Then count what’s left of flour, salt pork, lamp oil, and oats. Proper count, Astra—not one of those sailor’s guesses.” One of the rope scars across Astra’s palm catches pale light as the key is set down within reach. Beyond the kitchen door, the stable waits; upstairs, the merchants are beginning to stir; and Ide’s ledger has a blank column waiting to be filled. What do you do?

### openai · brannocks-ford-homecoming #1

Brannock’s Ford has learned a new way to look at Astra: briefly, then again. Market day fills the square with wet wool, horse dung, frying onions, and the sharp white smell of river mud. Six years have passed, but the rope ferry still crawls over the current below, its pulley groaning like an old throat. Across Tanner’s Lane, Hesper Coyle stands in the doorway of her narrow brick house—broad through the shoulders, iron-grey hair pinned in a severe coil, flour dust on one cheek and a burn scar across the knuckles of her right hand. “You’ll track half the river over my floor if you stand gawping,” she calls. “Boots off at the mat.”

Down at the landing, Dunstan Reeve hauls the ferry rope hand-over-hand. He has filled out since boyhood: thick-armed, dark-haired, a long pale seam under his jaw, wearing a patched blue coat shiny at the elbows. He spots Astra’s tall shape and salt-bleached brown hair, pauses only long enough to squint, then says across the water, “If you’ve come back to make that roof worse, I’ll charge you double for the crossing.”

A child at the bread stall stares openly at Astra’s rope-scarred palms and the missing top of one finger, until her mother tugs her away. Hesper has left a hammer and a bundle of fresh shingles beneath the eaves; beyond the market, the graveyard path climbs toward the chapel, while the ferry landing remains in plain sight. What do you do?

### gemini · saltmere-debt #2

The iron tide-bell of Saltmere rings the morning hour, a dull, flat toll swallowed by the thick autumn fog. The air off the seaward pier tastes of salt, frost, and rotting kelp. It is the last day of the herring run, and the docks are a slippery, frantic mess of silver scales and shouting fishers dragging the final nets. You stand by the mooring of the *Kittiwake*, your chain mail heavy and cold against your shoulders, rubbing your hands over the sputtering heat of Old Tammo’s coal brazier. The warmth slowly sinks into the thick rope-scars across your palms and the blunted stump of your missing finger.

"She's in a foul way this morning," Tammo rasps, pausing his needlework to spit a wad of brown phlegm onto the frost-rimed planks. He nods his chin toward the end of the pier. Harbormaster Orsa Pellwyn stands by the heavy iron scales, breath pluming in the chill air as she taps the cover of her brass-cornered ledger. The *Kittiwake's* catch needs to be counted, your debt tallied, and the boat hauled up before the winter gales hit.

Tammo goes back to mending, his arthritic hands moving with the steady, flawless rhythm he taught you two winters ago. "Everyone's jumpy," he mutters, glancing out past the breakwater. Through the mist, the jagged silhouette of Gannet Rock looms in the churning grey water. The lighthouse at its peak is dead and dark, just as it was the two nights prior. "Best get your silver sorted with Orsa. Or you could ask if she's paying a premium for some fool to row out to the rock." He gives a wheezing, humorless chuckle.

What do you do?

### openai · brannocks-ford-homecoming #2

Brannock’s Ford wakes by inches: millstones grumbling beyond the weir, gulls worrying at fish scales by the market quay, and the ferry rope humming across the brown river whenever Dunstan Reeve hauls on it. Rain has passed in the night, leaving Tanner’s Lane slick and shining between its close-set brick houses. Astra stands in Hesper Coyle’s doorway, tall in chain mail beneath a weather-dark coat, with a strong sailor’s build, salt-bleached brown hair cut short around a weathered face, and a chipped front tooth visible when her mouth opens. Rope scars cross both palms; the top joint of one finger is absent, the old wound pale against the damp morning.

“You still hold a hammer like it owes you money,” Hesper says from the ladder below the eaves. She is compact and broad through the shoulders, grey hair knotted under a red kerchief, her lined face set in the same practical displeasure it wore six years ago. A bundle of split shingles rests beside her boots. “That roof won’t mend itself, girl.”

At the river landing, Dunstan has just brought the ferry over. He has grown thick through the chest and middle, his dark hair cropped close, sleeves rolled over powerful forearms wet to the elbow. He catches sight of Astra across the lane and pauses with one hand still on the rope. “Market’s already picking bones clean,” he calls, neither warm nor cold. “Flour’s dear enough to make a man eat mud.” The old graveyard lies uphill beyond St. Venn’s, quiet among wet yews; the market and ferry are only a few streets down. Hesper taps the ladder with her hammer. “Roof first, or are you off to see who remembers you?” What do you do?

### gemini · kettle-inn-winter #1

The first hard freeze of the season turns the Hollin Pass into a quiet, white tomb. Outside the Kettle Inn, the morning air is sharp enough to burn the lungs, and the water trough is capped with an inch of stubborn ice. You bring the heel of your boot down hard to crack it open, the jarring impact shooting up your leg and reminding you of the biting cold in your hands. The chill aches worst in the rope-scarred flesh of your palms and the blunt stump of the finger you left on a deep-water boat years ago. In the adjacent stable, the Fothergills' draft horses huff warm plumes of breath into the bitter air, waiting for their morning feed.

The heavy kitchen door groans open behind you. Brannagh Fothergill steps out into the snow, wrapping a thick wool shawl tight over his stooped shoulders. "Leave the rest of the ice, Astra," he says, his breath pluming just like the horses'. "Those tin-merchants are still snoring off the climb in the common room, taking up every bench near the hearth. Ide wants you to count the root cellar and the salted pork before they wake and demand breakfast. She needs to know exactly what we've got before the snow completely shuts the pass."

He pauses, looking down the valley road where the pale drifts are already piling high against the tree line. "Still no post from Merrow, either. The tin-men say it's just the weather, but Ide's getting jumpy about it." Brannagh shivers, turns back toward the smell of woodsmoke, and leaves the door cracked for you. The frozen trough still needs clearing, the snoring merchants in the common room might have more news from down-valley if roused, and the dark, freezing storeroom awaits Ide's inventory. What do you do?

### openai · varrowgate-courier #1

Rain has polished Varrowgate’s bridge-stones black, and the Tollmark Courier House smells of damp wool, hot sealing wax, and river mud tracked in under a dozen boots. Master Ludo Fenwright peers over a barricade of ledgers, his narrow face pinched around a mouthful of pins. “Coppergate,” he says, sliding the morning’s tied bundle across to you. “Guildhall, tea-house, pawnbroker. In that order, if the city permits order today.”

Senna Vashti is waiting beneath the awning outside, lean in a patched green coat, with a shaved temple and a coil of dark hair pinned at the nape of her neck. Her gaze catches briefly on the rope scars across your palms as you settle the strap; she grins around it. “Don’t let the string bite. You’ve already paid enough blood to lines, by the look of you.” Across the street, workmen hang yellow paper lamps between buildings while a bell tower counts out the wet morning. Senna jerks her chin toward the market lanes. “I’ll show you the cut through Coppersmith Court—unless you’d rather make Master Fenwright explain why he keeps sending new runners past Vasker’s pawnshop.”

The Coppergate bridges wait beyond the rain, and your satchel holds the day’s routes—including one sealed letter with an unfamiliar mark and an address that does not ring true. What do you do?

### openai · varrowgate-courier #2

Varrowgate wakes by bells: bronze notes crossing the river mist from tower to tower, answered by the slap of barge-poles along the stone quays. Inside the Tollmark Courier House, Master Ludo Fenwright sits nearly buried behind his desk—broad-bellied, bald to the crown, with wax caught in his grizzled cuffs and a nose pinched red by cold—sorting seals through a lens. “Coppergate’s yours this morning, Astra,” he says. “Guildhalls, tea-houses, and don’t let Vetch the pawnbroker charm a copper out of you.”

Senna Vashti waits by the door with her runner’s cloak already pinned tight: lean as a rail, copper-brown skin, black hair braided close along one temple, and a pale old cut running from the corner of her mouth into her left cheek. Her eyes drop briefly to Astra’s rope-scarred palms as she passes over the string-bound satchel. “Use the bellfounders’ alley if you want dry boots,” Senna says. “And Coppergate’s third bridge, not the second—the second has a tax clerk who thinks runners are taxable weather.”

Outside, festival lamps are going up in rows above the street, their colored paper still limp with dew. Coppergate lies east over the bridges: the guildhall steps, the steam-sweet tea rooms, and Vetch’s notorious shop beneath its peeling blue sign are all within a morning’s walk. Ludo’s packets wait in the satchel—among them one sealed letter for an address that does not belong anywhere on the city’s maps. What do you do?

### openai · long-furrow-harvest #1

Barley dust rides the warm wind along Long Furrow’s single road, turning the eleven farms hazy beneath a hard blue sky. At the Halloran steading, Maud has planted herself beside a wagon half-loaded with sheaves, broad in the shoulders and sun-browned beneath a faded kerchief. She squints at the field and calls, “If Piet has tied that mule to the gate again, I’ll sell the beast and keep the boy.” From somewhere behind the barn comes Piet’s indignant answer: “It was only once!”

A snapped length of twine bites across the rope-scarred palm of Astra’s hand as another bundle waits to be bound. Beyond the palisade, Cormac Dunbrody moves from farm to farm with his tally stick, counting what will leave Long Furrow as tithe before harvest supper comes round. Maud wipes her hands on her apron and nods toward the road. “Cormac will want Halloran’s count soon. Or you could see whether your brother’s made peace with that mule before it kicks down another fence. Your choice, Astra.”

What do you do?

### gemini · kettle-inn-winter #2

The first proper snow of the season covers the courtyard of the Kettle Inn, muting the wind that howls down the Hollin Pass. You bring the splitting maul down hard on a frost-hardened log. The shock reverberates through the handle, a familiar ache settling into the deep, rope-thickened scars across your palms. You adjust your grip automatically—the missing top of your finger, lost to a snapped deep-water line three years ago, throbs faintly in the biting cold. You set another chunk of pine onto the block.

The heavy oak door of the inn creaks open, spilling the smell of woodsmoke and old ale into the freezing air. Brannagh Fothergill steps out, pulling his woolen mantle tight over his thick shoulders. He squints past the stable, eyeing the unbroken white stretching down the mountain toward the village of Merrow. "No post rider today, either," he grunts, his breath pluming in the frost. "That's a month with no word from the valley. Weather, likely. Or they're just too lazy to climb." He turns his dark eyes back to you. "Ide’s got the tin-merchants snoring in the common room, but she’s wanting you down in the cellar to count the stores before this snow packs any deeper."

The morning is still young. The ice on the stable trough still needs breaking for the merchants' draft horses, the cellar inventory waits for Ide’s ledger, and the tin-merchants inside might be worth a word about the lower road before they wake fully and start demanding breakfast. What do you do?

### openai · long-furrow-harvest #2

Morning lies pale over Long Furrow, turning the eleven farms’ barley heads the color of old brass. At the Halloran steading, Maud stands ankle-deep in cut stalks with her skirts pinned up and a sickle hooked through her belt, her broad, weather-dark face set in its usual expression of practical displeasure. “Cormac will count every sheaf twice if he thinks we’ve hidden one,” she says, not looking up. “So stack them straight, at least.”

Piet, all elbows and dust, wrestles the mule toward a cart and earns a sharp sideways kick of its hind leg for his trouble. “It likes Astra better,” he insists. The rope scars across Astra’s palms catch chaff when she flexes them; the shortened hand that once worked deep-water nets has never made farm work gentler. Beyond the fields, Long Furrow’s single road runs toward the palisade and its clustered roofs, where reeve Cormac Dunbrody’s tally cart has already stopped outside the Berrins’ place.

Three days remain before the harvest supper. Maud could use another pair of hands before noon; Cormac is close enough to find if there is business to settle; and the north end of the road lies open beyond the steading, toward the woods where the trapper has failed to come down this season. What do you do?

### openai · custom-wagon #1

Wendel Rook’s wagon has stopped beside a willow-shaded ditch while he argues with a wheel that has not, in fact, done anything wrong. The carter is a narrow, red-eared man in a patched brown coat, his thinning black hair plastered to his scalp by the damp; he talks at the mule because the mule cannot interrupt. Astra stands near the tailboard in chain mail, tall against the road, her short salt-bleached brown hair stirring in the wind. Rope scars cross both palms where they rest near her sword belt, and her chipped front tooth shows briefly when Wendel’s muttering earns whatever answer it earns.

“Road’s been too quiet,” Wendel says, as if quiet has cheated him personally. “Makes a man listen for trouble in every hedge.”

Ahead, the road bends south toward Dunmere between low fields of barley gone pale at the tips. Behind lies Ashford, perhaps an hour back by wagon pace. A hand-painted board at a track junction points toward **The Sallow Cup**, a roadside alehouse whose chimney gives out a thin stripe of peat smoke; beside it, a shallow brook runs clear enough to wash road dust from hands and face. Wendel straightens, pats the wagon’s side, and squints at Astra. “We’ve time enough for a cup if you’ve a mind. Or you can see whether that brook’s better company than I am. What do you do?”

### openai · custom-wagon #2

The wagon complains over a rut, its iron-rimmed wheels throwing up little fans of pale dust beneath a sky washed thin and bright. Wendel Rook reins in his tired chestnut mare and looks back from the driver’s bench: a narrow, stooped man with a wind-reddened nose, graying black curls escaping a battered felt cap, and a mustard-colored coat shiny at both elbows. “Ashford by noon, if Bess doesn’t decide she’s a barge,” he says. “Dunmere tomorrow. A man could build a respectable life on schedules, Astra, if roads and horses and customers weren’t all determined to ruin him.” The loose sailcloth binding around the missing top of your finger catches briefly on the leather wrap of your sword hilt as the wagon jolts again.

Ahead, Ashford’s low roofs and squat bell tower rise beyond wheat stubble and hedges. The road splits at a weathered marker: the left branch slopes toward the town’s market gate; the right cuts past a little stone shrine with fresh whitewash on its chipped saint’s face. Wendel digs through his coat for a lunch parcel, frowns at the empty pocket where it ought to be, then sighs. “If we stop at Hobb’s bakehouse, I’ll stand you a heel of bread. Provided you promise not to mention I still owe you wages.” What do you do?

### gemini · brannocks-ford-homecoming #1

The river smells of river-weed and autumn silt. The heavy hemp rope of the ferry groans against its wooden pulleys, slick with the morning mist. Brannock's Ford is loud with market day, and upriver, the old mill is already arguing with the weir in a low, grinding thrum that settles in the teeth. Astra stands on the muddy bank, tall in her chain mail, the wind catching her salt-bleached brown hair. She has been away for six years, and the town is largely just as she left it.

Dunstan Reeve hauls the dripping ferry rope hand over hand, guiding the flat-bottomed boat to the landing. He ties it off and finally looks up. His eyes flick over her—taking in the chipped front tooth, the heavy sword at her hip, and the thick rope-scars across her palms where a snapped deep-water net line took the top of her finger. He was her closest friend once. He still hasn't said if he's glad she's back. "Ferry's a copper," Dunstan says, his voice flat, wiping his own unscarred hands on his breeches. "Unless you're just here to block the landing."

Behind her, a pair of local farmers are already grumbling about the Aldwick estate's unseen new owners and how the price of flour has jumped twice since spring. Ahead lies the rest of the town. Aunt Hesper's house on Tanner's Lane is waiting, complete with a roof that needs mending and an old childhood room kept exactly as Astra left it—a quiet, suffocating accusation. Up the hill sits the churchyard and the grave she came to visit. Or there is Dunstan, waiting for a coin or a word.

What do you do?

### gemini · brannocks-ford-homecoming #2

The Brannock's Ford ferry groans against the current, the heavy wet rope spitting river water as it pulls taut. It is market day, and the banks are muddy with wagon traffic, though a few locals still pause to stare at the tall woman standing near the mooring post. They remember a different Astra—not someone with salt-bleached brown hair chopped short and a chipped front tooth. You catch the heavy mooring line as it swings in, the rough hemp biting familiarly into the thick rope-scars across both your palms and the stump of your missing fingertip, a bitter souvenir from your seasons on the deep-water boats.

Dunstan Reeve steps off the flat-bottomed barge, locking the crank. Your closest friend from six years ago hasn't smiled since you got back. He wipes his hands on his breeches and gives you a long, unreadable look. "Flour's up again," he says, his voice flat, as if picking up a conversation interrupted yesterday. "Market's complaining. Say it's the new owners up at the Aldwick estate." He kicks a wooden chock under the boarding ramp. "Hesper's expecting you. Said the roof won't mend itself."

Behind him, the market square is loud with haggling over the inflated prices. From here, the dirt road splits: up the hill toward the old cemetery where you still have a grave to visit, or straight into the crowded stalls and down Tanner's Lane, where your aunt waits in a house that has kept your old room exactly as it was—its own quiet kind of accusation.

What do you do?

### gemini · varrowgate-courier #1

The morning damp of Varrowgate clings to the stone walls of the Tollmark Courier House, smelling of river mud and the hot red wax pooling continuously on Master Ludo Fenwright’s desk. Ludo doesn't look up as he stamps another transit manifest, his round face half-hidden behind leaning towers of bundled parchment and tangled twine. Outside the barred windows, the city is already loud with the clatter of handcarts and the shouting of guild workers stringing wire and paper lamps across the narrow bridges. The Lantern Festival is nine days off, and the district is desperate to look prosperous before the tourists arrive.

"Your route now. Don't bleed on the parcels, boat-trash," Senna Vashti says, tossing a heavy leather courier's satchel across the room. Astra catches it, the worn strap slapping against the thick, rope-scarred calluses of her palms. Her grip slips for a fraction of a second where the top of her finger is missing—a dull ache that still remembers the snapped deep-water net line that took it three seasons ago. Senna, the senior runner who spent the last week showing Astra the alleyway shortcuts to collect on old favors, just smirks around a bruised apple and goes back to lacing her boots.

Astra's new solo assignment is Coppergate: the tea-houses, the merchant guildhalls, and its one notoriously ruthless pawnbroker. But as she shifts the satchel on her hip and checks the day's load, her thumb catches on something buried at the bottom. It’s a sealed letter, heavy and rigid, stamped with a fractured black wax crest she doesn't recognize, addressed to a street name in Coppergate that simply does not exist. Master Ludo is still violently stamping papers at his desk, and Senna is shouldering her own pack, about to head out the door into the morning rush.

What do you do?

### gemini · varrowgate-courier #2

The morning fog coming off the river smells of damp silt and hot sugar. Out in the cobblestone yard of the Tollmark Courier House, apprentices are already stringing paper lanterns between the eaves, getting a nine-day head start on the festival. Senna Vashti leans against the doorframe, chewing a splinter of wood. She watches Astra adjust the straps of her chain mail and shakes her head. "You don't need all that iron just to walk Coppergate," the senior runner drawls, tossing a thick leather satchel against Astra's chest.

Astra catches it, the heavy strap dragging familiarly across the rope-scars on her palms and the blunt stump of her missing finger. It’s the first time she's been trusted with a route of her own since she washed up in Varrowgate two winters ago, heavy with debt and light on explanations. Inside the cavernous hall, Master Ludo Fenwright is just visible behind a fortress of melted wax and tied parcels, furiously stamping manifests and yelling at the ledger-clerks.

The Coppergate run should be straightforward—a loop of guildhalls, tea-houses, and one notorious pawnbroker—save for one detail. Heavy at the bottom of the satchel is a letter with a strange, dark wax seal Astra doesn't recognize, bearing an address that simply does not exist. Senna is waiting by the gate to show her the district's shortcuts, while Master Ludo is still barking orders at his desk, but the city outside is already waking up. What do you do?

### gemini · long-furrow-harvest #1

The late afternoon sun bakes the dust of the single rutted road winding through Long Furrow. At the Halloran steading, the air is thick with the dry, itching chaff of cut barley. You heave another sheaf onto the groaning back of the farm cart, the coarse hemp twine biting into the heavy rope-scars across your palms. As you tie off the load, the stump of your missing fingertip—the one a snapped deep-water line took three seasons ago—makes the loop slightly awkward, but you pull the knot tight with practiced force.

"He's stubborn today, Astra, I swear he knows it's tithe day," Piet mutters, dodging a half-hearted kick from the family's swaybacked gray mule. From the farmhouse porch, Maud wipes a streak of dirt from her sweating forehead and points a calloused finger at your brother. "He's stubborn because you let him lead you, boy," your mother snaps, before turning her sharp eyes to you. "Get that tied off. Reeve Cormac is already tallying down by the palisade gate, and I won't have the Dunbrodys claiming we're late on our count."

The cart is nearly full, and the mule is still stamping in the traces, testing Piet's weak grip on the halter. You could shove your brother aside and finish hitching the beast yourself to haul the barley down to Cormac, or you might step inside the farmhouse first to wash the harvest dust from your throat before making the walk.

What do you do?

### gemini · long-furrow-harvest #2

The late afternoon sun bakes the dirt of the Halloran steading, the air thick with the chaff of cut barley and the sour reek of mule sweat. Astra hauls another sheaf onto the wagon bed. The coarse twine drags over the heavy rope-scars across her palms, her grip shifting by habit to spare the finger left half-missing to a snapped deep-water line two winters back. At the front of the cart, her younger brother Piet is losing a tug-of-war with the family mule, his boots slipping in the dust while the beast refuses to take a single step forward.

"If you let him drop his head, you've lost him, boy!" Maud shouts from the porch, leaning her weight on a pitchfork. She drags a sleeve across her face, looking older and more tired in the harsh light. "Astra, shoulder that stubborn bastard forward. Cormac Dunbrody is already down by the palisade tallying the tithe, and if we're at the back of the line he'll cheat our count before the harvest supper." Maud glances toward the dense northern tree line, her mouth tightening. "And keep an eye on the woods while you're down there. Wolves were too close last night, and the northern trapper is days late."

The wagon is fully loaded, Piet is getting nowhere with the bridle, and the long dirt road down through the village waits. What do you do?

### gemini · custom-wagon #1

The Ashford road is a ribbon of dry, packed dirt that smells of crushed fennel and draft-horse sweat. Wendel Rook’s wagon creaks with a rhythmic, maddening *clack-whine* over every rut, a sound that has been boring into your skull for the last two hours. The chain mail sits heavy and hot on your shoulders in the midday sun. You walk beside the rear axle, resting a hand on the sun-warmed wood. Your rope-scarred palms catch on the dry splinters, and the stump of your missing fingertip—taken by a snapped deep-water line three seasons ago—taps a slow, bored rhythm against the boards. Nothing has ever happened on this road, and today feels exactly like all the rest.

Up on the driver's bench, Wendel hasn't stopped talking since you passed the Ashford gates. "...and that's when I told the cooper, I said, 'Three copper for a banded barrel? You must be drinking what you're storing.' Am I right, Astra?" He twists around, his round, flush-pink face seeking validation, completely oblivious to how his tired draft horse is drifting toward the ditch. "Not that you'd know barrel prices. But a debt's a debt, and I know you've got your own to settle. I'll pay you your wages when we hit Dunmere. Probably."

Up ahead, the tree line breaks, offering a rare patch of deep shade under a sprawling oak. The left rear wheel you're walking beside groans louder with every revolution, begging for a swipe of grease from the bucket swinging under the chassis. Wendel waits for you to agree with him, blind to the state of his rig and the drifting horse.

What do you do?

### gemini · custom-wagon #2

The road between Ashford and Dunmere is exactly as Wendel Rook promised when he hired you: flat, cheap, and aggressively boring. The afternoon sun beats down on the rutted dirt, baking the dust into your salt-bleached brown hair. For two days, the only threat has been the carter's endless voice. Wendel slouches on the driver's bench, the reins slack in his hands, droning on about the price of oats and how he will definitely have your back pay once he sells this load of spun wool in Dunmere.

You walk alongside the creeping wagon, a tall shadow against the sun-bleached timber. You shift your grip on your belt, your rope-scarred palms and the stub of your severed finger resting against the pommel of your longsword. It is a habit left over from hauling deep-water nets—always bracing for a line to snap, even here in the quiet, dusty middle of nowhere. You run your tongue over your chipped front tooth, tasting grit.

Up ahead, the track dips toward the Halfway Ford, a shallow stream cutting through a copse of alder trees. Wendel pulls back on the reins, bringing the weary draft horse to a halt. "Left rear wheel's been squealing since morning," he calls down, wiping his brow. "Be a good lass and check the linchpin while I water the mare? Or at least fill the skins so we don't dry out before town."

What do you do?

