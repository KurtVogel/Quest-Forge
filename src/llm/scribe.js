/**
 * Scribe — a lightweight Gemini 2.5 Flash call that runs silently after every
 * DM response. It extracts structured world-state updates from the narrative:
 * new world facts, NPC data, and notable consequences.
 *
 * The Scribe does NOT replace the journal summarizer. It runs every turn for
 * granular extraction; the journal runs every 10 messages for narrative archiving.
 *
 * Cost: ~Gemini 2.5 Flash rates (tiny fraction of the DM model cost).
 */

import { sendMessage } from './adapter.js';
import { getBackgroundConfig } from './machinery.js';
import { classifyNpcCandidate, curateNpcsForPrompt } from '../engine/npcRoster.js';
import { extractBalancedJson, repairJson } from './utils/jsonExtractor.js';
import { captureReflection, captureScribePass } from '../dev/memoryInspectorStore.js';
import { computeRecentHeat, normalizePaceDial, TEMPO_TIMING_DIE_SIDES } from '../engine/worldTempo.js';
import { rollDie } from '../engine/dice.ts';

const SCRIBE_SYSTEM_PROMPT = `You are a meticulous game world record-keeper. Given a DM's narrative response and the player's action that prompted it, extract any new canonical facts about the game world. Every field you output is an UNVARNISHED record: complete and frank about every fact the fiction establishes, never a censored, selective, or tastefully vague account — written in neutral, matter-of-fact language (see the REGISTER rule).

Output ONLY valid JSON:
{
  "world_facts": [
    { "fact": "A canonical statement of something now true in this world", "category": "lore|character|location|event|relationship" }
  ],
  "npc_updates": [
    {
      "name": "NPC name",
      "kind": "character|creature|ephemeral",
      "rosterEligible": true,
      "disposition": "friendly|neutral|hostile|wary|unknown",
      "lastNotes": "brief note on what happened with them this turn",
      "personality": "trait observed (only if newly revealed)",
      "goals": "what they want (only if newly revealed)",
      "secrets": "hidden info (only if newly hinted at or revealed)",
      "appearance": "concrete physical/visual description — build, body proportions, face, hair, clothing, distinguishing features (only if newly described)",
      "basedIn": "place they are currently rooted — town they command, post they hold, territory they haunt. Update when fiction relocates or reassigns them; omit if unknown",
      "lastLocation": "where they were in this specific exchange (only if mentioned)",
      "agenda": "what this NPC is likely trying to accomplish next (only if implied or revealed)",
      "relationshipTension": "compact note about attraction, rivalry, resentment, debt, loyalty, fear, or trust strain",
      "stanceToPlayer": "how this NPC personally regards the HERO right now — affection, attraction, romantic interest, friendship, gratitude, respect, amusement, resentment, fear, obligation, rivalry. Written from the NPC's side, complete and current (only when this exchange establishes or shifts it)",
      "bondMoment": "one-line record of a significant personal moment between the hero and this NPC THIS turn — flirtation, confession, kiss, shared secret, gift, rescue, promise, betrayal, deep insult. Omit for ordinary interaction",
      "trust": 0,
      "privateNotes": "hidden NPC intent or unrevealed motive useful for future consistency",
      "callbackHooks": ["short hooks this NPC could later bring back naturally"]
    }
  ],
  "story_memory": [
    {
      "type": "callback|promise|wound|relationship|mystery|playerCanon|foreshadow|npcAgenda",
      "text": "compact memory card, written as something the DM can naturally use later",
      "subject": "person, place, object, promise, wound, rumor, or unresolved thread",
      "tags": ["short", "searchable", "tags"],
      "salience": 1,
      "emotionalCharge": 0,
      "linkedNpcNames": ["exact NPC names"],
      "location": "place tied to the memory if any",
      "source": "scribe"
    }
  ],
  "player_appearance": "concrete physical/visual description of the PLAYER's character, only if newly described this turn — otherwise omit",
  "location": "Current location if changed, or null",
  "location_profile": { "name": "place name exactly as the narrative calls it", "type": "haven|settlement|wilderness|frontier|hostile_site", "danger": "none|low|moderate|high|deadly" }
}

Rules:
- HARD EXTRACTION BUDGET: at most 2 world_facts and 2 story_memory cards per turn (3 only on a truly pivotal turn). Most ordinary turns — travel, shopping, small talk, routine fights — should produce ZERO of each. When over budget, keep only the most campaign-defining entries and drop the rest. This budget NEVER applies to npc_updates, "appearance", "player_appearance", or "location" — visual and positional continuity is always captured in full.
- World facts are durable, campaign-level truths a DM would still need many sessions later: deaths, alliances, betrayals, discoveries, curses, historical facts revealed
- Do NOT record transient action descriptions, scene-level detail, prices, purchases, minor chatter, or restatements of anything already implied by an existing fact ("Player attacked goblin" is not a world fact)
- DO record outcomes: "The goblin captain Rarg is dead", "The village of Millhaven burned to the ground"
- Story memory is for emotionally or dramatically useful callbacks: promises, debts, named objects, scars, injuries, insults, flirtation, fears, private vows, unresolved clues, player-authored proper nouns, foreshadowing, NPC agendas, and relationship tension. A card must earn its slot: if you cannot picture the DM paying it off in a later scene, do not write it.
- Capture player-authored canon from the player's action when it concerns their own compatible backstory, vows, names, and personal attachments the DM should remember later.
- A player message is not authoritative evidence about external reality. Do not turn player-asserted creatures, objects, exits, relationships, events, enemy behavior, or outcomes into world_facts, NPC updates, or playerCanon unless the DM narrative explicitly accepts or establishes them.
- When AUTHORITATIVE ENGINE STATE is provided, it overrides the prose. Never record a combatant dead, alive, fled, surrendered, victorious, or defeated contrary to that state.
- Keep story_memory compact; do not duplicate ordinary world_facts unless the memory has callback value.
- Only include npc_updates for NPCs that appeared in this specific exchange
- The hero's PARTY COMPANIONS are NPCs for record-keeping: emit npc_updates for them (stanceToPlayer, bondMoment, appearance, personality, goals) exactly like any other character — never skip someone because they travel with the hero. The party is the game's most sustained relationship, so companion stance shifts and bond moments matter MORE than a stranger's, not less.
- basedIn is the NPC's current anchor in the world (not permanent): update it when they are reassigned, relocate, or fiction establishes a new base. lastLocation is ephemeral — where they were this turn
- stanceToPlayer is about the personal relationship between this NPC and the HERO specifically — their feelings toward the hero, not their role or plot function. Update it whenever an exchange genuinely shifts how they regard the hero: a flirtation received warmly or coldly, gratitude after a rescue, trust broken, growing attraction or contempt. Write it unvarnished — desire, resentment, and awkwardness named plainly. When KNOWN PLAYER-RELATIONSHIP STANCES lists this NPC, emit the COMPLETE updated stance: start from the known stance and weave in what this turn changed — never a fragment that would erase the rest. If nothing shifted for them personally, omit the field.
- bondMoment must be an actual NEW event from THIS exchange, stated concretely with both parties ("The hero flirted with Maren over the map table; she laughed and let her hand linger"). At most one per NPC per turn; interpersonal continuity is exempt from the extraction budget. If KNOWN PLAYER-RELATIONSHIP STANCES already lists a moment covering this beat, omit bondMoment entirely — never re-report or paraphrase a recorded moment.
- Use kind "character" and rosterEligible true only for named people worth tracking across sessions (dialogue, rivalry, debt, secrets, recurring villains, quest givers). Use kind "creature" or "ephemeral" with rosterEligible false for nameless combat fodder, generic goblins/guards, or one-line minions that should not enter the durable roster.
- Capture "appearance"/"player_appearance" from concrete visual details the narrative actually states — never invent looks. These feed scene-art generation AND the DM's own long-term visual continuity, so accuracy matters.
- This is an adult game: body proportions and intimate, sensual, unflattering, or even embarrassing anatomical details the fiction establishes (a heavy backside, wide hips, a soft belly, body hair anywhere) are canonical visual continuity exactly like a scar or white hair. Record them frankly, completely, and at full specificity — never sanitize, euphemize, tone down, or silently omit them. For many players this continuity IS the point.
- REGISTER: write every record in plain, neutral anatomical language — backside/buttocks, breasts, chest, hips, genitals — never in profanity or crude slang, no matter how coarsely the player or DM phrased it. Translating vocabulary is NOT censoring content: keep the full detail, size, and specificity of what the fiction established. "Notably large buttocks" preserves a crude description completely; "curvy", a vague compliment, or dropping the detail loses canon and is forbidden. Neutral wording, complete facts.
- When KNOWN APPEARANCES lists a character and this turn adds or changes a visual detail, emit their appearance as the COMPLETE updated description: start from the known look and weave in what this turn established. Drop or alter a known detail ONLY when the fiction explicitly changed it (haircut, dye, disguise, wound, healing, new gear). NEVER emit just the new fragment — "a fresh scar on his cheek" alone would erase the white hair, the build, everything else on record. When merging, never launder the record: an intimate or unflattering detail already in KNOWN APPEARANCES stays in the merged description at full specificity until the fiction explicitly changes it — if the old record used crude slang, restate that detail in neutral anatomical wording (see REGISTER), but never blur, shrink, or drop it. As you merge, reconcile the description into clean prose: drop duplicate adjectives and resolve contradictions rather than stacking them ("scrawny ... scrawny ... large backside" should become one coherent line like "a scrawny goblin with notably large buttocks"), but never lose a distinct established detail in the process. If this turn adds nothing visually new for them, omit the field entirely.
- location_profile classifies what KIND of place the current location is, from what the narrative itself establishes: a haven is genuinely safe (a defended town, a temple sanctuary), a settlement is ordinary inhabited civilization, wilderness is uninhabited country, a frontier is contested or lawless ground, a hostile_site is intrinsically dangerous by nature (a ghoul-warren, a bandit camp). "danger" is the place's own intrinsic danger, independent of any current plot. Emit it when a location is first meaningfully established or when the fiction changes a place's fundamental nature (the town falls, the warren is cleared) — omit otherwise. Positional continuity, like appearance, is exempt from the extraction budget.
- Only include fields you have actual information for — omit empty/unknown fields
- DO NOT alter established details: copy names, proper nouns, and numbers exactly as the DM wrote them — never rename, paraphrase, translate, or invent (the REGISTER rule for anatomical vocabulary is the one exception). Refer to each NPC by the exact name used in the narrative so their record never forks.
- ONE PERSON, ONE RECORD: when a character's proper name is known — from the narrative, KNOWN APPEARANCES, or KNOWN PLAYER-RELATIONSHIP STANCES — always use their FULLEST known name ("Saima Aallotar", not "Saima") and NEVER a role title ("The Innkeeper", "the merchant"). Role-title names are allowed only for characters whose proper name has genuinely never been given.
- If nothing notable happened (pure narration, no new facts), return { "world_facts": [], "npc_updates": [], "story_memory": [], "location": null }
- Output ONLY the JSON, no other text`;

