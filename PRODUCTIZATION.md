# Quest Forge — Productization & Monetization

The working file for turning Quest Forge into a business: pricing models, hosting, model
selection, customer acquisition, unit economics, open questions, and what we learned from
comparable products. **Living document** — a scheduled research task appends to it; humans and
agents edit freely. Settled calls get promoted to `docs/DECISIONS.md`; the *why/for whom* lives in
`docs/PRODUCT.md`; the pitch in `docs/MARKETING.md`; the rival field notes in `docs/COMPETITORS.md`.
This file is the *how we get paid* layer on top of those.

_Created: 2026-09-06 (scheduled productization task, first run). See the changelog at the end._

---

## 0. Where we stand (inputs this doc takes as given)

| Fact | Source |
|---|---|
| **Production posture is hosted-Gemini, not BYOK.** DM on Gemini Pro, machinery on Gemini Flash, the player does not bring a key. OpenAI stays experimental, Grok shelved for narration (kept for scene art). | DECISIONS.md 2026-08-22 |
| BYOK still works in the shipped client (Settings → AI Provider) and costs us nothing per turn. The multi-provider DM surface stays as "cheap optionality". | CLAUDE.md, adapter.js |
| **No backend exists.** A server-side key proxy is *launch-critical* and *not started*. | IDEAS.md "Hosted-tier key proxy" |
| Cost basis (measured call inventory): ordinary turn ≈ 1 DM call (~14k in / ~1.1k out) + 1 Scribe call + 3 embeddings; a combat exchange = 2 DM calls. Estimated **$0.06/turn on the current stack, ~$0.02/turn on an efficient stack.** Cache-hit rate has **never been observed** (`usageMetadata` is not read anywhere). | IDEAS.md Launch & Monetization; STATUS.md focus track A |
| The default DM prompt is adult-capable and every Gemini call runs `safetySettings: BLOCK_NONE`. On a hosted key that is *our* API account against Google's Prohibited Use Policy — an explicit decision is owed before launch. | DECISIONS.md 2026-08-28; IDEAS.md key-proxy entry |
| Marketing wants to sell "no credits, no rounds, no per-message paywall" and "you set the line" — both lines are **BYOK-only truths**. A hosted tier meters and must stay inside provider policy. | COMPETITORS.md, MARKETING.md |
| Legal entity, payment processor, and tax setup: **none chosen.** Vesa is in Finland → EU VAT on digital services applies from the first euro of B2C sales. | (open) |

The tension this document has to resolve: **the sharpest marketing wedges (unmetered, unfiltered) belong to the BYOK path, while the settled production posture (hosted key) is the one that can actually make money from non-technical players.** The recommendation below is to ship *both* as one product with two doors.

---

## 1. Research: how comparable products monetize (2026)

Direct AI-DM competitors and the adjacent AI-fiction/companion products. Prices are as reported by
search results and vendor pages on 2026-09-06; several vendor pages could not be fetched directly
from the agent sandbox (egress-blocked), so **re-verify any number before it goes into copy**.

### 1.1 AI Dungeon Master products

