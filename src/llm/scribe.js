/**
 * Scribe — a lightweight background-machinery call (MACHINERY_MODEL in
 * llm/machinery.js) that runs silently after every DM response. It extracts
 * structured world-state updates from the narrative: new world facts, NPC
 * data, and notable consequences.
 *
 * The Scribe does NOT replace the journal summarizer. It runs every turn for
 * granular extraction; the journal runs every 10 messages for narrative archiving.
 *
 * Cost: background-machinery rates (a tiny fraction of the DM model cost).
 */

import { sendMessage } from './adapter.js';
import { getBackgroundConfig } from './machinery.js';
import { curateNpcsForPrompt, dispatchClassifiedNpcUpdate } from '../engine/npcRoster.js';
import { isLocationEvidencedInText, sanitizeExtractedLocation } from '../engine/locationRegistry.js';
import { tryParseDirectorJson } from './directorUtils.js';
import { captureReflection, captureScribePass } from '../debug/memoryInspectorStore.js';
import { computeRecentHeat, normalizePaceDial, TEMPO_TIMING_DIE_SIDES } from '../engine/worldTempo.js';
import { getKnownSpells, isSpellcaster } from '../engine/spellcasting.js';
import { rollDie } from '../engine/dice.ts';
import { CHARACTER_APPEARANCE_MAX } from '../config/contentLimits.js';
import {
    CAST_AUDIT_RULES,
    describeAppliedLoot,
    describeOwnedInventory,
    describePartyGear,
    hasAuditPayload,
    LOOT_AUDIT_RULES,
    runNarrationAudits,
} from './scribeAudits.js';

