# Roll-consequence eval — 2026-09-30

Proof step for "the promise in the outcome" (WOW 2026-09-16, checks-and-consequence W1; DECISIONS.md 2026-09-16). 10 FAILED out-of-combat checks with public failure stakes, per provider per variant. BEFORE = the old bare result line ("FAILURE", no stakes or margin); AFTER = the shipped `formatRollSummary` line (margin band + "The ruling promised on failure: …"). The post-roll user message is the resolver's own SYSTEM text with the withheld setup re-injected. Judge: `gemini-3.7-flash`, thinking-free, JSON-only, temperature 0. PASS = matches the stated stakes AND one consequence AND no second check AND competence kept.

| Provider | Variant | Scored | Pass ↑ | Consequence delivered | Matches stakes ↑ | Single consequence ↑ | No second check ↑ | Competence kept ↑ | Live choice ↑ | Median words |
|---|---|---|---|---|---|---|---|---|---|---|
| gemini (gemini-3.1-pro-preview) | before | 10/10 | 10% | 60% | 10% | 90% | 100% | 100% | 100% | 137 |
| gemini (gemini-3.1-pro-preview) | after | 10/10 | 90% | 100% | 100% | 100% | 90% | 100% | 100% | 155 |
| openai (gpt-5.6-terra) | before | 10/10 | 20% | 50% | 20% | 100% | 100% | 100% | 90% | 118 |
| openai (gpt-5.6-terra) | after | 10/10 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 124 |

## Findings

- **The promise line is the whole difference.** With the old bare "FAILURE" line, both DMs narrated "nothing happens"
  failures and OMITTED the stated stakes in 8 of 10 (Terra) and 9 of 10 (Gemini) cases — the refusal without the late
  fee, the clam-up without the harbor hearing of it, the fog without the stolen rope. With the shipped line (margin band +
  "The ruling promised on failure: …") the consequence narrated matched the stated stakes 10/10 on both providers, one
  consequence each, competence kept 10/10, a live choice 10/10.
- **The one AFTER miss (Gemini, climb-breakwater):** the stakes landed exactly, then the DM asked for a second roll (a
  save against the surf) — the "one roll settles the approach" rule bent once in 20. Terra 10/10 clean.
- **Margin texture reads.** Near-miss cases kept a foothold, the natural 1 (larder) delivered the stakes plus one
  complication without incompetence, wide misses landed in full — the bands are narration texture only and never moved
  pass/fail, as designed.
- n = 10 per cell, one sample each; the before/after gap (10 → 90, 20 → 100) is far outside noise.


## gemini · before — per check

| Check | Words | Pass | Delivered | Matches | Single | No 2nd | Competence | Live | Judge note |
|---|---|---|---|---|---|---|---|---|---|
| orsa-extension | 191 | no | yes | no | yes | yes | yes | yes | The refusal landed, but the DM omitted the publicly stated two-silver late fee and public shaming in favor of an unprompted quest hook. |
| bell-keeper-rumor | 146 | no | no | no | yes | yes | yes | yes | The bell-keeper clams up, but the narration fails to deliver the second half of the established stakes: him spreading the word across the harbor. |
| lift-the-crate | 142 | no | yes | no | yes | yes | yes | yes | The crate splinters, but the narration omits the stated loss of a third of the salt to the water. |
| insight-orsa | 136 | no | no | no | yes | yes | yes | yes | The narration delivers a standard 'nothing happens' failure rather than the agreed-upon misread consequence. |
| sneak-the-larder | 137 | yes | yes | yes | yes | yes | yes | yes | The DM delivers the agreed stakes accurately through environmental complications while handing back an immediate, active choice. |
| haggle-rope | 102 | no | no | no | yes | yes | yes | yes | The DM only narrated 'nothing happens' (the price remains ten) and omitted the second part of the stated stakes: refusing to sell the good coil at all today. |
| climb-breakwater | 177 | no | yes | no | yes | yes | yes | yes | The character landed on the pier boards instead of falling into the surf and losing the lantern as explicitly staked. |
| deceive-tallyman | 104 | no | yes | no | yes | yes | yes | yes | Instead of counting the cart and noting the name immediately as stated, the narration introduces an ultimatum threatening the harbormaster. |
| perception-fog | 117 | no | no | no | yes | yes | yes | yes | The DM narrated simple failure and ignored the established stake of having the coil of rope stolen. |
| intimidate-dockhand | 120 | no | yes | no | no | yes | yes | yes | The DM replaced the social reputation stakes (story spreading by noon) with an immediate physical blockade risking the catch. |

## gemini · after — per check

| Check | Words | Pass | Delivered | Matches | Single | No 2nd | Competence | Live | Judge note |
|---|---|---|---|---|---|---|---|---|---|
| orsa-extension | 174 | yes | yes | yes | yes | yes | yes | yes | The stated stakes land precisely, preserving character dignity and setting up a clear choice. |
| bell-keeper-rumor | 155 | yes | yes | yes | yes | yes | yes | yes | The DM perfectly executed the agreed stakes with rich sensory detail and cleanly handed play back to the player. |
| lift-the-crate | 166 | yes | yes | yes | yes | yes | yes | yes | Delivers the exact promised loss of salt and broken crate while respecting the near miss and cleanly handing initiative back to the player. |
| insight-orsa | 141 | yes | yes | yes | yes | yes | yes | yes | Delivers the exact promised misread while maintaining character competence and ends on a crisp choice. |
| sneak-the-larder | 174 | yes | yes | yes | yes | yes | yes | yes | Delivered the promised stakes smoothly via an environmental complication and framed a sharp new choice. |
| haggle-rope | 152 | yes | yes | yes | yes | yes | yes | yes | Delivers the exact promised stakes cleanly while preserving player competence and offering a prompt forward. |
| climb-breakwater | 159 | no | yes | yes | yes | no | yes | yes | Delivered the exact promised stakes cleanly while framing the slip on slick weed and ending on an immediate choice. |
| deceive-tallyman | 126 | yes | yes | yes | yes | yes | yes | yes | Delivers the exact promised stakes clearly and cleanly hands back the turn. |
| perception-fog | 141 | yes | yes | yes | yes | yes | yes | yes | Delivered the exact promised failure stakes cleanly while maintaining player competence and prompting a clear follow-up action. |
| intimidate-dockhand | 155 | yes | yes | yes | yes | yes | yes | yes | Delivered the exact public embarrassment stakes without undermining the character's delivery, ending on a crisp prompt. |

