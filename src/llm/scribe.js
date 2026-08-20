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
import { isLocationEvidencedInText, sanitizeExtractedLocation } from '../engine/locationRegistry.js';
import { extractBalancedJson, repairJson } from './utils/jsonExtractor.js';
import { captureReflection, captureScribePass } from '../debug/memoryInspectorStore.js';
import { computeRecentHeat, normalizePaceDial, TEMPO_TIMING_DIE_SIDES } from '../engine/worldTempo.js';
import { conversationalDistance } from '../engine/replayLedger.js';
import { getKnownSpells, isSpellcaster, resolveSpellForCharacter } from '../engine/spellcasting.js';
import { rollDie } from '../engine/dice.ts';
import { CHARACTER_APPEARANCE_MAX, MAX_COIN_EVENT, NPC_DOSSIER_FIELD_MAX } from '../config/contentLimits.js';

const SCRIBE_SYSTEM_PROMPT = `You are a meticulous game world record-keeper. Given a DM's narrative response and the player's action that prompted it, extract any new canonical facts about the game world. Every field you output is an UNVARNISHED record: complete and frank about every fact the fiction establishes, never a censored, selective, or tastefully vague account — written in neutral, matter-of-fact language (see the REGISTER rule).

Output ONLY valid JSON:
{
  "world_facts": [
    { "fact": "A canonical statement of something now true in this world", "category": "lore|character|location|event|relationship", "knownBy": ["ONLY for private information: exactly who knows it (use 'the hero' for the player) — omit entirely for common knowledge"] }
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
      "gender": "the character's gender exactly as the fiction establishes or makes clearly apparent — 'woman', 'man', or the fiction's own wording. Capture it the FIRST time it is knowable; afterwards omit unless the fiction changes it",
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
      "knownBy": ["ONLY for private information: exactly who knows it (use 'the hero' for the player) — omit entirely for common knowledge"],
      "witnessed": false,
      "source": "scribe"
    }
  ],
  "player_appearance": "concrete physical/visual description of the PLAYER's character, only if newly described this turn — otherwise omit",
  "location": "The place the hero PHYSICALLY STANDS at the END of this narrative, only if it changed — NEVER a place that is merely mentioned, discussed, remembered, watched from afar, or being left behind; null if unchanged",
  "location_profile": { "name": "place name exactly as the narrative calls it", "type": "haven|settlement|wilderness|frontier|hostile_site", "danger": "none|low|moderate|high|deadly", "region": "the broad NAMED land or realm containing many settlements that THIS PLACE ITSELF lies in, ONLY as the fiction has explicitly stated it — a capitalized proper name, NEVER a town, district, quarter, dock, street, building, or generic feature like 'the coast', and NEVER a distant land that is merely mentioned, discussed, or named as a destination in the scene. Omit unless the narrative has actually NAMED the land this place lies in — never invent one, never guess one, and never reuse a name from these instructions" }
}

Rules:
- HARD EXTRACTION BUDGET: at most 2 world_facts and 2 story_memory cards per turn (3 only on a truly pivotal turn). Most ordinary turns — travel, shopping, small talk, routine fights — should produce ZERO of each. When over budget, keep only the most campaign-defining entries and drop the rest. This budget NEVER applies to npc_updates, "appearance", "player_appearance", or "location" — visual and positional continuity is always captured in full.
- World facts are durable, campaign-level truths a DM would still need many sessions later: deaths, alliances, betrayals, discoveries, curses, historical facts revealed
- Do NOT record transient action descriptions, scene-level detail, prices, purchases, minor chatter, or restatements of anything already implied by an existing fact ("Player attacked goblin" is not a world fact)
- DO record outcomes: "The goblin captain Rarg is dead", "The village of Millhaven burned to the ground"
- Story memory is for emotionally or dramatically useful callbacks: promises, debts, named objects, scars, injuries, insults, flirtation, fears, private vows, unresolved clues, player-authored proper nouns, foreshadowing, NPC agendas, and relationship tension. A card must earn its slot: if you cannot picture the DM paying it off in a later scene, do not write it.
- Capture player-authored canon from the player's action when it concerns their own compatible backstory, vows, names, and personal attachments the DM should remember later.
- INFORMATION BOUNDARIES: when a fact or memory is PRIVATE — a secret, a confession, a hidden plan, something established behind closed doors or away from other ears — set "knownBy" to exactly the people who know it (use "the hero" for the player character; include eavesdroppers the narrative shows). Omit "knownBy" entirely for common knowledge; never write "everyone" into it. On story_memory, set "witnessed": true ONLY for the HERO'S OWN deeds done in front of uninvolved bystanders in a public or semi-public place (a market brawl, a tavern accusation, a wedding vow) — such moments travel as gossip. Never mark things the hero merely observed. A deliberate public act by the hero before a crowd is a story_memory with witnessed: true and salience 4 or 5 — these are exactly the moments that precede the hero into other towns. "witnessed" and "knownBy" are MUTUALLY EXCLUSIVE: a deed done before a crowd is public even if it failed, was interrupted, or was shut down — never give it a knownBy list; a card with knownBy is by definition not witnessed.
- A player message is not authoritative evidence about external reality. Do not turn player-asserted creatures, objects, exits, relationships, events, enemy behavior, or outcomes into world_facts, NPC updates, or playerCanon unless the DM narrative explicitly accepts or establishes them.
- When AUTHORITATIVE ENGINE STATE is provided, it overrides the prose. Never record a combatant dead, alive, fled, surrendered, victorious, or defeated contrary to that state.
- Keep story_memory compact; do not duplicate ordinary world_facts unless the memory has callback value.
- Only include npc_updates for NPCs that appeared in this specific exchange
- The hero's PARTY COMPANIONS are NPCs for record-keeping: emit npc_updates for them (stanceToPlayer, bondMoment, appearance, personality, goals) exactly like any other character — never skip someone because they travel with the hero. The party is the game's most sustained relationship, so companion stance shifts and bond moments matter MORE than a stranger's, not less.
- basedIn is the NPC's current anchor in the world (not permanent): update it when they are reassigned, relocate, or fiction establishes a new base. lastLocation is ephemeral — where they were this turn
- stanceToPlayer is about the personal relationship between this NPC and the HERO specifically — their feelings toward the hero, not their role or plot function. Update it whenever an exchange genuinely shifts how they regard the hero: a flirtation received warmly or coldly, gratitude after a rescue, trust broken, growing attraction or contempt. Write it unvarnished — desire, resentment, and awkwardness named plainly. When KNOWN PLAYER-RELATIONSHIP STANCES lists this NPC, emit the COMPLETE updated stance as a full rewrite: restate every still-true part IN ITS EXISTING WORDING, integrate what this turn changed, and drop only what this turn superseded. The engine replaces the stored stance only when your text covers it — a differently-worded fragment gets APPENDED instead, leaving contradicted old feelings standing next to the new ones ("resentful and suspicious" beside "warmly appreciative"). If nothing shifted for them personally, omit the field.
- bondMoment must be an actual NEW event from THIS exchange, stated concretely with both parties ("The hero flirted with Maren over the map table; she laughed and let her hand linger"). At most one per NPC per turn; interpersonal continuity is exempt from the extraction budget. If KNOWN PLAYER-RELATIONSHIP STANCES already lists a moment covering this beat, omit bondMoment entirely — never re-report or paraphrase a recorded moment.
- Use kind "character" and rosterEligible true only for named people worth tracking across sessions (dialogue, rivalry, debt, secrets, recurring villains, quest givers). Use kind "creature" or "ephemeral" with rosterEligible false for nameless combat fodder, generic goblins/guards, or one-line minions that should not enter the durable roster.
- Capture "appearance"/"player_appearance" from concrete visual details the narrative actually states — never invent looks. These feed scene-art generation AND the DM's own long-term visual continuity, so accuracy matters.
- "gender" is a first-class continuity field: pronouns, titles ("the widow", "the young man"), and explicit statements all establish it. A character whose gender is knowable but unrecorded WILL get misrendered in generated art, so capture it as soon as the fiction shows it — this is exempt from the extraction budget like appearance.
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
The game engine persists coins and items ONLY from structured events; anything narrated but not emitted as an event silently vanishes. Your task here is pure OBSERVATION: report what THIS DM narrative shows changing hands, at the full narrated amounts. The engine deterministically reconciles your report against the events it already applied — NEVER do that subtraction yourself, and never omit a coin movement just because EVENTS ALREADY APPLIED lists it.
Report the coins and items the narrative shows the hero ACQUIRING, as one extra top-level field:
"narrated_loot": { "gold": 0, "silver": 0, "copper": 0, "items": [{ "name": "exact item name from the narrative", "quantity": 1 }] }
Also report the coins the narrative shows the hero PAYING OUT, as another top-level field:
"narrated_payment": { "gold": 0, "silver": 0, "copper": 0 }

Loot rules:
- Report ONLY acquisitions the DM NARRATIVE explicitly completes for the hero: taken, pocketed, looted, claimed, received, handed over. The player's own message is never sufficient evidence — the DM narrative must confirm the acquisition happened.
- Never report offers, prices, rewards merely promised, goods only seen or described, another character's possessions, or attempts/intentions.
- Never report coins or items the narrative merely recalls, recounts, splits, or admires from an EARLIER scene — only acquisitions completed for the first time in THIS narrative. A reward being counted, divided, or mentioned again was already granted when it was first handed over.
- Hospitality consumed on the spot is not an acquisition: a poured drink, a served meal, food and ale enjoyed at the table never become inventory. Report provisions only when the narrative has the hero pack, pocket, or carry them away.
- Exact amounts only. If the narrative gives no specific number ("a handful of coins"), omit that coin field entirely — never estimate.
- Denominations are sacred: report coins in the EXACT denomination the narrative names and NEVER convert between them — "thirty silver pieces" is "silver": 30 (never "gold": 30), "fifty silver" is "silver": 50, "two gold crowns" is "gold": 2. This applies to narrated_payment identically.
- Purchases and sales are engine transactions handled elsewhere; never report coins or goods exchanged in a purchase or sale — in either direction.
- Change returned from the hero's own payment is never an acquisition: when the hero pays with a larger coin and gets change back, report nothing in narrated_loot for the change.
- The HERO'S CURRENT INVENTORY line lists what the hero already owns. Using, drawing, lighting, striking, wearing, or retrieving an owned item is NOT an acquisition — "she takes out her flint and steel and strikes a spark" grants nothing. Report an item the hero already owns ONLY when the narrative explicitly completes acquiring an ADDITIONAL copy (a second rope, another potion).
- Identifying, appraising, examining, or recognizing an item the hero ALREADY carries is NOT an acquisition — realizing the corked vial in her pack is a healing potion, or that the old ring is silver, changes what the item IS, never what the hero HAS. Report nothing for it, under either name.

Payment rules:
- Report a payment ONLY when the DM narrative explicitly completes it: the hero counts out, hands over, or drops the coins and the other party takes them. Intentions, promises, IOUs, haggling, and prices merely quoted are never payments.
- Involuntary coin losses count as paying out: coins the narrative shows being confiscated, seized, stolen, extorted, or robbed from the hero report here at the exact narrated amount. Threats and demands not yet carried out report nothing.
- Copy narrated amounts digit-exactly; spelled-out numbers convert exactly ("six silver" is "silver": 6, "a dozen coppers" is "copper": 12). Never round, estimate, or infer an amount the narrative does not state.
- Change-making: when the hero pays with a larger coin and receives change (hands over a gold piece for a 2-silver fare and gets 8 silver back), report the NET price actually paid — "silver": 2 — never the gross coin handed over, and never add the fare on top of the coin.
- Never re-report a payment the narrative merely recalls, confirms, defends, or references from an EARLIER scene — only payments completed for the first time in THIS narrative. "You already paid the six silver" is a recollection, not a new payment.
- Exact amounts only; never estimate. A wrongly reported coin is worse than a missed one — certainty is required.
- When in doubt, omit. Omit "narrated_loot" and "narrated_payment" entirely when this narrative moves no coins or items.

Also report gear the narrative shows the hero handing to a COMPANION that the companion accepts and takes up, when the engine applied no matching companion update, as another top-level field:
"missing_gear_handoffs": [{ "companion": "exact companion name", "item": "exact item name", "kind": "weapon" }]

Gear handoff rules:
- Report ONLY handoffs the DM narrative completes: the companion accepts and takes up the item (straps it on, sheathes it, dons it, tucks it away). Offers, refusals, loans for a single moment, and mere suggestions are never handoffs.
- "kind" is "weapon" for weapons, "armor" or "shield" for protection the companion now wears, "keepsake" for a sentimental item with no combat use.
- PARTY COMPANIONS' CURRENT GEAR lists what each companion already carries — an item already listed there is NOT a new handoff, and narration merely referencing or admiring their existing gear reports nothing.
- Anything under EVENTS ALREADY APPLIED (companion gear or keepsake updates, items lost by the hero) is NOT missing.
- Copy the companion's and the item's names exactly as the narrative writes them.
- When in doubt, omit — an invented handoff is worse than a missed one. Omit "missing_gear_handoffs" entirely when nothing is missing.

Also report the ITEMS the narrative shows LEAVING the hero's possession, as another top-level field:
"narrated_losses": { "items": [{ "name": "exact item name as the hero's inventory would know it" }] }

Loss rules:
- Report ONLY losses the DM NARRATIVE completes in this scene: confiscated, seized, stolen, taken, dropped and left behind, destroyed, handed over and kept by the other party. Threats, demands, attempts, and items merely set down within reach report nothing.
- The HERO'S CURRENT INVENTORY line lists what the hero owns — report a loss only for an item on that list, under its listed name (the narrative's "your blade" is the inventory's actual weapon name).
- A pack, purse, or bag "emptied" or "taken" loses its narrated CONTENTS: report each named item individually; coins seized with it report under narrated_payment, never here.
- Gear handed to a party COMPANION is a handoff (missing_gear_handoffs), never a loss. An item merely used, shown, worn, or lent for a moment and returned reports nothing.
- Never re-report a loss the narrative merely recalls, confirms, or laments from an EARLIER scene — only losses completed for the first time in THIS narrative. "Your sword is still gone" reports nothing.
- When in doubt, omit — a wrongly removed item is worse than a missed loss. Omit "narrated_losses" entirely when the hero loses nothing.`;