const LOOT_AUDIT_RULES = `

ADDITIONAL TASK — LOOT & PAYMENT PERSISTENCE AUDIT:
The game engine persists coins and items ONLY from structured events; anything narrated but not emitted as an event silently vanishes. Compare the DM narrative against the EVENTS ALREADY APPLIED section of the user message and report acquisitions the narrative established that the engine did not apply, as one extra top-level field:
"missing_loot": { "gold": 0, "silver": 0, "copper": 0, "items": [{ "name": "exact item name from the narrative", "quantity": 1 }] }
Also report coins the narrative shows the hero PAYING OUT that the engine never deducted, as another top-level field:
"missing_payment": { "gold": 0, "silver": 0, "copper": 0 }

Loot audit rules:
- Report ONLY acquisitions the DM NARRATIVE explicitly completes for the hero: taken, pocketed, looted, claimed, received, handed over. The player's own message is never sufficient evidence — the DM narrative must confirm the acquisition happened.
- Anything listed under EVENTS ALREADY APPLIED is NOT missing. Report only the shortfall (narrative grants coins and a ring, events applied only the coins -> report only the ring).
- Never report offers, prices, rewards merely promised, goods only seen or described, another character's possessions, or attempts/intentions.
- Never report coins or items the narrative merely recalls, recounts, splits, or admires from an EARLIER scene — only acquisitions completed for the first time in THIS narrative. A reward being counted, divided, or mentioned again was already granted when it was first handed over.
- Hospitality consumed on the spot is not an acquisition: a poured drink, a served meal, food and ale enjoyed at the table never become inventory. Report provisions only when the narrative has the hero pack, pocket, or carry them away.
- Exact amounts only. If the narrative gives no specific number ("a handful of coins"), omit that coin field entirely — never estimate.
- Denominations are sacred: report coins in the EXACT denomination the narrative names and NEVER convert between them — "thirty silver pieces" is "silver": 30 (never "gold": 30), "fifty silver" is "silver": 50, "two gold crowns" is "gold": 2. This applies to missing_payment identically.
- Purchases and sales are engine transactions handled elsewhere; never report coins or goods exchanged in a purchase or sale — in either direction.
- The HERO'S CURRENT INVENTORY line lists what the hero already owns. Using, drawing, lighting, striking, wearing, or retrieving an owned item is NOT an acquisition — "she takes out her flint and steel and strikes a spark" grants nothing. Report an item the hero already owns ONLY when the narrative explicitly completes acquiring an ADDITIONAL copy (a second rope, another potion).

Payment audit rules:
- Report a payment ONLY when the DM narrative explicitly completes it: the hero counts out, hands over, or drops the coins and the other party takes them. Intentions, promises, IOUs, haggling, and prices merely quoted are never payments.
- Anything listed under EVENTS ALREADY APPLIED as a coin loss or purchase is NOT missing.
- Copy narrated amounts digit-exactly; spelled-out numbers convert exactly ("six silver" is "silver": 6, "a dozen coppers" is "copper": 12). Never round, estimate, or infer an amount the narrative does not state.
- Shortfalls count: when the narrative names an exact price the hero completes paying and EVENTS ALREADY APPLIED shows a SMALLER coin loss for that same payment, report exactly the difference (narrative says six silver paid, events applied silver -4 -> "missing_payment": { "silver": 2 }). Never re-report the part already deducted.
- Never re-report a payment the narrative merely recalls, confirms, defends, or references from an EARLIER scene — only payments completed for the first time in THIS narrative. "You already paid the six silver" is a recollection, not a new payment.
- Exact amounts only; never estimate. A wrongly deducted coin is worse than a missed one — certainty is required.
- When in doubt, omit. Omit "missing_loot" and "missing_payment" entirely when nothing is missing.

Also report gear the narrative shows the hero handing to a COMPANION that the companion accepts and takes up, when the engine applied no matching companion update, as another top-level field:
"missing_gear_handoffs": [{ "companion": "exact companion name", "item": "exact item name", "kind": "weapon" }]

Gear handoff rules:
- Report ONLY handoffs the DM narrative completes: the companion accepts and takes up the item (straps it on, sheathes it, dons it, tucks it away). Offers, refusals, loans for a single moment, and mere suggestions are never handoffs.
- "kind" is "weapon" for weapons, "armor" or "shield" for protection the companion now wears, "keepsake" for a sentimental item with no combat use.
- PARTY COMPANIONS' CURRENT GEAR lists what each companion already carries — an item already listed there is NOT a new handoff, and narration merely referencing or admiring their existing gear reports nothing.
- Anything under EVENTS ALREADY APPLIED (companion gear or keepsake updates, items lost by the hero) is NOT missing.
- Copy the companion's and the item's names exactly as the narrative writes them.
- When in doubt, omit — an invented handoff is worse than a missed one. Omit "missing_gear_handoffs" entirely when nothing is missing.`;

