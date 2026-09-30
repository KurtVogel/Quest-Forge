# Death-count eval — 2026-09-30

The proof step for **"the count is on the page"** (WOW 2026-09-30, death-and-stakes W1; DECISIONS.md 2026-09-30 evening). Run with `npm run eval:death` (`scripts/deathCountEval.mjs`): two committed exchange results — a DYING round (1 success / 2 failures on the clock) and the DEATH terminal — narrated 5× per provider per variant through the real narration-only system prompt and the real `combatNarrationPrompt`; Gemini 3.1 Pro and GPT-5.6 Terra as DMs, `gemini-3.7-flash` as the thinking-free JSON judge.

**Summary.** DYING round (names the count or the party acts over the body, no combat ended, no invented attack) 4/5 → 5/5 on Gemini Pro and 3/5 → 5/5 on GPT Terra ("names the count" 0/5 → 4/5 and 0/5 → 5/5); DEATH terminal (says the hero died, no rescue) 0/5 → 3/5 (Pro) and 0/5 → 2/5 (Terra) with the first DIED wording — the DMs still euphemized ("the final breath stops", "your story ends here") — and 5/5 / 5/5 after the terminal gained "SAY IT IN PLAIN WORDS — "<Name> is dead" or "dies" must appear"; before the change Terra invented a rescue or revival in 4 of 5 death terminals, after it in 0.

**Reading.** The dying beat is the clean win: with the tally on the PLAYER line and the over-the-body ending, both DMs play the round around the fallen hero and Terra names the clock every time. The death terminal needed a second sentence — "narrate the death plainly" was not enough against the genre's own reflex to fade out; demanding the words themselves is what moved it, and the rescue/revival invention (Terra's 4 of 5 before) is gone on both. The judge's `ends_combat` column is informational on the terminal (the fight SHOULD end there); `names_count` on the terminal was not asked for by the prompt and is not scored.

## Run 1 — both scenarios, before / after the change

Proof step for "the count is on the page" (WOW 2026-09-30, death-and-stakes W1). Two committed exchange results — a DYING round (1 success / 2 failures) and the DEATH terminal — narrated 5× per provider per variant through the real narration-only prompt. BEFORE = the pre-change prompt (HP-only PLAYER line, "narrate the danger briefly", "setback or collapse", bare "natural N." lines); AFTER = the shipped prompt (PLAYER DYING with the tally, the over-the-body ending, the DIED terminal, the countdown line). Judge: `gemini-3.7-flash`, thinking-free, JSON-only, temperature 0. DYING pass = names the count OR the party acts over the body, AND does not end combat, AND invents no attack. DEATH pass = says the hero died AND adds no rescue / revival.

| Provider | Variant | Scenario | Scored | Pass ↑ | Names count | Party over body | Ends combat ↓ | Invents attack ↓ | Says died | Rescue/revival ↓ | Median words |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini | before | dying-round | 5 | 80% | 0% | 80% | 0% | 0% | 0% | 0% | 133 |
| gemini | before | death-terminal | 5 | 0% | 0% | 80% | 40% | 20% | 0% | 20% | 155 |
| gemini | after | dying-round | 5 | 100% | 80% | 100% | 0% | 0% | 0% | 0% | 144 |
| gemini | after | death-terminal | 5 | 60% | 0% | 60% | 100% | 20% | 60% | 0% | 151 |
| openai | before | dying-round | 5 | 60% | 0% | 60% | 0% | 0% | 0% | 0% | 65 |
| openai | before | death-terminal | 5 | 0% | 0% | 100% | 20% | 0% | 0% | 80% | 101 |
| openai | after | dying-round | 5 | 100% | 100% | 100% | 0% | 0% | 0% | 0% | 78 |
| openai | after | death-terminal | 5 | 40% | 0% | 80% | 40% | 0% | 40% | 0% | 100 |

## Narrations

### gemini · before · dying-round · run 1
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Torvald steps over the hero to shield them, but the specific death save count is omitted."}

> The world recedes into a cold, suffocating dark. The wet chill of the pier boards seeps into your skin, and your breaths turn terrifyingly ragged. The pain of the arrow is fading into a dangerous, heavy numbness as life slips further through your fingers. 
> 
> Above your fading consciousness, the violent rhythm of the fight rages on. The heavy thud of Torvald’s boots shakes the wood as he steps squarely over your fallen body. He roars, bringing his sword down in a brutal, desperate arc that bites deep into the limping cutter. The goblin collapses into a lifeless, bleeding heap at your side. 
> 
> An instant later, another black-fletched arrow streaks from the barrels, hissing through the air to splinter into the planks mere inches from Torvald’s leg. The archer curses, scrambling to nock another shaft as Torvald stands between you and the barrage. 
> 
> The blackness is pulling you under. What do you do?

### gemini · before · dying-round · run 2
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Torvald shields the fallen hero while the death-save tally goes unmentioned."}

> The cold, wet wood of the pier presses against your cheek as the world bleeds away into a roaring dark. A terrible, bone-deep numbness spreads from the arrow in your chest, dragging you further down into the black.
> 
> Above your fading consciousness, the fight rages on. Torvald roars, stepping fiercely over your fallen body to shield you. His longsword flashes in the dim light, coming down in a brutal, desperate arc that catches the limping cutter across the ribs. The goblin crumples instantly, slumping lifelessly onto the slick boards. A heartbeat later, an arrow splinters the planks mere inches from Torvald's boot as the panicked archer fires from behind the barrels, struggling to find its mark against the seasoned guard. 
> 
> The shouts and the clash of steel grow muffled as your pulse thins. What do you do?

### gemini · before · dying-round · run 3
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Torvald defends the body, but the death-save tally is omitted and the hero is dead."}