const CAST_AUDIT_RULES = `

ADDITIONAL TASK — NARRATED SPELLCAST AUDIT:
The engine spends spell slots and applies spell effects ONLY from structured events; a cast the DM narrates without its event mechanically never happened — no slot spent, no ward, no healing (a hero once fought a whole battle at base AC under a lovingly narrated Mage Armor). Pure OBSERVATION again: report the spells THIS DM narrative shows the HERO successfully completing, as one extra top-level field:
"narrated_casts": [{ "spell": "exact spell name from HERO'S KNOWN SPELLS", "target": "self, or the exact companion name the spell lands on" }]

Cast rules:
- Report ONLY casts the DM NARRATIVE completes for the HERO in this scene: the ward settles, the wounds knit, the light blooms. Attempts, intentions, preparations, interrupted or failed magic, and spells cast by ANY other character report nothing.
- HERO'S KNOWN SPELLS lists every spell that mechanically exists for the hero — report a cast only under its exact listed name. Magic that matches no listed spell reports nothing.
- ENGINE CASTS ALREADY APPLIED lists casts the engine already handled for this narrative — never re-report those.
- An effect merely CONTINUING from an earlier cast (an active ward glinting, an ongoing magical light) is not a new cast; only magic completed for the first time in THIS narrative counts.
- When in doubt, omit. Omit "narrated_casts" entirely when the hero completes no cast.`;

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

