# Quest Forge - Current Status

One-screen answer to "what's been in the works lately?" for any agent starting a fresh
session. **Update this at the end of any session that ships or decides something** —
replace stale entries, don't let it grow. For deeper history run `git log --oneline -20`
(this file was trimmed back to its one-screen contract on 2026-07-31; every prior entry
lives in git history and the settled outcomes in DECISIONS.md).

_Last updated: 2026-08-09 ×5 (three-P1 hardening batch, DECISIONS ×4: every non-streaming provider call now has an abort/retry stall guard (90s, machinery 60s, embedText 30s→null) and machinery extraction runs thinking-free with an 8k output cap; a declared weapon attack staged as a check is policy-rejected with a combat_start correction re-response; eventless narrated casts get the Scribe-audit backstop (`narrated_casts` → validated CAST_SPELL, ordinary out-of-combat turns only). Earlier today: Second Wind exchange lane + combat hero HUD, level-up resource refill, Arcane Recovery trap, pre-fight cast pairing. 1,530 tests green; deployed)._

## Codex retest of 6c8be23 processed 2026-08-09 (all priority targets PASS; 2 new P1s fixed)

The directed Codex playtest re-verified everything this week shipped: opening-scene
priming retry under StrictMode (exactly one AbortError → one silent retry → ONE opening,
reload-safe), the late-API-key trigger, wizard level 1→2 with spent slots preserved
(8→14 HP exactly once, slot table 2→3 without refill), Arcane Recovery via short rest,
post-defeat 1-HP stabilization + working rematch, same-scene identical-loot aggregation
(one x2 stack), and both coin/item recap guards (state unchanged across re-narration
turns). **Its two new P1s are fixed with tests:** (1) Arcane Recovery's generic "Use"
button consumed the once-per-long-rest charge with NO effect and locked out the real
short-rest recovery → passive resources (`passive` flag on the class def) now render
an "auto" tag instead of a button and ACTIVATE_RESOURCE refuses to spend them; (2)
"I cast Mage Armor" in the message that started the fight was narrated but never
evented, so the whole fight ran at AC 12 → the SPELLCASTING prompt now requires
`spell_cast` ALONGSIDE `combat_start` for pre-fight casts (the engine already applies
casts before initiative — ordering now pinned by an orchestrator test). Its two P2s
(Magic Missile dart splitting, NPC gender flip mid-scene — KNOWN NPCs header now marks
gender/pronouns never-changing) plus the eventless-narrated-cast backstop are in the
Open Findings Queue with attribution. Report file deleted after transcription, per the
standing dated-and-temporary convention.

## Codex parallel playtest P0 fixed 2026-08-09 (opening-scene priming stall)

Vesa accidentally ran a Codex playtest in parallel with playtest #8; its report
(`PLAYTEST_REPORT.md`, repo root, untracked — Vesa reviews/deletes) found a real P0:
fresh premise campaigns under `npm run dev` lose their DM opening permanently (StrictMode
double-mount cleanup aborts the priming call AFTER `openingScenePending` was consumed; no
retry, reload can't recover). Reproduced deterministically in isolation, fixed
(DECISIONS.md 2026-08-09: consume-on-commit via `getLastCommittedTurn`, bounded retries,
API-key-change trigger), verified live: abort → silent retry → exactly one opening. The
concurrent run itself was assessed clean otherwise — separate browser profiles/origins,
so no cross-contamination of saves; only the shared Gemini key and port 4173 overlapped.
Codex's remaining findings (Second Wind declared in chat not applied in the exchange,
attack staged as roleplay check until challenged, combat HUD missing hero HP, stale
journal entry, mobile drawer UX, ability-button aria) are transcribed into the Open
Findings Queue with attribution.

## Eighth live playtest 2026-08-08/09 (adversarial follow-up — hunting the #7 fixes' own blind spots)