| Product | Free tier | Paid model | Metering unit | Model choice | Notes |
|---|---|---|---|---|---|
| **Old Greg's Tavern** (web + iOS/Android) | ~1-hour trial / small free-round grant | **Adventurer $5 one-time (50 rounds)** · **Hero $15/mo (200 rounds)** · **Legend $25/mo (450 rounds, 25% off extra rounds)**; ~$4.99 per 5-credit pack per reviews | "round" ≈ one AI response; 1 campaign credit = 200 rounds ≈ 12–15 h; campaign start costs 50 rounds | Fixed (hosted) | **Rounds roll over month to month** (no breakage — player-friendly, costlier for them). +20 bonus rounds per companion added (group-play referral loop). Moved from flat $5 one-time to metered in Aug 2025 because hosted AI cost forced it; reviews say "monetization comes at users hard". Claims 225k–285k players by mid-2026. |
| **LoreKeeper** (closest architectural rival: server-side 5e engine, persistence, 6-player MP) | **20 free turns/day**, no card; 10 welcome credits | from **€7.99/mo**; credit packs after daily turns | turns/day + credits | Fixed | Cheapest entry in the category; the generous daily free tier is their acquisition engine. Aggressive SEO content ("best AI DM 2026", "vs Old Greg's"). |
| **Friends & Fables** (VTT angle) | 5–25 turns/day | **Starter $19.95 · Pro $29.95 · Legend $39.95 /mo** (raised from $14.95–$34.95 in Dec 2025) | **Unlimited *standard* turns; premium narration models + premium images consume credits** | Tiered: standard vs premium | The "standard unlimited + premium credits" shape is the cleanest answer to the unlimited-vs-metered dilemma. Sticker price is a floor for heavy premium-model users. |
| **Dungeons Deep** | — | from $9.95/mo, up to 5 players | — | — | Also runs an SEO comparison blog. |
| **RoleForge** | Free during alpha, everything unlocked | "early supporters lock in best rates at launch" | none yet | — | Pre-monetization; watch what they pick. |
| **AI Dungeon** (the OG, freeform, no rules engine) | Wanderer free (basic models, ~2k memory) | **Adventurer $9.99 · Hero $19.99 · Mythic $49.99 · Ultimate $99**; "Shadow tiers" above that (web-only, monthly-only) | Monthly **credits** + memory-bank slots; higher tiers = bigger models + longer context + image credits; annual discounts (12/6-month) | **User picks the model; each model has a different credit cost per action** | The mature-market reference: multi-tier subscription + credits, model choice priced by credit burn, extreme top tiers for whales. |

### 1.2 Adjacent AI-fiction / companion products

| Product | Shape | Takeaway |
|---|---|---|
| **NovelAI** | $10 / $15 / $25 per month (Tablet/Scroll/Opus), no annual discount since Mar 2026; runs its own permissive models | Proves a mid-priced subscription works for adult-capable fiction — because they **own the model** and thus the content policy. We don't. |
| **Sudowrite** | Hobby ~$10 (annual) / Pro $22 / Max $44 per month; **all tiers identical features, tiers differ only in monthly credits**; budget models ~350–1,000 credits per 1k words, frontier models 5,000–15,000 | Credits-only differentiation keeps the product simple; model choice is priced by credit burn, not by tier gating. Unused credits expire monthly except top tier (rollover). |
| **Character.AI** | Freemium; $32M revenue 2024 on ~20M MAU | Even a tiny conversion on a big free base pays; the free tier IS the funnel. |
| **AI companion apps (category data)** | $9.99/mo is the de-facto standard; ARPU $10–30/mo for subscribers; blended ARPU $3–15 (hybrid freemium) vs $30–100+ (subscription-led); "mature operators run a base subscription for predictable revenue plus tokens for high-engagement upsell" | Hybrid (subscription floor + credit top-ups) is the category's convergent answer. Gate after demonstrated value, not before. |

### 1.3 BYOK as a business (general findings)

- BYOK offloads 100% of inference cost and lets the app charge a flat SaaS/perpetual fee for the interface — but it is a **"conversion tax"**: asking a non-technical user to create a provider account, generate a key, paste it, and pick a model is a brutal onboarding step. This matches our own COMPETITORS.md diagnosis ("our biggest weakness").
- Pattern observed across BYOK apps: **once they get traction they add metered hosted usage anyway** (LobeChat → hosted metered cloud while the self-hosted build stayed free). BYOK-first then hosted is a well-trodden path, not a contradiction.
- OpenRouter's model: no token markup, **5.5% fee on credit purchases, 5% on BYOK routing above a free threshold** — the industry's benchmark for what a routing/aggregation layer may charge. Also a candidate hosted backend for a "premium narrator" option if we ever want non-Gemini narrators without holding every provider's key.

### 1.4 Platform, payment, and policy constraints (these shape everything)