function coerceLootAmount(value, max = MAX_COIN_EVENT) {
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
    return lines ? lines.slice(0, NPC_DOSSIER_FIELD_MAX) : null;
}


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

/** Coin totals (in copper) the event path already applied for this narration.
 * Purchases/sales carry an explicit priceCp only when the DM supplied one; the
 * conservative direction is to count what we can see — the audit then under-
 * corrects rather than double-charges. */
function appliedCoinCp(events) {
    const n = value => (Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);
    if (!events) return { gainCp: 0, lossCp: 0 };
    let gainCp = n(events.goldFound) * 100 + n(events.silverFound) * 10 + n(events.copperFound);
    let lossCp = n(events.goldLost) * 100 + n(events.silverLost) * 10 + n(events.copperLost);
    for (const purchase of events.purchases || []) lossCp += n(purchase?.priceCp);
    for (const sale of events.sells || []) gainCp += n(sale?.priceCp);
    return { gainCp, lossCp };
}

const auditItemToken = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Identity tokens for every item the event path already granted this narration. */
function appliedItemTokens(events) {
    const tokens = new Set();
    const add = entry => {
        if (!entry) return;
        const values = typeof entry === 'string'
            ? [entry]
            : [entry.name, entry.itemKey, entry.key, entry.item?.name, entry.item?.itemKey];
        for (const value of values) {
            const token = auditItemToken(value);
            if (token) tokens.add(token);
        }
    };
    for (const list of [events?.itemsFound, events?.startingItems, events?.purchases]) {
        (list || []).forEach(add);
    }
    return tokens;
}

