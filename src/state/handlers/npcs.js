/**
 * NPC roster and locations: upsert/pin/archive/portrait/migration plus the
 * canonical location registry writes.
 */
import { buildStoryMemoryPromotion, migrateLegacyNpc, namesMatch, normalizeNpcRecord } from '../../engine/npcRoster.js';
import { findStoryMemoryMatch, normalizeStoryMemoryCard } from '../../engine/storyMemory.js';
import { areRelatedPlaces, collectKnownRegions, findLocationRecord, isBackstoryRegion, isRegionEvidenced, isRegionNameOnly, isSameLocation, isSameRegion, resolvePlaceNamedRegion, sanitizeRegionName, upsertLocation } from '../../engine/locationRegistry.js';
import { appendHearsayLedger, selectRegionalHearsay } from '../../engine/regionalHearsay.js';
import { ABSENCE_DRIFT_COOLDOWN_MESSAGES, ABSENCE_DRIFT_MIN_AWAY, MAX_ACTIVE_FRONTS, MAX_DRIFT_DEVELOPMENTS, distanceSince, getFrontIntensityBand, isAbsenceDriftLocalNpc } from '../../engine/worldTempo.js';
import { gameReducer } from '../gameReducer.js';
import { upsertNpc } from './shared.js';

/**
 * Attach a generated portrait to an NPC by id. Shared by the SET_NPC_PORTRAIT
 * reducer case and flushAutoSave's pre-render merge (the flush reads a state
 * ref that predates the dispatch). normalizeNpcRecord's allowlist drops
 * unsafe URLs.
 */
export function applyNpcPortrait(npcs = [], payload = {}) {
    return (npcs || []).map(npc => (
        npc.id === payload.id
            ? normalizeNpcRecord({
                ...npc,
                portraitUrl: payload.portraitUrl,
                portraitPrompt: String(payload.portraitPrompt || '').slice(0, 2000),
                portraitProvider: String(payload.portraitProvider || '').slice(0, 40),
                portraitUpdatedAt: Date.now(),
            })
            : npc
    ));
}

export function archiveNpcBulk(npcs = [], ids = []) {
    const idSet = new Set((ids || []).filter(Boolean));
    if (idSet.size === 0) return npcs;
    return npcs.map(npc => (
        idSet.has(npc.id)
            ? normalizeNpcRecord({ ...npc, rosterTier: 'archived_creature', kind: 'creature', pinned: false })
            : npc
    ));
}

function findTouchedNpc(after = [], payload = {}) {
    const id = payload.id;
    const name = payload.name;
    return after.find(npc =>
        (id && npc.id === id)
        || (name && namesMatch(npc.name, name))
    ) || null;
}

