/**
 * The four prompt blocks the journal and the roster feed (2026-10-14
 * memory-journal Lap-4 P2): the place line, SESSION HISTORY, LOCATION
 * TRANSITION HISTORY and KNOWN NPCs — four builders, four parts, four
 * ceilings. They lived as ONE 155-line `buildJournalContext` inside the
 * cadence engine (engine/worldJournal.js), pushed as one `journalAndNpcs`
 * part under one 38,000-char ceiling, so a KNOWN NPCs regression could hide
 * behind a short journal. The journal module keeps the cadence;
 * `buildJournalContext` below is the four joined, for the tests that read
 * the whole context.
 */
import { LOCATION_NAME_MAX } from '../config/contentLimits.js';
import { briefNpcFieldForPrompt, curateNpcsForPrompt, findCompanionRecord, listNpcImpressions, splitBondMoments } from '../engine/npcRoster.js';
import { describeAbsence, describeStageForPrompt, resolveOpenThread } from '../engine/relationshipArc.js';
import { describeCurrentPlace, describeTravelLink, isSameLocation, listKnownWays } from '../engine/locationRegistry.js';
import { describeRegionLine, findRegionProfile, regionForPrompt } from '../engine/regionProfile.js';

/** KNOWN NPCs line opener budget — the party line's cap for the same fields. */
export const KNOWN_NPC_NOTES_MAX = 300;
/** SESSION HISTORY: entries shown, consequences shown per entry, and the clamp on each. */
export const SESSION_HISTORY_ENTRIES = 3;
export const SESSION_HISTORY_CONSEQUENCES = 3;
export const SESSION_HISTORY_CONSEQUENCE_CHARS = 150;
/** KNOWN NPCs: lines shown. */
export const MAX_PROMPT_NPCS = 8;

const clampText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
// A location with a name worth matching (the journal's normalizeLocationName truthiness).
const hasLocationName = (loc) => typeof loc === 'string' && /\w/.test(loc.replace(/^\s*the\s+/i, ''));

/**
 * The bond with the hero on a KNOWN NPCs line, in two tiers (2026-09-12):
 * the KEY moments (turning points — the DM plays from these) and "lately"
 * (unconfirmed stance impressions + the newest ordinary moment). A legacy
 * record with ungraded moments renders them all under "lately".
 */
export function describeBondForPrompt(npc = {}, storyMemory = [], { messages = null, messageCount } = {}) {
    const { key, recent } = splitBondMoments(npc.bondMoments);
    const impressions = listNpcImpressions(npc, 'stanceToPlayer');
    const lines = [];
    // Where they stand and what is pending (2026-09-13 overhaul slice 1):
    // the stage is derived from the record, the thread is the live beat the
    // DM plays toward — both lead the bond fields.
    const stage = describeStageForPrompt(npc);
    if (stage) lines.push(`bond: ${stage}`);
    const thread = resolveOpenThread(npc, storyMemory);
    if (thread) lines.push(`between you now: ${thread.text}`);
    // Absence (overhaul): a bond left alone meets the reunion in a changed
    // register — cooled, sharpened, scarred, or stinging. Bounded, engine-read.
    const absence = describeAbsence(npc, { messages, messageCount });
    if (absence) lines.push(`apart: ${absence.line}`);
    if (key.length > 0) {
        lines.push(`key moments with the hero: ${briefNpcFieldForPrompt(key.slice(-3).map(m => m.text).join('; '), 240)}`);
    }
    const lately = [
        ...impressions.slice(-2),
        ...recent.slice(0, key.length > 0 ? 1 : 2).map(m => m.text),
    ];
    if (lately.length > 0) {
        lines.push(`lately with the hero: ${briefNpcFieldForPrompt(lately.join('; '), 200)}`);
    }
    return lines;
}

/**
 * The place card (2026-09-16): ONE line — the name, the signature particular
 * the fiction established, and the place's current state — plus the ways the
 * hero has actually traveled from here (geography as canon, 2026-09-14).
 */