/**
 * Reconcile the Scribe's narrated-loot OBSERVATION against the events the engine
 * already applied for this narration. The Scribe reports full narrated totals;
 * the accounting happens HERE, in code — the old contract asked the LLM to report
 * "only the shortfall" and its arithmetic failures were a live double-grant/
 * double-charge source (2026-07-31). Coin recovery is all-or-nothing: if the
 * event path applied ANY coin gain for this narration, the DM demonstrably
 * evented the grant and owns its amount — no top-ups (the same-day playtest
 * showed change-making narrations make gross-vs-net amounts ambiguous to the
 * Scribe). Idempotent per sourceId via CLAIM_LOOT_SOURCE, clamped by the engine,
 * and announced with a visible system message so the player sees every correction.
 */
function reconcileNarratedLoot(narrated, lootAudit, dispatch) {
    if (!narrated || typeof narrated !== 'object') return;
    const gold = coerceLootAmount(narrated.gold);
    const silver = coerceLootAmount(narrated.silver);
    const copper = coerceLootAmount(narrated.copper);
    const items = (Array.isArray(narrated.items) ? narrated.items : [])
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

    const { sourceId, getState, appliedEvents } = lootAudit;
    if (!sourceId) return;
    if ((getState?.()?.appliedLootSourceIds || []).includes(sourceId)) {
        console.warn(`[Scribe] Loot audit for ${sourceId} already applied; skipping.`);
        return;
    }
    dispatch({ type: 'CLAIM_LOOT_SOURCE', payload: sourceId });

    const narratedCp = gold * 100 + silver * 10 + copper;
    // Stand-down rule: any applied coin gain means the DM evented this grant —
    // recover coins only on PURE omission, in the narrated denominations.
    const { gainCp } = appliedCoinCp(appliedEvents);
    const coinShortfallCp = gainCp > 0 ? 0 : narratedCp;
    if (narratedCp > 0 && gainCp > 0) {
        console.log(`[Scribe] Loot audit: event path already applied a ${gainCp} cp gain for this narration — standing down on coins.`);
    }

    const knownTokens = appliedItemTokens(appliedEvents);
    // Cross-message ledger check (live playtest #8): the same-message stand-down
    // above cannot see a RE-narration — "you tuck the pages away" one turn after
    // the pages were evented re-granted them because audit ADD_ITEMs deliberately
    // carry no _meta (the announcement line must never claim more than it did).
    // So the dedupe happens HERE: an item identity the recentItemGrants ledger
    // shows applied within its window is a recount, not a missing grant. Window
    // mirrors RECENT_ITEM_GRANT_MESSAGE_WINDOW in state/handlers/inventory.js.
    const ITEM_GRANT_LEDGER_WINDOW = 4;
    const state = getState?.();
    const recentGrantTokens = new Set();
    const currentIndex = (state?.messages || []).length;
    for (const entry of state?.recentItemGrants || []) {
        if (entry?.status !== 'applied') continue;
        const distance = conversationalDistance(state.messages, entry.messageIndex, currentIndex);
        if (!(distance >= 0 && distance <= ITEM_GRANT_LEDGER_WINDOW)) continue;
        for (const token of [auditItemToken(entry.name), auditItemToken(entry.itemKey)]) {
            if (token) recentGrantTokens.add(token);
        }
    }
    const missingItems = items.filter(item => {
        const tokens = [item.name, item.itemKey].map(auditItemToken);
        const alreadyApplied = tokens.some(token => token && knownTokens.has(token));
        const recentlyGranted = tokens.some(token => token && recentGrantTokens.has(token));
        if (alreadyApplied) console.warn(`[Scribe] Narrated item "${item.name}" already granted by the event path; skipping.`);
        else if (recentlyGranted) console.warn(`[Scribe] Narrated item "${item.name}" was already granted moments ago (ledger); skipping.`);
        return !alreadyApplied && !recentlyGranted;
    });

    // Coins route through the replay-guarded grant so a reward the DM re-narrates on a
    // later turn (already suppressed on the event path) cannot re-enter via the audit.
    // The reducer announces the recovery (or the suppression) itself. Audits never
    // carry playerMessage: the repeat-intent bypass belongs to the DM event path.
    if (coinShortfallCp > 0) {
        dispatch({
            type: 'ADD_COIN_GRANT',
            payload: {
                gold, silver, copper,
                _meta: { sourceId, announce: 'audit', audit: true },
            },
        });
    }
    for (const item of missingItems) dispatch({ type: 'ADD_ITEM', payload: item });

    if (missingItems.length > 0) {
        const parts = missingItems.map(item => (item.quantity > 1 ? `${item.quantity}x ${item.name}` : item.name));
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `**Loot recovered from narration:** ${parts.join(', ')} added to your possessions.`,
            },
        });
    }
    if (coinShortfallCp > 0 || missingItems.length > 0) {
        console.log(`[Scribe] Loot audit recovered: ${coinShortfallCp} cp shortfall, items ${missingItems.length}`);
    }
}