## openai · before — per check

| Check | Words | Pass | Delivered | Matches | Single | No 2nd | Competence | Live | Judge note |
|---|---|---|---|---|---|---|---|---|---|
| orsa-extension | 159 | no | no | no | yes | yes | yes | yes | The narration merely refuses the request and forgets to apply the agreed-upon two silver late-fee stake. |
| bell-keeper-rumor | 104 | no | no | no | yes | yes | yes | no | The bell-keeper clams up, but the active stake—him telling the harbor about the player's questions—is completely omitted. |
| lift-the-crate | 99 | yes | yes | yes | yes | yes | yes | yes | The crate cracks as established, and Tammo immediately offers a hook to recover the loss. |
| insight-orsa | 164 | no | no | no | yes | yes | yes | yes | The narration treated failure as a simple 'nothing happens' rather than delivering the stated false belief about her fear. |
| sneak-the-larder | 92 | no | yes | no | yes | yes | yes | yes | The clerk catches the character, but questions them rather than marching them to Orsa as established in the stakes. |
| haggle-rope | 124 | no | yes | no | yes | yes | yes | yes | The DM softened the stakes by still allowing her to buy the coil for ten silver instead of refusing to sell it entirely. |
| climb-breakwater | 96 | no | yes | no | yes | yes | yes | yes | The narration softens the agreed stakes by avoiding the fall into surf and loss of the lantern. |
| deceive-tallyman | 102 | no | no | no | yes | yes | yes | yes | The DM stalled the failure into a standoff rather than executing the agreed stakes of counting the cart and writing down the name. |
| perception-fog | 118 | no | no | no | yes | yes | yes | yes | The stated consequence of having the coil of rope stolen was completely omitted from the narration. |
| intimidate-dockhand | 120 | yes | yes | yes | yes | yes | yes | yes | The dockhand dismisses the threat in front of his crew and escalates the standoff without undermining the hero's competence. |

## openai · after — per check

| Check | Words | Pass | Delivered | Matches | Single | No 2nd | Competence | Live | Judge note |
|---|---|---|---|---|---|---|---|---|---|
| orsa-extension | 146 | yes | yes | yes | yes | yes | yes | yes | Delivers the exact agreed-upon stakes cleanly while maintaining character dignity and offering a clear, pressing choice. |
| bell-keeper-rumor | 141 | yes | yes | yes | yes | yes | yes | yes | The DM accurately delivers the promised failure stakes without diminishing player competence and hands play back cleanly. |
| lift-the-crate | 102 | yes | yes | yes | yes | yes | yes | yes | Delivers the exact promised salt loss while preserving her footing and ending on a crisp choice. |
| insight-orsa | 140 | yes | yes | yes | yes | yes | yes | yes | Delivers the exact promised misread seamlessly without extra penalties and ends on a direct prompt. |
| sneak-the-larder | 138 | yes | yes | yes | yes | yes | yes | yes | Delivers the exact agreed stakes, frames the failure on an external noise, and opens directly into dialogue with Orsa. |
| haggle-rope | 124 | yes | yes | yes | yes | yes | yes | yes | Delivers the exact promised failure outcome cleanly while presenting an alternative cordage option. |
| climb-breakwater | 106 | yes | yes | yes | yes | yes | yes | yes | Delivers the exact promised stakes cleanly while framing the slip on the slick stone and handing the choice back via dialogue. |
| deceive-tallyman | 104 | yes | yes | yes | yes | yes | yes | yes | The exact promised consequence was delivered cleanly while maintaining player competence and passing back a live choice. |
| perception-fog | 95 | yes | yes | yes | yes | yes | yes | yes | The stated stakes are perfectly delivered while preserving the character's dignity and leaving an immediate choice. |
| intimidate-dockhand | 112 | yes | yes | yes | yes | yes | yes | yes | Delivers the exact social fallout agreed upon without undermining Astra's demeanor, ending on a crisp prompt. |

## Transcripts

### openai · before · orsa-extension