// The on-demand art director lives in its own module since the 2026-08-24
// split; existing consumers keep importing it from here.
export { composeScenePrompt, preserveSceneSituation } from './sceneDirector.js';

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
      "species": "the character's species/ancestry exactly as the fiction establishes it — 'goblin', 'human', 'dwarf', 'high elf'. Capture it the FIRST time it is knowable (including obvious humans); afterwards omit unless the fiction changes it",
      "basedIn": "place they are currently rooted — town they command, post they hold, territory they haunt. Update when fiction relocates or reassigns them; omit if unknown",
      "lastLocation": "where they were in this specific exchange (only if mentioned)",
      "agenda": "what this NPC is likely trying to accomplish next (only if implied or revealed)",
      "relationshipTension": "compact note about attraction, rivalry, resentment, debt, loyalty, fear, or trust strain",
      "stanceToPlayer": "how this NPC personally regards the HERO right now — affection, attraction, romantic interest, friendship, gratitude, respect, amusement, resentment, fear, obligation, rivalry. Written from the NPC's side, complete and current (only when this exchange establishes or shifts it)",
      "bondMoment": "one-line record of a significant personal moment between the hero and this NPC THIS turn — flirtation, confession, kiss, shared secret, gift, rescue, promise, betrayal, deep insult. Omit for ordinary interaction. The REGISTER rule binds THIS field hardest: an intimate moment is recorded in neutral anatomical language, never the scene's own crude diction",
      "trust": 0,
      "privateNotes": "hidden NPC intent or unrevealed motive useful for future consistency",
      "callbackHooks": ["short hooks this NPC could later bring back naturally — complete phrases in the neutral REGISTER, never crude slang"]
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
- "gender" and "species" are first-class continuity fields: pronouns, titles ("the widow", "the young man"), and explicit statements establish gender; any stated or apparent ancestry ("the goblin merchant", "a dwarven smith") establishes species. A character whose gender or species is knowable but unrecorded WILL get misrendered in generated art — a goblin woman recorded only as "woman" comes back human — so capture both as soon as the fiction shows them; both are exempt from the extraction budget like appearance.
- This is an adult game: body proportions and intimate, sensual, unflattering, or even embarrassing anatomical details the fiction establishes (a heavy backside, wide hips, a soft belly, body hair anywhere) are canonical visual continuity exactly like a scar or white hair. Record them frankly, completely, and at full specificity — never sanitize, euphemize, tone down, or silently omit them. For many players this continuity IS the point.
- REGISTER: write every record in plain, neutral anatomical language — backside/buttocks, breasts, chest, hips, genitals — never in profanity or crude slang, no matter how coarsely the player or DM phrased it. Translating vocabulary is NOT censoring content: keep the full detail, size, and specificity of what the fiction established. "Notably large buttocks" preserves a crude description completely; "curvy", a vague compliment, or dropping the detail loses canon and is forbidden. Neutral wording, complete facts.
- When KNOWN APPEARANCES lists a character and this turn adds or changes a visual detail, emit their appearance as the COMPLETE updated description: start from the known look and weave in what this turn established. Drop or alter a known detail ONLY when the fiction explicitly changed it (haircut, dye, disguise, wound, healing, new gear). NEVER emit just the new fragment — "a fresh scar on his cheek" alone would erase the white hair, the build, everything else on record. When merging, never launder the record: an intimate or unflattering detail already in KNOWN APPEARANCES stays in the merged description at full specificity until the fiction explicitly changes it — if the old record used crude slang, restate that detail in neutral anatomical wording (see REGISTER), but never blur, shrink, or drop it. As you merge, reconcile the description into clean prose: drop duplicate adjectives and resolve contradictions rather than stacking them ("scrawny ... scrawny ... large backside" should become one coherent line like "a scrawny goblin with notably large buttocks"), but never lose a distinct established detail in the process. If this turn adds nothing visually new for them, omit the field entirely.
- location_profile classifies what KIND of place the current location is, from what the narrative itself establishes: a haven is genuinely safe (a defended town, a temple sanctuary), a settlement is ordinary inhabited civilization, wilderness is uninhabited country, a frontier is contested or lawless ground, a hostile_site is intrinsically dangerous by nature (a ghoul-warren, a bandit camp). "danger" is the place's own intrinsic danger, independent of any current plot. Emit it when a location is first meaningfully established or when the fiction changes a place's fundamental nature (the town falls, the warren is cleared) — omit otherwise. Positional continuity, like appearance, is exempt from the extraction budget.
- Only include fields you have actual information for — omit empty/unknown fields
- DO NOT alter established details: copy names, proper nouns, and numbers exactly as the DM wrote them — never rename, paraphrase, translate, or invent (the REGISTER rule for anatomical vocabulary is the one exception). Refer to each NPC by the exact name used in the narrative so their record never forks.
- ONE PERSON, ONE RECORD: when a character's proper name is known — from the narrative, KNOWN APPEARANCES, or KNOWN PLAYER-RELATIONSHIP STANCES — always use their FULLEST known name ("Saima Aallotar", not "Saima") and NEVER a role title ("The Innkeeper", "the merchant"). Role-title names are allowed only for characters whose proper name has genuinely never been given.
- If nothing notable happened (pure narration, no new facts), return { "world_facts": [], "npc_updates": [], "story_memory": [], "location": null }
- Output ONLY the JSON, no other text`;


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
        const identity = [npc.species, npc.gender].map(v => String(v || '').trim()).filter(Boolean).join(' ');
        entries.push(`${name}${identity ? ` (${identity})` : ''}: ${npc.appearance.trim().slice(0, 240)}`);
    }
    return entries.length > 0 ? entries.join('\n') : null;
}

/**
 * Canonical place names the registry already tracks, for the Scribe's location
 * extraction (queue P2, live playtest #6): colloquial strings ("the back room
 * of the chandlery") share no tokens with the canonical record ("E. Duskwell —
 * Tallow & Tapers"), so genuine arrivals minted nothing, updated no visit
 * stamps, and skipped absence-drift/hearsay until a turn happened to name the
 * place properly. Most recently visited names first; compact by design.
 */
export function buildKnownLocations({ locations = [] } = {}) {
    const names = [...(locations || [])]
        .filter(record => record?.name)
        .sort((a, b) => (b.lastVisitedAt || b.firstSeenAt || 0) - (a.lastVisitedAt || a.firstSeenAt || 0))
        .slice(0, 12)
        .map(record => record.name);
    return names.length > 0 ? names.join('; ') : null;
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

/**
 * Roster-update twin of the fact/card filter: a dossier update whose NAME is
 * a snapshot enemy is checked on its narrative fields (the claim is built as
 * "name: fields" so the enemy-name presence test matches the same way).
 */
const NPC_UPDATE_CLAIM_FIELDS = ['lastNotes', 'disposition', 'secrets', 'agenda', 'notes', 'stanceToPlayer', 'relationshipTension', 'bondMoment'];
function npcUpdateContradictsAuthoritativeCombat(npc, authoritativeContext) {
    if (!npc || typeof npc !== 'object' || !npc.name) return false;
    const enemies = authoritativeContext?.postState?.enemies || [];
    if (enemies.length === 0) return false;
    const fields = NPC_UPDATE_CLAIM_FIELDS
        .map(key => (typeof npc[key] === 'string' ? npc[key] : ''))
        .filter(Boolean);
    if (fields.length === 0) return false;
    return contradictsAuthoritativeCombat(`${npc.name}: ${fields.join(' ')}`, authoritativeContext);
}

export async function runScribe({ playerMessage, dmNarrative, settings, dispatch, authoritativeContext = null, lootAudit = null, knownAppearances = null, knownStances = null, knownLocations = null, dmLocationEvent = null }) {
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
                knownLocations
                    ? `KNOWN PLACES (canonical place names the game already tracks): ${knownLocations}\nWhen this turn's location is one of these places under ANY phrasing — "the back room of the chandlery" IS the chandlery — report "location" as the canonical name verbatim. A distinct named place not on this list (a particular shop, street, or site, even inside a known town) keeps its own proper name.`
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

        const extracted = tryParseDirectorJson(response, 'world_facts', 'Scribe');
        if (!extracted) return;

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
                // The authoritative-combat filter covers roster updates too
                // (2026-09-01 scribe P2): a victory narration "killing" a foe
                // the engine marked fled wrote the death into that NPC's
                // dossier, which then rode KNOWN NPCs + RAG every turn.
                if (npcUpdateContradictsAuthoritativeCombat(npc, authoritativeContext)) {
                    console.warn(`[Scribe] Dropped roster update for "${npc?.name}" — contradicts authoritative combat state.`);
                    continue;
                }
                // Shared classify→dispatch with the journal's npcs_encountered
                // loop (2026-08-31 P2 — one helper owns the roster boundary).
                if (dispatchClassifiedNpcUpdate(dispatch, npc)) {
                    rosteredNames.push(npc?.name || '(unnamed)');
                }
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
                    // The turn's own text, inspected by the reducer's first-seen
                    // region evidence gate at dispatch time — never stored.
                    evidenceText: `${playerMessage || ''}\n${dmNarrative || ''}`.slice(0, 6000),
                },
            });
        }

        runNarrationAudits(extracted, { lootAudit, castAudit }, dispatch);

        captureScribePass({
            facts: worldFacts,
            npcsUpdated: rosteredNames,
            cards: storyMemory,
            playerAppearance: typeof extracted.player_appearance === 'string' && !!extracted.player_appearance.trim(),
            location,
            // hasAuditPayload is the ONE presence check for every audit channel —
            // object-shaped or array — because hand-rolled Array.isArray variants
            // are exactly how two flags sat permanently false (2026-07-23 audit).
            lootAudited: !!(lootAudit && hasAuditPayload(extracted.narrated_loot)),
            paymentAudited: !!(lootAudit && hasAuditPayload(extracted.narrated_payment)),
            lossesAudited: !!(lootAudit && hasAuditPayload(extracted.narrated_losses?.items)),
            gearAudited: !!(lootAudit && hasAuditPayload(extracted.missing_gear_handoffs)),
            castsAudited: !!(castAudit && hasAuditPayload(extracted.narrated_casts)),
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
      "callbackHooks": ["one or two details they could naturally bring back later — complete phrases in neutral anatomical language, never crude slang"]
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
        species: reflectionText(npc.species, 40),
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

        const reflected = tryParseDirectorJson(response, ['npc_updates', 'front_advances', 'story_memory'], 'Reflection');
        if (!reflected) return;

        const reflectedNames = [];
        if (Array.isArray(reflected.npc_updates)) {
            for (const npc of reflected.npc_updates) {
                if (dispatchClassifiedNpcUpdate(dispatch, npc)) {
                    reflectedNames.push(npc?.name || '(unnamed)');
                }
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