export const handlers = {
    // UPDATE_NPC upserts by id or name (see upsertNpc): one create/merge path
    // means the per-turn Scribe and the DM's inline npc_updates can introduce a
    // brand-new NPC the instant it appears, instead of being silently dropped
    // until the next journal pass.
    UPDATE_NPC(state, action) {
        const nextNpcs = upsertNpc(state.npcs, action.payload);
        if (nextNpcs === state.npcs) return state;
        const touched = findTouchedNpc(nextNpcs, action.payload);
        let storyMemory = state.storyMemory || [];
        if (touched) {
            const promotion = buildStoryMemoryPromotion(touched);
            if (promotion) {
                const idx = findStoryMemoryMatch(storyMemory, promotion);
                if (idx === -1) {
                    const card = normalizeStoryMemoryCard(promotion);
                    if (card) storyMemory = [...storyMemory, card];
                } else {
                    storyMemory = storyMemory.map((card, i) => (
                        i === idx ? normalizeStoryMemoryCard({ ...promotion, id: card.id }, card) : card
                    ));
                }
            }
        }
        return { ...state, npcs: nextNpcs, storyMemory };
    },

    PIN_NPC(state, action) {
        return {
            ...state,
            npcs: (state.npcs || []).map(npc => (
                npc.id === action.payload?.id
                    ? normalizeNpcRecord({
                        ...npc,
                        pinned: !!action.payload.pinned,
                        rosterTier: 'character',
                        importance: 5,
                    })
                    : npc
            )),
        };
    },

    ARCHIVE_NPC(state, action) {
        return {
            ...state,
            npcs: (state.npcs || []).map(npc => (
                npc.id === action.payload?.id
                    ? normalizeNpcRecord({ ...npc, rosterTier: 'archived_creature', kind: 'creature', pinned: false })
                    : npc
            )),
        };
    },

    SET_NPC_PORTRAIT(state, action) {
        // normalizeNpcRecord's SAFE_PORTRAIT_URL allowlist is the belt here —
        // an unsafe URL is dropped rather than stored.
        return {
            ...state,
            npcs: applyNpcPortrait(state.npcs, action.payload || {}),
        };
    },

    MIGRATE_NPC_ROSTER(state) {
        const needsMigration = (state.npcs || []).some(npc => !npc.rosterTier);
        if (!needsMigration) return state;
        return { ...state, npcs: (state.npcs || []).map(npc => migrateLegacyNpc(npc)) };
    },

    ARCHIVE_NPC_BULK(state, action) {
        const ids = action.payload?.ids || [];
        if (ids.length === 0) return state;
        return { ...state, npcs: archiveNpcBulk(state.npcs, ids) };
    },

    SET_LOCATION(state, action) {
        const rawPayload = action.payload;
        const name = typeof rawPayload === 'string' ? rawPayload : rawPayload?.name;
        if (!name || typeof name !== 'string') return state;
        const profile = rawPayload && typeof rawPayload === 'object' ? rawPayload.profile : null;

        // Living-world arrival detection (DECISIONS.md 2026-08-05): only a move
        // to a DIFFERENT canonical record is an arrival — the Scribe re-stating
        // the current place (alias drift) must not re-trigger anything.
        const messageIndex = (state.messages || []).length;
        const priorLocations = state.locations || [];
        const prevIdx = findLocationRecord(priorLocations, state.currentLocation);
        const prevRecord = prevIdx === -1 ? null : priorLocations[prevIdx];
        const targetIdx = findLocationRecord(priorLocations, name);
        const targetRecord = targetIdx === -1 ? null : priorLocations[targetIdx];

        // fillOnly (journal cadence + same-turn Scribe under a DM location event):
        // the caller may fill an EMPTY location or re-affirm the current one, but
        // never relocate the hero — a less authoritative async pass must not
        // override live position (live playtest #5: the summary's stale town
        // clobbered a same-turn arrival and forged departure stamps; playtest #6:
        // the Scribe dragged the hero back to a merely-mentioned fen place the
        // DM's own location event had just walked her out of).
        const fillOnly = rawPayload && typeof rawPayload === 'object' && rawPayload.fillOnly === true;
        if (fillOnly && state.currentLocation) {
            const samePlace = (prevRecord && targetRecord && targetRecord.id === prevRecord.id)
                || isSameLocation(state.currentLocation, name);
            if (!samePlace) return state;
        }

        const arrived = !prevRecord || !targetRecord || targetRecord.id !== prevRecord.id;

        // Absence runs from the moment the hero LEFT the place (its departure
        // stamp) to this return, in conversational messages. Legacy records
        // without a stamp read null and simply start accruing from now.
        const awayDistance = arrived && targetRecord && Number.isFinite(targetRecord.lastVisitedMessage)
            ? distanceSince(state.messages, targetRecord.lastVisitedMessage, messageIndex)
            : null;

        // Departure stamp on the place being left, arrival stamp on the new one.
        const departed = arrived && prevRecord
            ? priorLocations.map(record => (record.id === prevRecord.id
                ? { ...record, lastVisitedMessage: messageIndex }
                : record))
            : priorLocations;
        // A bare region name ("the Rimefell Marches") is a whereabouts, not a
        // place — minting it as a location record distorts canonical folding
        // and eviction (live playtest #3 registry noise). currentLocation still
        // updates and hearsay still runs; the record waits for a real place
        // name ("Ghyll, Rimefell Marches" mints normally — token EQUALITY, not
        // containment, decides).
        const regionOnly = targetIdx === -1 && isRegionNameOnly(priorLocations, name);
        const locations = regionOnly
            ? departed
            : upsertLocation(departed, name, { ...(profile || {}), lastVisitedMessage: messageIndex });

        const next = { ...state, currentLocation: name, locations };
        if (!arrived) return next;

        // Pseudo-place guard (live playtest #8): a destination that neither
        // resolves to nor mints a canonical record ("the threshold of the hidden
        // staircase") is scene furniture, not a place with a gossiping audience.
        // Every such string used to count as an arrival at a brand-new "place",
        // re-offering the same deeds under raw-text ledger keys — one fight was
        // cued at nine spellings inside the same few streets. Keep the live
        // hearsay window untouched (the render guard hides it if the hero truly
        // moved on) and skip selection entirely.
        const destinationIdx = findLocationRecord(locations, name);
        if (destinationIdx === -1) return next;

        // Traveling rumor: deterministically pick which of the hero's deeds
        // could plausibly be talk of THIS place, once per (deed, place).
        const selection = selectRegionalHearsay({
            fronts: state.fronts,
            recentEncounters: state.recentEncounters,
            recentHearsay: state.recentHearsay,
            storyMemory: state.storyMemory,
            locations,
            locationName: name,
            messages: state.messages,
            messageIndex,
        });
        if (selection.items.length > 0) {
            next.recentHearsay = appendHearsayLedger(state.recentHearsay, selection.ledgerEntries);
        }
        next.session = {
            ...next.session,
            regionalHearsay: selection.items.length > 0
                ? { locationName: name, arrivedAtMessage: messageIndex, items: selection.items }
                : null,
        };

        // Absence drift: a long-enough return raises the one-shot marker the
        // background director (llm/absenceDrift.js) fires from. Cooldown: one
        // drift per homecoming, not one per stale record the return stroll
        // re-touches (2026-08-05 live playtest fired two within a few turns).
        const lastDriftAt = state.session?.absenceDrift?.arrivedAtMessage;
        const driftCoolingDown = Number.isFinite(lastDriftAt)
            && distanceSince(state.messages, lastDriftAt, messageIndex) < ABSENCE_DRIFT_COOLDOWN_MESSAGES;
        // Nested-place guard (live playtest #7): the shop, its street, and the
        // town fragment into separate records, so a "return" to the street's
        // stale record fired drift while the hero had spent the whole absence
        // inside the shop ON that street. If any RELATED record (shared
        // name/alias token) was visited more recently than the drift threshold,
        // the hero never really left this place's orbit — no drift.
        const lingeredNearby = (departed || []).some(record =>
            record.id !== targetRecord?.id
            && Number.isFinite(record.lastVisitedMessage)
            && distanceSince(state.messages, record.lastVisitedMessage, messageIndex) < ABSENCE_DRIFT_MIN_AWAY
            && areRelatedPlaces(record, targetRecord));
        if (awayDistance !== null && awayDistance >= ABSENCE_DRIFT_MIN_AWAY
            && !state.session?.pendingAbsenceDrift && !driftCoolingDown && !lingeredNearby) {
            next.session = {
                ...next.session,
                pendingAbsenceDrift: {
                    key: `${targetRecord.id}|${messageIndex}`,
                    locationName: targetRecord.name,
                    awayDistance,
                    returnMessage: messageIndex,
                },
            };
        }
        return next;
    },

    /**
     * One-shot install of the background absence-drift proposal. Everything is
     * re-validated here: NPC developments touch agenda/lastNotes only and only
     * for roster NPCs OF the return place (structurally nobody can be killed,
     * relocated, or have bond history rewritten), the world fact rides the
     * deduping ADD_WORLD_FACTS path, and a front symptom survives only where
     * an active front still holds theater — clamped to its live intensity
     * band. A weak proposal installs nothing; a quiet return is first-class.
     */
    INSTALL_ABSENCE_DRIFT(state, action) {
        const payload = action.payload || {};
        const pending = state.session?.pendingAbsenceDrift;
        if (!pending || payload.sessionId !== state.session?.id || payload.key !== pending.key) return state;
        const session = { ...state.session, pendingAbsenceDrift: null };
        const drift = payload.drift && typeof payload.drift === 'object' ? payload.drift : {};

        const developments = (Array.isArray(drift.developments) ? drift.developments : [])
            .map(dev => ({
                name: String(dev?.name || '').trim().slice(0, 100),
                agenda: String(dev?.agenda || '').trim().slice(0, 300),
                lastNotes: String(dev?.lastNotes || '').trim().slice(0, 400),
                visible: String(dev?.visible || '').trim().slice(0, 240),
            }))
            // Local NPCs only (2026-08-19 audit): the director's context holds
            // just the NPCs of the return place, so a development naming a
            // distant roster NPC is a hallucination, never a valid install.
            .filter(dev => dev.name && (dev.agenda || dev.lastNotes)
                && (state.npcs || []).some(npc => isAbsenceDriftLocalNpc(npc, pending.locationName)
                    && namesMatch(npc.name, dev.name)))
            .slice(0, MAX_DRIFT_DEVELOPMENTS);

        let npcs = state.npcs || [];
        for (const dev of developments) {
            npcs = upsertNpc(npcs, {
                name: dev.name,
                ...(dev.agenda && { agenda: dev.agenda }),
                ...(dev.lastNotes && { lastNotes: dev.lastNotes }),
            });
        }

        const locations = state.locations || [];
        const idx = findLocationRecord(locations, pending.locationName);
        const record = idx === -1 ? null : locations[idx];
        const theaterFront = record
            ? (state.fronts || []).find(front => (front.status || 'active') === 'active'
                && (record.theaterFrontIds || []).includes(front.id))
            : null;
        const symptomText = String(drift.frontSymptom || '').trim().slice(0, 240);
        const frontSymptom = theaterFront && symptomText
            ? { frontId: theaterFront.id, maxIntensity: getFrontIntensityBand(theaterFront), text: symptomText }
            : null;

        const fact = String(drift.worldFact || '').trim().slice(0, 300);
        const installed = developments.length > 0 || fact || frontSymptom;
        const next = {
            ...state,
            npcs,
            session: {
                ...session,
                absenceDrift: installed
                    ? {
                        locationName: pending.locationName,
                        arrivedAtMessage: pending.returnMessage,
                        awayDistance: pending.awayDistance,
                        developments,
                        fact,
                        frontSymptom,
                    }
                    : state.session?.absenceDrift || null,
            },
        };
        if (!fact) return next;
        return gameReducer(next, { type: 'ADD_WORLD_FACTS', payload: [{ fact, category: 'event' }] });
    },

    // Scribe-classified profile for an already-known place (type/danger/theater/
    // region). A profile naming a region NEW to the whole registry — while the
    // hero stands there and at least one OTHER region is already known (the
    // first-ever region is home and never seeds) — raises the one-shot
    // regional-front marker (DECISIONS.md 2026-08-05 ×2, world-tempo
    // component 9): a genuinely new land gets its own native pressures.
    UPDATE_LOCATION_PROFILE(state, action) {
        const { name, profile: rawProfile } = action.payload || {};
        if (!name || !rawProfile || typeof rawProfile !== 'object') return state;
        // Update-only: a profile classifies a place the registry already knows.
        // The Scribe dispatches SET_LOCATION before this, so the current place
        // always has its record; a profile for anything else (a mentioned
        // region, a place the hero never stood in) minted null-stamp noise
        // records ("Vale of Reeds", "the fen" — live playtest #3). Theater
        // growth keeps its own minting path in handlers/fronts.js.
        const locationsBefore = state.locations || [];
        const targetIdx = findLocationRecord(locationsBefore, name);
        if (targetIdx === -1) return state;
        const targetRecord = locationsBefore[targetIdx];
        const priorRegions = collectKnownRegions(locationsBefore);

        // Region acceptance runs four gates before the registry write:
        // 1. Backstory guard (DECISIONS.md 2026-08-06, live playtest #3): a land
        //    named only in the hero's player-authored background is where the
        //    hero CAME FROM, not where this place lies.
        // 2. Place-name translation (live playtest 2026-08-20): the Scribe
        //    reports the containing TOWN ("Ashford") as a district's region —
        //    a proper, premise-evidenced name every other gate waves through.
        //    A "region" exactly naming a known place record is not a land:
        //    substitute that place's own canon region, or nothing.
        // 3. Cluster inheritance (queue P2, live playtest #8): the shop, its
        //    lane, and their town are one land — a related record's canon
        //    region outranks a novel proposal for a sub-place ("the Chandlers'
        //    quarter" cannot sit in a different land than Weatherby itself).
        // 4. Evidence gate (same queue entry): a FIRST-SEEN region name must
        //    appear in the turn's own text, the premise, or a world fact — a
        //    well-formed invention (the live "Rimefell Marches" prompt-example
        //    echo) dies here. Already-known regions re-tag without evidence.
        let region = sanitizeRegionName(rawProfile.region, name);
        if (region && isBackstoryRegion(region, {
            background: state.character?.background,
            premise: state.session?.premise,
        })) {
            region = null;
        }
        if (region) {
            region = resolvePlaceNamedRegion(locationsBefore, region, { excludeId: targetRecord.id });
        }
        if (region && !targetRecord.region) {
            const clusterRegion = locationsBefore.find(record => record !== targetRecord
                && record?.region && areRelatedPlaces(record, targetRecord))?.region || null;
            if (clusterRegion) {
                region = isSameRegion(clusterRegion, region) ? region : clusterRegion;
            } else if (!priorRegions.some(known => isSameRegion(known, region))
                && !isRegionEvidenced(region, {
                    turnText: action.payload?.evidenceText,
                    premise: state.session?.premise,
                    worldFacts: state.worldFacts,
                })) {
                region = null;
            }
        }
        const profile = { ...rawProfile, region };
        const locations = upsertLocation(locationsBefore, name, profile);
        const next = { ...state, locations };

        if (!region) return next;
        const hereIdx = findLocationRecord(locations, state.currentLocation);
        const classifiedIdx = findLocationRecord(locations, name);
        if (hereIdx === -1 || classifiedIdx === -1 || locations[hereIdx].id !== locations[classifiedIdx].id) return next;
        // The record's STORED region is authoritative (first value wins): a
        // re-classification that lost to an earlier canon region seeds nothing.
        if (!isSameRegion(locations[classifiedIdx].region, region)) return next;
        if (priorRegions.length === 0) return next; // home region — never seeded
        if (priorRegions.some(known => isSameRegion(known, region))) return next;
        if ((state.session?.seededRegions || []).some(known => isSameRegion(known, region))) return next;
        if (state.session?.pendingRegionalFronts) return next;
        const activeFronts = (state.fronts || []).filter(f => (f.status || 'active') === 'active').length;
        // The installer only tops the web to MAX_ACTIVE_FRONTS - 1 (one slot
        // always stays free), so with no room below that line the marker would
        // only buy a wasted DM call. The region stays unseeded and can trigger
        // later when a slot frees up.
        if (activeFronts >= MAX_ACTIVE_FRONTS - 1) return next;

        next.session = {
            ...next.session,
            pendingRegionalFronts: {
                key: `${region.toLowerCase()}|${(state.messages || []).length}`,
                region,
                locationName: locations[classifiedIdx].name,
                atMessage: (state.messages || []).length,
            },
        };
        return next;
    },
};
