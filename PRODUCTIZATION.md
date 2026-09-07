# Quest Forge — Productization & Monetization

The working file for turning Quest Forge into a business: pricing models, hosting, model
selection, customer acquisition, unit economics, open questions, and what we learned from
comparable products. **Living document** — a scheduled research task appends to it; humans and
agents edit freely. Settled calls get promoted to `docs/DECISIONS.md`; the *why/for whom* lives in
`docs/PRODUCT.md`; the pitch in `docs/MARKETING.md`; the rival field notes in `docs/COMPETITORS.md`.
This file is the *how we get paid* layer on top of those.

_Created: 2026-09-06 (scheduled productization task, first run). Last research pass: 2026-09-07. See the changelog at the end._

> **What changed on 2026-09-07 (read this first if you saw the 2026-09-06 version):**
> 1. Prices re-verified through secondary sources (vendor pages are still egress-blocked): OGT and F&F numbers hold; **LoreKeeper's pricing is contradictory across sources** and must be checked by hand before it appears in copy (§1.1).
> 2. **The cost model was wrong about the machinery.** `MACHINERY_MODEL` is `gemini-3.7-flash` (CLAUDE.md is right, the IDEAS.md "Flash-Lite" entry is stale), and every Gemini 3.6–3.8 Flash model is on **introductory pricing that doubles on 2027-01-01**. That hits the machinery on both doors and guts the "cheap Flash narrator" plan (§2, revised tables).
> 3. Firebase AI Logic is confirmed feature-complete for what we need (streaming, safety settings, thinking config, cached-token usage metadata, per-user rate limits) — but it is a rate limiter, not a meter. Entitlement counting is still ours to build either way (§3.2).
> 4. Every indie MoR (Paddle, Lemon Squeezy, Polar) prohibits adult/age-restricted content and Polar names "AI relationship services" explicitly; all three want a pre-clearance conversation for AI products. The compliant hosted posture (§5 option 1) is the only one an MoR will carry — confirmed, not just suspected (§1.4, §5).
> 5. Provider policy scan: OpenAI's adult mode is paused indefinitely; xAI is the only major API that tolerates fictional adult text (moderation still on, no guarantees); Google has no adult-fiction exception. The "permissive provider" for a hosted explicit tier would be Grok — the narrator we shelved for event compliance (§5).
> 6. RevenueCat's 2026 benchmarks reframe acquisition: hard paywalls convert ~5× freemium, AI apps churn ~30% faster than non-AI apps, and day zero decides everything. The first-ten-minutes onboarding is the monetization feature (§6).

---

## 0. Where we stand (inputs this doc takes as given)