/** Compact owned-inventory summary so the audit can tell "using" from "acquiring".
 * Live Grok finding 2026-07-09: "takes out her flint and steel" read as a completed
 * take and re-granted gear the hero already owned. */
function describeOwnedInventory(state) {
    const summary = (state?.inventory || [])
        .map(item => {
            const name = String(item?.name || '').trim();
            if (!name) return null;
            const qty = Number.isFinite(item?.quantity) && item.quantity > 1 ? ` x${item.quantity}` : '';
            return `${name}${qty}`;
        })
        .filter(Boolean)
        .join('; ');
    return summary ? summary.slice(0, 800) : null;
}

/** Compact human-readable summary of the loot-relevant events the engine applied. */
function describeAppliedLoot(events) {
    if (!events) return 'None. No structured events were applied for this narrative.';
    const parts = [];
    if (events.goldFound > 0) parts.push(`gold +${events.goldFound}`);
    if (events.silverFound > 0) parts.push(`silver +${events.silverFound}`);
    if (events.copperFound > 0) parts.push(`copper +${events.copperFound}`);
    if (events.goldLost > 0) parts.push(`gold -${events.goldLost}`);
    if (events.silverLost > 0) parts.push(`silver -${events.silverLost}`);
    if (events.copperLost > 0) parts.push(`copper -${events.copperLost}`);
    for (const item of events.itemsFound || []) {
        parts.push(`item: ${typeof item === 'string' ? item : item?.name || item?.itemKey || 'unknown'}`);
    }
    for (const item of events.itemsLost || []) {
        parts.push(`item lost by hero: ${typeof item === 'string' ? item : item?.name || 'unknown'}`);
    }
    for (const update of events.updateCompanions || []) {
        const gearBits = [];
        if (update?.weapon) gearBits.push(`weapon ${update.weapon}`);
        if (update?.ac !== undefined) gearBits.push(`AC ${update.ac}`);
        if (update?.keepsake) gearBits.push(`keepsake ${update.keepsake}`);
        if (gearBits.length > 0) parts.push(`companion gear update (${update?.name || update?.id || 'companion'}): ${gearBits.join(', ')}`);
    }
    for (const purchase of events.purchases || []) parts.push(`purchase: ${purchase?.itemKey || purchase?.name || purchase?.item?.name || 'item'}`);
    for (const sale of events.sells || []) parts.push(`sale: ${sale?.itemKey || sale?.name || 'item'}`);
    for (const item of events.startingItems || []) parts.push(`starting item: ${item?.name || item?.itemKey || 'unknown'}`);
    return parts.length ? parts.join('; ') : 'None. No coins or items were applied for this narrative.';
}

function coerceLootAmount(value, max = 10000) {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(max, Math.trunc(num)));
}

/** Compact companion-gear summary so the gear-handoff audit can tell "already
 * carries" from "just received". */
function describePartyGear(state) {
    const lines = (state?.party || [])
        .map(companion => {
            const name = String(companion?.name || '').trim();
            if (!name) return null;
            const bits = [`weapon: ${companion.weapon || 'Unarmed'}`, `AC ${companion.ac ?? '?'}`];
            const keepsakes = (companion.keepsakes || []).filter(Boolean);
            if (keepsakes.length > 0) bits.push(`keepsakes: ${keepsakes.join(', ')}`);
            return `${name} — ${bits.join(', ')}`;
        })
        .filter(Boolean)
        .join('; ');
    return lines ? lines.slice(0, 600) : null;
}

/** Filler strings a model emits for "location unchanged" — never canonical places. */
const JUNK_LOCATION_RE = /^(null|none|undefined|unknown|unchanged|same|same place|no change|current location|n\/a|-+)\.?$/i;