/**
 * Spellcast sibling of reconcileNarratedLoot (queue P1, Codex 2026-08-09): a
 * cast the DM narrates with no spell_cast event is mechanically nonexistent.
 * The audit dispatches the missed CAST_SPELL and the reducer stays the single
 * authority — it validates the spell, spends the slot, rolls healing, posts its
 * own "casts X" line, and its ledger keeps this idempotent (exact sourceId for
 * retries; the nearby-replay window suppresses later re-narrations because
 * audits deliberately carry no playerMessage, so the player-recast bypass never
 * opens for them). Out-of-combat only by design: in-fight casting is exchange
 * territory, and victory narration recaps in-fight casts (no `auditCasts` flag
 * on that path).
 */
function reconcileNarratedCasts(narrated, lootAudit, dispatch) {
    if (!Array.isArray(narrated) || narrated.length === 0) return;
    const { sourceId, getState, appliedEvents } = lootAudit;
    if (!sourceId) return;
    const state = getState?.();
    const character = state?.character;
    if (state?.combat?.active || !isSpellcaster(character?.class)) return;
    const appliedKeys = new Set((appliedEvents?.spellCasts || [])
        .map(cast => resolveSpellForCharacter(character, cast?.spell)?.key)
        .filter(Boolean));
    for (const entry of narrated.slice(0, 2)) {
        const name = String((typeof entry === 'string' ? entry : entry?.spell) || '').trim();
        const spell = resolveSpellForCharacter(character, name);
        if (!spell || !spell.outOfCombatAvailable) continue;
        if (appliedKeys.has(spell.key)) {
            console.warn(`[Scribe] Narrated cast "${spell.name}" already applied by the event path; skipping.`);
            continue;
        }
        const target = typeof entry === 'object' && entry?.target ? String(entry.target).slice(0, 60) : '';
        dispatch({
            type: 'CAST_SPELL',
            payload: {
                spell: spell.name,
                ...(target && { target }),
                _meta: { sourceId: `${sourceId}:cast` },
            },
        });
        console.log(`[Scribe] Cast audit: recovered narrated ${spell.name} the event path missed.`);
    }
}