export function buildPlaceBlock(currentLocation, { locations = [], regions = null } = {}) {
    if (!currentLocation) return '';
    const lines = [`**Current location:** ${describeCurrentPlace(locations, currentLocation) || currentLocation}`];
    // The land's face (WOW 2026-10-26): ONE line under the place — the
    // region profile the regional director wrote, the record every new
    // place, person, foe and name here is drawn from.
    // The current record's own land, else the land last visited (most places
    // are never tagged — the 2026-10-27 live proof lost the face on three of
    // four far-land turns); the inherited line hedges for the crossing.
    const region = regionForPrompt(locations, currentLocation);
    const regionLine = region ? describeRegionLine(region.name, findRegionProfile(regions, region.name), { inherited: region.inherited }) : '';
    if (regionLine) lines.push(regionLine);
    // Consistency, not a map — an unlisted place is unmapped, never
    // nonexistent, so the DM stays free to invent roads not yet walked.
    const ways = listKnownWays(locations, currentLocation, { limit: 6 });
    if (ways.length > 0) {
        lines.push(`**Known ways from here (established geography — keep every stated direction, distance, and road consistent with this; unlisted places are simply not yet charted):** ${ways.map(way => describeTravelLink(way, way.name)).join('; ')}`);
    }
    return lines.join('\n');
}

/** The last 3 journal entries for narrative context. */
export function buildSessionHistoryBlock(journal) {
    const entries = Array.isArray(journal) ? journal : [];
    if (entries.length === 0) return '';
    const recentEntries = entries.slice(-SESSION_HISTORY_ENTRIES);
    const entrySummaries = recentEntries.map((e, i) => {
        let entry = `Entry ${entries.length - recentEntries.length + i + 1}: ${e.summary}`;
        // Array belt for legacy entries persisted before normalizeJournalSummary —
        // a string-valued consequences here crashed the prompt build every turn.
        // Newest 3 consequences, 150 chars each (2026-09-30 prompt-building
        // Lap-3 P2): the block printed 8 × 300 × 3 = 7,200 chars of
        // consequences beside a 2,000-char summary that already covers
        // the beat — 11.3k measured; the record keeps every consequence.
        if (Array.isArray(e.consequences) && e.consequences.length) {
            const shown = e.consequences.slice(-SESSION_HISTORY_CONSEQUENCES)
                .map(c => clampText(c, SESSION_HISTORY_CONSEQUENCE_CHARS))
                .filter(Boolean);
            if (shown.length) entry += ` [Consequences: ${shown.join('; ')}]`;
        }
        return entry;
    }).join('\n');
    return `\n## SESSION HISTORY (what has happened so far)\n${entrySummaries}`;
}

// Location transition history ledger. Bounded (2026-08-18 audit): the
// backward scan covers only the recent journal — an infinite campaign must
// not pay O(whole journal) regex work per prompt build when the current
// location matches nothing — and an entry already visible in the SESSION
// HISTORY last-3 window is referenced, not re-printed (right after travel
// the arrival entry IS one of the last 3, so re-printing duplicated ~2-4k
// chars every turn). Re-printed summaries are clamped.
const TRANSITION_SCAN_ENTRIES = 30;
const TRANSITION_SUMMARY_CHARS = 300;