Continued Maren into the lockbox, the wharf sale, a watchman fight (won), a guild-guard
fight (LOST — deliberately), and the capture arc. **P1 found live, fixed with tests
(DECISIONS.md 2026-08-09):** the Scribe audit re-grants already-applied loot when the NEXT
message re-narrates it — coins slipped the value ledger by drift (evented 7 gp, narrated
"5 gold and 12 silver" = 620 cp; watched +6g2s from nothing), items slipped because audit
ADD_ITEMs are meta-less by #7 design ("Missing ledger pages" ×2 in inventory). Fixes: audit
coin grants/payments get a cover rule (any recent larger applied non-same-base entry
suppresses) + the bundle strip (same-base excluded); scribe.js drops audit items the
`recentItemGrants` ledger shows applied within window. **Also fixed:** two identical
`items_found` entries in ONE response were eaten by the #7 ledger's exact-source guard →
applyEvents now aggregates them into one quantity-summed grant; item signatures went
identity-only (quantity drift = the coin denomination-drift twin); **post-defeat 0-HP
limbo** — the whole capture arc ran at 0 HP + Unconscious while the DM narrated her awake
and rolling checks (a stale lowLevelDefeat also means instant defeat in any new fight) →
the player's next out-of-combat action revives to 1 HP, clears the flag/Unconscious, keeps
Restrained (verified live on the real save); **hearsay spam** — one fight was offered at
NINE nested/raw spellings ("the shop", "guild quarter", loc-ids…) → pseudo-places (no
canonical record) get no rumor pass and the ledger is cluster-aware via `areRelatedPlaces`;
**region junk** — "the Chandlers' quarter"/"the Guild Quarter" passed the properness gate
(and "the Rimefell Marches" turned out to be the Scribe echoing the prompt's own example —
examples removed, echo forbidden) → regions can never end in an urban-locality head noun.
**Validated live this run:** prompt injection via player-embedded JSON block (no XP/item/
gold applied, DM answered in fiction), zero-slot cast rejected with no free enemy action,
"Cast adjusted to your declared Fire Bolt" guardrail, situational ruling granted off
established fiction (embers → advantage → nat-20 crit), surprise suppressing Opening
Initiative, potion bonus-action mid-combat (max-HP clamp), exact-DC success (12 vs DC 12),
proposal survives reload, defeat safety net + zero XP on a lost fight + encounter ledger
"defeat" entry, DM-emitted rest_taken with full restore + ledger, robbery via items_lost/
coin events (one turn late but complete; stale twin records left ghost copies), OOC recap
mid-captivity refusing hidden state — the DM itself flagged the sheet/story divergence.
**Still unexercised:** level-up/ASI live flow, tempo publicHints anti-repeat. Playtest
save left as-is (phantom 6g2s + duplicate pages are period artifacts of the bug).

## Seventh live playtest 2026-08-08 (same-day adversarial run — deliberately hunting the unexercised paths)

Continued Maren Duskwell into combat/spellcasting and hostile-recap territory. **Two new
P1s, both fixed with tests (DECISIONS.md 2026-08-08 ×2):** (1) `items_found` had NO
cross-message replay ledger — the DM granted the aunt's one healing potion on three
separate messages (find → counting recap → deal-scene recap) and every grant applied; new
`recentItemGrants` ledger in ADD_ITEM (event-path dispatches only, player re-acquire
bypass, visible suppression line). (2) `stripBundledReplay` stripped only ONE ledger entry,
so a split grant (2 gp + 28 gp) recapped as one 30 gp bundle leaked the 2 gp complement —
watched live ("granted 2 gp" on a zero-coin turn); it now strips every matching entry and
fully suppresses a bundle assembled entirely from prior grants. **Also fixed:** sustained-
spell clear at combat end/rest was silent → DM narrated "you are already protected" over a
dropped AC (now announced: "**Mage Armor** fades as the fight ends."); absence drift
false-fired for "Tallow Lane" while the hero spent the whole absence inside the shop ON it
(nested places fragment into separate records) → `areRelatedPlaces` nearby-guard skips
drift when a token-related record was visited within the threshold; pure-noise legacy
registry records ("the freezing muck") now dropped by the load heal (theaters/profiled
records still kept); Scribe audit rule: identifying an owned item is not an acquisition.
**Validated live this run:** combat spellcasting end-to-end (Fire Bolt/Magic Missile slots,
crypto dice, invalid target blocked with no free enemy action, bogus advantage claim
ignored, OOC-in-combat paused with no hidden-state leak), challenge-ruling withdrawal →
diceless success + `recentRulings` entry, Chronicle "Close chapter" (13.8k-char chapter),
scene-art fallback (no xAI key → labeled Gemini render), quest opened on deal acceptance,
front clock advanced on the Dunstan kill, reload/Continue byte-identical. **Still
unexercised:** tempo-window publicHints anti-repeat, level-up/ASI flow.