| Fact | Source |
|---|---|
| **Production posture is hosted-Gemini, not BYOK.** DM on Gemini Pro, machinery on Gemini Flash, the player does not bring a key. OpenAI stays experimental, Grok shelved for narration (kept for scene art). | DECISIONS.md 2026-08-22 |
| BYOK still works in the shipped client (Settings → AI Provider) and costs us nothing per turn. The multi-provider DM surface stays as "cheap optionality". | CLAUDE.md, adapter.js |
| **No backend exists.** A server-side key proxy is *launch-critical* and *not started*. | IDEAS.md "Hosted-tier key proxy" |
| Cost basis (measured call inventory): ordinary turn ≈ 1 DM call (~14k in / ~1.1k out) + 1 Scribe call + 3 embeddings; a combat exchange = 2 DM calls. Re-estimated 2026-09-07 at **~$0.05/turn uncached, ~$0.04 with the cache hitting** (§2). Cache-hit rate has **never been observed** — re-confirmed 2026-09-07: no `usageMetadata` / `cachedContentTokenCount` read exists anywhere in `src/`. | IDEAS.md Launch & Monetization; STATUS.md focus track A |
| **Machinery model is `gemini-3.7-flash`** (`llm/machinery.js`), not the Flash-Lite the IDEAS.md entry still names. All Gemini 3.6/3.7/3.8 Flash models share **introductory pricing ($0.75 / $3.75 per 1M) that doubles to $1.50 / $7.50 on 2027-01-01.** Our machinery cost roughly doubles that day on both doors. | machinery.js; pricing sources §9 |
| The DM call runs with Gemini's default thinking level; thinking tokens bill as output on Pro ($12/M). The "~1.1k out" figure counts visible output only, so the true output cost per turn is unknown until track A lands. | IDEAS.md thinking-budget entry (machinery only) |
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
| **Old Greg's Tavern** (web + iOS/Android) | ~1-hour trial / small free-round grant | **Adventurer $5 one-time (50 rounds)** · **Hero $15/mo (200 rounds)** · **Legend $25/mo (450 rounds; Adventurer top-ups at $3.75 instead of $5)** — *re-confirmed 2026-09-07 via OGT's own newsletter* | "round" ≈ one AI response; 1 campaign credit = 200 rounds ≈ 12–15 h; campaign start costs 50 rounds | Fixed (hosted) | **Every purchased round rolls over month to month** ("no wasted rounds, no pressure to use them up" is their own copy — breakage is explicitly *not* their model). +20 bonus rounds per companion added (group-play referral loop). Moved from flat $5 one-time to metered in Aug 2025 because hosted AI cost forced it; reviews say "monetization comes at users hard". Claims 225k–285k players by mid-2026. |
| **LoreKeeper** (closest architectural rival: server-side 5e engine, persistence, 6-player MP) | Source A: **20 free turns/day**, no card, + 10 welcome credits · Source B: **500 one-time free credits** | Source A: **€7.99 / €9.99 / €19.99 per month** · Source B: **Plus $9 · Pro $19 (adds co-op) · Forge $39 per month, up to 40% off annual**; credit packs where **1 credit = 3 rounds** | turns/day + credits (A) or credits only (B) | Fixed; "proprietary engine, multi-provider" — **hosted, no BYOK** (answers the COMPETITORS.md TODO) | **⚠ 2026-09-07: two incompatible pricing pictures in circulation** — either the model changed recently (daily free turns → one-time credit grant, i.e. *away* from the generous funnel) or a third-party listing is stale. Vendor page is egress-blocked from the sandbox; **verify by hand before quoting.** Aggressive SEO content either way. |
| **Friends & Fables** (VTT angle) | Free tier (5–25 turns/day per earlier sources) | **Starter $19.95 · Pro $29.95 · Legend $39.95 /mo**; annual **$16.63 / $24.96 / $33.29** (≈17% off) — *re-confirmed 2026-09-07* | **Unlimited turns on EVERY paid tier** (incl. Starter) + **100 / 300 / 600 bonus monthly credits**; credits buy premium narration models and Image Studio renders; tiers also differ by party size (4/5/6 players) and custom-block size | **Player-switchable narration models**, priced in credits (their "Model Switching" patch, late 2025) | The "standard unlimited + premium credits" shape is the cleanest answer to the unlimited-vs-metered dilemma — and unlimited-on-Starter proves their standard narrator is a cheap model. Sticker price is a floor for heavy premium-model users. |
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
- **Merchant of Record** (Paddle, Lemon Squeezy, Polar): ~5% + $0.50 per transaction (Polar adds +1.5% on non-US cards — relevant for a Euro-heavy customer base), handle EU VAT / UK VAT / US sales tax / GST so a Finnish sole developer need not register for VAT-OSS or per-country tax. Lemon Squeezy (Stripe-owned since 2024) is the indie default; Paddle for scale. **All three inherit Stripe/Visa/Mastercard content rules** — an MoR does not launder the adult-content problem. *Checked 2026-09-07:* **Paddle's AUP** bans "adult and other age-restricted content and services … sexually-oriented … material of a lewd and lascivious nature" and its 2026 update adds AI-generated-content restrictions driven by card-network user-generated-content rules; **Polar's AUP** names "adult services or content, including by AI or proxy (such as AI Girlfriend/Boyfriend services)" and puts *all* AI tools under "closer review" (not banned, but reviewed); **Lemon Squeezy** lists "illegal or age-restricted products" and tells sellers to email support with a description *before* selling if unsure. Conclusion: an AI RPG with a *mature-but-not-explicit* hosted posture is sellable, but only after a written pre-clearance from the chosen MoR — the open question is no longer "which MoR" but "get it in writing".
- **EU VAT mechanics for a Finnish seller (not legal advice; verify with an accountant):** Finland's domestic VAT registration threshold is **€20,000/yr** (since 2025; the graduated relief below it was abolished). EU-wide, B2C digital services are taxed where the *customer* is, with a **€10,000/yr cross-border micro-threshold** below which home-country VAT applies; above it, destination rates via the OSS one-stop-shop. **With an MoR, none of this touches us**: the MoR is the legal seller to the consumer and pays us a B2B payout (reverse-charge), so our own turnover is the payout stream and consumer VAT is their filing. This is the single strongest argument for an MoR from the first euro, ahead of fees. A sole trader (toiminimi) is sufficient until revenue justifies an Oy; the MoR contract, not the entity type, is what the payment side cares about.
- **UK Online Safety Act** (checked 2026-09-07): Ofcom's own explainer says a chatbot service is **out of scope if users only interact with the chatbot and never with each other** — a single-player game with no sharing surface is that. Two caveats: (a) any service that *publishes pornographic content, including via a chatbot,* needs "highly effective age assurance" (certified third-party checks / facial age estimation), which is exactly why the hosted door must not be explicit; (b) ministers announced (Feb 2026) an amendment bringing one-to-one AI interactions into the illegal/harmful-content duties, and Ofcom opened enforcement against Grok/X and an AI companion service in Jan 2026. An 18+ self-attestation is enough for the compliant hosted door today; a public Chronicle/hero-sharing feature would change the analysis (user-to-user content). Watch the amendment.
- **Steam** (Jan 2026 policy rewrite): live-generated AI content requires a written description of guardrails; **live-generated adult content is banned entirely**; an in-overlay player reporting tool flags undisclosed AI. Steam is viable only for a policy-compliant build.
- **itch.io**: paid adult content is de-indexed from browse/search since 2025 under payment-processor pressure and only slowly returning; free adult content is re-indexed with a warning. Not a revenue channel for the unfiltered path; fine for discovery.
- **App stores**: the mobile incumbents live at 13+; explicit content is structurally off the table there — our long-known wedge, unchanged.