export function buildTransitionHistoryBlock(journal, currentLocation) {
    const entries = Array.isArray(journal) ? journal : [];
    // Alias-tolerant match (2026-08-31 P2): currentLocation and journal-entry
    // stamps carry RAW alias strings ("Library landing, Clockwork Tower" vs
    // "Clockwork Tower") — normalizeLocationName exact-equality never matched
    // them, silently suppressing this block right after travel. isSameLocation
    // is the registry's token-containment rule.
    if (!hasLocationName(currentLocation) || entries.length === 0) return '';
    // The trail must END here (2026-10-26 memory-journal P2): the scan used to
    // keep walking while nothing matched, so on a RETURN before the next
    // cadence — the newest entries elsewhere, the hero back in town — it
    // landed on the PREVIOUS visit's run and told the DM the hero had just
    // walked in from the harbor they left ten entries ago. Now the newest
    // located entry must be the current place (an entry with no location says
    // nothing about place and is skipped); otherwise there is no trail to
    // show — the place card's "Visited ×N · last here N turns ago" carries the
    // return. The run then walks back over the stay to its first entry.
    const scanFloor = Math.max(0, entries.length - TRANSITION_SCAN_ENTRIES);
    let i = entries.length - 1;
    while (i >= scanFloor && !entries[i]?.location) i--;
    if (i < scanFloor || !isSameLocation(entries[i].location, currentLocation)) return '';
    let transitionIdx = i;
    while (i >= scanFloor) {
        const entryLoc = entries[i]?.location;
        if (!entryLoc) { i--; continue; }
        if (!isSameLocation(entryLoc, currentLocation)) break;
        transitionIdx = i;
        i--;
    }

    const shownFloor = entries.length - Math.min(entries.length, SESSION_HISTORY_ENTRIES); // SESSION HISTORY's window
    const arrivalEntry = entries[transitionIdx];
    const prevEntry = transitionIdx > 0 ? entries[transitionIdx - 1] : null;
    const lines = [];
    if (prevEntry) {
        const prevIdx = transitionIdx - 1;
        const prevPlace = clampText(prevEntry.location, LOCATION_NAME_MAX);
        const at = prevPlace ? ` at ${prevPlace}` : '';
        lines.push(prevIdx >= shownFloor
            ? `- **Right before entering:** Entry ${prevIdx + 1}${at ? ` (${at.trim()})` : ''} in SESSION HISTORY above.`
            : `- **Right before entering:** [Entry ${prevIdx + 1}${at}] ${clampText(prevEntry.summary, TRANSITION_SUMMARY_CHARS)}`);
    }
    lines.push(transitionIdx >= shownFloor
        ? `- **Arrival at ${currentLocation}:** Entry ${transitionIdx + 1} in SESSION HISTORY above.`
        : `- **Arrival at ${currentLocation}:** [Entry ${transitionIdx + 1}] ${clampText(arrivalEntry.summary, TRANSITION_SUMMARY_CHARS)}`);
    return `\n## LOCATION TRANSITION HISTORY\n${lines.join('\n')}`;
}

/**
 * NPC tracker — curated by importance, pins, location, and tension (not
 * recency alone). A party companion is never a KNOWN NPCs line (2026-10-13
 * prompt-building P2): their roster record renders ONCE, on their party
 * line — a present companion used to take a reserved slot here beside it.
 */