> The world shrinks to the wet slap of the pier boards and the thick, copper taste of your own blood. The burning pain beneath your collarbone dulls into a heavy, dragging numbness, pulling you deeper into the suffocating dark. You are slipping away.
> 
> Through the fading haze, the sounds of violence are muffled. Torvald roars, planting himself directly over your fallen body. You hear the wet crunch of his longsword biting deep into flesh and bone, followed by the heavy thud of the limping cutter collapsing lifeless onto the planks beside you. 
> 
> A heartbeat later, a black-fletched arrow streaks from the barrels, splintering violently into the wood just inches from Torvald’s leg as he holds the line to protect you. The cold is creeping up your limbs. What do you do?

### gemini · before · dying-round · run 4
Judge: {"names_count":false,"party_over_body":false,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Captures the sensory experience of fading out well, though it misses tracking the death-save tally."}

> The cold of the sea-slicked planks seeps into your cheek, but the sensation is rapidly fading. A heavy, suffocating darkness drags you downward, turning the sounds of the skirmish muddy and distant. Through the encroaching haze, the heavy thud of Torvald’s boots vibrates against the wood. You hear a sharp, wet crunch as his longsword bites deep into flesh and bone; the limping cutter gurgles a final, choking breath and collapses into a lifeless heap mere inches from your outstretched fingers. 
> 
> Immediately after, the vicious hiss of an arrow tears the air. It buries itself into the pier with a violent, splintering thwack just past Torvald's shoulder, missing him by a hair. The archer is still up there among the barrels, and you are bleeding out on the boards. What do you do?

### gemini · before · dying-round · run 5
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Good description of Torvald protecting the fallen hero, but misses explicit tracking of the death save count."}

> Cold spreads outward from the arrow lodged near your collarbone, dragging you deeper into a suffocating, heavy dark. You can't draw breath; the damp sea air tastes only of copper as your body fails to rally against the shock. 
> 
> Dimly, through the ringing in your ears, you hear Torvald roar. The sickening crunch of steel finding bone reverberates through the pier boards as his longsword bites deep into the limping cutter, dropping the goblin lifeless to the wood. An instant later, a black-fletched arrow splinters the planks mere inches from Torvald's boot—the archer firing wildly from behind the barrels, desperate to keep the furious man at bay.
> 
> Torvald plants himself squarely over your bleeding, unresponsive body, his weapon raised toward the barrels. The shadows are pulling you under.

### gemini · before · death-terminal · run 1
Judge: {"names_count":false,"party_over_body":true,"ends_combat":true,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"The text relies on euphemistic fading to black rather than explicitly stating death occurred."}

> The searing agony of the arrow in your collarbone suddenly turns to ice. You try to drag in a breath, but your chest refuses to rise. A thick, hot copper warmth floods the back of your throat. 
> 
> Through the shrinking, blurred tunnel of your vision, you see Torvald step over your fallen body. He swings his longsword in a desperate arc, the blade biting deep into the archer by the barrels. The goblin shrieks, its chest laid open in a wet spray of crimson, but it stubbornly manages to stay on its feet, reeling and clutching the gushing wound. 
> 
> The sounds of the seaward pier—the crashing waves, Torvald's ragged shouting, the scrape of boots on wet boards—warp and fade into a dull, distant hum. The cold, brine-soaked wood presses against your cheek, and the pain finally slips away as your body gives out. Your eyes roll back, and a heavy, absolute blackness swallows you whole.

### gemini · before · death-terminal · run 2
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Fails to state death explicitly and erroneously implies survival with 'you will feel in the muscle and bone long after today'."}

> The damp wood of the pier presses against your cheek as the cold rushes in. You try to draw a breath, but the arrow lodged beneath your collarbone radiates a fierce, tearing agony—a deep wound you will feel in the muscle and bone long after today. 
> 
> As your vision narrows to a dark pinprick, you catch a final, blurry glimpse of Torvald stepping protectively over your fallen body. He roars in defiance, his longsword flashing out to bite viciously into the goblin archer. The creature shrieks as dark blood sprays across the stacked barrels, though it manages to keep its feet. Nearby, the bleeding cutter finally crumples against the planks, moving no more.
> 
> But you cannot hold on to see the fight's end. Torvald’s desperate shouts fade into a dull, echoing rush of the tide. The scent of sea salt and your own blood dissolves into nothing as the heavy darkness rises up, swallowing you whole.

### gemini · before · death-terminal · run 3
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Uses euphemisms like 'succumb to the void' rather than explicitly stating death."}

> The splintered wood of the pier presses hard against your cheek as a deep, suffocating cold rushes in, turning the agonizing fire in your collarbone into a heavy numbness. Above your fading vision, the limping cutter finally succumbs to its earlier wounds, pitching forward to lie motionless across the damp boards. 
> 
> Torvald’s boots hammer the planks as he steps over you, roaring in defiance. His longsword carves a brutal arc that bites deep into the archer by the barrels, drawing a violent spray of dark blood. The goblin shrieks, badly wounded but still standing, clutching its bow with trembling hands. 
> 
> But the sounds of the desperate struggle are already growing hollow to your ears. The breath catches and stops in your throat. The encroaching darkness pulls you under, completely drowning out Torvald's ragged shouts as the world slips away and you succumb to the void.

### gemini · before · death-terminal · run 4
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":true,"notes":"Narrates mere unconsciousness and potential survival instead of confirming the hero's actual death on the third failed save."}

> The cold of the seaward pier seeps into your bones as your vision narrows to a pinprick. The arrow lodged deep beneath your collarbone pulses with a sickening, hot agony—a devastating wound that will burn with every breath tomorrow, should you live to see the sunrise. 
> 
> Above you, Torvald roars in desperate defiance. Battered, bleeding, and driven to his limits, he steps squarely over your fallen body to shield you. His longsword flashes in a heavy arc, biting deep into the archer and driving the screeching, bloodied goblin back into the stacked barrels. Beside them, the wounded cutter finally succumbs to its own injuries, slumping motionless against the slick wooden pilings. 
> 
> But the world is already spinning away from you. Torvald's furious shouts and the rhythmic crash of the dark surf become a distant, muffled echo. You cannot hold on. The blackness rushes in, thick and absolute, pulling you under. You slip into total unconsciousness, leaving your bleeding companion to make a final, desperate stand over your helpless form.

### gemini · before · death-terminal · run 5
Judge: {"names_count":false,"party_over_body":false,"ends_combat":true,"invents_attack":true,"says_died":false,"rescue_or_revival":false,"notes":"Invents an attack/kill on a 'cutter' not in the log, and relies on euphemisms rather than plainly stating the hero is dead."}

> The cold salt breeze fades as your vision tunnels. You try to draw breath, but the arrow lodged beneath your collarbone denies it, sending a final, numbing shockwave through your chest. Your grip on the pier's slick boards goes completely slack. 
> 
> Above you, Torvald roars in desperate fury. His longsword arcs down in a brutal sweep, putting the limping cutter down for good on the bloodstained wood, before his backswing bites deep into the archer by the barrels. The archer shrieks, reeling from the heavy blow, but manages to keep its feet. 
> 
> That shriek is the last thing you hear. Torvald shouts your name, his voice cracking with panic, before the encroaching darkness rises up and swallows you whole.

### gemini · after · dying-round · run 1
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Torvald stands over the dying hero and kills the cutter, but the 2/3 death save count is omitted."}

> The world fades to a cold, crushing blackness, your pulse faltering as the breath rattles in your chest. You are slipping further into the dark, the burning pain of the arrow wound giving way to a terrible, numbing stillness. 
> 
> Through the drowning haze, the heavy thud of boots vibrates against your cheek. Torvald steps over your fallen body with a ragged shout, bringing his longsword down in a desperate arc that drops the limping cutter dead to the blood-slicked boards. From the cover of the barrels, the remaining archer snaps a retaliatory shot at him, but the black-fletched arrow merely splinters against the pier by Torvald's heel. The cold is pulling you under, leaving Torvald standing alone over your dying form. What do you do?

### gemini · after · dying-round · run 2
Judge: {"names_count":true,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Accurately reflects the high-stakes 2-failure death save state while Torvald defends the fallen hero."}

> Darkness pulls at you, deep and freezing. The sharp agony in your collarbone dulls into a heavy, suffocating numbness as your breathing falters. Your pulse flutters weakly against the edge of the abyss, struggling to push blood through your veins. One more slip, one more missed heartbeat, and you will not wake up. 
> 
> Above your motionless body, Torvald roars. As the limping cutter lunges in to finish you, your companion steps into the gap, bringing his longsword around in a desperate, brutal arc. The blade catches the goblin hard, and it crumples dead against the blood-slicked boards. 
> 
> From the cover of the barrels, the archer snaps a hurried shot at the warrior. The arrow goes wide, whistling past Torvald's ear to bury itself deep in the pier's timbers. Torvald plants his boots firmly over you, his shield raised, guarding your fading life as the archer scrambles to draw another shaft.

### gemini · after · dying-round · run 3
Judge: {"names_count":true,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Excellent narration clearly tracking the death save stakes while placing Torvald directly over the body."}

> The blackness swallows the pain, dragging you violently under. You cannot feel your hands anymore; the slick, wet cold of the salt-stained pier is fading, your heartbeat stuttering as the blood leaves you. You are on the very edge of the void, one shallow breath away from never waking up. 
> 
> Through the suffocating dark, muffled by the ringing in your ears, you hear Torvald scream your name. His heavy boots slam into the boards beside your head. There is the brutal, wet crunch of steel cleaving bone—Torvald's longsword biting deep into the limping cutter, dropping the goblin lifeless onto the planks mere inches from your outstretched fingers. 
> 
> A split second later, a black-fletched arrow splinters against the wood right above you, narrowly missing Torvald as he deliberately plants himself over your bleeding body to shield you from the archer. 
> 
> Torvald is holding the line, but you are bleeding out into the salt-sprayed wood. The dark is closing in.

### gemini · after · dying-round · run 4
Judge: {"names_count":true,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Accurately reflects the death save clock stakes and Torvald standing over the hero's body."}

> You feel nothing of the damp wood beneath you, only a terrible, creeping cold dragging you down into the dark. Your breath hitches, shallow and failing—the pulse in your throat slowing to a perilous crawl as your life bleeds out onto the pier. You are slipping away.
> 
> Above you, Torvald roars in sheer desperation. He plants his boots on either side of your limp body and brings his longsword down in a savage, sweeping arc. The blade catches the limping cutter across the chest, and the goblin crumples to the blood-slicked boards, moving no more. 
> 
> A heartbeat later, an arrow splinters the wood inches from Torvald's knee as the archer fires blindly from the barrels. The surviving goblin scrambles to nock another shaft, eyes darting between the furious warrior and your motionless form. You are one heartbeat away from the end; what happens next?

### gemini · after · dying-round · run 5
Judge: {"names_count":true,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Accurately conveys the high-stakes 2-failure clock while Torvald defends the fallen hero."}

> The cold seeps into your bones as darkness swallows your vision. Your breath hitches into a wet, rattling gasp, blood pooling wide and dark across the uneven pier boards. You are slipping away, teetering on the absolute edge of the void—one more faltering heartbeat away from death.
> 
> Above your unseeing form, Torvald steps into the breach with a desperate roar. He brings his longsword down in a vicious arc, catching the limping cutter across the chest before its dirty blade can reach you, and the goblin crumples into a lifeless heap. An instant later, an arrow shrieks just past Torvald's ear, splintering into the wood behind him as the archer on the barrels tries to pick him off. Torvald stands alone over your bleeding body, breathing hard. What do you do?

### gemini · after · death-terminal · run 1
Judge: {"names_count":false,"party_over_body":true,"ends_combat":true,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Narrates the finality of the PC's demise poetically but avoids using explicit death wording or tracking the 3rd failed save count."}

> The cold, wet planks of the seaward pier press against your cheek, thick with the smell of brine and your own pooling blood. The terrible, burning agony beneath your collarbone gives way to a creeping, heavy numbness. You can hear Torvald screaming your name above the frantic clash of steel, his heavy boots pounding the wood as he lunges past your fallen body. He drives his longsword into the goblin archer, biting deep into its shoulder with a desperate, wet crunch. The archer staggers, bleeding heavily but still standing, while the cutter lies completely motionless on the slick boards nearby. 
> 
> But the sights and sounds of the pier are already pulling away from you. The frantic rhythm of your heart stutters in your chest, fighting for a beat that never comes. The salt-heavy air refuses to fill your lungs. The grey sky above Saltmere dims to a pinprick, and then to nothing at all. Your breath stops. Your limbs go entirely still, and your eyes glaze over, fixed blindly on the churning clouds. 
> 
> Torvald bleeds, fighting on alone over your body, but you do not hear his grief or the clash of his blade. The pain is gone. Your story ends here.

### gemini · after · death-terminal · run 2
Judge: {"names_count":false,"party_over_body":false,"ends_combat":true,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Uses euphemistic fade-to-black phrasing ('Your story ends here') rather than plainly stating the hero has died, and omits the save count."}

> The cold, brine-soaked wood of the pier presses against your cheek, slick with your own blood. Above you, Torvald—bleeding, battered, and exhausted—roars in defiance. His longsword arcs heavily into the goblin archer's shoulder, biting deep and staggering the creature, while the cutter lies motionless nearby, finally bleeding out from its ruined thigh.
> 
> But the victory, if it comes, will not be yours to see. The arrow beneath your collarbone has done its work. A sudden, terrifying cold spreads from your chest, heavy and absolute, dragging you down. You try to draw one last breath of the salty sea air, but your lungs refuse. 
> 
> The clash of steel and Torvald’s desperate voice calling your name grow distant, echoing into nothing. The darkness takes you entirely. Your story ends here on the wet boards of Saltmere.

### gemini · after · death-terminal · run 3
Judge: {"names_count":false,"party_over_body":false,"ends_combat":true,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Clearly and plainly states that the hero is dead as combat concludes."}

> The cold comes fast. Lying against the wet, salt-rimed wood of the pier, the burning agony of the arrow beneath your collarbone gives way to a heavy, creeping numbness. Above you, the world blurs into a chaotic smear of motion and noise. Torvald lunges past your fallen body with a ragged, desperate shout, his longsword biting deep into the goblin archer. The creature shrieks, blood spilling down its side, but it keeps its footing. Beside you, the wounded cutter finally slumps against the crates, its previous injuries overtaking it as it bleeds out lifelessly onto the boards.
> 
> Torvald turns. He is bleeding, exhausted, and when his eyes find you, his expression shatters. He screams your name, but the sound is already distant, swallowed by a rushing tide in your ears. Your lungs draw one last, shallow rattle of air that tastes of brine and copper. The grey sky above Saltmere narrows, fades, and then goes entirely black.
> 
> You are dead. Your story ends here.

### gemini · after · death-terminal · run 4
Judge: {"names_count":false,"party_over_body":true,"ends_combat":true,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Accurately conveys the character's death while naturally incorporating Torvald standing over the body to attack."}

> The cold, salt-stinging wind off the waves sweeps over the pier, but you can no longer feel it. The burning agony of the arrow beneath your collarbone fades into a heavy, pulling numbness. Through your dimming vision, you see Torvald step over you with a desperate roar. His longsword arcs down, biting deeply into the goblin archer behind the barrels and drawing a wet spray of dark blood, but the creature shrieks and keeps its feet, eyes wide and frantic. 
> 
> You do not hear its scream. The clash of steel and the cries of the gulls thin out, replaced by a rushing silence. The blood spreading from your chest sinks into the rotting wood of the pier, the final cost of this fight. Your lungs empty and do not fill again; the light in your eyes extinguishes entirely. Torvald is left bleeding and alone over your lifeless body. 
> 
> You are dead.

### gemini · after · death-terminal · run 5
Judge: {"names_count":false,"party_over_body":true,"ends_combat":true,"invents_attack":true,"says_died":true,"rescue_or_revival":false,"notes":"The narration inventively kills off an unmentioned 'cutter' while narrating Astra's definitive death."}

> The cold of the brine-soaked boards seeps into your bones, deeper than the throbbing agony of the arrow in your chest. Above you, Torvald roars. You catch a fading, fragmented glimpse of his longsword biting brutally into the archer's shoulder, sending a spray of dark blood into the salt air. The cutter collapses beside you, succumbing to its own wounds, its blade clattering uselessly against the wood. 
> 
> But the clash of steel and Torvald's frantic, ragged breaths grow distant. The scent of sea-salt and copper thins to nothing. The darkness at the edges of your vision rushes inward, absolute and cold. Your breath rattles once, a shallow, broken gasp, and then stops entirely.
> 
> Torvald stands battered and bleeding over your motionless body, but you are beyond his reach. The light leaves your eyes. Astra, your story ends here, bleeding out on the wet planks of the seaward pier.

### openai · before · dying-round · run 1
Judge: {"names_count":false,"party_over_body":false,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Narrates the ongoing fight and the worsening condition without tracking the death save clock explicitly."}

> The blackness tightens rather than lifts; Astra’s breath comes shallow against the wet pier boards.
> 
> Torvald catches the cutter’s low rush on his longsword and drives the man down hard beside the salt-stained pilings. An arrow snaps past Torvald’s ear and buries itself quivering in a tarred rope coil. Across the pier, the goblin archer remains behind the barrels, bow already drawn again.

### openai · before · dying-round · run 2
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Accurately depicts the ongoing combat and Torvald shielding the fallen ally, but misses tracking the lethal third death-save failure."}

> Astra’s breath catches wetly, then thins to almost nothing against the salt-stained planks.
> 
> Torvald’s sword opens the cutter from hip to ribs and drops it hard among the coils of rope. The archer’s next shaft snaps against a bollard beside him, spraying pale splinters across his boots. Torvald squares himself between Astra’s still body and the barrels, blade raised toward the remaining goblin.

### openai · before · dying-round · run 3
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"The prose fails to convey that the third failure resulted in death."}

> Astra’s ragged breath fails to find rhythm; the black water beyond the pilings seems closer than the voices above. Torvald’s sword bites through the cutter’s final rush, putting the goblin down hard across the wet boards, then an arrow snaps past Torvald’s shoulder and buries itself in a tar-black post.
> 
> The remaining archer keeps its distance by the barrels, bow already lifting again while Torvald stands between it and Astra.

### openai · before · dying-round · run 4
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"The narration misses the lethal third death-save failure entirely, treating the fallen hero as merely unconscious."}

> Torvald’s sword bites deep into the cutter’s side, dropping the goblin hard onto the wet planks beside Astra. He wheels at once, boots skidding through fish-slime and blood, just as the archer’s next shaft snaps against a pier post instead of finding his ribs.
> 
> Astra lies motionless at the edge of the seaward pier while the lone goblin archer keeps its distance among the stacked barrels, bow already rising again. Torvald plants himself between the bow and Astra, blade lifted.

### openai · before · dying-round · run 5
Judge: {"names_count":false,"party_over_body":false,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"The narration misses that the failed death save marks the hero's death."}

> Torvald’s sword bites hard into the cutter’s side, dropping the goblin in a heap against the tar-black boards. An arrow hisses past Torvald’s shoulder and smacks into a piling, its shaft quivering above the wash.
> 
> Astra does not stir. Blood darkens the seams between the pier planks while the surviving archer stays behind the barrels, bow still in hand and a fresh arrow already drawn.

### openai · before · death-terminal · run 1
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":true,"notes":"Fails to state the hero is dead, hinting at possible waking while the surviving enemy still weighs fighting."}

> Torvald’s answering stroke opens the archer’s shoulder, driving the goblin back against the tar-black barrels with its bow clattering loose but not out of reach. The cutter lies facedown beside the salt-stained planks, its knife half under one hand.
> 
> Astra’s body gives no further answer. The arrow wound beneath the collarbone has gone cold and stubborn, a deep ache waiting for any waking that may come; Torvald, limping and bloodied himself, drops beside them with one hand pressed hard to the wound. Across the pier, the surviving archer stares at him through its pain, weighing flight against one last chance.

### openai · before · death-terminal · run 2
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":true,"notes":"Fails to confirm the hero's death and implies they might survive to tomorrow despite the final failed death save."}

> Torvald’s sword bites into the archer’s side, nearly folding the small figure over the barrel-stack; it stays on its feet, clutching the wound and staring at him with naked calculation. The cutter lies crumpled on the wet boards, its blade skittered beneath a coil of tar-black rope.
> 
> Astra does not rise. Blood has soaked the shoulder of their coat around the arrow wound beneath the collarbone—a deep, punishing hurt that will make every breath and lifted arm costly if they live to feel tomorrow. Torvald, battered and breathing hard, plants himself between Astra and the surviving goblin as the tide knocks softly against the pier pilings.

### openai · before · death-terminal · run 3
Judge: {"names_count":false,"party_over_body":true,"ends_combat":true,"invents_attack":false,"says_died":false,"rescue_or_revival":true,"notes":"Narrates Astra surviving to regain consciousness despite failing the final death save and dying."}

> Torvald’s answering stroke bites into the archer’s side, driving the goblin back against the fish-barrels with a sharp, wet gasp. The cutter lies crumpled in the black runoff between the pier planks, but Astra does not rise; the arrow wound beneath the collarbone has taken too much, and each shallow breath pulls at it like a hooked line.
> 
> Torvald drops to one knee beside Astra, blood dark on his own sleeve, while the wounded archer keeps its distance with its bow still in hand. The pier smells of salt, tar, and fresh blood. Astra’s fight has ended here—for now—and the shoulder wound will leave its hard lesson when consciousness returns.

### openai · before · death-terminal · run 4
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"The narration fails to state that the hero has died, treating them as still breathing."}

> The cutter lies crumpled among the wet ropes, its blade skittered beneath a bollard. A hard strike catches the archer and tears through its shoulder; it reels against the barrels, still upright, one hand clamped over the bleeding wound.
> 
> But Astra does not rise. The arrow wound beneath the collarbone has soaked the front of their clothes dark, and each breath comes thin against the salt-stinking boards. Torvald, blood running down one sleeve and limping badly, plants himself between Astra and the remaining goblin with his sword raised.
> 
> The archer watches him from behind the barrels—hurt, frightened, and very much alive.

### openai · before · death-terminal · run 5
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":true,"notes":"Fails to state the hero died, implying survival with future aching, and does not end combat."}

> Astra’s last thread of resistance frays in the salt wind; the arrow wound beneath the collarbone pulses darkly against wet cloth, a hurt that will ache long after the pier is left behind.
> 
> Torvald answers with steel. His blade opens the goblin archer across the side, forcing it back against the tar-black barrels with a thin, furious hiss. The cutter is down amid the fish scales and splintered boards, but Torvald remains on his feet—blood on his sleeve, sword raised between Astra and the surviving archer.

### openai · after · dying-round · run 1
Judge: {"names_count":true,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Accurately depicts the death-save clock and Torvald stepping over Astra."}

> Torvald’s sword cuts the goblin cutter down beside Astra, leaving its hooked blade skittering across the wet planks. He turns in time for the archer’s next shaft to snap against a pier-post by his shoulder, close enough to shower him with pale splinters.
> 
> Astra does not stir. Blood darkens the grain of the boards beneath them; two failed turns against death now stand between them and the end, and the next failure will be final. Torvald plants himself over Astra’s body, blade raised toward the goblin among the barrels.

### openai · after · dying-round · run 2
Judge: {"names_count":true,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Accurately reflects the death save state and Torvald defending the fallen hero without ending combat."}

> Torvald’s sword catches the cutter across the ribs and drops it hard among the wet ropes, its knife skittering between the pier boards. He plants himself over Astra’s motionless body, shoulders squared beneath his battered mail.
> 
> From behind the barrels, the goblin’s next shaft snaps against a piling instead of finding him. Torvald glances down only once—long enough to see the shallow, failing rhythm of Astra’s breath—then fixes his eyes on the archer. One more lost struggle against death will be the last.

### openai · after · dying-round · run 3
Judge: {"names_count":true,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Accurately reflects the death save count, party member positioning, and ongoing combat."}

> Torvald’s sword drops the cutter hard onto the wet boards, ending its rush beside Astra’s sprawled body. The archer’s next shaft snaps against a pier post instead of finding Torvald; salt spray beads on the old timber around them.
> 
> Torvald plants himself over Astra, blood running down one sleeve, and turns his blade toward the lone archer. Astra does not stir. Two failures now stand between them and the end; the next failed breath will be the last.

### openai · after · dying-round · run 4
Judge: {"names_count":true,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Accurately reflects the stakes, keeps combat active, and shows Torvald protecting Astra."}

> Astra’s breath catches once, then thins to a wet, fragile thread—the kind that leaves no room for another bad turn. Torvald answers with steel, cutting the goblin cutter down onto the salt-slick planks; it lies crumpled and alive but no longer fighting.
> 
> The archer’s next shaft snaps against a pier post beside Torvald’s shoulder. He plants himself over Astra’s motionless body, sword raised toward the barrels, knowing exactly how little separates this from an ending.

### openai · after · dying-round · run 5
Judge: {"names_count":true,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Accurately reflects the death count threshold and Torvald standing over Astra while combat continues."}

> Torvald’s sword finds the cutter at last, dropping the goblin hard across the wet planks beside Astra. He wheels back toward the barrels just as the archer’s next shaft skims past his shoulder and snaps against a salt-crusted piling.
> 
> Astra does not stir. Blood darkens the boards beneath them; one more lost breath will be the last. Torvald plants himself over the fallen fighter, blade raised toward the archer’s cover.

### openai · after · death-terminal · run 1
Judge: {"names_count":false,"party_over_body":true,"ends_combat":true,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Torvald kneels by Astra as combat closes, but the narration relies on euphemisms rather than plainly stating Astra has died."}

> Torvald’s sword opens the archer’s shoulder and drives it reeling against the barrels, still upright, still clutching its bow. The cutter lies motionless in a darkening smear across the wet pier boards.
> 
> Beside them, Astra’s body gives no answering breath. The arrow’s wound beneath the collarbone—bitter, deep, and wet with blood—has taken everything it was going to take. Torvald drops to one knee at Astra’s side, his own torn shoulder sagging beneath a split shirt, and stares at the still face in stunned silence as gulls wheel above Saltmere’s black water.

### openai · after · death-terminal · run 2
Judge: {"names_count":false,"party_over_body":true,"ends_combat":true,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Accurately conveys Astra's death and Torvald kneeling beside them as the scene closes."}

> Torvald’s sword catches the archer across the ribs, opening a dark slash through its patched leather. The goblin staggers against the barrels but stays on its feet, bow still clenched in its small hand. The cutter lies crumpled in the salt-wet boards nearby.
> 
> Astra’s breath does not return. The blood beneath their collarbone spreads slowly into the seams of the pier, black in the lantern light. Torvald drops beside them, one hand hovering uselessly over the wound before settling against Astra’s shoulder. His own cut thigh shakes beneath him; it will ache with every step tomorrow, if he gets that far.
> 
> The sea keeps striking the pilings below. Astra is dead.

### openai · after · death-terminal · run 3
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Describes the final breath stopping without explicitly using the word dead, while keeping combat active."}

> The goblin cutter lies sprawled across the wet boards, its knife fallen from its hand. Torvald’s sword catches the archer across the ribs, driving the creature back against the stacked barrels; it stays upright, one hand clamped over the bleeding cut, eyes wide and feral.
> 
> Astra’s breath comes once, thinly, around the arrow wound beneath the collarbone—then does not come again. The salt wind worries at loose hair and blood-dark cloth. Torvald remains standing, bruised and bleeding from the shoulder, staring down at the companion he could not save while the surviving archer watches from the barrels.

### openai · after · death-terminal · run 4
Judge: {"names_count":false,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":false,"rescue_or_revival":false,"notes":"Narrates the final breath and look down at the fallen hero, but omits the explicit death statement and count."}

> Torvald’s blade catches the archer across the ribs, folding the goblin over its barrel without quite taking it from the fight. The cutter lies crumpled on the wet pier boards, beaten down but still breathing; seawater darkens the gaps between the planks.
> 
> Astra’s breathing stops. No hand reaches for the wound again, no stubborn breath follows the last. The arrow beneath the collarbone has taken its due.
> 
> Torvald remains standing only by force of will, one hand pressed hard to the wound in his side, his sword red to the guard. He looks down at Astra for one long, wrecked moment while the bloodied archer fumbles for another shot.

### openai · after · death-terminal · run 5
Judge: {"names_count":false,"party_over_body":false,"ends_combat":false,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Clearly confirms Astra's death while leaving the surviving companion facing the remaining goblin."}

> Torvald’s sword catches the goblin archer across the side, opening a dark line through its filthy leathers and driving it back against the salt-stained barrels. The cutter lies sprawled on the wet pier boards, its blade fallen from its hand; beyond it, black water knocks patiently against the pilings.
> 
> Astra does not rise. Blood has soaked through the wound beneath the collarbone, and after one final, shallow failure of breath, the body goes still. Torvald remains on his feet, wounded and alone, staring between the fallen fighter and the archer still clutching its bow. The fight has taken Astra’s life.

## Run 2 — the death terminal after the "SAY IT IN PLAIN WORDS" sentence

Proof step for "the count is on the page" (WOW 2026-09-30, death-and-stakes W1). Two committed exchange results — a DYING round (1 success / 2 failures) and the DEATH terminal — narrated 5× per provider per variant through the real narration-only prompt. BEFORE = the pre-change prompt (HP-only PLAYER line, "narrate the danger briefly", "setback or collapse", bare "natural N." lines); AFTER = the shipped prompt (PLAYER DYING with the tally, the over-the-body ending, the DIED terminal, the countdown line). Judge: `gemini-3.7-flash`, thinking-free, JSON-only, temperature 0. DYING pass = names the count OR the party acts over the body, AND does not end combat, AND invents no attack. DEATH pass = says the hero died AND adds no rescue / revival.

| Provider | Variant | Scenario | Scored | Pass ↑ | Names count | Party over body | Ends combat ↓ | Invents attack ↓ | Says died | Rescue/revival ↓ | Median words |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini | after | death-terminal | 5 | 100% | 80% | 100% | 80% | 20% | 100% | 0% | 147 |
| openai | after | death-terminal | 5 | 100% | 100% | 60% | 80% | 0% | 100% | 0% | 96 |

## Narrations

### gemini · after · death-terminal · run 1
Judge: {"names_count":true,"party_over_body":true,"ends_combat":true,"invents_attack":true,"says_died":true,"rescue_or_revival":false,"notes":"Accurately conveys Astra's death and count, but invents the death of another enemy ('the cutter') not in the resolved events."}

> The cold of the salt-slicked pier seeps into your bones as the world narrows to a pinprick. Three times your body fights to pull air past the arrow lodged deep beneath your collarbone, and three times it fails. The dark takes you completely. Astra dies.
> 
> Above your still form, Torvald roars in grief and fury. His longsword arcs in a desperate, sweeping blow that slashes deeply into the archer, driving the bleeding goblin stumbling back against the barrels. The cutter, its thigh ruined from the earlier clash, finally gives out, bleeding its last over the wet boards before crumpling motionless. 
> 
> The battle still rings over the water, Torvald standing battered and bleeding over your lifeless body, his breath ragged in the sea air. But for you, the cost has been paid in full. The story ends here.

### gemini · after · death-terminal · run 2
Judge: {"names_count":true,"party_over_body":true,"ends_combat":true,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Clear and faithful narration acknowledging the third failed save, death, and scene conclusion."}

> The cold seeps into your bones, drowning out the shouting and the clash of steel. The bleeding from the arrow beneath your collarbone is simply too much. As the darkness swallows your vision, your breathing stops on the damp boards of the Saltmere pier. The third failed death save is your last; Astra is dead.
> 
> Torvald roars in raw, throat-tearing grief. He surges past your lifeless body and brings his longsword down in a desperate, sweeping arc, carving a deep, bloody gash across the goblin archer's chest. The archer staggers back, grievously wounded but still standing, while the limping cutter finally succumbs to its own injuries, collapsing dead against the crates. 
> 
> The skirmish lasted four brutal rounds, and the cost is absolute. Torvald stands battered and bleeding heavily from his own wounds, his chest heaving as he stares down at your still form. Your story ends here.

### gemini · after · death-terminal · run 3
Judge: {"names_count":true,"party_over_body":true,"ends_combat":true,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Clear death narration correctly tracking the third failure and companion shielding the body."}

> The cold, salt-slicked wood of the pier presses against your cheek as the world dims to a narrow, gray tunnel. Above you, Torvald roars, stepping fiercely over your fallen form. His longsword arcs down in a desperate blur, biting deeply into the goblin archer and driving the bleeding creature back against the stacked barrels. 
> 
> You try to draw a breath, to reach for the arrow shaft jutting from beneath your collarbone, but your strength is completely gone. A third and final shudder wracks your frame as the blood loss overwhelms you, and the sounds of Torvald's frantic fight fade into nothing. Your chest stops moving; your eyes stare unblinking at the overcast sky. Astra is dead. The short, brutal skirmish leaves Torvald battered and bleeding on the docks, alone with the heavy cost of your final stand.

### gemini · after · death-terminal · run 4
Judge: {"names_count":true,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Clear and accurate narration of the hero's death and the final death save tally."}

> The cold of the salt-slicked pier seeps into your bones, heavier than the burning ache of the arrow buried beneath your collarbone. Above you, the desperate clash of steel rings out as Torvald steps over your fallen form. With a guttural roar, he lunges and drives his longsword into the goblin archer, opening a wet, ragged gash across the creature's chest. The archer shrieks and staggers back against the barrels, bleeding heavily, but manages to keep its feet.
> 
> You try to draw a breath, to move, to cling to the fading edges of the world, but your lungs refuse to expand. The fight above you muffles into a distant, hollow echo. Your body struggles blindly against the encroaching dark, but the damage is too severe. Three failed saving throws. The frantic pounding in your chest slows to a sluggish, halting rhythm, and then simply stops. The scent of salt and copper fades into a cold, heavy silence. 
> 
> Astra is dead.

### gemini · after · death-terminal · run 5
Judge: {"names_count":false,"party_over_body":true,"ends_combat":true,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Clearly and definitively narrates Astra's death following the final failed save while Torvald defends the body."}

> Torvald roars your name, stepping fiercely over your fallen body. He swings his longsword in a desperate arc, the blade biting deep into the goblin archer's shoulder. The creature shrieks, spraying dark blood across the barrels, but it stubbornly keeps its footing. Nearby, the cutter lies in a broken, bleeding heap on the salt-slicked wood, finally still. 
> 
> But you do not see the end of the fight. The clash of steel and the crashing waves of Saltmere fade into a dull, rushing silence. The arrow beneath your collarbone has done its fatal work. You try one last time to draw breath, but the air refuses to come. The bitter cold of the wooden pier seeps into your bones, washing away the pain. 
> 
> Four brutal rounds of combat took their toll in spilled blood and broken steel. Torvald will carry the ache of his wounds and the heavy memory of this pier, but you have given everything. The light leaves your eyes, and your chest stops rising. Astra is dead. The sea wind blows over the docks, but your story ends here.

### openai · after · death-terminal · run 1
Judge: {"names_count":true,"party_over_body":false,"ends_combat":true,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Accurately narrates the third failure, Astra's death, and the remaining combatants."}

> Torvald’s sword catches the archer across the ribs, driving the small figure hard into the barrels; it stays upright, one hand clamped over the fresh wound, eyes bright with fear and hate. The cutter lies beaten on the wet pier boards, its blade skittered beyond its reach.
> 
> Beside them, Astra’s body does not rise. Three failed struggles against death have spent the last of that stubborn strength. Astra is dead.
> 
> Torvald remains standing only by leaning on his sword, his own wounds darkening his clothes as saltwater laps below the pier. The archer’s ragged breathing and the scrape of gull-feet on old planks are all that remain of the fight.

### openai · after · death-terminal · run 2
Judge: {"names_count":true,"party_over_body":false,"ends_combat":true,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Accurately narrates the third failure and Astra's death while concluding the scene."}

> Torvald’s sword catches the archer across the side, leaving the goblin reeling against the salt-stained barrels but still upright, bow clutched in shaking hands. The cutter is down among the wet planks, its knife skittered into a seam.
> 
> Beside them, Astra’s body no longer fights for breath. The third failed saving throw takes what the arrow began: **Astra dies** on Saltmere’s seaward pier, blood darkening the boards beneath the wound under the collarbone—a wound that would have ached with every breath tomorrow, had tomorrow been theirs.
> 
> Torvald remains standing, wounded and alone, with the surf knocking patiently against the pilings below.

### openai · after · death-terminal · run 3
Judge: {"names_count":true,"party_over_body":true,"ends_combat":true,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Accurately confirms Astra's death after three failed saves while narrating Torvald's hit and the close of the encounter."}

> Torvald’s blade catches the archer across the shoulder, cutting deep enough to stagger the goblin but not to put it down. The cutter lies beaten among the wet boards; the archer remains upright beyond the barrels, one hand clamped over its bleeding wound.
> 
> Astra’s body does not rise. Three failed struggles against death have spent the last of their mercy. Astra is dead.
> 
> Torvald remains on the pier with his own wounds burning beneath torn mail, looking down at the companion he could not save while the salt wind worries at the blood on the boards.

### openai · after · death-terminal · run 4
Judge: {"names_count":true,"party_over_body":true,"ends_combat":false,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Accurately narrates the third failure, explicitly declares Astra dead, and keeps the scene active with Torvald standing over the body."}

> Torvald’s answering cut opens the archer’s upper arm, but the goblin stays upright behind the barrels, bow still in hand and blood darkening its sleeve. The cutter lies spent on the planks beside Astra.
> 
> Astra’s body does not rise. The third failed saving throw takes what remained of their struggle; Astra is dead. Torvald stands over them with his own battered body aching from the fight, the salt wind worrying at torn cloth and spilled blood, while the surviving archer watches from cover.

### openai · after · death-terminal · run 5
Judge: {"names_count":true,"party_over_body":true,"ends_combat":true,"invents_attack":false,"says_died":true,"rescue_or_revival":false,"notes":"Accurately reflects the third failure and Astra's death while Torvald looks on."}

> Torvald’s sword catches the archer across the upper arm, sending it reeling against the salt-stained barrels with blood dark on its sleeve. The cutter lies crumpled on the pier boards, its blade out of reach, while the archer remains standing—hurt, but not finished.
> 
> Astra does not rise. The wound beneath the collarbone has emptied its warmth into the wet boards; after three failed saving throws, Astra dies. Torvald remains on his feet with his own cuts and bruises, staring down at the fallen fighter as gulls wheel above Saltmere’s seaward pier.