- **Google Gemini API Prohibited Use Policy** forbids generating sexually explicit content; automated abuse monitoring scans API usage, retains data 55 days for enforcement, and repeated violations can restrict the product's API access or the Google account. `BLOCK_NONE` safety settings do not change the policy; they only stop Google's *filter* from returning empty candidates. Paid-tier prompts/responses are not used for training.
- **Stripe** (and PayPal, Cash App) prohibit adult content including "AI companion apps" and "adult AI subscription platforms"; accounts get terminated when the category surfaces on risk review. Alternatives are high-risk processors (CCBill, Segpay, specialist adult-AI processors) with steep rates and rolling reserves, or crypto.
- **Merchant of Record** (Paddle, Lemon Squeezy, Polar): ~5% + $0.50 per transaction, handle EU VAT / UK VAT / US sales tax / GST so a Finnish sole developer need not register for VAT-OSS or per-country tax. Lemon Squeezy (Stripe-owned since 2024) is the indie default; Paddle for scale. **Both inherit Stripe-class content rules** — an MoR does not launder the adult-content problem.
- **Steam** (Jan 2026 policy rewrite): live-generated AI content requires a written description of guardrails; **live-generated adult content is banned entirely**; an in-overlay player reporting tool flags undisclosed AI. Steam is viable only for a policy-compliant build.
- **itch.io**: paid adult content is de-indexed from browse/search since 2025 under payment-processor pressure and only slowly returning; free adult content is re-indexed with a warning. Not a revenue channel for the unfiltered path; fine for discovery.
- **App stores**: the mobile incumbents live at 13+; explicit content is structurally off the table there — our long-known wedge, unchanged.

---

## 2. Pricing model options

Assumptions used throughout (verify with track A instrumentation before locking anything):

| Stack | DM model | Est. cost / ordinary turn | Est. cost / combat exchange (2 DM calls) |
|---|---|---|---|
| **Current** | Gemini 3.1 Pro ($2 / $12 per 1M), machinery on 3.7 Flash | ~$0.045–0.06 | ~$0.09–0.11 |
| **Current + cache actually hitting** (static prefix ~5–7k tokens at 10% input price) | same | ~$0.035–0.05 | ~$0.07–0.09 |
| **Efficient** | Gemini 3-series Flash as narrator (~$0.75 / $3.75 intro; **Flash intro rates double 2027-01-01**), machinery unchanged | ~$0.02 | ~$0.035 |

Per-player monthly inference cost by usage profile (current stack, no cache):

| Profile | Turns / month | Cost to us |
|---|---|---|
| Casual | 100 | ~$5 |
| Regular | 300 | ~$15 |
| Heavy | 1,000 | ~$50 |
| Whale | 3,000 | ~$150 |

**Conclusion every competitor reached and we must too:** a hosted flat-rate "unlimited" plan on a frontier narrator loses money on exactly the players who love the game most. Either meter, or tier the narrator model, or both.

### Option A — Two doors: BYOK free/unmetered + hosted metered (RECOMMENDED shape)

- **BYOK door (free app, zero inference cost to us):** the shipped client as-is. Unlimited turns, any supported provider/model, the player's own content posture with their own provider. Carries the "no rounds, no paywall, you set the line" marketing wedges honestly — they are literally true here.
- **Hosted door (paid):** Quest Forge's own Gemini key behind a proxy; metered in turns; policy-compliant content posture (see §5). Serves the non-technical majority that will never paste an API key.
- Optional **BYOK Supporter** one-time/annual fee for cloud-sync convenience, roster/portrait extras, or simply "support the project" — many BYOK apps charge a flat interface fee. Keep the core BYOK free so the wedge stays credible.
- Why: it matches the settled hosted-Gemini posture *and* keeps the wedges; the BYOK path is also the pressure valve for content that the hosted path cannot carry.

### Option B — Turn-metered credits (Old Greg's / LoreKeeper shape)