/** True when an audit field arrived with actual content (they are object-shaped). */
function hasAuditPayload(value) {
    if (!value || typeof value !== 'object') return false;
    return Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0;
}

const GEAR_HANDOFF_KINDS = new Set(['weapon', 'armor', 'shield', 'keepsake']);

function companionNameMatches(companionName, reportedName) {
    const known = String(companionName || '').trim().toLowerCase();
    const reported = String(reportedName || '').trim().toLowerCase();
    if (!known || !reported) return false;
    if (known === reported) return true;
    // First-name reporting ("Kaarina" for "Kaarina Tammi") and vice versa.
    return known.split(/\s+/)[0] === reported.split(/\s+/)[0];
}

/**
 * Scribe gear-handoff audit: narrated companion gear handoffs the DM never
 * emitted as update_companions/items_lost. Routes tracked items through
 * GIVE_GEAR_TO_COMPANION (announces + removes from the hero) and keepsakes
 * through the capped keepsake list. Conservative by design: armor with no
 * tracked inventory item has no derivable AC and is skipped. Idempotent per
 * narration via a claimed `:gear` sourceId.
 */
function applyMissingGearHandoffs(missing, lootAudit, dispatch) {
    const entries = (Array.isArray(missing) ? missing : [])
        .map(entry => {
            const companion = String(entry?.companion || '').trim().slice(0, 60);
            const item = String(entry?.item || '').trim().slice(0, 80);
            const kind = GEAR_HANDOFF_KINDS.has(entry?.kind) ? entry.kind : null;
            if (!companion || !item || !kind) return null;
            return { companion, item, kind };
        })
        .filter(Boolean)
        .slice(0, 2);
    if (entries.length === 0) return;

    const { sourceId, getState } = lootAudit;
    if (!sourceId) return;
    const gearSourceId = `${sourceId}:gear`;
    const state = getState?.();
    if ((state?.appliedLootSourceIds || []).includes(gearSourceId)) {
        console.warn(`[Scribe] Gear-handoff audit for ${gearSourceId} already applied; skipping.`);
        return;
    }
    dispatch({ type: 'CLAIM_LOOT_SOURCE', payload: gearSourceId });

    let applied = 0;
    for (const entry of entries) {
        const companion = (state?.party || []).find(c => companionNameMatches(c.name, entry.companion));
        if (!companion || companion.status === 'dead') continue;
        if (entry.kind === 'keepsake') {
            dispatch({ type: 'UPDATE_COMPANION', payload: { id: companion.id, keepsake: entry.item } });
            applied += 1;
            continue;
        }
        const owned = (state?.inventory || []).find(
            i => String(i?.name || '').trim().toLowerCase() === entry.item.toLowerCase(),
        );
        if (owned) {
            // The reducer announces, derives mechanics, and removes the item.
            dispatch({ type: 'GIVE_GEAR_TO_COMPANION', payload: { itemId: owned.id, companionId: companion.id } });
            applied += 1;
        } else if (entry.kind === 'weapon') {
            // Narrated-only weapon the engine never tracked: stats still follow
            // the fiction (UPDATE_COMPANION derives dice and announces).
            dispatch({ type: 'UPDATE_COMPANION', payload: { id: companion.id, weapon: entry.item } });
            applied += 1;
        }
    }
    if (applied > 0) console.log(`[Scribe] Gear-handoff audit applied ${applied} narrated handoff(s).`);
}

/**
 * Apply Scribe-detected narrated-but-unapplied loot. Idempotent per sourceId via
 * CLAIM_LOOT_SOURCE, clamped by the engine, and announced with a visible system
 * message so both the player and the DM's future context see the correction.
 */
function applyMissingLoot(missing, lootAudit, dispatch, playerMessage = '') {
    if (!missing || typeof missing !== 'object') return;
    const gold = coerceLootAmount(missing.gold);
    const silver = coerceLootAmount(missing.silver);
    const copper = coerceLootAmount(missing.copper);
    const items = (Array.isArray(missing.items) ? missing.items : [])
        .map(entry => {
            const name = String((typeof entry === 'string' ? entry : entry?.name) || '').trim().slice(0, 80);
            if (!name) return null;
            const quantity = coerceLootAmount(typeof entry === 'object' ? entry.quantity : 1, 20) || 1;
            const itemKey = typeof entry === 'object' && entry.itemKey ? String(entry.itemKey).slice(0, 60) : null;
            return { name, quantity, ...(itemKey && { itemKey }) };
        })
        .filter(Boolean)
        .slice(0, 4);
    if (gold <= 0 && silver <= 0 && copper <= 0 && items.length === 0) return;

    const { sourceId, getState } = lootAudit;
    if (!sourceId) return;
    if ((getState?.()?.appliedLootSourceIds || []).includes(sourceId)) {
        console.warn(`[Scribe] Loot audit for ${sourceId} already applied; skipping.`);
        return;
    }
    dispatch({ type: 'CLAIM_LOOT_SOURCE', payload: sourceId });

    // Coins route through the replay-guarded grant so a reward the DM re-narrates on a
    // later turn (already suppressed on the event path) cannot re-enter via the audit.
    // The reducer announces the recovery (or the suppression) itself.
    if (gold > 0 || silver > 0 || copper > 0) {
        dispatch({
            type: 'ADD_COIN_GRANT',
            payload: {
                gold, silver, copper,
                _meta: { sourceId, announce: 'audit', ...(playerMessage && { playerMessage }) },
            },
        });
    }
    for (const item of items) dispatch({ type: 'ADD_ITEM', payload: item });

    if (items.length > 0) {
        const parts = items.map(item => (item.quantity > 1 ? `${item.quantity}x ${item.name}` : item.name));
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `**Loot recovered from narration:** ${parts.join(', ')} added to your possessions.`,
            },
        });
    }
    console.log(`[Scribe] Loot audit recovered: gold ${gold}, silver ${silver}, copper ${copper}, items ${items.length}`);
}

/**
 * Scribe payment audit twin: coins the narrative shows the hero paying out that never
 * became a coin-loss event. The reducer clamps the deduction to the purse and posts a
 * visible system line; idempotency is a claimed per-message sourceId, like loot recovery.
 */