/**
 * Payment twin of reconcileNarratedLoot: the Scribe reports the TOTAL coins the
 * narrative shows the hero paying out; the engine deducts them ONLY when the
 * event path applied no coin loss at all for this same narration (pure omission
 * recovery). This is what killed the live "paid once, charged twice" bug — the
 * second charge was this audit re-reporting an already-evented payment and
 * slipping past the ledger via the repeat-payment player-phrasing bypass. No
 * partial top-ups either: the 2026-07-31 playtest's ferry toll ("hand over a
 * gold piece, take 8 silver change") showed gross-vs-net payment amounts are
 * ambiguous to the Scribe, so an evented payment's amount is the DM's alone.
 * The reducer still clamps the deduction to the purse and posts a visible
 * system line; idempotency is a claimed per-message sourceId, like loot recovery.
 */
function reconcileNarratedPayment(narrated, lootAudit, dispatch) {
    if (!narrated || typeof narrated !== 'object') return;
    const gold = coerceLootAmount(narrated.gold);
    const silver = coerceLootAmount(narrated.silver);
    const copper = coerceLootAmount(narrated.copper);
    if (gold <= 0 && silver <= 0 && copper <= 0) return;

    const { sourceId, getState, appliedEvents } = lootAudit;
    if (!sourceId) return;
    const paymentSourceId = `${sourceId}:payment`;
    if ((getState?.()?.appliedLootSourceIds || []).includes(paymentSourceId)) {
        console.warn(`[Scribe] Payment audit for ${paymentSourceId} already applied; skipping.`);
        return;
    }
    dispatch({ type: 'CLAIM_LOOT_SOURCE', payload: paymentSourceId });

    const narratedCp = gold * 100 + silver * 10 + copper;
    const { lossCp } = appliedCoinCp(appliedEvents);
    if (lossCp > 0) {
        console.log(`[Scribe] Payment audit: event path already applied a ${lossCp} cp loss for this narration — standing down.`);
        return;
    }
    // The reducer checks the shared recentCoinLosses ledger for OTHER messages'
    // charges; same-message accounting already happened right here, and audits
    // get no player-phrasing bypass.
    dispatch({
        type: 'AUDIT_COIN_PAYMENT',
        payload: {
            gold, silver, copper,
            _meta: { sourceId: paymentSourceId, audit: true },
        },
    });
    console.log(`[Scribe] Payment audit settled: ${narratedCp} cp (no coin loss was evented for this narration).`);
}

/**
 * Loss twin of reconcileNarratedLoot (queue P2, live playtest #8): the seizure
 * decree narrated the pack "emptied onto the table" with zero items_lost events
 * and the sheet kept everything the story locked away. Observation-only like
 * the whole family: the Scribe reports the items the narrative shows LEAVING
 * the hero's possession; the engine removes each one ONLY when the event path
 * removed nothing matching for this narration AND the hero still owns it —
 * routed through REMOVE_ITEM_BY_NAME, the exact action the items_lost event
 * path uses (whole-stack semantics, AC recompute, so the audit is never more
 * powerful than the DM's own channel). Self-limiting on recaps: an item
 * already removed matches nothing and reports no shortfall. Coins seized
 * alongside ride narrated_payment (one coin-loss lane, one ledger). Idempotent
 * per narration via a claimed `:losses` sourceId; announced visibly.
 */