## Sixth live playtest 2026-08-08 (continued Maren Duskwell campaign — the location mess's real root cause)

Continued the playtest-#5 elf-wizard save through ~10 turns (fen → Weatherby → shop →
market → nat-20 wall cache → Jagger's arrival). **Found and fixed the P1 under everything
(DECISIONS.md 2026-08-08):** after `await sendToLLM`, the ADD_MESSAGE render hasn't
flushed, so ChatPanel's `findLast(assistant)` returned the PREVIOUS turn's message — the
Scribe had been extracting facts/locations/loot from one narrative behind (proven 4× from
save text: "The Weirs", "market square", the lodestone, bog-wax/keys). Fix: orchestrator
records `lastCommittedTurn` at dispatch, ChatPanel + `finalizeRoleplayTurn` consume it;
plus two guards — DM location event outranks same-turn Scribe (fillOnly downgrade) and
`isLocationEvidencedInText` (Scribe can only relocate to a place the turn's text names).
All three validated live post-fix (facts/cards/loot from the correct turn; post-roll path
too). **Validated live this run:** same-value coin-loss purchase bypass (2 sp inn payment
then 2 sp provisions purchase, both `applied` — the never-reproduced #5 target), dormancy
revival by merge (the dormant "Aunt's ledger" mystery flipped active, no duplicate),
regional hearsay end-to-end (fight:43 offered once per place, secondhand grade, ledger
correct), **absence drift full cycle** (shop arrival at awayDistance 31 → background call →
`INSTALL_ABSENCE_DRIFT`: 0 NPC developments + dues-notice fact + whispers-clamped
Fen-Tallow symptom; the DM voiced the notice as in-scene discovery under the door),
mint gate (lowercase "market square"/"the back room of the chandlery" minted nothing),
mount re-seed prune lines, Continue with 64→96 cached embeddings, engine-exact coin grants
(2+28 gp = the narrated 25 gp + 50 s), zero app console errors. **Queued (P2):**
colloquial sub-place strings miss canonical records (arrivals/stamps/drift skipped until a
proper name lands), castResults' same-task stateRef read (sibling of the fixed bug),
silent send-swallow while post-stream machinery runs. **Not exercised:** combat spell
declarations (no combat this run), tempo-window publicHints anti-repeat (no window opened;
the drift symptom was a genuinely new beat).

## Fifth live playtest 2026-08-07 (elf wizard, fresh campaign, emphasis on the just-fixed seams)

Validated live: **reveal-gold contract** (15 gp shown = 15 gp started), **bare-region guard**
(`currentLocation` became "Sallow Fen" with NO registry record minted, while The Weirs
carried `region: "the Sallow Fen"` from its profile), **story-memory dormancy** (two
salience-2 cards silent for 3 cadences went dormant mid-run; promises/wounds stayed
active), **declared spells** (zero "Cast adjusted" notes — the DM emitted player-named
Magic Missile exactly, slot spent, and the Fire Bolt kill line read "casts Fire Bolt at
Silt-Walker"; the watch item is answered: the prompt line holds, the backstop idles),
opening-initiative slot (Silt-Walker won init, hit for 2, then `awaiting_player`), engine
XP, Scribe audit stand-down on the porter's silver, advantage pair display, Continue with
23 cached embeddings. **Two new findings, fixed same-night (DECISIONS.md 2026-08-07 ×3):**
(P1) the journal cadence's async `SET_LOCATION` relocated the hero backwards ("Weatherby"
clobbered the same-turn fen arrival, forging phantom departure/arrival stamps) — journal
location is now `fillOnly`, the per-turn Scribe owns live position; (P2) "the freezing
muck" minted a record — new `isMintableLocationName` properness gate (mint-only; legacy
lowercase records survive the heal). The strengthening queue is now **fully clear**. Minor
observed non-bugs: the DM prices purchases its own way (no same-value collision occurred;
the commerce-verb bypass stays unit-pinned), and same-place name drift ("Aunt's shop,
Tallow Lane" vs the shop's sign name "E. Duskwell — Tallow & Tapers") mints two records —
no token overlap for containment to fold; accepted drift.

## Open-queue P2 batch 2026-08-07 (DECISIONS.md 2026-08-07 ×2 — every open queue item closed)

All 8 open items from the strengthening queue fixed in one pass: **(1) region names never
become location records** — bare known-region SET_LOCATION mints nothing (token-equality
`isRegionNameOnly`; compound "Ghyll, Rimefell Marches" still mints), a region variant can
alias but never RENAME a place record (the Ghyll-lost-its-record mechanism), and
`UPDATE_LOCATION_PROFILE` is update-only (the null-stamp "Vale of Reeds"/"the fen" mints);
**(2)** coin losses honor an explicit purchase message (COMMERCE_VERB_RE bypass — the 1 sp
stew after 1 sp passage case); **(3)** story-memory dormancy shipped (IDEAS 2026-07-14
design): journal-cadence age-out of salience-1/2 cards silent 3 cadences,
promise/playerCanon exempt, Scribe re-report revives, non-active cards also skipped by the
RAG seed; **(4)** `UPDATE_STORY_MEMORY` ambiguous bare-subject guard; **(5)**
`retrieveRelevant` gates on raw similarity (boost ranks only); **(6)** RAG seeding re-runs
when the machinery key first appears; **(7)** `publicHints` spent as the tempo block's
anti-repeat line (last 3 surfaced symptoms, "never re-run these beats"). The remaining
"frosted grass"-class descriptive-noise sub-case was then closed the same night after
playtest #5 reproduced it (see the entry above). 1,449 tests at this commit, lint clean.

## Region guards + fourth live playtest 2026-08-07 (F+D validated, spell silence fixed)

Vesa picked **F+D** from the five candidate guards (DECISIONS.md 2026-08-06 ×4):
`isBackstoryRegion` strips a Scribe region named in `character.background` but not the
premise before it enters the registry, and regional installs top the front web only to
`MAX_ACTIVE_FRONTS − 1` (one slot always free; trigger gated the same). **Playtest #4**
(dwarf cleric Brunhild, the Harrowlands premise, backstory land "the Ember Steppe" as
bait): the bait never appeared anywhere, the REAL new region seeded —
`[LivingWorld] Native pressures for the Pale Downs: 2 proposed`, exactly 1 installed
(3 of 4 slots, reserve held). Also verified live: purchase event, challenge-ruling flow
(DM revised to advantage, FINAL RULING, challenge spent), surprise suppressing the
opening-initiative slot, Channel Divinity correctly rejected at cleric 1 with no free
enemy action, situational-ruling kill, out-of-combat `spell_cast` Cure Wounds (slot spent,
engine-rolled heal), OOC table talk, reload/Continue with the campaign-keyed embedding
cache. **New finding, fixed same-night (DECISIONS.md 2026-08-07):** silent spell
adaptation — off-catalog "Guiding Bolt" became an unnamed Sacred Flame and an uncastable
Healing Word vanished wordlessly; now `engine/declaredSpells.js` honors castable
player-named spells, posts visible notes for adapted/dropped magic, and spell-attack
result lines name the spell. Plus the reveal-gold re-roll fix (reveal 25 gp → started 12;
the previewed character now IS the campaign hero). **Still open (queue):** same-value
coin-loss suppression P2, location-registry noise P2 ("frosted grass"-class records;
"the Downs" mis-tagged Harrowlands), story-memory/vector-memory P2 batch, `publicHints`
design question. Watch item: next combats, confirm the DM now emits player-named catalog
spells directly (the reconcile note "Cast adjusted to your declared X" should be RARE).

## Third live playtest 2026-08-06 (interactive browser session, ~12 turns, real Gemini)

Full interactive run on the production build (creation wizard → premise opening → checks →
combat → loot → travel → new region → reload/Continue). **Both same-day P1 fixes verified
live**: `[LLM timing] combat-intent: TTFT ~6.4s` with no retrieval embed preceding it, and
Continue loaded 19 cached embeddings re-embedding only new texts. **Working as designed:**
roll proposals (DC 10/12, advantage from fiction, nat-20 advantage pair displayed),
opening-initiative slot, situational-ruling advantage + Sneak Attack, engine XP + quest
open/complete in the same arcs, narrated long rest applied once, coin ledger caught a
40-silver-recapped-as-4-gold duplicate AND a loot-audit shortfall recovery + stand-down
pair, hearsay of the weir kill voiced as distorted NPC gossip in the next region, the
knownBy secret (confession to Tarn) never leaked, and a seeded front's symptom surfaced as
whispers. **Four new queue findings** (SCHEDULED_STRENGTHENING open queue): **(P1) the
region watch item FAILED** — the Scribe tagged Blackwater Weirs with backstory-only
"the Sorrow Fen" (proper name, passes sanitizeRegionName), which seeded 2 native fronts
for a never-visited land, filled the 4-front cap, and blocked the real Rimefell Marches
from seeding; prompt-only enforcement is now proven insufficient, engine-side guard needs
a design call. Plus P2s: same-value coin-loss double-charge suppression (1 sp stew after
1 sp passage), hero-reveal starting gold re-rolled on confirm (18 gp shown → 11 gp
started), region names leaking into the location registry as location records.

## Vector-memory P1 pair 2026-08-06 (both audit P1s fixed same-day, DECISIONS.md 2026-08-06 ×3)

The morning strengthening audit (vector-memory-rag + story-memory) opened 2 P1 + 5 P2;
both P1s are fixed: **(1)** combat-intent calls skip retrieval/curation/inspector-capture
(`wantsMemories` gate in `turnOrchestrator.js`) — no more blocking embed round-trip or
4-6 KB of dead memory blocks in the JSON-only prompt; **(2)** the embedding cache has a
lifecycle: 1500-row per-campaign cap (transient `player`/`narrative` evict first, mirrored
to disk), mount re-seed prunes stale reworded `npc`/`story_*` rows (replace-not-append),
and deleting a campaign's last save purges its rows (`sessionId` stamped in save metadata,
`shouldPurgeCampaignEmbeddings` biased toward keeping — legacy unstamped saves never
purge). **Queue after this: 5 P2s (vector-memory ×2, story-memory ×3) + the `publicHints`
design question.** Watch item: on a mature campaign's first mount after this, expect a
one-time `[VectorMemory] Pruned N stale reworded rows` console line.

## Second live playtest 2026-08-06 (28 turns, stricter verdicts — DECISIONS.md 2026-08-06 ×2)

Re-run of the same harness with two verdicts added: `realRegionSeeded` (the ACTUAL region,
not just any) and `noJunkRegions`. First-run fixes held: secret probe PASS again, absence
drift installed on the return, "the docks"-class junk gone, 8/10 green. The two failures
were the point — three deeper findings, all fixed same-day with tests: **(1)**
all-lowercase junk ("the coastal artery") passed the generic-token net and seeded fronts →
`sanitizeRegionName` now requires a capital-initial proper token; **(2)** the Scribe tagged
Brackwater with a *mentioned* distant region, which became "home" and blocked real-region
seeding → Scribe rule: region = the land THIS place lies in, never a
mentioned/destination land (prompt-only — **watch item for run three**); **(3)** the
public accusation carried `knownBy: ["the hero"]`, blocking it from the rumor pool →
witnessed/knownBy declared mutually exclusive, engine strips `witnessed` when `knownBy`
is present (secrecy wins). Also confirmed honest-negative: a fully peaceful run produces
zero hearsay offers — no fights, no resolved fronts, no traveling deeds is correct behavior.

## Living-world live playtest 2026-08-06 (28 turns, real Gemini, all verdicts green)

`scripts/playtest_living_world.cjs` (new; local production build via `npm run preview`,
puppeteer, logs + screenshots in `test-results/living_world/`): a five-act scripted session —
secret confession → public accusation → travel → new region → long-absence return →
stranger probe. **Every engine verdict passed**: the confession was captured with
`knownBy: ["the hero", "Marta Weck"]` on card + facts; a stranger asked "what do folk say
about me?" answered with street gossip and NO trace of the secret (automated PASS); visit
stamps tracked every move; the return to the Gilded Eel triggered absence drift at
awayDistance 42 and installed 2 NPC developments + a quiet price-rise fact; a real fight
became a live firsthand hearsay offer; the premise's region names flowed into the registry;
and the seeding trigger + install + cap all fired. Three calibration findings, fixed
same-night (DECISIONS.md 2026-08-06): Scribe region-field junk → `sanitizeRegionName`
properness boundary; public-deed salience/witnessed under-marking → Scribe rule; drift
call per stale record on homecoming → 20-message cooldown. **Watch item: the fixes are
prompt+engine — next live run should confirm regional seeding fires for the REAL region
now that junk can't fill the front web first.**

## Living-world round two 2026-08-05 (four features, DECISIONS.md 2026-08-05 ×2)

**(1) Epistemics layer** — story cards + world facts carry Scribe-captured `knownBy`;
prompt renders `[SECRET — known only to: …]` tags (WORLD FACTS, callbacks, RAG text);
CRITICAL RULE 9: characters only know what they could know, the hero's unspoken thoughts
are known to no one, knowledge spreads only through the fiction; KNOWN NPCs marks
`secret:`/`agenda:` as private interior. **(2) Payoff ceremony** — front resolution now
awards engine-computed milestone XP (50% of current level threshold; two resolutions = one
level, rpg-balance-master ruling in agent memory) and nudges a Chronicle chapter close
(session flag → golden hint, consumed on write). **(3) Witnessed hearsay** — Scribe marks
public moments `witnessed`; salience ≥4 non-secret witnessed cards travel as the third
rumor source (secrets never travel). **(4) Regional front seeding** (world-tempo
component 9 done) — Scribe `location_profile.region`; a registry-new region (first-ever =
home, never seeded) one-shot-triggers `llm/regionalFronts.js` (DM model) proposing 1–2
native, flavor-divergent, born-invisible pressures; installed with the arrival place as
theater, capped at 4 active, region marked seeded even on an empty result. **Watch items:
next campaign, (a) tell one NPC a secret and check a stranger doesn't echo it; (b) resolve
a front — expect XP line + level pacing + Chronicle nudge; (c) travel to a named new land —
look for `[LivingWorld] Native pressures for …` in the console and that the new fronts
stay whispers-gated outside their theater.**

## The world keeps living while you're away 2026-08-05 (absence drift + traveling rumor)

Shipped both halves of the same-day IDEAS.md entry (DECISIONS.md 2026-08-05) — the
strongest persistent-world signal a solo campaign can send. One trigger: SET_LOCATION
arriving at a different canonical record, with new `lastVisitedMessage` departure/arrival
stamps. **Traveling rumor** (`engine/regionalHearsay.js`): ≤2 hero deeds (resolved fronts,
encounter-ledger fights; hostile-site fights never travel) selected deterministically on
arrival, distortion-graded firsthand/secondhand/legend by age + locality, offered once per
(deed, place) via the `recentHearsay` ledger, rendered as `## REGIONAL HEARSAY — PRIVATE`
(NPC dialogue only, never narrator fact). **Absence drift** (`llm/absenceDrift.js`):
return after ≥30 conversational messages away raises a one-shot marker; a background
DM-model call proposes 0–2 off-screen developments (existing NPCs' agenda/lastNotes only —
structurally nobody dies or moves away, bonds untouchable), one world fact, and a
band-clamped symptom only where a front holds theater; `INSTALL_ABSENCE_DRIFT` validates
complete-or-nothing and `## WHILE YOU WERE AWAY — PRIVATE` cues the DM for ~12
conversational messages. No new DM event channels. 32 new tests (1,391 green), lint clean.
**Watch item: next long campaign, leave a town for 15+ scenes and return — check the
console for `[LivingWorld] Absence drift …` and that the return scene surfaces the
developments as discovery, not exposition dump; then arrive somewhere new after a big
victory and check hearsay lands in NPC dialogue with the distortion played straight.**

## Strengthening-queue P1 batch #2 2026-08-05 (3 P1s + 9 sibling P2s fixed)

Every open P1 in SCHEDULED_STRENGTHENING.md cleared, in 4 commits (DECISIONS.md 2026-08-05 ×3):
**(1) Hero gear stat clamps** — `normalizeItem` bounds non-catalog baseAC/shieldAC/AC-and-
weapon bonuses (AC-40 hallucinated plate is dead), infers missing armorType from baseAC
bands; rules.js re-clamps defensively for stale saves; junk weapon notation keeps the
wielder's modifier. **(2) Unfenced-JSON rescue on every channel** — parser anchors derived
from the EVENT_CHANNELS registry (was requested_rolls-only; other channels dropped events
and leaked JSON into narrative/RAG); repairJson comma strip string-aware; semantic roll
gate request-shaped (no more blocking Flash-Lite calls on bare "check"); per-turn parser
logs debug-gated. **(3) Scene-art cache keyed on inputs** (narration id + location) with
`peekCachedImage` probing before the compose call; POST prompt cap; art-director cast
filter-before-slice; LRU tests. **(4) Prompt accretion caps** — ACTIVE QUESTS (newest 12 +
name-only overflow, 250-char prompt descriptions, duplicate reminder dropped) and
INVENTORY Carried (25, mechanical-first, "still owned" overflow).

Same-day P2 sweep (5 more commits) then cleared the rest of the queue: live `rollHistory`
capped at 50 via shared `appendRollHistory` (all six append sites) + `MAX_DIE_SIDES`
(1000) + batched one-call crypto draws in `rollDice`; `sanitizeLoadedEnemy` is whitelist
projection (junk keys on hostile saves no longer survive, key set pinned); hero-import
portrait ceiling dropped to 300k chars (generated portraits are 60-110k) with
`sanitizeImageUrl` boundaries pinned; location-registry eviction is least-recently-visited
with theater records immune (FIFO was evicting the founding town and silently disabling
front intensity clamps); the write-only hidden roll-summary dispatch is deleted and the
roll-arbiter payload compacted/clamped/pinned; inventory handler branches + REMOVE_QUEST
pinned. **Queue is now 1 open item** — the `publicHints` design question (shrink vs spend
as a "do not repeat" tempo line), which needs Vesa's call. **Watch item: next Grok
campaign, confirm unfenced non-roll events now apply (look for the "Parsed unfenced JSON
(anchor: …)" console warn).**

## Strengthening-queue P1 batch 2026-08-04 (5 P1s + 5 sibling P2s fixed)

All open P1s but one cleared from SCHEDULED_STRENGTHENING.md (DECISIONS.md 2026-08-04 ×3):
**(1) Combat window starvation** — exchange result lines are tagged `exchangeLine` and
dropped from the DM's 20-message window (narration prompt stays the sole carrier; chat
rendering unchanged); `lastExchangeResult` stores events only (summary/lines derived at
read time, newline-safe), hero AC computed once per enemy pass, footprint tests added.
**(2) World tempo on conversational distance** — timing die, tempo window, heat window,
and victory echo now measure conversational messages (dice-turn chatter no longer opens
windows early or cools fresh fights); legacy raw-index directives derive on read.
**(3) Storage split** — IndexedDB v3 separates save metadata from payloads (one-time
in-upgrade migration; listing never materializes campaigns), cloud saves are chunks-always
with metadata-only parent docs (legacy inline docs still load until re-saved).
**(4) Autosave policy extracted** to `state/autosavePolicy.js` with tests (the previously
0%-covered inverted trigger + action-replay flush), hide flush dirty-gated, explicit flush
cancels the debounce it supersedes. Remaining queue: 1 P1 (scene-art cache-that-never-hits)
+ 15 P2s. **Watch items: first cloud save on an existing campaign re-writes as 1 chunk
(needs deployed chunks rules — repo rules already have them); first app boot after deploy
runs the IndexedDB v2→v3 migration — worth a quick Continue-and-load sanity check.**

## Front resolution, aftermath & foe fatigue 2026-08-03 (Vesa: "ichor ghouls in EVERY dungeon")

Vesa found fronts couldn't actually END (the DM was never shown `status: "resolved"`, so a
defeated front stayed active at clock cap forever) and dungeon flavor kept repeating. Shipped
(DECISIONS.md 2026-08-03): the DM now resolves a decisively-ended front via `front_updates`
(documented example + strict "the pressure itself is finished" bar); the engine makes it a
one-shot canonized transition — `resolvedAtMessage`/`resolution` stamped, theaters retired,
granted tempo window cancelled, a world fact minted revealing the title (the DM-notes payoff
moment), 🕰️ system line; a `RECENT VICTORY` tempo line has the DM show the absence for ~40
messages; `llm/frontAftermath.js` (background DM-model, frontDirector pattern) proposes 0–2
flavor-divergent successor pressures from the vacuum — empty = clean victory is first-class —
validated/one-shot-installed by `INSTALL_AFTERMATH_FRONTS` (≤3 active). Anti-repetition:
encounter ledger 6→10 with `foeFamilies` head-noun grouping; ≥3 fights with one family renders
a hard `FOE FATIGUE` variety line. Also: eslint now ignores stray `test-results/`. Untested in
live play yet — **watch item: next campaign, resolve a front for real and check the aftermath
generation + victory echo land.**