function applyMissingPayment(missing, lootAudit, dispatch, playerMessage = '') {
    if (!missing || typeof missing !== 'object') return;
    const gold = coerceLootAmount(missing.gold);
    const silver = coerceLootAmount(missing.silver);
    const copper = coerceLootAmount(missing.copper);
    if (gold <= 0 && silver <= 0 && copper <= 0) return;

    const { sourceId, getState } = lootAudit;
    if (!sourceId) return;
    const paymentSourceId = `${sourceId}:payment`;
    if ((getState?.()?.appliedLootSourceIds || []).includes(paymentSourceId)) {
        console.warn(`[Scribe] Payment audit for ${paymentSourceId} already applied; skipping.`);
        return;
    }
    dispatch({ type: 'CLAIM_LOOT_SOURCE', payload: paymentSourceId });
    // The reducer checks the shared recentCoinLosses ledger, so a payment the DM
    // already evented on a nearby turn cannot be deducted a second time through
    // the audit backstop (and vice versa).
    dispatch({
        type: 'AUDIT_COIN_PAYMENT',
        payload: {
            gold, silver, copper,
            _meta: { sourceId: paymentSourceId, ...(playerMessage && { playerMessage }) },
        },
    });
    console.log(`[Scribe] Payment audit settled: gold ${gold}, silver ${silver}, copper ${copper}`);
}

/**
 * Current canonical looks for the characters likely in this exchange: the player,
 * plus every tracked NPC whose name appears in the turn's text. Fed to the Scribe
 * so appearance updates MERGE with the established look instead of replacing it
 * with this turn's fragment ("a fresh scar" must never erase the white hair).
 */
export function buildKnownAppearances({ character, npcs = [] } = {}, ...texts) {
    const haystack = texts.filter(Boolean).join('\n').toLowerCase();
    const entries = [];
    if (character?.appearance?.trim()) {
        entries.push(`${character.name || 'The player character'} (PLAYER CHARACTER): ${character.appearance.trim().slice(0, 240)}`);
    }
    for (const npc of npcs) {
        if (entries.length >= 8) break;
        const name = String(npc?.name || '').trim();
        if (!name || !npc.appearance?.trim()) continue;
        if (!haystack.includes(name.toLowerCase())) continue;
        entries.push(`${name}: ${npc.appearance.trim().slice(0, 240)}`);
    }
    return entries.length > 0 ? entries.join('\n') : null;
}

/**
 * Established personal stances toward the hero for the NPCs in this exchange.
 * Same merge contract as appearances: the Scribe must emit the complete updated
 * stance, so one turn's cold reply can't erase months of recorded warmth. The
 * already-recorded bond moments ride along so the Scribe never re-reports an old
 * beat in new words — the reducer's token dedupe can't catch paraphrases.
 */
export function buildKnownStances({ npcs = [] } = {}, ...texts) {
    const haystack = texts.filter(Boolean).join('\n').toLowerCase();
    const entries = [];
    for (const npc of npcs) {
        if (entries.length >= 8) break;
        const name = String(npc?.name || '').trim();
        const stance = String(npc?.stanceToPlayer || '').trim();
        const moments = (Array.isArray(npc?.bondMoments) ? npc.bondMoments : [])
            .map(moment => String(moment?.text || '').trim())
            .filter(Boolean);
        if (!name || (!stance && moments.length === 0)) continue;
        if (!haystack.includes(name.toLowerCase())) continue;
        const lines = [];
        if (stance) lines.push(`${name}: ${stance.slice(0, 240)}`);
        if (moments.length > 0) {
            lines.push(`${name} — moments already on record (do NOT re-report or paraphrase these): ${moments.slice(-3).map(m => `"${m.slice(0, 140)}"`).join('; ')}`);
        }
        entries.push(lines.join('\n'));
    }
    return entries.length > 0 ? entries.join('\n') : null;
}

/**
 * Run the Scribe after a DM response to extract world-state updates.
 * Dispatches updates silently — the player never sees this.
 *
 * @param {object} options
 * @param {string} options.playerMessage - The player's input
 * @param {string} options.dmNarrative - The DM's response narrative
 * @param {object} options.settings - Game settings (provider, apiKey)
 * @param {function} options.dispatch - Game state dispatch
 * @param {object|null} [options.authoritativeContext] - Engine truth that narration cannot override
 */
function contradictsAuthoritativeCombat(value, authoritativeContext) {
    const claim = String(value || '').toLowerCase();
    const enemies = authoritativeContext?.postState?.enemies || [];
    const deathClaim = /\b(dead|dies|died|killed|slain|lifeless|destroyed|finished off)\b/i;
    const activeCombatEndedClaim = /\b(defeated|vanquished)\b/i;
    const aliveClaim = /\b(alive|survives|survived|fighting|active)\b/i;
    return enemies.some(enemy => {
        const name = String(enemy.name || '').toLowerCase();
        if (!name || !claim.includes(name)) return false;
        if (enemy.status === 'defeated' || (enemy.hp ?? 0) <= 0) return aliveClaim.test(claim);
        if (enemy.status === 'active') return deathClaim.test(claim) || activeCombatEndedClaim.test(claim);
        return deathClaim.test(claim);
    });
}