function reconcileNarratedLosses(narrated, lootAudit, dispatch) {
    const items = (Array.isArray(narrated?.items) ? narrated.items : [])
        .map(entry => String((typeof entry === 'string' ? entry : entry?.name) || '').trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 4);
    if (items.length === 0) return;

    const { sourceId, getState, appliedEvents } = lootAudit;
    if (!sourceId) return;
    const lossSourceId = `${sourceId}:losses`;
    const state = getState?.();
    if ((state?.appliedLootSourceIds || []).includes(lossSourceId)) {
        console.warn(`[Scribe] Loss audit for ${lossSourceId} already applied; skipping.`);
        return;
    }
    dispatch({ type: 'CLAIM_LOOT_SOURCE', payload: lossSourceId });

    // Stand-down per item: a loss identity the event path already removed for
    // this narration is the DM's own accounting, not a missing removal.
    const appliedLossTokens = new Set((appliedEvents?.itemsLost || [])
        .map(entry => auditItemToken(typeof entry === 'string' ? entry : entry?.name))
        .filter(Boolean));

    const removed = [];
    for (const name of items) {
        const token = auditItemToken(name);
        if (token && appliedLossTokens.has(token)) {
            console.warn(`[Scribe] Narrated loss "${name}" already removed by the event path; skipping.`);
            continue;
        }
        const owned = (state?.inventory || []).find(
            item => String(item?.name || '').trim().toLowerCase() === name.toLowerCase(),
        );
        if (!owned) {
            console.warn(`[Scribe] Narrated loss "${name}" matches nothing the hero owns; skipping.`);
            continue;
        }
        dispatch({ type: 'REMOVE_ITEM_BY_NAME', payload: owned.name });
        removed.push(owned.name);
    }

    if (removed.length > 0) {
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `**Losses recorded from narration:** ${removed.join(', ')} removed from your possessions.`,
            },
        });
        console.log(`[Scribe] Loss audit removed ${removed.length} narrated loss(es) the event path missed.`);
    }
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
        const gender = String(npc.gender || '').trim();
        entries.push(`${name}${gender ? ` (${gender})` : ''}: ${npc.appearance.trim().slice(0, 240)}`);
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