- Sell rounds. One-time packs (no subscription anxiety) plus monthly plans with included rounds. Rollover is the player-friendly variant (OGT) but removes breakage; monthly expiry (Sudowrite, F&F) is the operator-friendly variant.
- Pros: cost-linked by construction, no whale risk, one-time packs convert people who hate subscriptions. Cons: reviews show metering "comes at users hard"; every campaign start being a visible cost hurts trial.
- Fit: the natural metering unit for our hosted door. Our "turn" is well-defined at the orchestrator (1 ordinary turn = 1 DM call + machinery; a combat exchange is 2 DM calls — price it as 2, or 1.5 to feel fair).

### Option C — Tiered subscription with *standard unlimited* + *premium credits* (Friends & Fables shape)

- Standard turns run on the efficient narrator (Flash-class) and are unlimited within a fair-use ceiling; premium turns on Gemini Pro burn credits. The subscription is a floor, credits the upsell.
- Pros: "unlimited" on the price page without whale bankruptcy; a clean upsell to the better narrator. Cons: requires the Flash narrator to pass our own quality bar (eval:combat + eval:memory + golden fixtures) — **not yet tested**; two narrators = two prompt-cache prefixes and two tuning baselines.

### Option D — Pure pay-per-use wallet (OpenRouter shape)

- Prepaid balance, turns debited at cost + margin, transparent per-turn price shown in the UI. Pros: honest, zero breakage complaints, trivially maps to the proxy's metering. Cons: no recurring revenue predictability; every turn shows a price tag (immersion-hostile in an RPG).

### Option E — One-time purchase / perpetual license