export async function runScribe({ playerMessage, dmNarrative, settings, dispatch, authoritativeContext = null, lootAudit = null, knownAppearances = null, knownStances = null }) {
    const background = getBackgroundConfig(settings);
    if (!background.apiKey || !dmNarrative) return;

    const ownedInventory = (lootAudit && typeof lootAudit.getState === 'function')
        ? describeOwnedInventory(lootAudit.getState())
        : null;
    const partyGear = (lootAudit && typeof lootAudit.getState === 'function')
        ? describePartyGear(lootAudit.getState())
        : null;

    try {
        const response = await sendMessage({
            ...background,
            systemPrompt: lootAudit ? SCRIBE_SYSTEM_PROMPT + LOOT_AUDIT_RULES : SCRIBE_SYSTEM_PROMPT,
            temperature: 0.2, // faithful extraction — facts and loot amounts must not drift
            messageHistory: [],
            userMessage: [
                `Player action: ${playerMessage}`,
                `DM narrative: ${dmNarrative}`,
                authoritativeContext
                    ? `AUTHORITATIVE ENGINE STATE (prose cannot override this): ${JSON.stringify(authoritativeContext)}`
                    : null,
                knownAppearances
                    ? `KNOWN APPEARANCES (established canonical looks — merge new details into these, never contradict or shorten them):\n${knownAppearances}`
                    : null,
                knownStances
                    ? `KNOWN PLAYER-RELATIONSHIP STANCES (each NPC's established personal stance toward the hero — stanceToPlayer updates must merge with these, never shrink them to this turn's fragment):\n${knownStances}`
                    : null,
                lootAudit
                    ? `EVENTS ALREADY APPLIED BY THE ENGINE THIS TURN (anything listed here is NOT missing): ${describeAppliedLoot(lootAudit.appliedEvents)}`
                    : null,
                ownedInventory
                    ? `HERO'S CURRENT INVENTORY (already owned — using, drawing, or lighting these is NOT an acquisition): ${ownedInventory}`
                    : null,
                partyGear
                    ? `PARTY COMPANIONS' CURRENT GEAR (already carried — referencing these is NOT a new handoff): ${partyGear}`
                    : null,
            ].filter(Boolean).join('\n\n'),
        });

        const jsonMatch = extractBalancedJson(response, 'world_facts');
        if (!jsonMatch) return;

        let extracted;
        try {
            extracted = JSON.parse(jsonMatch.json);
        } catch {
            try {
                extracted = JSON.parse(repairJson(jsonMatch.json));
                console.warn('[Scribe] JSON repaired before parsing.');
            } catch (e2) {
                console.warn('[Scribe] JSON parse failed after repair:', e2.message);
                return;
            }
        }

        // Engine-owned budget backstop: the prompt caps extraction at 2-3 per turn,
        // but a chatty model must not be able to flood the fact/card stores anyway.
        const worldFacts = (Array.isArray(extracted.world_facts)
            ? extracted.world_facts.filter(fact => !contradictsAuthoritativeCombat(fact?.fact, authoritativeContext))
            : []).slice(0, 3);
        if (worldFacts.length > 0) {
            dispatch({ type: 'ADD_WORLD_FACTS', payload: worldFacts });
            console.log(`[Scribe] Added ${worldFacts.length} world fact(s)`);
        }

        const rosteredNames = [];
        if (Array.isArray(extracted.npc_updates) && extracted.npc_updates.length > 0) {
            for (const npc of extracted.npc_updates) {
                const classified = classifyNpcCandidate(npc);
                if (!classified.allowRoster) continue;
                dispatch({
                    type: 'UPDATE_NPC',
                    payload: {
                        ...npc,
                        kind: classified.kind,
                    },
                });
                rosteredNames.push(npc?.name || '(unnamed)');
            }
            if (rosteredNames.length > 0) {
                console.log(`[Scribe] Updated ${rosteredNames.length} roster NPC(s)`);
            }
        }

        const storyMemory = (Array.isArray(extracted.story_memory)
            ? extracted.story_memory.filter(memory => !contradictsAuthoritativeCombat(memory?.text, authoritativeContext))
            : []).slice(0, 3);
        if (storyMemory.length > 0) {
            dispatch({ type: 'ADD_STORY_MEMORY_CARDS', payload: storyMemory });
            console.log(`[Scribe] Added ${storyMemory.length} story memory card(s)`);
        }

        if (typeof extracted.player_appearance === 'string' && extracted.player_appearance.trim()) {
            dispatch({ type: 'UPDATE_CHARACTER', payload: { appearance: extracted.player_appearance.trim().slice(0, 600) } });
        }

        // A model answering "where are we now?" with filler must not mint a canonical
        // place — "null"/"unchanged" as the current location was a real 2026-07-23 find.
        const extractedLocation = typeof extracted.location === 'string' ? extracted.location.trim() : '';
        const location = extractedLocation && !JUNK_LOCATION_RE.test(extractedLocation) ? extractedLocation : null;
        if (location) {
            dispatch({ type: 'SET_LOCATION', payload: location });
        }

        const locationProfile = extracted.location_profile;
        if (locationProfile && typeof locationProfile === 'object' && locationProfile.name) {
            dispatch({
                type: 'UPDATE_LOCATION_PROFILE',
                payload: {
                    name: locationProfile.name,
                    profile: { type: locationProfile.type, danger: locationProfile.danger },
                },
            });
        }

        if (lootAudit) {
            applyMissingLoot(extracted.missing_loot, lootAudit, dispatch, playerMessage);
            applyMissingPayment(extracted.missing_payment, lootAudit, dispatch, playerMessage);
            applyMissingGearHandoffs(extracted.missing_gear_handoffs, lootAudit, dispatch);
        }

        captureScribePass({
            facts: worldFacts,
            npcsUpdated: rosteredNames,
            cards: storyMemory,
            playerAppearance: typeof extracted.player_appearance === 'string' && !!extracted.player_appearance.trim(),
            location,
            // missing_loot/missing_payment are OBJECTS, not arrays — Array.isArray
            // kept both inspector flags permanently false (2026-07-23 audit).
            lootAudited: !!(lootAudit && hasAuditPayload(extracted.missing_loot)),
            paymentAudited: !!(lootAudit && hasAuditPayload(extracted.missing_payment)),
            gearAudited: !!(lootAudit && Array.isArray(extracted.missing_gear_handoffs) && extracted.missing_gear_handoffs.length > 0),
        });
    } catch (e) {
        // Scribe failures must never block the main game loop, but log clearly
        console.error('[Scribe] Extraction failed:', e.message || e);
    }
}