## Earlier (details in git history + DECISIONS.md)

- **2026-08-02 — Scribe reflection payload P1 + 30-turn live playtest:** reflection now
  ships `projectNpcForReflection` projections (was raw roster incl. portrait base64,
  846 KB measured); machinery contexts dropped pretty-printing; 30 KB payload-ceiling test.
  Then a 30-turn production-build playtest (`scripts/playtest_full_session.cjs`, real
  Gemini): zero product bugs — checks, two combats, loot/coin ledgers, rests, level-up,
  fronts, memory probes, persistence all verified live; logs in `test-results/full_session/`.
- **2026-08-01 — Ability-score recommendations at creation:** `CLASSES[x].abilityGuidance`
  + `engine/abilityGuidance.js` pair a best-first priority with the standard array; banner
  with one-click spread, per-row why-lines. Advice only. Also moved the Fighter
  fighting-style picker from the race step (where it silently never rendered) to the class step.
- **2026-07-31 — Coin/heal double-application root cause fixed:** Scribe audits report
  narrated TOTALS, engine does the arithmetic; audits act on pure omissions only, lost the
  player-phrasing ledger bypass; recap-bundle guard; loose `healing` suppressed alongside
  `rest_taken`/`spell_cast`. Validated live via `scripts/playtest_economy_doublecharge.cjs`.
- **2026-07-30→31 — Ultra-review fix campaign:** all P0/P1s from the six-lens review fixed
  structurally (~20 commits): session-keyed remount + turn abort, campaign-keyed embedding
  cache v4 (one-time re-embed per campaign on first load), enemyStats trust boundary on
  out-of-combat NPC rolls, autosave inverted to any-persisted-field; eventChannels registry,
  combatMath kernel, handlers/ split, turnOrchestrator extraction; suite 1,146 → 1,263.
  Deferred P2s: IDEAS.md "Ultra-review leftovers 2026-07-31".

## Strengthening queue & watch items

Open in SCHEDULED_STRENGTHENING.md after the 2026-08-04 fix batch: 1 P1 (scene-art
image cache that can never hit) + 15 P2s (scene-art ×3, dice-engine ×3, hidden-fronts ×2,
roll-resolution ×3, quests ×2, character-vault ×2). Carried watch items (need live play / Vesa's eyes):
stance-stutter self-clean on the Saima save (other browser profile), Scribe gender
backfill on pre-gender campaigns, Grok art respecting the gender tag, Aune
appearance-thinning LOOKS baseline snapshot next playtest, L1-death balance observation.