- Works only for BYOK (the interface is what's sold). OGT tried a flat $5 for a hosted product and abandoned it within months.

### Recommended synthesis (to be validated, not yet decided)

**A + B, with C as the phase-2 upgrade:** free BYOK door; hosted door with a one-time starter pack + two monthly plans of included turns; later split turns into standard/premium once the Flash narrator passes evals. Sketch, priced in EUR (MoR handles VAT):

| Plan | Price | Included | Cost to us (worst case, current stack) | Gross margin before fees |
|---|---|---|---|---|
| Trial | free | 30 hosted turns, one-time, no card | ~$1.50 | acquisition cost |
| Starter pack | €5 one-time | 60 turns | ~$3.00 | ~40% |
| Adventurer | €9.99/mo | 200 turns | ~$10 (100% used) / ~$6 (60% used) | ~0% / ~40% |
| Hero | €19.99/mo | 500 turns | ~$25 / ~$15 | negative / ~25% |
| Extra turns | €5 per 80 | | ~$4 | ~20% |

The table is deliberately unflattering: **on the current Pro-only stack with an unobserved cache rate the numbers do not work at Old Greg's price points.** The plans become healthy (50–70% margin) only with (a) the cache verified hitting on the ~6k static prefix, (b) standard turns on a Flash-class narrator, or (c) prices ~1.5× the table. This is why STATUS.md track A (usageMetadata instrumentation) is the single most valuable next engineering task for the business, not just for curiosity.

---

## 3. Hosting strategy

### 3.1 What we host today
Static client on Firebase Hosting; saves in the browser (IndexedDB) or the player's own Firebase. This stays. The hosted door adds exactly one server-side component: the **key proxy** (auth, metering, rate limits, model routing). Nothing else moves server-side — the engine, dice, and state remain client-owned, which is the product's trust claim.

### 3.2 Proxy options

| Option | What it is | Pros | Cons / questions |
|---|---|---|---|
| **Firebase AI Logic** (Google's gateway SDK: client → Firebase AI Logic server → Gemini) | Managed proxy with App Check attestation and **per-user rate limits** built in; no custom server | Zero-ops, keeps the "no backend" spirit, key never leaves Google | Must verify: streaming SSE parity with our `readSseStream`, `safetySettings`, `thinkingConfig`, `responseSchema`, and usage metadata pass-through; billing granularity for metering turns (we need per-user counters, not just rate limits); ties the hosted door to Gemini only (acceptable — that's the settled posture) |
| **Cloud Functions / Cloud Run proxy** (own code) | Thin function: verify Firebase Auth token, check entitlement in Firestore, forward to Gemini, stream back, decrement turns | Full control over metering, model routing, standard/premium turns, abuse cutoffs; invocation cost ~$0.40/M + compute — negligible per turn (<$0.001) | We own uptime, cold starts on streaming (min-instances cost), secret handling, and a second deploy target |
| **Third-party gateway** (OpenRouter-style) | Route through an aggregator with its own key management | Multi-model premium narrators without holding provider keys | 5–5.5% fee, another vendor in the chat path, still needs our own auth + metering layer |

**Leaning:** own Cloud Function proxy for the hosted door (metering *is* the business logic; we want to own it), evaluate Firebase AI Logic first as a possible shortcut. Either way the client keeps a provider adapter that can point at the proxy exactly like it points at Gemini today, so BYOK and hosted share one code path.

### 3.3 Self-hosted / open-source door?
A downloadable/self-hostable build is the natural companion to BYOK ("your key, your saves, your Firebase" is already the architecture). Open question whether the source itself should be public: it strengthens the trust claim (inspectable dice) and community acquisition, but hands the prompt engineering — the actual moat — to every competitor. Middle path: closed source, free hosted BYOK build, no self-host support. Decide before public launch; hard to un-open.

### 3.4 Hosting cost floor
Firebase Hosting (static) is effectively free at our scale; Firestore for entitlements is cents per thousand players; Functions negligible. The only material cost is inference. Budget the proxy at <2% of revenue.

---

## 4. Model selection: fixed vs user choice

| | Fixed narrator (hosted door) | User choice (BYOK door) |
|---|---|---|
| Quality control | We tune, eval-gate, and pin a stable model id (the current DM id is a *preview* model — pinning is on the launch gate already) | Player's problem; the multi-provider surface is "cheap optionality", unpolished by decision |
| Cost control | Required for metering math | Irrelevant (their key) |
| Machinery | Gemini Flash always (provider-independent by design) | Gemini Flash always; needs a Gemini key even when the DM is OpenAI |
| Content | Our policy on our key (§5) | Their provider's policy on their key |

**Recommendation:** hosted door = **one curated narrator per turn class** (standard/premium), never a free model picker — every competitor that exposes model choice ends up pricing it by credit burn (AI Dungeon, Sudowrite), which turns the price page into a token-economics lesson. Offer at most a two-way "Standard / Premium narrator" toggle once Option C is live. BYOK door keeps the full picker. Adding a non-Gemini premium narrator later is an OpenRouter-style routing question, not a product question, and it costs us a second tuning baseline — don't pay that before the first paying cohort exists.

---

## 5. Content policy on the hosted door (the biggest single blocker)

Today's default DM prompt is adult-capable, and the app declares `BLOCK_NONE`. On a hosted key that means Google's abuse monitoring sees explicit narration under *our* account with 55-day retention, and Stripe-class processors see "AI roleplay app with adult content" on risk review. Both can end the business overnight.

Options:

1. **Hosted door is policy-compliant by construction; unfiltered play is BYOK-only.** Hosted default prompt = mature-but-not-explicit (dark, violent, romantic, morally grey stays — that is most of the demand per MARKETING.md), explicit scenes fade-to-black. Marketing: "you set the line" attaches to BYOK; hosted copy says "mature themes, your rules" without explicit promises. Payments via an ordinary MoR. *Cheapest, safest, keeps every channel open.*
2. **Hosted explicit tier on a permissive provider** (the NovelAI model). Requires a provider whose API terms allow adult fiction, a high-risk processor (higher fees, reserves, chargeback exposure), age verification (UK OSA, US state laws), and a separate legal review. A different business; park it.
3. **Do nothing** — not an option; it's the one path that risks the Google account the whole machinery layer depends on.

**Recommendation: option 1 for launch.** Concretely: a hosted-tier prompt variant selected by the proxy (the client already ships per-campaign custom DM prompts), a visible content line in ToS, and an age gate (18+ self-attestation minimum) on both doors because even the compliant default is adult-toned. Revisit option 2 only with real demand data from the BYOK cohort.

---

## 6. Customer acquisition

What the winners do, and what it costs us:

- **Generous, card-free free tier is the funnel** in this category: LoreKeeper 20 turns/day, F&F 5–25 turns/day, OGT ~1 hour, AI Dungeon a permanent free model. Character.AI's revenue rides a huge free base. Our BYOK door is "free but with a wall"; the hosted trial must be **instant** (no key, no card): ~30 hosted turns is ~$1.50 of acquisition cost per signup — cheap relative to any paid channel. Daily-turn grants (LoreKeeper) retain better than one-time grants but cost more; start one-time, measure.
- **Referral loops native to the fiction:** OGT gives +20 rounds per companion added. Solo-play analogue: turns for sharing a Chronicle chapter / hero file, or for a friend's first paid pack.
- **SEO comparison content is the category's main channel.** Every rival runs a blog of "best AI DM 2026 / X vs Y" pieces (LoreKeeper, F&F, Dungeons Deep, RoleForge, third-party review sites like Arcanum RPGs). Cheap, compounding, and we have genuinely differentiated material (honest dice, engine-owned state, hidden fronts). Plan 6–10 pieces before launch; get listed in the third-party roundups.
- **Communities, not ads:** Google/Meta ads are closed to anything adult-adjacent; the audience is on r/Solo_Roleplay, r/AIDungeon, r/OldGregsTavern, solo-RPG Discords, and itch.io. The trailer (MARKETING.md) is the asset those channels need.
- **Mobile is the gap.** OGT is the only native-mobile player and the fastest-growing; PWA pass + first-ten-minutes onboarding (already on the launch gate) are acquisition work, not polish.
- **Conversion expectations:** category ARPU for subscribers is $10–30/mo; freemium-to-paid conversion for consumer AI apps is low single digits. At 3% conversion and €12 blended ARPU, 1,000 signups ≈ €360/mo. The business needs tens of thousands of signups for one person's income — plan channels accordingly, and price for margin per paying player rather than volume.

---

## 7. Open questions and blockers (ordered by how much they gate)

1. **Unit economics are unmeasured.** Cache-hit rate, real tokens in/out, $/turn, TTFT — track A (`usageMetadata` instrumentation) resolves this in one playtest. *Blocker for any price.*
2. **Can a Flash-class narrator carry the standard turn?** Run eval:combat + eval:memory + golden fixtures on the cheapest Gemini 3-series Flash as DM. Yes → Option C is on; no → prices must be ~1.5× the sketch or turns fewer.
3. **Hosted content posture** (§5): confirm option 1; write the hosted prompt variant; decide age-gate mechanics. *Blocker for holding a hosted key at all.*
4. **Key proxy architecture:** Firebase AI Logic vs own Cloud Function. Needs a one-day spike against the streaming/safety/thinking/schema/usage feature list. *Launch-critical, not started.*
5. **Metering unit and combat pricing:** 1 turn = 1 DM call; a combat exchange = 2 DM calls plus narration — charge 2, or 1.5 and eat the difference? Table-talk (OOC) turns are cheap but still a DM call — charge or free?
6. **Legal entity and MoR:** who sells (sole trader vs company), Lemon Squeezy vs Paddle, and whether the *compliant* hosted product is safely inside their acceptable-use terms (get it in writing; "AI roleplay" alone can trigger review).
7. **Rollover vs expiry** for included turns: OGT rolls over (players love it), Sudowrite/F&F expire (margin). Suggest: subscription turns expire, purchased packs never do.
8. **Open source or not** (§3.3). Decide before launch.
9. **Production image chain:** hosted xAI key for Grok Imagine (another key, another policy, another meter) vs Gemini-image-only. Images are the second cost center; price scene art as premium credits or cap per plan.
10. **Stable-model pinning and swap policy** on the hosted door: every provider model swap changes cost and quality; the eval gate exists, the cadence does not.
11. **Fair-use and abuse controls** on the hosted door: automated turn spam against our key is a direct wallet attack; per-user RPM limits + daily caps + App Check are the minimum.
12. **What the BYOK Supporter tier actually contains** (if anything) so the free BYOK door stays credible as "free".

---

## 8. Proposed phasing

- **Phase 0 — measure (now, engineering only):** track A instrumentation; Flash-narrator eval; proxy spike. Output: a real $/turn table replacing §2's estimates.
- **Phase 1 — public BYOK beta (no money changes hands):** launch the two-door client with the hosted door disabled; the PWA/onboarding work; 6–10 SEO pieces + the trailer; a waitlist for hosted plans that captures willingness-to-pay. Risk: near zero (their keys). Data: retention, turns/session, campaign length, content-policy exposure.
- **Phase 2 — hosted door, metered:** entity + MoR + proxy + policy-compliant prompt + age gate; starter pack + two plans; trial 30 turns. Start with Pro-only turns priced honestly; add standard/premium split when the Flash eval passes.
- **Phase 3 — optimize:** rollover/expiry tuning, referral turns, premium scene-art credits, annual plans, possible non-Gemini premium narrator via routing.

---

## 9. References reviewed (2026-09-06)

Direct competitors and pricing:
- Old Greg's Tavern — [pricing page](https://www.oldgregstavern.com/pricing) · [pricing-change newsletter](https://oldgregstavern.beehiiv.com/p/why-old-gregs-tavern-is-updating-pricing) · [memory & subscriptions update](https://oldgregstavern.beehiiv.com/p/the-tavern-levels-up-memory-subscriptions-more) · [Arcanum RPGs review](https://arcanumrpgs.com/blog/old-gregs-tavern-review/)
- LoreKeeper — [Best AI DM 2026 roundup](https://lore-keeper.com/blog/best-ai-dungeon-master-2026) · [free AI DM piece](https://lore-keeper.com/blog/free-ai-dungeon-master) · [LoreKeeper vs OGT](https://lore-keeper.com/blog/lorekeeper-vs-old-gregs-tavern) (all competitor-authored)
- Friends & Fables — [F&F review, Dungeons Deep](https://dungeonsdeep.ai/blog/friends-and-fables-review-2026) · [OGT vs F&F, Arcanum](https://arcanumrpgs.com/blog/old-gregs-tavern-vs-friends-and-fables/) · [aitools.inc listing](https://aitools.inc/tools/friends-and-fables)
- AI Dungeon — [memberships & benefits](https://help.aidungeon.com/memberships-benefits) · [about Shadow Tiers](https://help.aidungeon.com/faq/about-shadow-tiers) · [Arcanum review](https://arcanumrpgs.com/blog/ai-dungeon-review/) · [Dungeons Deep review](https://dungeonsdeep.ai/blog/ai-dungeon-review-2026)
- Category cost overview — [What an AI RPG actually costs (Arcanum)](https://arcanumrpgs.com/blog/ai-rpg-cost/) · [RoleForge pricing (free alpha)](https://roleforge.ai/pricing/) · [Dungeons Deep](https://dungeonsdeep.ai/)

Adjacent products:
- [Sudowrite pricing](https://checkthat.ai/brands/sudowrite/pricing) · [Sudowrite cost-of-a-novel post](https://sudowrite.com/blog/cost-of-writing-novel-with-ai/) · [NovelAI pricing 2026](https://aitoolsdevpro.com/ai-tools/novelai-guide/)
- [AI companion monetization: subscription vs token (track360)](https://track360.io/blog/ai-companion-app-monetization-models-subscription-vs-token-2026) · [How AI companion apps make money](https://www.aicompanionpick.com/how-ai-companion-apps-make-money-business) · [AI companion pricing compared](https://www.aicompanionpick.com/ai-companion-pricing-comparison-2026) · [2026 free-to-paid conversion report](https://www.growthunhinged.com/p/free-to-paid-conversion-report)

BYOK / hosted economics:
- [BYOK apps: spend caps, perpetual pricing, provider terms (Trends.vc)](https://trends.vc/bring-your-own-key-byok-apps-spend-caps-perpetual-pricing-provider-terms/) · [Dyad on BYOK](https://www.dyad.sh/blog/bring-your-own-api-key-ai-app-builder) · [Strategies to monetize AI apps](https://medium.com/@miguelaeh/strategies-to-monetize-ai-apps-and-agents-da0058a9500a)
- [OpenRouter pricing & BYOK fee](https://www.truefoundry.com/blog/openrouter-pricing) · [OpenRouter fees explained](https://amnic.com/blogs/openrouter-pricing)
- Gemini pricing — [CloudZero guide](https://www.cloudzero.com/blog/gemini-pricing/) · [DevTk 3.7 Flash intro rates](https://devtk.ai/en/blog/gemini-api-pricing-guide-2026/) · [BenchLM Sept 2026](https://benchlm.ai/google/api-pricing)

Policy, payments, platforms:
- [Gemini API abuse monitoring / usage policies](https://ai.google.dev/gemini-api/docs/usage-policies) · [Google Generative AI Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy) · [Gemini logs & data policy](https://ai.google.dev/gemini-api/docs/logs-policy) · [AI adult-content policy tracker](https://aihaven.com/ai-adult-content-policy-tracker/)
- [Does Stripe allow adult content? (2026)](https://signaturepayments.com/does-stripe-allow-adult-content/) · [Stripe prohibited businesses](https://paykings.com/blog/stripe-prohibited-businesses/) · [NSFW AI payment processing](https://www.payfirmly.com/blogs/nsfw-ai-payment-processing-orchestration)
- [Paddle vs Lemon Squeezy 2026](https://fungies.io/paddle-vs-lemon-squeezy/) · [Lemon Squeezy vs Polar vs Paddle](https://www.buildmvpfast.com/blog/lemon-squeezy-vs-polar-paddle-merchant-of-record-2026)
- [Steam AI disclosure policy update (PC Gamer)](https://www.pcgamer.com/software/ai/steam-updates-ai-disclosure-form-to-specify-that-its-focused-on-ai-generated-content-that-is-consumed-by-players-not-efficiency-tools-used-behind-the-scenes/) · [Steam 2026 AI rules for indies](https://www.strayspark.studio/blog/steam-ai-disclosure-rules-2026-indie-developer-guide)
- [itch.io update on NSFW content](https://itch.io/updates/update-on-nsfw-content) · [itch.io reindexing adult content (Game Developer)](https://www.gamedeveloper.com/business/itch-io-begins-reindexing-free-adult-content-and-plans-to-slowly-reintroduce-paid-content)
- [Firebase AI Logic rate limits & per-user limits](https://firebase.google.com/docs/ai-logic/quotas) · [Firebase AI Logic App Check](https://firebase.google.com/docs/ai-logic/app-check) · [Streaming Cloud Functions + Genkit](https://firebase.blog/posts/2025/03/streaming-cloud-functions-genkit/) · [Cloud Run pricing](https://cloud.google.com/run/pricing)

---

## Changelog

- **2026-09-06 — created** (scheduled productization task). Initial research pass: competitor pricing table (OGT, LoreKeeper, F&F, AI Dungeon, Dungeons Deep, RoleForge) and adjacent products (NovelAI, Sudowrite, companion-app category data); five pricing options with a two-door (BYOK free + hosted metered) recommendation and an honest margin sketch showing current-stack economics do not clear OGT price points without a verified cache or a Flash-class standard narrator; hosting options (Firebase AI Logic vs own Cloud Function proxy vs aggregator); fixed-narrator recommendation for the hosted door; the hosted content-policy blocker with a launch recommendation (compliant hosted door, unfiltered play BYOK-only); acquisition patterns (card-free trial, referral turns, SEO comparison content, communities); 12 open questions; 4-phase plan. Several vendor pages were egress-blocked from the sandbox — numbers are from search snippets and secondary reviews; re-verify before use in copy.