const REFLECTION_SYSTEM_PROMPT = `You are the private campaign continuity assistant for a single-player RPG. Update hidden NPC intent, relationship pressure, dramatic memory hooks, and off-screen campaign pressure from the current campaign state.

Output ONLY valid JSON:
{
  "npc_updates": [
    {
      "name": "Exact NPC name",
      "basedIn": "current anchor — command post, town, territory. Update when they relocate; omit if unknown",
      "agenda": "what they likely try next",
      "relationshipTension": "attraction, rivalry, fear, debt, loyalty, distrust, or leverage",
      "stanceToPlayer": "their current personal stance toward the hero — affection, attraction, respect, resentment, obligation — complete, written from the NPC's side",
      "trust": 50,
      "privateNotes": "hidden intent or secret pressure",
      "callbackHooks": ["one or two details they could naturally bring back later"]
    }
  ],
  "front_advances": [
    {
      "id": "front id",
      "delta": -1,
      "symptom": "one in-world sign that can surface naturally",
      "reason": "private canonical reason for -1, 0, or +1 movement"
    }
  ],
  "tempo_directive": {
    "front_id": "ONE front id that may surface a symptom in the coming scenes, or null for a quiet stretch",
    "max_intensity": "whispers|indirect|presence|confrontation",
    "where": "the place its symptom would naturally surface",
    "suggested_symptom": "one natural in-world expression of the pressure",
    "rationale": "private: why this makes sense in the arc RIGHT NOW",
    "quiet_hook": "when front_id is null: an optional small NON-threatening local hook or piece of daily life"
  },
  "front_proposals": [
    {
      "title": "short private name for a NEW pressure",
      "goal": "what it wants",
      "stakes": "what changes if nobody interferes",
      "grim_portents": ["3-5 escalating off-screen steps"],
      "faction": { "name": "driving force", "goal": "its goal", "stance": "stance toward the hero" },
      "reason": "why this player-engaged threat has EARNED promotion to a real campaign pressure"
    }
  ],
  "story_memory": [
    {
      "type": "callback|promise|wound|relationship|mystery|playerCanon|foreshadow|npcAgenda",
      "text": "compact dramatic callback opportunity",
      "subject": "who or what it concerns",
      "tags": ["short", "tags"],
      "salience": 3,
      "emotionalCharge": 2,
      "linkedNpcNames": ["Exact NPC name"],
      "location": "place if relevant",
      "source": "reflection"
    }
  ]
}

Rules:
- Do not invent a new plot that contradicts canon. Synthesize likely intent from existing facts.
- Do not contradict the authoritative combat state of any character or NPC (e.g. do not record agendas, goals, or callback hooks for a character who is dead/defeated in the engine state).
- Hidden fronts must remain private; symptoms are fiction only, never clock/stage/title exposition.
- Front delta is strictly -1, 0, or +1. Advance only when meaningful fictional time passed, the hero ignored a pressure to pursue something else, or an off-screen faction gained a concrete opportunity. Soften only when canonical player action hindered it. Use 0 when only its symptoms or posture evolve.
- PACING: fronts are campaign clocks that should take many sessions to fill, not one evening. Advance at most ONE front per reflection, and only with an explicit fictional trigger you can name in "reason". The engine also refuses clock gains for a front that advanced in the previous reflection — the default and most common outcome is that nothing moves.
- A journal cadence is not itself a reason to move a front. Omit fronts with no meaningful change. Never jump multiple steps, resolve a front, or undo an established grim portent here.
- Emit at most 2 story_memory cards per reflection, and only for hooks with real future payoff.
- TEMPO DIRECTIVE (always include it): decide whether the coming scenes get a pressure symptom or stay quiet. Quiet (front_id null) is a normal, common, and GOOD answer — slow-burn is a feature. Respect the campaign pace in the context: slow-burn means most reflections stay quiet; standard roughly every other; breakneck may grant most. Ground the choice in the arc: what would make sense given where the hero is, what just happened, and each pressure's reach — a pressure far from its home territory reaches the hero only as news. The engine independently caps intensity to what the clocks justify and delays the landing with its own dice; your job is only what/where would make sense.
- If RECENT HEAT in the context is high, strongly prefer a quiet directive with a restorative quiet_hook — the table needs air after violence.
- The inverse binds too: when RECENT HEAT sits BELOW the campaign pace's appetite (calm on a standard campaign, calm OR lively on breakneck) and the scenes since the last fight have already given the table its air, LEAN toward granting a window at whatever intensity the arc supports. On breakneck, consecutive quiet directives need an explicit arc reason in the rationale — the player chose that dial to be pushed.
- FRONT PROPOSALS: only when the PLAYER has repeatedly and deliberately engaged a concrete recurring threat that existing fronts do not cover and it has proven durable across scenes (a raided den that keeps mattering, a rival who keeps returning). At most one, complete or omitted entirely. This is rare — most reflections propose nothing.
- Potential companions may be seeded as hooks, but never add them to the party.
- Intriguing NPCs should emerge from agenda, competence, danger, secrets, attraction, rivalry, vulnerability, or leverage, not default sexualization.
- Keep every field unvarnished: record attraction, resentment, and bodily or intimate canon plainly and completely, never softened into vagueness or omission — but always in neutral anatomical language, never profanity or crude slang.
- stanceToPlayer evolves slowly off-screen: refine or drift it only when established events support it, and emit the complete stance (it replaces the record). Never invent romance or hostility the canon does not support.
- Keep everything compact. Omit empty arrays when nothing changes.`;

export async function runNpcFrontReflection({ state, dispatch, cadence = null }) {
    const background = getBackgroundConfig(state?.settings);
    if (!background.apiKey) return;
    const npcs = curateNpcsForPrompt(state.npcs || [], {
        location: state.currentLocation,
        limit: 12,
    });
    const fronts = state.fronts || [];
    if (npcs.length === 0 && fronts.length === 0) return;

    const heat = computeRecentHeat(state);
    const context = {
        location: state.currentLocation,
        premise: state.session?.premise,
        recentJournal: (state.journal || []).slice(-3),
        worldFacts: (state.worldFacts || []).slice(-12),
        npcs,
        fronts,
        partySize: (state.party || []).length,
        campaignPace: normalizePaceDial(state.settings?.paceDial),
        recentHeat: { level: heat.level, reasons: heat.reasons },
        recentEncounters: (state.recentEncounters || []).slice(-4),
        knownLocations: (state.locations || []).slice(-12).map(record => ({
            name: record.name,
            type: record.type,
            danger: record.danger,
            homeOfFronts: record.theaterFrontIds,
        })),
        previousTempoDirective: state.worldTempo?.directive
            ? { frontId: state.worldTempo.directive.frontId, maxIntensity: state.worldTempo.directive.maxIntensity }
            : null,
        cadence: cadence ? {
            id: cadence.id,
            journalEnd: cadence.journalEnd,
            latestSummary: cadence.summary,
            keyDecisions: cadence.keyDecisions || [],
            consequences: cadence.consequences || [],
        } : null,
    };

    try {
        const response = await sendMessage({
            ...background,
            systemPrompt: REFLECTION_SYSTEM_PROMPT,
            temperature: 0.4, // grounded reflection with a little invention for hooks
            messageHistory: [],
            userMessage: JSON.stringify(context, null, 2),
        });

        const jsonMatch = extractBalancedJson(response, 'npc_updates')
            || extractBalancedJson(response, 'front_advances')
            || extractBalancedJson(response, 'story_memory');
        if (!jsonMatch) return;

        let reflected;
        try {
            reflected = JSON.parse(jsonMatch.json);
        } catch {
            try {
                reflected = JSON.parse(repairJson(jsonMatch.json));
            } catch (e2) {
                console.warn('[Reflection] JSON parse failed after repair:', e2.message);
                return;
            }
        }

        const reflectedNames = [];
        if (Array.isArray(reflected.npc_updates)) {
            for (const npc of reflected.npc_updates) {
                const classified = classifyNpcCandidate(npc);
                if (!classified.allowRoster) continue;
                dispatch({
                    type: 'UPDATE_NPC',
                    payload: { ...npc, kind: classified.kind },
                });
                reflectedNames.push(npc?.name || '(unnamed)');
            }
        }
        if (cadence?.id && Number.isFinite(cadence.journalEnd)) {
            dispatch({
                type: 'APPLY_FRONT_ADVANCE_BATCH',
                payload: {
                    cadenceId: cadence.id,
                    journalEnd: cadence.journalEnd,
                    advances: Array.isArray(reflected.front_advances) ? reflected.front_advances : [],
                },
            });
        }
        if (Array.isArray(reflected.story_memory) && reflected.story_memory.length > 0) {
            dispatch({ type: 'ADD_STORY_MEMORY_CARDS', payload: reflected.story_memory.slice(0, 2) });
        }

        if (cadence?.id && 'tempo_directive' in reflected) {
            // Engine-rolled timing die: the reflection decides WHAT may surface
            // and WHERE; crypto dice alone decide WHEN it lands (0–4 scenes).
            dispatch({
                type: 'APPLY_TEMPO_DIRECTIVE',
                payload: {
                    cadenceId: cadence.id,
                    directive: reflected.tempo_directive,
                    timingDelay: rollDie(TEMPO_TIMING_DIE_SIDES) - 1,
                },
            });
        }

        if (cadence?.id && Array.isArray(reflected.front_proposals) && reflected.front_proposals.length > 0) {
            dispatch({
                type: 'ADD_EMERGENT_FRONT',
                payload: { cadenceId: cadence.id, proposal: reflected.front_proposals[0] },
            });
        }

        captureReflection({
            cadenceId: cadence?.id || null,
            npcsUpdated: reflectedNames,
            frontAdvances: Array.isArray(reflected.front_advances) ? reflected.front_advances : [],
            cards: Array.isArray(reflected.story_memory) ? reflected.story_memory.slice(0, 2) : [],
            tempoDirective: reflected.tempo_directive || null,
            frontProposal: reflected.front_proposals?.[0]?.title || null,
        });
    } catch (e) {
        console.warn('[Reflection] NPC/front reflection failed:', e.message || e);
    }
}