export function buildKnownNpcsBlock(npcs, currentLocation, { presentNames = null, partyNames = [], messages = null, storyMemory = [] } = {}) {
    const companionRecords = new Set((Array.isArray(partyNames) ? partyNames : [])
        .map(name => findCompanionRecord(npcs, name))
        .filter(Boolean));
    const rosterNpcs = (npcs || []).filter(n => (n.rosterTier === 'character' || !n.rosterTier) && !companionRecords.has(n));
    if (rosterNpcs.length === 0) return '';
    const shown = curateNpcsForPrompt(rosterNpcs, { location: currentLocation, limit: MAX_PROMPT_NPCS, presentNames, messages });
    const hiddenCount = Math.max(0, rosterNpcs.length - shown.length);

    const npcList = shown.map(n => {
        // Species and gender ride next to the name (not buried in extras):
        // scene art, pronoun consistency, and the DM's own prose all depend
        // on never re-guessing them — a goblin must never drift human.
        const identity = [n.species, n.gender, n.disposition].filter(Boolean).join(', ');
        const disp = identity ? ` (${identity})` : '';
        // The line's opener was the block's one unclamped field (2026-09-30
        // prompt-building Lap-3 P2): `lastNotes` rides at the 600-char dossier
        // clamp while every sibling renders at 180, so one maxed line ran
        // 3,177 chars and eight of them cost ~3.4k chars per call. The
        // party line caps the same fields at 300; the same budget here.
        const notes = briefNpcFieldForPrompt(n.lastNotes || n.notes || '', KNOWN_NPC_NOTES_MAX);
        // Show the latest relationship shift so the DM keeps a changed bond
        // consistent — a friend who turned on the player should stay turned.
        // Only previous → current: the full chain burned tokens/card space
        // without adding play value (Vesa, 2026-07-23); data keeps every step.
        const lastArcFrom = Array.isArray(n.relationshipHistory) ? n.relationshipHistory[n.relationshipHistory.length - 1]?.from : null;
        const arc = typeof lastArcFrom === 'string' && lastArcFrom
            ? `relationship: ${lastArcFrom} → ${n.disposition}`
            : '';
        const extras = [
            n.pinned && 'pinned',
            n.importance && `importance: ${n.importance}/5`,
            // Established looks come first: nothing breaks immersion like a
            // white-haired NPC turning brown-haired three sessions later.
            n.appearance && `looks: ${briefNpcFieldForPrompt(n.appearance)}`,
            n.personality && `personality: ${briefNpcFieldForPrompt(n.personality)}`,
            n.goals && `wants: ${briefNpcFieldForPrompt(n.goals)}`,
            n.agenda && `agenda: ${briefNpcFieldForPrompt(n.agenda)}`,
            n.secrets && `secret: ${briefNpcFieldForPrompt(n.secrets)}`,
            n.relationshipTension && `tension: ${briefNpcFieldForPrompt(n.relationshipTension)}`,
            // The personal bond with the hero — flirtation, gratitude, grudges —
            // is the beat players remember most; the DM must play it consistently.
            n.stanceToPlayer && `toward the hero: ${briefNpcFieldForPrompt(n.stanceToPlayer)}`,
            ...describeBondForPrompt(n, storyMemory, { messages, messageCount: Array.isArray(messages) ? messages.length : undefined }),
            Number.isFinite(n.trust) && `trust: ${n.trust}/100`,
            n.basedIn && `based in: ${n.basedIn}`,
            n.lastLocation && `last seen: ${n.lastLocation}`,
            arc,
            Array.isArray(n.callbackHooks) && n.callbackHooks.length > 0 && `hooks: ${n.callbackHooks.slice(0, 2).join('; ')}`,
        ].filter(Boolean).join(' | ');
        return `- **${n.name}**${disp}: ${notes}${extras ? ` [${extras}]` : ''}`;
    }).join('\n');

    const overflow = hiddenCount > 0
        ? `\n*(${hiddenCount} other NPCs available via RETRIEVED MEMORIES when relevant)*`
        : '';

    return `\n## KNOWN NPCs (keep names, registered gender, and established looks EXACTLY consistent — a character's gender and pronouns NEVER change from the registered value or the fiction that introduced them, and never re-invent or launder hair, eyes, build, body proportions, scars, intimate details, or clothing that "looks:" already records. Each NPC's "secret:" and "agenda:" entries are that character's PRIVATE interior — other characters do not know them unless the fiction has shown the reveal, per rule 9. "bond:" is where that person and the hero stand; "between you now:" is the LIVE thread between them — the thing they would raise first, so let them act on it, ask about it, or visibly avoid it when they share a scene; "apart:" is how time alone has changed the register they meet in — cooled, sharpened, scarred, or stinging — play the reunion in that register before the old warmth or heat returns)\n${npcList}${overflow}`;
}

/**
 * The four blocks in order, as the prompt assembles them — `[{ name, text }]`
 * with the empty ones left out. The assembler pushes each as its own part.
 */
export function buildJournalBlocks(journal, npcs, currentLocation, { presentNames = null, partyNames = [], messages = null, storyMemory = [], locations = [], regions = null } = {}) {
    return [
        { name: 'place', text: buildPlaceBlock(currentLocation, { locations, regions }) },
        { name: 'sessionHistory', text: buildSessionHistoryBlock(journal) },
        { name: 'transitionHistory', text: buildTransitionHistoryBlock(journal, currentLocation) },
        { name: 'knownNpcs', text: buildKnownNpcsBlock(npcs, currentLocation, { presentNames, partyNames, messages, storyMemory }) },
    ].filter(block => block.text);
}

/** The whole context as one string (the tests' view; the prompt pushes the parts). */
export function buildJournalContext(journal, npcs, currentLocation, options = {}) {
    return buildJournalBlocks(journal, npcs, currentLocation, options).map(block => block.text).join('\n');
}