export async function runScribe({ playerMessage, dmNarrative, settings, dispatch, authoritativeContext = null, lootAudit = null, knownAppearances = null, knownStances = null, dmLocationEvent = null }) {
    const background = getBackgroundConfig(settings);
    if (!background.apiKey || !dmNarrative) return;

    const auditState = (lootAudit && typeof lootAudit.getState === 'function') ? lootAudit.getState() : null;
    const ownedInventory = auditState ? describeOwnedInventory(auditState) : null;
    const partyGear = auditState ? describePartyGear(auditState) : null;
    // Narrated-cast audit rides the ordinary-turn loot audit only (auditCasts flag):
    // victory narration recaps in-fight casts and mid-combat casting is exchange
    // territory, so neither may reach CAST_SPELL through this path.
    const castAudit = !!(lootAudit?.auditCasts && auditState
        && isSpellcaster(auditState.character?.class) && !auditState.combat?.active);
    const knownSpells = castAudit
        ? getKnownSpells(auditState.character).map(spell => spell.name).join('; ')
        : null;
    const appliedCasts = castAudit
        ? ((lootAudit.appliedEvents?.spellCasts || []).map(cast => cast?.spell).filter(Boolean).join('; ') || 'None.')
        : null;

    try {
        const response = await sendMessage({
            ...background,
            systemPrompt: SCRIBE_SYSTEM_PROMPT
                + (lootAudit ? LOOT_AUDIT_RULES : '')
                + (castAudit ? CAST_AUDIT_RULES : ''),
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
                    ? `EVENTS ALREADY APPLIED BY THE ENGINE THIS TURN (the engine reconciles narrated_loot/narrated_payment against these itself — for the gear-handoff audit, anything listed here is NOT missing): ${describeAppliedLoot(lootAudit.appliedEvents)}`
                    : null,
                ownedInventory
                    ? `HERO'S CURRENT INVENTORY (already owned — using, drawing, or lighting these is NOT an acquisition): ${ownedInventory}`
                    : null,
                partyGear
                    ? `PARTY COMPANIONS' CURRENT GEAR (already carried — referencing these is NOT a new handoff): ${partyGear}`
                    : null,
                knownSpells
                    ? `HERO'S KNOWN SPELLS (the only spells that mechanically exist for the hero): ${knownSpells}`
                    : null,
                appliedCasts
                    ? `ENGINE CASTS ALREADY APPLIED for this narrative (never re-report these): ${appliedCasts}`
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
            dispatch({ type: 'UPDATE_CHARACTER', payload: { appearance: extracted.player_appearance.trim().slice(0, CHARACTER_APPEARANCE_MAX) } });
        }

        // A model answering "where are we now?" with filler must not mint a canonical
        // place — "null"/"unchanged" as the current location was a real 2026-07-23 find.
        // Evidence gate (live playtest #6): the hero can only be relocated to a
        // place this turn's text actually names — "market square" arrived from
        // stale model context while the narration entered the chandlery.
        const location = sanitizeExtractedLocation(extracted.location);
        if (location && isLocationEvidencedInText(location, `${playerMessage}\n${dmNarrative}`)) {
            // When the DM's OWN events already relocated the hero this turn, that
            // explicit call is the narrator's authoritative statement — the async
            // Scribe may confirm or refine it but never relocate away from it
            // (live playtest #6: the Scribe latched onto a merely-mentioned "The
            // Weirs" and dragged the hero back into the fen the narration had
            // just walked her out of, forging phantom living-world stamps).
            dispatch({
                type: 'SET_LOCATION',
                payload: dmLocationEvent ? { name: location, fillOnly: true } : location,
            });
        }

        const locationProfile = extracted.location_profile;
        if (locationProfile && typeof locationProfile === 'object' && locationProfile.name) {
            dispatch({
                type: 'UPDATE_LOCATION_PROFILE',
                payload: {
                    name: locationProfile.name,
                    profile: { type: locationProfile.type, danger: locationProfile.danger, region: locationProfile.region },
                },
            });
        }

        if (lootAudit) {
            reconcileNarratedLoot(extracted.narrated_loot, lootAudit, dispatch);
            reconcileNarratedPayment(extracted.narrated_payment, lootAudit, dispatch);
            reconcileNarratedLosses(extracted.narrated_losses, lootAudit, dispatch);
            applyMissingGearHandoffs(extracted.missing_gear_handoffs, lootAudit, dispatch);
            if (castAudit) reconcileNarratedCasts(extracted.narrated_casts, lootAudit, dispatch);
        }

        captureScribePass({
            facts: worldFacts,
            npcsUpdated: rosteredNames,
            cards: storyMemory,
            playerAppearance: typeof extracted.player_appearance === 'string' && !!extracted.player_appearance.trim(),
            location,
            // narrated_loot/narrated_payment are OBJECTS, not arrays — Array.isArray
            // kept both inspector flags permanently false (2026-07-23 audit).
            lootAudited: !!(lootAudit && hasAuditPayload(extracted.narrated_loot)),
            paymentAudited: !!(lootAudit && hasAuditPayload(extracted.narrated_payment)),
            lossesAudited: !!(lootAudit && Array.isArray(extracted.narrated_losses?.items) && extracted.narrated_losses.items.length > 0),
            gearAudited: !!(lootAudit && Array.isArray(extracted.missing_gear_handoffs) && extracted.missing_gear_handoffs.length > 0),
            castsAudited: !!(castAudit && Array.isArray(extracted.narrated_casts) && extracted.narrated_casts.length > 0),
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

function reflectionText(value, maxLength) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

// The reflection reasons about who an NPC is and where their bond is heading — it
// never needs portraits, embeddings, or full histories. A raw roster entry carries
// portraitUrl base64 data URLs (~60 KB each; 12 portraits measured 846 KB of
// context on every journal cadence), so the record must be projected, never
// spread: any new roster field stays out of this payload until listed here.
function projectNpcForReflection(npc = {}) {
    const projected = {
        name: reflectionText(npc.name, 100),
        gender: reflectionText(npc.gender, 40),
        disposition: reflectionText(npc.disposition, 100),
        personality: reflectionText(npc.personality, 400),
        goals: reflectionText(npc.goals, 500),
        secrets: reflectionText(npc.secrets, 500),
        agenda: reflectionText(npc.agenda, 500),
        relationshipTension: reflectionText(npc.relationshipTension, 400),
        stanceToPlayer: reflectionText(npc.stanceToPlayer, 500),
        lastNotes: reflectionText(npc.lastNotes || npc.notes, 400),
        callbackHooks: (Array.isArray(npc.callbackHooks) ? npc.callbackHooks : [])
            .slice(-3)
            .map(hook => reflectionText(hook, 200))
            .filter(Boolean),
        bondMoments: (Array.isArray(npc.bondMoments) ? npc.bondMoments : [])
            .slice(-2)
            .map(moment => reflectionText(moment?.text || moment, 240))
            .filter(Boolean),
        basedIn: reflectionText(npc.basedIn, 120),
        lastLocation: reflectionText(npc.lastLocation, 120),
    };
    for (const key of Object.keys(projected)) {
        const value = projected[key];
        if (!value || (Array.isArray(value) && value.length === 0)) delete projected[key];
    }
    return projected;
}

export async function runNpcFrontReflection({ state, dispatch, cadence = null }) {
    const background = getBackgroundConfig(state?.settings);
    if (!background.apiKey) return;
    const npcs = curateNpcsForPrompt(state.npcs || [], {
        location: state.currentLocation,
        limit: 12,
    }).map(projectNpcForReflection);
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
            userMessage: JSON.stringify(context),
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
- A character's stated gender is inviolable: when a name carries "(woman)", "(man)", or the situation establishes gender, the rendered figure MUST read unmistakably as that gender — never default a described woman to a generic male figure or vice versa.
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
    // Filter BEFORE the cap — a nameless roster entry in the top 4 must not
    // silently shrink the cast the art director is told about.
    const recentNpcs = npcs
        .filter(n => n.name)
        .sort((a, b) => (b.lastSeen || b.firstMet || 0) - (a.lastSeen || a.firstMet || 0))
        .slice(0, 4);
    for (const n of recentNpcs) {
        const gender = n.gender?.trim() || '';
        const desc = n.appearance?.trim() || `${n.disposition || ''} NPC`.trim();
        lines.push(`NPC — ${n.name}${gender ? ` (${gender})` : ''}: ${desc}`);
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