const ART_DIRECTOR_PROMPT = `You are the art director for a gritty, mature, dark-fantasy RPG. Given the current scene and the known visual details of the characters and things present, write ONE vivid image-generation prompt that an image model will render.

Rules:
- Output ONLY the prompt text — no preamble, no quotes, no JSON, no explanation.
- 100-170 words. Concrete and visual: describe the characters in frame (using the provided appearances), the setting, composition/framing, lighting, weather, mood, and art style.
- Render the EXACT latest moment and its consequences, not a generic establishing shot. Preserve every visually important subject, species, count, action, body, wound, pose, and reaction stated in the current situation—especially defeated foes, witnesses, kneeling/cowering figures, and the player's decisive gesture.
- Do not add generic party members, soldiers, bystanders, creatures, or props that are not supported by the supplied situation and entity details.
- Make the player character the visual anchor when present. State other subjects' spatial relationship to them so the image model cannot quietly omit half the scene.
- Use the EXACT appearance details provided for each named character so they look consistent across scenes. If a character has no given appearance, infer modestly from their race/class/equipment — do not contradict known details.
- Depict only what the situation supports. This is an adult, gritty world: render violence, grime, and mature/sensual content frankly and unvarnished when the scene calls for it — bodies as established, not idealized — but keep it grounded, never gratuitous. Describe bodies in neutral anatomical language, never profanity or crude slang.
- End with this quality direction: "grounded cinematic dark-fantasy realism, professional concept art, anatomically coherent figures, detailed materials, dramatic natural lighting, not cartoonish or childlike".
- Do NOT include any on-image text, captions, watermarks, UI, or speech bubbles.`;

/** Keep both the setup and decisive aftermath when a long narration feeds scene art. */
export function preserveSceneSituation(situation, maxLength = 1800) {
    const text = String(situation || '').trim();
    if (text.length <= maxLength) return text;
    const tailLength = Math.min(650, Math.floor(maxLength * 0.4));
    const headLength = maxLength - tailLength;
    return `${text.slice(0, headLength).trimEnd()}\n[Later in the same moment]\n${text.slice(-tailLength).trimStart()}`;
}

/**
 * Compose a single image-generation prompt for the current scene. Runs on demand
 * (when the player requests scene art), not every turn. Pulls together the current
 * situation and the accumulated visual details of the entities likely in frame, and
 * asks the Scribe model to art-direct a finished prompt.
 *
 * @returns {Promise<string|null>} A finished image prompt, or null on failure.
 */
export async function composeScenePrompt({ situation, character, npcs = [], combat, currentLocation, settings }) {
    const background = getBackgroundConfig(settings);
    if (!background.apiKey) return null;

    const lines = [];
    if (currentLocation) lines.push(`Location: ${currentLocation}`);
    if (situation) lines.push(`Current situation: ${preserveSceneSituation(situation)}`);

    if (character) {
        const equipped = (character.equippedSummary || '').trim();
        const gender = character.gender?.trim() || '';
        const desc = character.appearance?.trim()
            || `a ${gender ? `${gender} ` : ''}${character.race || ''} ${character.class || 'adventurer'}`.replace(/\s+/g, ' ').trim();
        lines.push(`Player character — ${character.name}${gender ? ` (${gender})` : ''}: ${desc}${equipped ? ` Wearing/wielding: ${equipped}.` : ''}`);
    }

    // NPCs likely in frame: most recently active first, capped for prompt size.
    const recentNpcs = [...npcs]
        .sort((a, b) => (b.lastSeen || b.firstMet || 0) - (a.lastSeen || a.firstMet || 0))
        .slice(0, 4)
        .filter(n => n.name);
    for (const n of recentNpcs) {
        const desc = n.appearance?.trim() || `${n.disposition || ''} NPC`.trim();
        lines.push(`NPC — ${n.name}: ${desc}`);
    }

    if (combat?.active && combat.enemies?.length > 0) {
        lines.push(`In combat against: ${combat.enemies.map(e => e.name).filter(Boolean).join(', ')}.`);
    }

    try {
        const prompt = await sendMessage({
            ...background,
            systemPrompt: ART_DIRECTOR_PROMPT,
            messageHistory: [],
            userMessage: lines.join('\n'),
        });
        const cleaned = String(prompt || '').trim();
        return cleaned || null;
    } catch (e) {
        console.log('[Scribe] Image-prompt composition failed:', e.message || e);
        return null;
    }
}