> [ROLL RESULT: Persuasion check: Persuade Orsa Pellwyn to grant a month's extension on the Kittiwake debt, DC 12, rolled 10 — FAILURE]

Orsa Pellwyn shuts the brass-cornered ledger over Astra’s tally with one firm palm. A compact, square-built woman in her late fifties, she wears black wool beneath an oilskin waistcoat; her iron-grey hair is braided so tightly it draws the skin at the corners of her pale eyes. Her nose has plainly been broken at least once, and a narrow gold ring glints through one ear.

“One more month puts the Kittiwake in the teeth of the gales,” she says. “And puts my boat at risk for a debt you have not cleared.” Her gaze lands on the numbers, then returns to Astra. “You’ve worked hard. That earns you this: bring her hauled up by sundown, help Tammo with the winter net-store, and you may take day work when I have it. But the boat is not yours for another month.”

She slides the tally back across the desk. “Unless you have coin—or something better than promises—to change my mind.”

### openai · before · bell-keeper-rumor

> [ROLL RESULT: Persuasion check: Get the bell-keeper to say what he saw at Gannet Rock, DC 10, rolled 4 — FAILURE]

The bell-keeper’s mouth closes hard. He is a narrow, wind-burned man with a flattened nose, iron-grey hair tied at his nape, and a wool apron dusted in greenish bell-metal polish; his eyes flick once toward the harbourmaster’s lit window.

“Nothing worth a fuss,” he says, not quite meeting Astra’s gaze. “Dark lamp. Bad weather. Same as anybody can see from shore.” His fingers worry the little brass key hanging at his belt until it clicks against the ring.

Then he lowers his voice. “Leave Gannet Rock be, girl. Folk who go hunting answers out there tend to come back owing more than they carried.”

### gemini · before · orsa-extension

> [ROLL RESULT: Persuasion check: Persuade Orsa Pellwyn to grant a month's extension on the Kittiwake debt, DC 12, rolled 10 — FAILURE]

Orsa Pellwyn does not look up from her brass-cornered ledger as the wooden tally clatters onto her desk. "One more month," she repeats, tasting the words like something gone off. Her pen stops.

She raises her eyes, her gaze flicking down to Astra's rope-scarred palms before settling coldly on her face. "The run is over, Astra. A month of winter trawling just means you'll snap my mast, sink my boat, and drown yourself before you clear your debt. The answer is no. You haul the *Kittiwake* up by noon and we count this tally against your principal."

Orsa leans back in her chair, looking past Astra toward the frost-rimed window and the dark, jagged silhouette of Gannet Rock out in the grey swells. "Unless, of course, you're looking for a different wage. The town council put a bounty up this morning. Two silver to whoever rows out there and figures out why the keeper hasn't lit the lamp in two days. Nobody on the docks wants it." She taps her quill against the dry inkwell. "Bring me that bounty by tomorrow morning, and you can keep the boat in the water."

### openai · before · lift-the-crate

> [ROLL RESULT: Athletics check: Carry the salt-crate up the landing steps alone, DC 12, rolled 11 — FAILURE]

The crate slips from the last step and lands corner-first on the wet planks with a hollow crack. Brine runs through a split in its side, carrying a few silver herring across the landing; gulls immediately wheel and scream above the tar-black water.

Old Tammo pauses over his net, his thin hands held toward the brazier. “That’ll be coming out of somebody’s count,” he says, not unkindly. Then he hooks his chin toward the dark lighthouse beyond the breakwater. “Orsa’s been asking who’s fool enough to row to Gannet Rock. Might be a way to square a small loss.”

### openai · before · insight-orsa

> [ROLL RESULT: Insight check: Read what Orsa is hiding about the lighthouse keeper, DC 12, rolled 8 — FAILURE]

Orsa Pellwyn gives nothing away beyond a small tightening at the corner of her mouth. She is a broad-shouldered woman in her late fifties, with iron-grey hair braided close against a weather-cut scalp, a square jaw, and a faded wool coat stretched over a thick sailor’s build. Her brass-cornered ledger lies open beneath one hard, ink-stained hand.

“The keeper’s called Nedd Vark,” she says, eyes still on the columns of debt. “Reliable enough to drink himself dull on shore leave, never reliable enough to miss a light twice.” She turns a page with deliberate care. “The council wants someone to row out, see whether he’s dead, drunk, or simply gone. The Kittiwake knows those waters.”

Only the harbor’s ordinary business shows on her face: catch, payment, weather, obligation. Whatever she may be holding back, she does not let it surface. Her finger settles beside Astra’s name in the ledger. “Settle your share of the catch first, or make yourself useful. Which will it be?”

### gemini · before · bell-keeper-rumor

> [ROLL RESULT: Persuasion check: Get the bell-keeper to say what he saw at Gannet Rock, DC 10, rolled 4 — FAILURE]

The bell-keeper wipes his raw hands on his apron, his eyes darting nervously up the quay toward Harbormaster Orsa's lamplit window. He visibly shrinks back from your gentle prodding.

"Saw nothing. Just fog and shadows," he mutters, though the tremor in his jaw betrays him. His gaze drops, refusing to meet yours, fixing instead on your rope-scarred palms. "And you've got your own troubles, Astra. Orsa's tallymen are already making their rounds, and the *Kittiwake* ain't half empty yet. Don't go looking for curses when you've got debts to pay."

He retreats into the dim, damp-stone warmth of the tower, pulling the heavy oak door shut with a definitive thud. Out on the seaward pier, the cold wind howls off the breakwater, rattling the halyards on the moored boats. Old Tammo coughs by his brazier, pulling his shawl tighter against the chill.

What do you do?

### openai · before · sneak-the-larder

> [ROLL RESULT: Stealth check: Get into the tally-house larder unseen, DC 12, rolled 1 — FAILURE]

The larder door gives a loud, damp crack as it opens, and a stack of empty fish-oil tins shivers loose from the nearest barrel. Their clatter rings sharply through the little room.

A thin clerk in ink-stained cuffs appears in the back doorway with a chipped mug in hand. He stops dead, taking in Astra’s chain mail and the rope scars across her palms. “Gods’ teeth,” he says, then glances toward the front office where Harbormaster Pellwyn keeps her ledger. “This is the tally-house. What business have you got in the larder?”

### openai · before · haggle-rope

> [ROLL RESULT: Persuasion check: Talk the chandler down to six silver for the rope, DC 10, rolled 7 — FAILURE]

The chandler’s thumb finds the worn place Astra named, and he gives a dry little snort. He is a broad, bald man with a wax-yellow beard braided close to his chin, sleeves dark with tar to the elbows. “Frayed at the bight, aye. Still sound through forty fathoms.” He lowers the coil to its peg with deliberate care. “Ten silver, girl. Or keep hauling on whatever you’ve got until it parts at the wrong hour.”

The shop reeks of hemp dust, lamp oil, and the sharp black pitch bubbling in a little iron pot by the stove. He eyes Astra’s mail and sword, then nods toward the six-silver pile offered between them. “That buys you patch cord. Not a coil. So—which are you taking?”

### openai · before · climb-breakwater

> [ROLL RESULT: Athletics check: Climb the breakwater to the gull-egg ledge, DC 12, rolled 6 — FAILURE]

A slick stone shifts under Astra’s boot, and the breakwater gives her no purchase. She slides hard down the weed-smeared face, catching herself against a lower shelf just above the churning water; cold spray soaks the hem of her mail and trousers. Above, the gulls wheel and scream over their untouched clutch, white droppings stark against black stone.

Old Tammo looks up from the pier, one hand braced on his knee. “That wall’s got more appetite than sense today,” he calls. “You hurt, girl?” The ledger-lamp in Orsa Pellwyn’s office continues to burn up the quay.

### openai · before · deceive-tallyman

> [ROLL RESULT: Deception check: Get the second cart past the tallyman uncounted, DC 12, rolled 11 — FAILURE]

The tallyman’s chalk pauses above his slate. He is a narrow, liver-spotted man in a tar-black oilskin, with a wool cap pulled low over one pale, pinched face; he gives the cart’s piled baskets a slow, unimpressed look.

“Tammo’s name isn’t a counting mark,” he says. “And Tammo himself isn’t here to say it.” His hooked finger taps the cart’s axle. “You can help me lift the canvas, or I can send for Pellwyn and we’ll do it with her ledger open.”

Old Tammo, still by his brazier farther down the pier, has not looked up. The tallyman waits beside the cart.

### gemini · before · lift-the-crate

> [ROLL RESULT: Athletics check: Carry the salt-crate up the landing steps alone, DC 12, rolled 11 — FAILURE]

The salt-swollen wood is heavier than it looks, slick with harbor grime. It twists out of your rope-scarred palms just as you clear the second step, crashing back down onto the damp stone with a heavy, wet splintering sound that echoes over the wash of the tide.

The icy morning wind bites at your knuckles where the rough boards scraped them red.

Up by the brazier, Old Tammo pauses his bone needle and squints through the coal smoke. "Going to need a second back for that, Astra," he calls out, gesturing with a calloused thumb toward the yellow glow of Orsa Pellwyn's office window. "And best be quick. Orsa's already on the early tallies, and she won't take 'I dropped it' for herring weight."

The heavy crate sits wedged awkwardly on the bottom step, half-blocking the *Kittiwake's* gangboard. What do you do?

### openai · before · perception-fog

> [ROLL RESULT: Perception check: Spot a light or boat near Gannet Rock through the fog, DC 12, rolled 9 — FAILURE]

Nothing holds steady in the fog beyond the breakwater: no lantern glow, no sail, no dark hull cutting through the pall. The bell buoy gives a hollow, misplaced clang somewhere seaward, then vanishes again beneath the hush of water.

Behind Astra, Old Tammo draws a smoking twist of tarred line through his broad, knuckled hands. He is a squat old man with a flattened nose, white beard stained amber at the mouth, and one clouded eye beneath a wool cap. “Gannet Rock’s two miles east by the bell line,” he says without looking up. “Dark tower means trouble—or a keeper who’s found a bottle. You planning to stare the light back on, girl, or take the Kittiwake in?”

### openai · before · intimidate-dockhand

> [ROLL RESULT: Intimidation check: Make the dockhand back down, DC 12, rolled 7 — FAILURE]

The dockhand’s grin only widens. He is a broad, thick-necked man in a tar-black wool cap, with a split lower lip and pale lashes above small, watchful eyes; fish scales glitter in the damp hairs on his forearms. “That so?” he says, quiet enough to make it personal. “You paying off Pellwyn’s ledger with threats now?”

Two other hands have stopped over a coil of wet rope, their attention fixed on the narrow strip of pier between the Kittiwake and the black water. Old Tammo does not look up from his net, but his needle has gone still.

The man shifts his weight closer without touching Astra, testing whether the threat was meant to end the matter. “Go on, then.”

### gemini · before · insight-orsa

> [ROLL RESULT: Insight check: Read what Orsa is hiding about the lighthouse keeper, DC 12, rolled 8 — FAILURE]

Orsa keeps her eyes strictly on her brass-cornered ledger, her voice remaining perfectly level. You watch her face for a tell—a twitch of the jaw, a nervous glance toward the window and the dark rock beyond—but the harbormaster gives you nothing. She is as weathered and unyielding as Saltmere's own breakwater.

She dips her quill, the scratch of the nib loud in the damp morning air, and draws a sharp line beneath the *Kittiwake*'s current tally. "The keeper's business is his own until it costs me coin," Orsa says, finally looking up with eyes like chipped slate. "And right now, the only thing costing me coin is a half-full boat still bobbing at my pier when the gales are due. Are you hauling the rest of that herring, Astra, or just standing there letting it rot?"

### openai · after · orsa-extension

> [ROLL RESULT: Persuasion check: Persuade Orsa Pellwyn to grant a month's extension on the Kittiwake debt, DC 12, rolled 10 — FAILURE by 2 (near miss: the stated stakes land, but the hero keeps a foothold). The ruling promised on failure: "Orsa refuses and adds a late-fee of two silver to the ledger, in front of the tallymen". Deliver exactly that consequence — one, proportionate — then a live choice.]

Orsa Pellwyn’s pen stops above the brass-cornered ledger. She is a broad-shouldered woman in a dark wool coat shiny at the elbows, iron-grey hair pinned hard against a long, weather-cut face; a thin white scar draws one corner of her mouth upward, though she is not smiling.

“No.” She writes the word in the margin with a quick, decisive scratch, then adds another line beneath the Kittiwake’s figures. “Two silver late-fee. In front of witnesses, so there’s no mistaking what delay costs.” The two tallymen at the wall keep their eyes on their slates, pretending not to hear the nib tear faintly through the paper.

Orsa shuts the ledger and finally meets Astra’s gaze. “The boat is hauled by sundown. Settle what’s owing, find another berth, or give me a reason worth more than pity to send her back out in gale season. Which is it?”

### openai · after · bell-keeper-rumor

> [ROLL RESULT: Persuasion check: Get the bell-keeper to say what he saw at Gannet Rock, DC 10, rolled 4 — FAILURE by 6 (wide miss: the stated stakes in full). The ruling promised on failure: "He clams up and tells the harbor you are asking questions about the lighthouse". Deliver exactly that consequence — one, proportionate — then a live choice.]

The bell-keeper’s fingers tighten around the rag until his knuckles pale. He is a narrow, stooped man in a tar-black wool cap, with a long wind-chafed face, watery grey eyes, and a limp left hand missing its smallest finger. Rather than answer, he looks past Astra toward the harbormaster’s lit office.

“Didn’t see a thing worth saying,” he mutters. “And if you’ve sense, you’ll stop asking after it.” He turns sharply toward the quay, his brass handbell knocking against his hip as he goes. By the time he reaches the fish-stalls, two dockhands have already heard that Astra is prying into Gannet Rock—and word in Saltmere moves quickest when it can be sold.

Old Tammo pauses his net-mending across the pier, watching the man leave. “That one’s scared,” he says, low. “Question is whether he’s scared of the rock—or somebody ashore.”

### gemini · before · sneak-the-larder

> [ROLL RESULT: Stealth check: Get into the tally-house larder unseen, DC 12, rolled 1 — FAILURE]

The heavy larder door sticks against its warped frame. When forced, the wood gives way with a piercing shriek of rusted iron that cuts right through the morning dock-noise, banging loudly against the inner wall. Inside, the barrels stand in a tight row under a single shuttered window, leaving absolutely no shadow or gap wide enough to conceal a full-grown woman.

The back door swings open. The clerk—a reedy lad with ink-stained fingers—stops dead, dropping a ledger as he spots you half-crouched by the salt-pork. "Hey! You're Pellwyn's hand on the *Kittiwake*," he stammers, his voice cracking as he backs up a step. "Orsa! Orsa, someone's in the stores!"

Heavy, measured footsteps immediately stop pacing in the adjoining office. The scrape of a heavy chair over floorboards signals the Harbormaster rising to investigate. What do you do?

### openai · after · lift-the-crate

> [ROLL RESULT: Athletics check: Carry the salt-crate up the landing steps alone, DC 12, rolled 11 — FAILURE by 1 (near miss: the stated stakes land, but the hero keeps a foothold). The ruling promised on failure: "The crate slips and splits on the steps; a third of the salt is lost to the water". Deliver exactly that consequence — one, proportionate — then a live choice.]

The crate bucks sideways on the second step, its swollen slats cracking with a wet report. Astra keeps her footing, but the bottom gives way: coarse salt pours across the weed-slick boards and hisses into the black water between the pilings. A third of the load is gone before it can be saved.

Old Tammo looks up from his brazier, needle paused in his thick fingers. “Damn waste,” he says, not unkindly, and drags his spare push-broom from beside the net racks. “Want help saving what’s dry, or are you taking that tally to Pellwyn before she hears it from somebody else?”

### openai · after · insight-orsa

> [ROLL RESULT: Insight check: Read what Orsa is hiding about the lighthouse keeper, DC 12, rolled 8 — FAILURE by 4. The ruling promised on failure: "You misread her: you come away sure she is frightened of the keeper, when she is not". Deliver exactly that consequence — one, proportionate — then a live choice.]

Orsa Pellwyn’s mouth tightens at the keeper’s name, and the look she gives the black water beyond the harbor reads as fear—fear of whatever waits in that unlit tower. You come away certain the keeper has frightened her badly.

She is a broad-shouldered woman in her late fifties, with iron-grey hair pinned in a hard coil, a square face weathered red at the cheeks, and ink permanently dark in the creases of her fingers. Her heavy wool coat smells of lamp oil and wet paper as she shuts the brass-cornered ledger. “Gannet Rock’s keeper is named Jory Venn. He has missed two lights and sent no word. That is not a debt I can put off forever.”

She slides her gaze to the Kittiwake, then back to Astra. “Will you take a boat out and learn whether Venn is alive?”

### openai · after · sneak-the-larder

> [ROLL RESULT: Stealth check: Get into the tally-house larder unseen, DC 12, rolled 1 — FAILURE by 11 (NATURAL 1: the stakes plus ONE complication — never incompetence; the hero's authored words, confidence, and delivery stand). The ruling promised on failure: "The clerk finds you in the larder and marches you to Orsa". Deliver exactly that consequence — one, proportionate — then a live choice.]

The larder door gives with a wet wooden groan, and the clerk turns from the rear passage at once, a crook-necked man with flour on one cuff and a key ring clenched in his fist. He finds Astra crouched among fish barrels and sacks of hardtack beneath the shuttered window; there is nowhere useful to disappear to.

He says nothing while marching her across the quay. Harbormaster Orsa Pellwyn looks up from her brass-cornered ledger: a broad, square-built woman in a tar-black wool coat, iron-grey hair braided tight against a weather-cut face, with two blunt fingers missing from her left hand. A little brass scale sits beside the open accounts. “Astra,” Orsa says, flatly. “Was there a debt in my book you meant to settle by eating it?” Her eyes move from the clerk to you. “Explain yourself.”

### gemini · before · haggle-rope

> [ROLL RESULT: Persuasion check: Talk the chandler down to six silver for the rope, DC 10, rolled 7 — FAILURE]

The chandler turns the coil over in his hands, unhurried, his thick thumbs brushing the rough hemp exactly where you pointed. He snorts, tossing it back onto the salt-stained planks of his stall.

"It'll hold a skiff just fine," he grunts, his breath pluming in the damp morning air with the faint smell of stale ale and tar. "Ten silver. Or you can weave kelp together and see how Harbormaster Pellwyn likes the *Kittiwake* tied off when the gales hit."

He crosses his heavy arms, entirely unmoved by the negotiation, and waits for your coin or your departure. What do you do?

### openai · after · haggle-rope

> [ROLL RESULT: Persuasion check: Talk the chandler down to six silver for the rope, DC 10, rolled 7 — FAILURE by 3. The ruling promised on failure: "He keeps the price at ten and will not sell you the good coil at all today". Deliver exactly that consequence — one, proportionate — then a live choice.]

The chandler turns the coil over in his thick, tar-blackened hands, then gives Astra a flat look beneath brows singed pale by lamp smoke. He is a square little man in a patched waxed coat, with a bald crown shining through lank grey hair and a nose bent sharply left.

“Fraying at the bight’s the outer wrap, not the heart,” he says. “Ten silver for sound rope, and I’ve no appetite for being priced down before breakfast.” He hooks the coil back behind the counter. “Not selling that one to you today.”

A rack of inferior cordage hangs near the doorway, stiff with old salt and mildew. The chandler turns toward a customer waiting on lamp oil, making it plain the haggling is over.

### openai · after · climb-breakwater

> [ROLL RESULT: Athletics check: Climb the breakwater to the gull-egg ledge, DC 12, rolled 6 — FAILURE by 6 (wide miss: the stated stakes in full). The ruling promised on failure: "You fall into the surf: you lose the lantern and take a bruising, and the eggs stay where they are". Deliver exactly that consequence — one, proportionate — then a live choice.]

The weed-slick stones betray your grip halfway up. You hit the surf shoulder-first, hard enough to knock breath loose, and the lantern goes from your hand into the churning black water; its flame gutters once beneath the foam and vanishes. A raw bruise is already gathering along your ribs beneath the chain mail.

Above, the gull-eggs remain on their narrow ledge, pale against the stone, while gulls wheel and scream into the wind. Tammo has looked up from his brazier; he spits over the side and calls, “That rock’s taken better climbers than you, girl. You climbing again, or coming ashore before it takes the rest?”

### gemini · before · climb-breakwater

> [ROLL RESULT: Athletics check: Climb the breakwater to the gull-egg ledge, DC 12, rolled 6 — FAILURE]

The breakwater stones are green with weed below the tide line, and the morning wind is already up, whipping cold spray across the harbor. You haul yourself up the first tier, but your heavy boots find no purchase on the slime. As you reach for the ledge, your grip gives way. You slide backward, scraping your rope-scarred palms against a crust of barnacles, and land with a heavy thud back on the pier's wet wooden boards, breathless and empty-handed.

Old Tammo pauses his work at the brazier, the harsh smell of crushed bladderwrack rising around you as you catch your breath. He just shakes his head, gesturing with his wooden netting needle up the quay.

"Leave the eggs to the birds, Astra," he calls over the wind. "Orsa's tally-man is already walking the boards, and the *Kittiwake* still has a half-hold of herring waiting to be hauled."

The tally-man, a thin fellow wrapped in a heavy wool coat, is indeed making his way down the pier with a slate tucked under his arm, eyeing the low-riding boats.

### openai · after · deceive-tallyman

> [ROLL RESULT: Deception check: Get the second cart past the tallyman uncounted, DC 12, rolled 11 — FAILURE by 1 (near miss: the stated stakes land, but the hero keeps a foothold). The ruling promised on failure: "He does not believe you, counts the cart, and notes your name beside it". Deliver exactly that consequence — one, proportionate — then a live choice.]

The tallyman’s pencil stops above the damp slate. He studies Astra’s rope-scarred hands, then the second cart’s heap of silver herring under its wet sailcloth, and gives a humorless snort.

“Tammo’s got one cart and a bad knee. This is yours.” He walks around the load, calling the count aloud while a dock-boy scratches it into the harbor book. At the bottom of the column, the tallyman writes **ASTRA** beside the cart in firm black strokes.

“Pellwyn will want the figures before the Kittiwake comes out,” he says, shutting the ledger. “You heading to her office, or leaving that for someone else to explain?”

### openai · after · perception-fog

> [ROLL RESULT: Perception check: Spot a light or boat near Gannet Rock through the fog, DC 12, rolled 9 — FAILURE by 3. The ruling promised on failure: "You see nothing, and while you stare out to sea someone lifts the coil of rope from beside your boots". Deliver exactly that consequence — one, proportionate — then a live choice.]

Beyond the breakwater there is only fog—flat, wet, and close enough to swallow Gannet Rock whole. The bell buoy gives a dull, lonely clang somewhere unseen, but no lamp answers from the lighthouse and no hull shape breaks the grey water.

Behind you, rope rasps over old planks. A narrow-shouldered boy in an oversized tarred coat has lifted the coil from beside your boots; damp black hair hangs across one eye as he starts edging toward the fish sheds, pretending he has merely been sent to fetch it. “This yours?” he asks without turning around.

### gemini · before · deceive-tallyman

> [ROLL RESULT: Deception check: Get the second cart past the tallyman uncounted, DC 12, rolled 11 — FAILURE]

The tallyman looks from the heavy cart to you, then back again, his eyes narrowing against the biting harbor wind. He steps off his crate and plants his boots squarely in the path of the wooden wheels.

A drop of freezing rain smudges the fresh white chalk marks on his tally-slate.

"Tammo hasn't hauled a net in three years, Astra," he says, his voice flat and unimpressed. He taps the edge of the cart with a knuckle. "Orsa wants every tail logged before the *Kittiwake* comes out of the water. Pull the tarp back, or I'm fetching the harbormaster to pull it for you."

### openai · after · intimidate-dockhand

> [ROLL RESULT: Intimidation check: Make the dockhand back down, DC 12, rolled 7 — FAILURE by 5 (wide miss: the stated stakes in full). The ruling promised on failure: "He laughs it off in front of his friends and the story of it is around the pier by noon". Deliver exactly that consequence — one, proportionate — then a live choice.]

The dockhand laughs in Astra’s face—a broad man in a tar-stiff wool cap, with a flattened nose and black stubble showing through windburned cheeks. “Hear that?” he calls to the two men who have paused beside a heap of wet nets. “Pellwyn’s girl’s charging by the tooth now.”

His friends bark laughter, not quite brave enough to step closer, while he keeps his ground amid fish scales and brine-dark boards. By noon, every pier-worker in Saltmere will have heard some version of it: Astra threatened a man and he laughed.

Old Tammo’s needle has stopped moving over at the brazier. The dockhand spreads his hands. “Go on, then. Make the rate plain.”

### gemini · before · perception-fog

> [ROLL RESULT: Perception check: Spot a light or boat near Gannet Rock through the fog, DC 12, rolled 9 — FAILURE]

You squint into the distance, but the fog is thick past the breakwater, rolling over the harbor mouth in a heavy grey wall. The damp air clings to your salt-bleached hair, smelling sharply of brine and crushed kelp. Somewhere out in that soup, the bell buoy clangs a hollow, lonely note with the swell, but of Gannet Rock or any bobbing lantern, there is no sign.

Behind you, Old Tammo coughs and shifts on his stool by the brazier. "Looking won't light it, girl," he grunts, pulling a frayed section of netting taut across his knee. "And Orsa's ledger won't wait on ghosts. You hauling the rest of that catch, or letting it rot in the hull?"

### gemini · before · intimidate-dockhand

> [ROLL RESULT: Intimidation check: Make the dockhand back down, DC 12, rolled 7 — FAILURE]

The dockhand doesn't flinch. Up close, he is bigger than he looked from the *Kittiwake's* deck, thick-necked and smelling of old chum. Two of his friends stop hauling a brine barrel to watch, dropping it to the wet boards with a heavy thud and crossing their arms.

He sneers down at you, completely unbothered by the threat. "Or what?" he spits, a brass ring glinting in his ear. "You'll throw a herring at me? You're too far behind Orsa's ledger to be picking fights, Kittiwake."

The three of them form a solid, mocking blockade between the boat and the weighing scales, perfectly happy to let your catch rot in the hold while the morning slips away. What do you do?

### gemini · after · orsa-extension

> [ROLL RESULT: Persuasion check: Persuade Orsa Pellwyn to grant a month's extension on the Kittiwake debt, DC 12, rolled 10 — FAILURE by 2 (near miss: the stated stakes land, but the hero keeps a foothold). The ruling promised on failure: "Orsa refuses and adds a late-fee of two silver to the ledger, in front of the tallymen". Deliver exactly that consequence — one, proportionate — then a live choice.]

You put the tally on the desk. Orsa Pellwyn does not look up from the brass-cornered ledger. "One more month," she repeats, as if tasting something gone off. The scratch of her pen stops. The tallymen warming their hands by the iron stove go quiet, turning to watch.

"The gales don't wait for your debts, Astra, and neither do I," Orsa says, finally looking up. "The Kittiwake gets hauled up today." She deliberately dips her pen, draws a sharp line on your page, and writes a new figure in full view of the watching men. "Two silver late-fee added to your ledger."

She sprinkles sand over the wet ink and snaps the heavy book shut. "You have until sundown to bring me the coin you owe, or another crew takes the boat in the spring. Unless, of course, you can find a way to make yourself exceptionally useful to Saltmere before the tide-bell rings again." She glances pointedly out the salt-crusted window, looking across the grey water toward the dark silhouette of Gannet Rock.

### gemini · after · bell-keeper-rumor

> [ROLL RESULT: Persuasion check: Get the bell-keeper to say what he saw at Gannet Rock, DC 10, rolled 4 — FAILURE by 6 (wide miss: the stated stakes in full). The ruling promised on failure: "He clams up and tells the harbor you are asking questions about the lighthouse". Deliver exactly that consequence — one, proportionate — then a live choice.]

The bell-keeper wipes his hands on his salt-stained apron and glances nervously toward the harbormaster's office. But as you press him, his fear sours into a sudden, defensive panic. He recoils, his boots scraping loudly against the wet stone of the quay.

"I didn't see nothing, and I ain't saying nothing!" he barks, his voice carrying much further than intended in the damp morning air. He backs away and yells up the pier, making sure every roughneck and fish-gutter hears him. "Orsa! The *Kittiwake's* hand is asking about the lighthouse! Poking where she ain't paid to!"

At his brazier, Old Tammo stops his mending and sighs, his breath pluming in the cold. Further up the quay, the herring-heavers pause their hauling to stare at you, and a heavy silhouette shifts behind the glowing window of Orsa Pellwyn's ledger-room. The bell-keeper scurries off, leaving you the center of attention on the docks. What do you do?

### gemini · after · lift-the-crate

> [ROLL RESULT: Athletics check: Carry the salt-crate up the landing steps alone, DC 12, rolled 11 — FAILURE by 1 (near miss: the stated stakes land, but the hero keeps a foothold). The ruling promised on failure: "The crate slips and splits on the steps; a third of the salt is lost to the water". Deliver exactly that consequence — one, proportionate — then a live choice.]

The crate is salt-swollen and slick, far heavier than it looks. As you heave it upward, boots bracing on the wet stone, your grip fails on the algae-slimed bottom edge. The crate twists out of your hands and crashes hard against the lip of the second step. You manage to keep your footing, but the waterlogged wood splinters with a loud crack. A cascade of coarse white salt pours through the broken slats, dissolving instantly as it hits the dark, churning harbor water below. A third of the haul is gone before you can even brace the ruined box.

Old Tammo pauses his netting needle by the brazier, wincing at the sound. Up the quay, the heavy door to Harbormaster Orsa Pellwyn's office swings open. A ledger-clerk steps out into the cold morning air, clutching a slate and peering down the pier toward the splintering noise. The broken crate is wedged awkwardly on the steps, still bleeding the rest of its salt. What do you do?

### gemini · after · insight-orsa

> [ROLL RESULT: Insight check: Read what Orsa is hiding about the lighthouse keeper, DC 12, rolled 8 — FAILURE by 4. The ruling promised on failure: "You misread her: you come away sure she is frightened of the keeper, when she is not". Deliver exactly that consequence — one, proportionate — then a live choice.]

Orsa keeps her eyes firmly on the brass-cornered ledger, her voice perfectly level as she speaks of Gannet Rock. But watching the rigid set of her jaw and the way her pen hesitates over the inkwell, you come away sure of one thing: she is deeply frightened of the keeper.

The scratch of her nib against the thick parchment sounds loud in the cramped, oil-smelling office.

She finally looks up, presenting a mask of hard authority that you now believe you see right through. She taps a long, ink-stained finger against your open account line in the book. "The *Kittiwake's* herring will clear your winter debt," she says crisply. "But I'll pay ten silver to whoever rows out and checks that light today."

She gives you a sharp, expectant look. "Are you taking the oars, or just standing in my light?"

### gemini · after · sneak-the-larder

> [ROLL RESULT: Stealth check: Get into the tally-house larder unseen, DC 12, rolled 1 — FAILURE by 11 (NATURAL 1: the stakes plus ONE complication — never incompetence; the hero's authored words, confidence, and delivery stand). The ruling promised on failure: "The clerk finds you in the larder and marches you to Orsa". Deliver exactly that consequence — one, proportionate — then a live choice.]

The larder door sticks, its rusted hinges shrieking like a dying gull. You slip inside, dropping low behind a row of brine-crusted barrels under a single shuttered window, but the noise has already given you away. The clerk steps through the doorway, wiping ink-stained fingers on a rag. He doesn’t even look surprised. "Up, Astra," he sighs. "The Harbormaster heard that. Walk."

He marches you out of the larder and straight into the lamplit warmth of the office. Orsa Pellwyn sits behind her desk, the heavy brass-cornered ledger already open. She doesn't look up immediately; she simply dips her pen and scribbles a fresh line.

"Sneaking through my tally-house," the older woman murmurs, her voice like grinding stones. "That’s another silver added to your debt, Astra. And your morning's catch is still sitting out there in the *Kittiwake*." She finally raises her cold eyes, gesturing with the feather of her quill toward the window and the dark silhouette of Gannet Rock beyond the breakwater. "Unless you're in here to volunteer to check my lighthouse?"

### gemini · after · haggle-rope

> [ROLL RESULT: Persuasion check: Talk the chandler down to six silver for the rope, DC 10, rolled 7 — FAILURE by 3. The ruling promised on failure: "He keeps the price at ten and will not sell you the good coil at all today". Deliver exactly that consequence — one, proportionate — then a live choice.]

The chandler turns the coil over in his hands, unhurried. He rubs a calloused thumb over the hemp, gives a short, dismissive grunt, and yanks the rope entirely out of your reach.

"Ten's the price," he mutters, tossing the coil behind him where it hits the wet deckboards with a heavy thud. "Since you've got such a sharp eye for a fray, you can go find your rigging somewhere else. I'm not selling it to you today."

He turns his broad back on you, pulling a chalk slate from his apron to start tallying a crate of iron spikes. Down the pier, Old Tammo coughs over the smoke of his brazier, while the *Kittiwake* still bobs low in the grey water with a half-full hold of herring waiting to be unloaded.

Do you head back down to the boat to finish hauling the catch, or go see Orsa at the harbormaster's office?

### gemini · after · climb-breakwater

> [ROLL RESULT: Athletics check: Climb the breakwater to the gull-egg ledge, DC 12, rolled 6 — FAILURE by 6 (wide miss: the stated stakes in full). The ruling promised on failure: "You fall into the surf: you lose the lantern and take a bruising, and the eggs stay where they are". Deliver exactly that consequence — one, proportionate — then a live choice.]

The breakwater stones are green with slick weed below the tide line, and the morning wind is already whipping the waves into a chop. Your boots find no purchase on the kelp. You plunge backward into the freezing surf, striking the lower rocks with a heavy, bruising thud. The lantern slips from your grasp, swallowed instantly by the dark water, leaving the pale gull-eggs completely untouched on their high ledge.

The ocean bites instantly through your clothes, dragging at the rings of your chain mail with freezing weight and leaving the taste of salt and copper in your mouth.

Up on the seaward pier, Old Tammo sets down his mending. He hobbles to the edge and lowers the long, salt-bleached handle of his gaff hook toward the swell for you to grab. "Tide's got no mercy for egg-thieves, Astra!" he calls down over the roar of the water. "You hauling up, or swimming all the way to Gannet Rock?"

### gemini · after · deceive-tallyman

> [ROLL RESULT: Deception check: Get the second cart past the tallyman uncounted, DC 12, rolled 11 — FAILURE by 1 (near miss: the stated stakes land, but the hero keeps a foothold). The ruling promised on failure: "He does not believe you, counts the cart, and notes your name beside it". Deliver exactly that consequence — one, proportionate — then a live choice.]

The tallyman pauses, looking from the salt-rimed cart to you and back. He doesn't step aside.

"Nice try," he grunts, dragging the tarp back himself. He runs a cold, calloused hand over the mountain of silver-scaled herring, counting the catch under his breath. When he finishes, he pulls a stub of chalk from his heavy coat and deliberately scratches your name onto his slate, right beside the total.

"Orsa expects the ledger settled by noon, Astra," he says, his breath pluming in the grey morning air. He taps the slate once—a dry, bureaucratic warning—before turning his attention to a shouting deckhand on the next boat over. Up the quay, the yellow light in the harbormaster's window cuts through the morning fog, waiting. What do you do?

### gemini · after · perception-fog

> [ROLL RESULT: Perception check: Spot a light or boat near Gannet Rock through the fog, DC 12, rolled 9 — FAILURE by 3. The ruling promised on failure: "You see nothing, and while you stare out to sea someone lifts the coil of rope from beside your boots". Deliver exactly that consequence — one, proportionate — then a live choice.]

The fog is thick past the breakwater, rolling over the waves in heavy, grey banks. A bell buoy clangs mournfully somewhere out in the soup, but as you stare toward Gannet Rock, the gloom is absolute. There is no lantern light, no silhouette of a bobbing skiff—nothing but the churning sea.

While you are staring into the mist, a faint scuff of a boot sounds on the slick planks right behind you. By the time you glance down, the heavy coil of hempen rope you had set beside your boots is gone.

A scruffy boy in an oversized, salt-crusted wool sweater is already sprinting back down the pier toward the fish-sorting tables, clutching your rope tight against his chest. He darts between a stack of empty herring barrels, trying to put distance between himself and the Kittiwake.

What do you do?

### gemini · after · intimidate-dockhand

> [ROLL RESULT: Intimidation check: Make the dockhand back down, DC 12, rolled 7 — FAILURE by 5 (wide miss: the stated stakes in full). The ruling promised on failure: "He laughs it off in front of his friends and the story of it is around the pier by noon". Deliver exactly that consequence — one, proportionate — then a live choice.]

Up close, the dockhand is a head taller than you remembered, his chest broad under a brine-stained tunic. Over his shoulder, two other lumpers pause their hauling to watch the confrontation. When you deliver your threat, he just stares down at you for a heartbeat before barking a harsh, mocking laugh that carries easily over the wind.

"Hear that, lads?" he calls back to his mates. "The *Kittiwake's* terror is gonna take my teeth!"

The others chuckle, the story already cementing itself into a joke that will run the length of the pier by noon. He turns back to you, entirely unimpressed, and roughly shoves a heavy, empty herring basket against your chest. "Save your breath. Pellwyn's ledger is waiting, and your catch ain't counting itself."

He stands his ground, arms crossed over his chest, waiting to see if you are going to take the basket and haul your fish, or try your luck again.