---

## 2. Pricing model options

Assumptions used throughout (verify with track A instrumentation before locking anything). Revised 2026-09-07 with the real machinery model and the 2027 Flash price step:

- Ordinary turn = 1 DM call (~14k in, of which ~6k is the byte-stable cacheable prefix; ~1.1k *visible* out, thinking tokens unknown) + machinery (Scribe ~8k in / 0.6k out, roll-policy audit on check turns ~3k in, 3 embeddings ~1.2k tokens total).
- List prices (per 1M tokens, Sept 2026): Gemini 3.1 Pro **$2 in / $12 out / $0.20 cached-in** (implicit caching is automatic, 90% off matched prefix tokens); Gemini 3.6–3.8 Flash **$0.75 / $3.75 intro → $1.50 / $7.50 from 2027-01-01**; Gemini 3.1 Flash-Lite ~$0.25 / $1.50 (not on an intro schedule as far as sources show — verify); `gemini-embedding-2` $0.20. Explicit context caching on Pro costs ~$4.50 per 1M cached tokens per hour of storage — at our ~6k prefix that is ~$0.03/hour per *distinct* prefix, only worth it for a shared hosted prefix, never per-player.

| Stack | DM narrator | Machinery | Ordinary turn | Combat exchange (2 DM + machinery) | Same stack after 2027-01-01 |
|---|---|---|---|---|---|
| **Current, cache not hitting** | 3.1 Pro | 3.7 Flash (~$0.011) | **~$0.052** | ~$0.093 | ~$0.063 |
| **Current, cache hitting on the 6k prefix** | 3.1 Pro | 3.7 Flash | **~$0.041** | ~$0.072 | ~$0.052 |
| **"Efficient" — Flash narrator** | 3.7 Flash (cached prefix) | 3.7 Flash | **~$0.022** | ~$0.033 | **~$0.043** |
| Machinery back on Flash-Lite (any narrator) | — | 3.1 Flash-Lite (~$0.004) | saves ~$0.007/turn now, ~$0.018/turn in 2027 | | |

Three things this table says that the 2026-09-06 version did not:

1. **The Flash-narrator saving is a 2026 price.** After the January step the "efficient" stack (~$0.043) costs about what the cached Pro stack costs today (~$0.041) — the Option C standard/premium split then buys a ~15–20% saving, not ~50%. Do not build a two-narrator product on the assumption of a 2× cheaper standard turn; build it only if the Flash narrator *also* passes the quality evals and the January price is used in the model.
2. **Machinery is now a meaningful cost center.** The 2026-08-22 move from Flash-Lite to 3.7 Flash tripled machinery cost per turn for quality reasons; on a metered hosted door that is ~$0.01–0.02 per turn of margin. Not a call to revert — a call to *measure* Scribe quality vs cost once track A exists, and to keep the machinery model swappable per lane (the Scribe's merge quality may justify Flash; the roll-policy audit and embeddings almost certainly do not).
3. **Thinking tokens are the unknown that could dominate.** At $12/M output, 2k thinking tokens per turn would add $0.024 — more than the entire machinery. Track A must log `thoughtsTokenCount`; if it is large, a `thinkingConfig` decision on the DM lane (never on quality-critical narration without an eval) becomes a pricing input.

Per-player monthly inference cost by usage profile (current stack, cache hitting → not hitting):

| Profile | Turns / month | Cost to us | Retail equivalent at OGT's Hero/Legend price-per-round ($0.075 / $0.056) |
|---|---|---|---|
| Casual | 100 | ~$4–5 | $5.60–7.50 |
| Regular | 300 | ~$12–16 | $17–22 |
| Heavy | 1,000 | ~$41–52 | $56–75 |
| Whale | 3,000 | ~$123–156 | $168–225 |

**Conclusion every competitor reached and we must too:** a hosted flat-rate "unlimited" plan on a frontier narrator loses money on exactly the players who love the game most. Either meter, or tier the narrator model, or both. **New observation:** OGT's Legend tier sells a round at ~$0.056 — *at or below our Pro-turn cost* — while explicitly disclaiming breakage (rounds never expire). Either their narrator is far cheaper than Pro or Legend is a loss-leader for the $15 Hero tier. We cannot match their per-round price on a Pro narrator; we should not try — price the quality, not the round.

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

**A + B, with C as the phase-2 upgrade:** free BYOK door; hosted door with a one-time starter pack + two monthly plans of included turns; later split turns into standard/premium *if* the Flash narrator passes evals **and** the 2027 price still leaves a margin worth a second tuning baseline. Sketch, priced in EUR (MoR handles VAT; EUR≈USD for this sketch). Two rows per plan: the 2026-09-06 allowance vs a **2026-09-07 re-priced allowance** at ~€0.06–0.07 retail per turn against $0.041–0.052 cost:

| Plan | Price | Included (09-06 → 09-07) | Cost to us at 100% use (cache hit → miss) | Gross margin at 100% use | MoR fee share (5% + €0.50) |
|---|---|---|---|---|---|
| Trial | free | 30 turns, one-time, no card | ~$1.25–1.55 | acquisition cost | — |
| Starter pack | €5 → **€7.99** one-time | 60 → **100 turns** | $2.5–3.1 → $4.1–5.2 | ~40% → ~35–49% | **15%** on €5 (the fixed €0.50 eats small packs) → 11% |
| Adventurer | €9.99/mo | 200 → **150 turns** | $8.2–10.4 → $6.2–7.8 | ~0–18% → **~22–38%** | 10% |
| Hero | €19.99/mo | 500 → **350 turns** | $20.5–26 → $14.4–18.2 | negative → **~9–28%** | 7.5% |
| Extra turns | €5 per 80 → **€5 per 70** | | $3.3–4.2 → $2.9–3.6 | ~20% → ~28–42% | 15% |

Realistic utilisation (60–70% of included turns used, the SaaS norm for included-quota plans) lifts the subscription margins into the 45–60% band at the re-priced allowances. The table is still deliberately unflattering: **at OGT's per-round price points the current Pro stack has no margin; at ~€0.065/turn it has a thin-but-real one, and the sub-€10 psychological anchor is kept by shrinking the allowance rather than raising the sticker.** The plans become healthy (60%+) only with (a) the cache verified hitting on the ~6k static prefix, (b) thinking tokens found to be small or bounded, (c) the machinery's per-lane model right-sized, or (d) a Flash-class standard narrator that survives both the evals and the January price. This is why STATUS.md track A (usageMetadata instrumentation) is the single most valuable next engineering task for the business, not just for curiosity — and why it should log `thoughtsTokenCount` and `cachedContentTokenCount` separately, per lane.

---

## 3. Hosting strategy

### 3.1 What we host today
Static client on Firebase Hosting; saves in the browser (IndexedDB) or the player's own Firebase. This stays. The hosted door adds exactly one server-side component: the **key proxy** (auth, metering, rate limits, model routing). Nothing else moves server-side — the engine, dice, and state remain client-owned, which is the product's trust claim.

### 3.2 Proxy options

| Option | What it is | Pros | Cons / questions |
|---|---|---|---|
| **Firebase AI Logic** (Google's gateway SDK: client → Firebase AI Logic server → Gemini) | Managed proxy with App Check attestation and **per-user rate limits** built in; no custom server | Zero-ops, keeps the "no backend" spirit, key never leaves Google. **Feature parity confirmed from release notes/docs (2026-09-07):** the JS SDK supports `generateContentStream`, `safetySettings` (set on the `GenerativeModel`), `thinkingConfig` incl. thinking levels + thought summaries, and `usageMetadata` **with `cachedContentTokenCount` / `cacheTokensDetails`** for implicit-cache savings. Per-user limits are configurable across RPM / RPD / TPM / TPD (default 100 RPM per user); the underlying Gemini API project quota still applies on top. | **It is a rate limiter, not a meter.** Nothing in it counts turns against an entitlement or knows what a plan is — per-user turn counters, plan checks, and cutoffs still need our own Firestore rules/functions, so "zero backend" is really "zero *proxy* code, some entitlement code". The client would talk the Firebase SDK object model rather than our raw `fetch` + `readSseStream`, so the hosted door becomes a *second Gemini provider adapter* (the BYOK adapter stays as-is). App Check attestation providers can add cost on Blaze (reCAPTCHA Enterprise). Ties the hosted door to Gemini only (acceptable — that's the settled posture). `responseSchema` support not yet checked. |
| **Cloud Functions / Cloud Run proxy** (own code) | Thin function: verify Firebase Auth token, check entitlement in Firestore, forward to Gemini, stream back, decrement turns | Full control over metering, model routing, standard/premium turns, abuse cutoffs; invocation cost ~$0.40/M + compute — negligible per turn (<$0.001) | We own uptime, cold starts on streaming (min-instances cost), secret handling, and a second deploy target |
| **Third-party gateway** (OpenRouter-style) | Route through an aggregator with its own key management | Multi-model premium narrators without holding provider keys | 5–5.5% fee, another vendor in the chat path, still needs our own auth + metering layer |

**Leaning (sharpened 2026-09-07):** the two viable shapes are now clearer. **Shape 1 — Firebase AI Logic + Firestore entitlements:** AI Logic carries the key and the per-user abuse ceiling; a tiny Cloud Function (or Firestore transaction from the client under rules) decrements a turn counter *before* each DM call and refuses when the plan is spent. Cheapest to build, no streaming proxy to operate, but the turn decrement is client-initiated and therefore only as trustworthy as App Check + rules, and metering is per *call*, not per *token*. **Shape 2 — own Cloud Function/Run streaming proxy:** one code path for BYOK and hosted (the adapter just changes base URL), token-exact metering from the real `usageMetadata`, server-side prompt-variant selection (§5), and standard/premium routing — at the cost of operating a streaming service (min-instances for cold starts, secrets, a second deploy). Recommendation: **spike Shape 1 first (one day)** because it can ship a paid door with almost no new infrastructure; move to Shape 2 the moment token-exact metering or server-side prompt control matters, which is the day the standard/premium split or the hosted content variant ships. Either way the client keeps a provider adapter that can point at the proxy exactly like it points at Gemini today.

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

**Recommendation:** hosted door = **one curated narrator per turn class** (standard/premium), never a free model picker — every competitor that exposes model choice ends up pricing it by credit burn (AI Dungeon, Sudowrite, and since late 2025 Friends & Fables' "Model Switching"), which turns the price page into a token-economics lesson. Offer at most a two-way "Standard / Premium narrator" toggle once Option C is live. BYOK door keeps the full picker. Adding a non-Gemini premium narrator later is an OpenRouter-style routing question, not a product question, and it costs us a second tuning baseline — don't pay that before the first paying cohort exists.

---

## 5. Content policy on the hosted door (the biggest single blocker)

Today's default DM prompt is adult-capable, and the app declares `BLOCK_NONE`. On a hosted key that means Google's abuse monitoring sees explicit narration under *our* account with 55-day retention, and Stripe-class processors see "AI roleplay app with adult content" on risk review. Both can end the business overnight.

Options:

1. **Hosted door is policy-compliant by construction; unfiltered play is BYOK-only.** Hosted default prompt = mature-but-not-explicit (dark, violent, romantic, morally grey stays — that is most of the demand per MARKETING.md), explicit scenes fade-to-black. Marketing: "you set the line" attaches to BYOK; hosted copy says "mature themes, your rules" without explicit promises. Payments via an ordinary MoR. *Cheapest, safest, keeps every channel open.*
2. **Hosted explicit tier on a permissive provider** (the NovelAI model). Requires a provider whose API terms allow adult fiction, a high-risk processor (higher fees, reserves, chargeback exposure), age verification (UK OSA, US state laws), and a separate legal review. A different business; park it.
3. **Do nothing** — not an option; it's the one path that risks the Google account the whole machinery layer depends on.

**Provider policy landscape (scanned 2026-09-07) — who could even carry option 2:**

| Provider | Adult fiction on the API | Status |
|---|---|---|
| **Google Gemini** | No. The Prohibited Use Policy refresh added artistic/educational/journalistic exceptions, but nothing that reads as an adult-fiction carve-out; abuse monitoring is automated. | Rules out our own key for explicit play — as assumed. |
| **OpenAI** | The usage policy was rewritten to permit "consensual, age-appropriate adult themes" for developers, but the consumer **"adult mode" was paused indefinitely in March 2026** over minor-access and attachment concerns. Enforcement posture for API developers is therefore unclear. | Not a foundation to build a tier on. |
| **xAI (Grok)** | The AUP permits text-based sexual situations and adult fiction with invented adult characters (never real persons, never minors); moderation stays on even with NSFW settings, no allowlist, no output guarantee. | **The only major API that tolerates the content** — and the narrator we shelved for weak game-event compliance. A hosted explicit tier would mean Grok narration + our full audit family, on a high-risk processor. |
| Own/permissive open model (NovelAI's route) | Full control; full liability. | Out of scope for a solo developer. |

So option 2 is not merely expensive — its only realistic narrator is the one the engine trusts least, and its payment rail is the one no indie MoR will provide. The BYOK door already gives players that route on *their* Grok/OpenAI key with none of the liability on us. That is the answer to "how does Quest Forge serve the uncensored demand": **BYOK is the explicit tier**, and marketing should say so plainly rather than promising it on the hosted product.

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
- **2026 subscription-app benchmarks (RevenueCat State of Subscription Apps 2026, added 2026-09-07):**
  - **Hard paywalls convert ~5× freemium** (10.7% vs 2.1% download-to-paid by day 35) with near-identical year-one retention; opt-in trials without a card average ~8.9% trial-to-paid (4–6% is "good", 10–15% "great"); card-required trials 31%.
  - **AI apps earn ~41% more per customer but churn ~30% faster**: annual retention 21% vs 31% for non-AI apps; monthly-plan retention 6% vs 9.5%. Assume a paying player lasts **3–5 months**, so LTV ≈ 3–5 × ARPU ≈ €30–60 and CAC must stay under ~€15–20 — which rules out paid acquisition and confirms SEO + communities + referral as the only channels that pencil.
  - **Day zero decides**: most conversions and most trial cancellations happen in the first session.
  - What this changes for us: (a) the 30-turn card-free trial should end in a **hard-ish wall** (BYOK door offered as the free alternative, hosted plan as the paid one) rather than a lingering freemium drip; (b) the "first ten minutes" onboarding item on the launch gate is the *monetization* feature, not a polish item — premise → hero reveal → first scene must land inside the trial's first session; (c) retention beats acquisition for an AI app: the memory/callback machinery is our retention engine and belongs in the trial (a Scribe-less trial would be cheaper and self-defeating); (d) an annual plan at ~17% off (the F&F ratio) is worth offering from day one purely to fight the AI-app churn curve.
- **Where the free tier lives:** LoreKeeper's apparent move from 20 daily free turns toward a one-time credit grant (if the newer source is right) would be the first hosted rival *retreating* from the daily-grant funnel — consistent with the cost math in §2. Our BYOK door is the structurally free tier no hosted rival can copy; the hosted trial only has to be good enough to show the memory working once.

---

## 7. Open questions and blockers (ordered by how much they gate)

1. **Unit economics are unmeasured.** Cache-hit rate, real tokens in/out, **thinking tokens per DM call**, $/turn per lane, TTFT — track A (`usageMetadata` instrumentation) resolves this in one playtest. Still unstarted as of 2026-09-07 (no `usageMetadata` read in `src/`). *Blocker for any price.*
2. **Can a Flash-class narrator carry the standard turn — and is it still worth it at 2027 prices?** Run eval:combat + eval:memory + golden fixtures on 3.7/3.8 Flash as DM. Yes + margin survives the January step → Option C is on; otherwise the hosted door stays Pro-only at the re-priced allowances in §2.
3. **Hosted content posture** (§5): confirm option 1; write the hosted prompt variant; decide age-gate mechanics (18+ self-attestation suffices while the door is non-explicit and single-player; a sharing feature or the UK OSA amendment changes that). *Blocker for holding a hosted key at all.*
4. **Key proxy architecture:** Firebase AI Logic + Firestore entitlements (Shape 1) vs own streaming proxy (Shape 2) — §3.2. Feature parity for Shape 1 is confirmed from docs; the spike now has to answer only the metering question: is a client-initiated per-call decrement under App Check + rules trustworthy enough for a paid door? *Launch-critical, not started.*
5. **Metering unit and combat pricing:** 1 turn = 1 DM call; a combat exchange = 2 DM calls plus narration — charge 2, or 1.5 and eat the difference? Table-talk (OOC) turns are cheap but still a DM call — charge or free?
6. **Legal entity and MoR:** sole trader is enough to start; the MoR is the seller of record so consumer VAT never touches us (§1.4). Choose between Lemon Squeezy / Paddle / Polar **and obtain written pre-clearance for "AI tabletop RPG, mature themes, no explicit content"** before building checkout — all three list adult/age-restricted content as prohibited and Polar reviews every AI product. Also weigh Polar's +1.5% non-US-card fee for a Euro-heavy audience.
6a. **Machinery model per lane (new 2026-09-07):** 3.7 Flash tripled machinery cost vs Flash-Lite and doubles again in January. Decide, with track A data, which lanes need Flash quality (Scribe merges) and which can drop to Flash-Lite (roll-policy audit, journal summaries?) — a per-lane model in `getBackgroundConfig` rather than one constant.
6b. **Small-pack fee floor (new 2026-09-07):** a €0.50 fixed MoR fee makes a €5 pack pay 15% in fees. Set the smallest purchasable pack at ~€8, or bundle the starter pack into the first month of a plan.
7. **Rollover vs expiry** for included turns: OGT rolls over (players love it), Sudowrite/F&F expire (margin). Suggest: subscription turns expire, purchased packs never do.
8. **Open source or not** (§3.3). Decide before launch.
9. **Production image chain:** hosted xAI key for Grok Imagine (another key, another policy, another meter) vs Gemini-image-only. Images are the second cost center; price scene art as premium credits or cap per plan.
10. **Stable-model pinning and swap policy** on the hosted door: every provider model swap changes cost and quality; the eval gate exists, the cadence does not.
11. **Fair-use and abuse controls** on the hosted door: automated turn spam against our key is a direct wallet attack; per-user RPM limits + daily caps + App Check are the minimum.
12. **What the BYOK Supporter tier actually contains** (if anything) so the free BYOK door stays credible as "free".
13. **LoreKeeper's real current pricing** (new 2026-09-07): sources disagree (€7.99 + 20 daily free turns vs $9/$19/$39 + 500 one-time credits). Check the live page by hand; if they dropped the daily grant, update COMPETITORS.md — it changes the "generous free funnel" story the category tells about itself.
14. **Thinking on the DM lane** (new 2026-09-07): if track A shows thinking tokens are a large share of output cost, decide whether a bounded `thinkingConfig` on the DM call survives the narration-quality evals. Never decide this on cost alone — it's the money-maker lane.
15. **Annual plan from day one?** The AI-app churn data (§6) argues yes at ~15–20% off; the counter-argument is refund exposure while the product is young. Decide with the MoR's refund policy in hand.

---

## 8. Proposed phasing

- **Phase 0 — measure (now, engineering only):** track A instrumentation **(per lane, incl. thinking + cached token counts)**; Flash-narrator eval **modelled at 2027 prices**; proxy spike (Shape 1 first); the MoR pre-clearance email (costs nothing, may take weeks). Output: a real $/turn table replacing §2's estimates, and a written yes/no from a payment partner.
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

### Added 2026-09-07 (second research pass; vendor pages still egress-blocked, so numbers come from search snippets of the pages named)

Competitor pricing re-verification:
- OGT — [The Tavern Levels Up: Memory, Subscriptions & More (rollover + Legend top-up price)](https://oldgregstavern.beehiiv.com/p/the-tavern-levels-up-memory-subscriptions-more) · [OGT vs F&F plan comparison (F&F-authored)](https://fables.gg/blog/old-gregs-tavern-vs-friends--fables-plan--feature-comparison)
- F&F — [Pricing page](https://play.fables.gg/pricing) · [Patch notes 25.44/25.45: model switching + pricing update](https://fables.gg/patch-notes/patch-notes-2545-fenix-model-switching-pricing-update) · [Arcanum review](https://arcanumrpgs.com/blog/friends-and-fables-review/)
- LoreKeeper — [char-gen alternatives listing ($9/$19/$39, 1 credit = 3 rounds)](https://char-gen.com/alternatives/lore-keeper) · [theresanaiforthat listing](https://theresanaiforthat.com/ai/lorekeeper/) · [LoreKeeper help center](https://help.lore-keeper.com/getting-started/what-is-lorekeeper) · [RoleForge's top-5 comparison](https://roleforge.ai/blog/best-ai-game-master-tools-compared/)

Gemini pricing and caching:
- [Gemini 3.1 Pro pricing incl. caching and thinking tokens (Verdent)](https://www.verdent.ai/guides/gemini-3-1-pro-pricing) · [Gemini API pricing Sept 2026 (BenchLM)](https://benchlm.ai/google/api-pricing) · [Gemini API pricing calculator (costgoat)](https://costgoat.com/pricing/gemini-api) · [Context caching cost optimisation](https://techjacksolutions.com/ai-tools/google-gemini/gemini-context-caching-cost-optimization/) · [Gemini 3.5 Flash review + Flash intro-pricing schedule](https://www.buildfastwithai.com/blogs/gemini-3-5-flash-review-benchmarks-price-api) · [CloudZero: thinking tokens nobody budgeted for](https://www.cloudzero.com/blog/gemini-pricing/) · [gemini-embedding-2 price](https://aicostcheck.com/model/gemini-embedding-2-preview)

Firebase AI Logic parity:
- [Firebase JS SDK release notes (usageMetadata cache fields, thinkingConfig, generateContentStream)](https://firebase.google.com/support/release-notes/js) · [AI Logic thinking docs](https://firebase.google.com/docs/ai-logic/thinking) · [AI Logic safety settings](https://firebase.google.com/docs/ai-logic/safety-settings) · [AI Logic pricing](https://firebase.google.com/docs/ai-logic/pricing) · [AI Logic Sept 2025 feature update](https://firebase.blog/posts/2025/09/firebase-ai-logic-updates/)

Payments, MoR acceptable use, VAT:
- [Paddle: what am I not allowed to sell](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle) · [Paddle AUP update on gen-AI (Boathouse)](https://www.boathouse.co/paddle-video-series-episode/34-aup-update-gen-ai) · [Polar acceptable use](https://polar.sh/docs/merchant-of-record/acceptable-use) · [Polar AUP (legal)](https://polar.sh/legal/acceptable-use-policy) · [Polar review 2026 incl. fee changes](https://dodopayments.com/blogs/polar-sh-review) · [Lemon Squeezy prohibited products](https://docs.lemonsqueezy.com/help/getting-started/prohibited-products)
- [Finland VAT 2026 thresholds (1Office)](https://1office.co/blog/vat-registration-finland-2026-guide/) · [vero.fi: VAT for small business](https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/vat/vat-for-small-business/) · [EU VAT for SaaS 2026: thresholds, OSS (Dodo)](https://dodopayments.com/blogs/eu-vat-saas-guide-2026) · [When and where to charge EU VAT on digital services (Taxually)](https://www.taxually.com/blog/when-and-where-to-charge-eu-vat-on-digital-services)

Provider content policy and age assurance:
- [OpenAI usage policies](https://openai.com/policies/usage-policies/) · [ChatGPT adult mode paused (justainews, May 2026)](https://justainews.com/companies/openai/adult-mode-in-chatgpt-explained-nsfw-erotica-porn-policy/) · [Built In: adult content for verified users](https://builtin.com/articles/chatgpt-ai-erotica-rollout)
- [xAI Acceptable Use Policy (Grokipedia summary)](https://grokipedia.com/page/xAI_Acceptable_Use_Policy) · [Grok NSFW policy 2026 (AI Academy)](https://academy.techpresso.co/prompts/grok-nsfw-prompts)
- [Google refreshes Generative AI Prohibited Use Policy (SEJ)](https://www.searchenginejournal.com/google-refreshes-generative-ai-prohibited-use-policy/535580/) · [Google's own announcement](https://blog.google/feed/were-updating-our-generative-ai-prohibited-use-policy/)
- [Ofcom: AI chatbots and online regulation](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/ai-chatbots-and-online-regulation-what-you-need-to-know) · [RPC on Ofcom's chatbot explainer](https://www.rpclegal.com/snapshots/technology-digital/spring-2026/ofcom-publishes-an-explainer-on-the-regulation-of-ai-chatbots-under-the-online-safety-act/) · [Lewis Silkin: OSA reforms fast-tracked for AI](https://www.lewissilkin.com/insights/2026/02/23/online-safety-reforms-to-be-fast-tracked-amid-rising-ai-risks-102mk2r) · [OneID: age verification under the OSA](https://oneid.uk/news-and-events/uk-online-safety-act-age-verification-guide)

Conversion and retention benchmarks:
- [RevenueCat State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps) · [RevenueCat: the report in 10 minutes](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026) · [TechNewsWorld: AI apps earn more, retain less](https://www.technewsworld.com/story/ai-apps-generate-revenue-but-struggle-with-retention-180236.html) · [Userpilot trial conversion benchmarks](https://userpilot.com/blog/saas-average-conversion-rate/)

---

## Changelog

- **2026-09-07 — second research pass** (scheduled productization task). Prices re-verified via secondary sources (OGT and F&F confirmed; LoreKeeper contradictory → open question 13; LoreKeeper confirmed hosted/no-BYOK, closing the COMPETITORS.md TODO). **Cost model corrected:** machinery is `gemini-3.7-flash`, not Flash-Lite, and all 3.6–3.8 Flash models double in price on 2027-01-01 — §2 rebuilt with per-stack 2026 vs 2027 columns, thinking tokens flagged as the unknown, the Flash-narrator saving shown to shrink to ~15–20% after January, and the plan sketch re-priced (smaller allowances at ~€0.065/turn, fee-floor note for small packs). Firebase AI Logic confirmed feature-complete from docs (streaming, safety, thinking, cached-token usage metadata, per-user RPM/RPD/TPM/TPD) but positioned as a rate limiter that still needs our entitlement counter; hosting leaning rewritten as Shape 1 (AI Logic + Firestore entitlements) spike-first, Shape 2 (own streaming proxy) when token-exact metering or server-side prompt variants matter. MoR acceptable-use checked for Paddle, Polar, Lemon Squeezy — all prohibit adult/age-restricted content, Polar reviews every AI product; action is a written pre-clearance. EU VAT mechanics for a Finnish seller summarised (€20k domestic, €10k EU cross-border micro-threshold, MoR-as-seller makes it moot). Provider policy table added to §5 (Google no, OpenAI paused, xAI tolerated-with-moderation) with the conclusion that **BYOK is the explicit tier**. UK OSA scope notes added (single-player chatbot out of scope today; explicit content or user-to-user sharing changes that; amendment pending). RevenueCat 2026 benchmarks added to §6 (hard paywall 5× freemium, AI apps churn 30% faster, day-zero conversion) with four concrete implications. Open questions grew from 12 to 15 (+6a/6b); Phase 0 now includes the MoR pre-clearance email. Nothing decided — Vesa reviews; settled calls go to DECISIONS.md.
- **2026-09-06 — created** (scheduled productization task). Initial research pass: competitor pricing table (OGT, LoreKeeper, F&F, AI Dungeon, Dungeons Deep, RoleForge) and adjacent products (NovelAI, Sudowrite, companion-app category data); five pricing options with a two-door (BYOK free + hosted metered) recommendation and an honest margin sketch showing current-stack economics do not clear OGT price points without a verified cache or a Flash-class standard narrator; hosting options (Firebase AI Logic vs own Cloud Function proxy vs aggregator); fixed-narrator recommendation for the hosted door; the hosted content-policy blocker with a launch recommendation (compliant hosted door, unfiltered play BYOK-only); acquisition patterns (card-free trial, referral turns, SEO comparison content, communities); 12 open questions; 4-phase plan. Several vendor pages were egress-blocked from the sandbox — numbers are from search snippets and secondary reviews; re-verify before use in copy.
