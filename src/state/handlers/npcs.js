/**
 * NPC roster and locations: upsert/pin/archive/portrait/migration plus the
 * canonical location registry writes.
 */
import { buildStoryMemoryPromotion, gradeBondMoments, migrateLegacyNpc, namesMatch, normalizeNpcRecord, selectKeyBondMoments } from '../../engine/npcRoster.js';
import { beatTargets, deriveRelationshipStage, sanitizeRelationshipBeat } from '../../engine/relationshipArc.js';

/**
 * The quiet tell (2026-09-13 overhaul): what changed in the bond between
 * the record before and after an update — a NEW key moment (salience >= 4)
 * or a stage that moved. `[{ name, kind, label }]`, at most one of each.
 */
export function describeBondMarks(before, after) {
    if (!after?.name) return [];
    const marks = [];
    const keyBefore = new Set(selectKeyBondMoments(before?.bondMoments || [], 50).map(m => m.text));
    const newKey = selectKeyBondMoments(after.bondMoments || [], 50)
        .find(m => Number.isFinite(m.salience) && m.salience >= 4 && !keyBefore.has(m.text));
    if (newKey) {
        marks.push({ name: after.name, kind: 'moment', label: `A moment with ${after.name} was recorded: ${newKey.text}` });
    }
    // Only turning points tell: familiar and below are not news.
    const stageBefore = before ? deriveRelationshipStage(before).stage : 'stranger';
    const stageAfter = deriveRelationshipStage(after);
    if (stageAfter.stage !== stageBefore && !['stranger', 'acquaintance', 'familiar'].includes(stageAfter.stage)) {
        marks.push({ name: after.name, kind: 'stage', label: `${after.name}: now ${stageAfter.label.toLowerCase()}` });
    }
    return marks;
}

/** Stamp the newest visible DM message with bond marks (deduped by name+kind). */
export function stampLastDmMessage(messages, marks) {
    if (!Array.isArray(messages) || marks.length === 0) return messages;
    let idx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m && m.role === 'assistant' && !m.hidden && !m.deleted) { idx = i; break; }
    }
    if (idx === -1) return messages;
    const existing = Array.isArray(messages[idx].bondMarks) ? messages[idx].bondMarks : [];
    const merged = [...existing];
    for (const mark of marks) {
        if (merged.some(m => m.name === mark.name && m.kind === mark.kind)) continue;
        merged.push(mark);
    }
    if (merged.length === existing.length) return messages;
    return messages.map((m, i) => (i === idx ? { ...m, bondMarks: merged.slice(-6) } : m));
}
import { findStoryMemoryMatch, normalizeStoryMemoryCard } from '../../engine/storyMemory.js';
import { sanitizePortraitUrl } from '../../engine/portraitUrl.js';
import { areRelatedPlaces, collectKnownRegions, findLocationRecord, isBackstoryRegion, isDirectionEvidencedInText, isLocationEvidencedInText, isRegionEvidenced, isRegionNameOnly, isSameLocation, isSameRegion, linkLocations, normalizeTravelDirection, resolvePlaceNamedRegion, sanitizeRegionName, upsertLocation } from '../../engine/locationRegistry.js';
import { appendHearsayLedger, hearsayOfferSurvivesArrival, selectRegionalHearsay } from '../../engine/regionalHearsay.js';
import { ABSENCE_DRIFT_COOLDOWN_MESSAGES, ABSENCE_DRIFT_MIN_AWAY, MAX_ACTIVE_FRONTS, MAX_DRIFT_DEVELOPMENTS, distanceSince, getFrontIntensityBand, isAbsenceDriftLocalNpc } from '../../engine/worldTempo.js';
import { gameReducer } from '../gameReducer.js';
import { isStaleCampaignAction, upsertNpc } from './shared.js';
import { cleanTextField, LOCATION_NAME_MAX, NPC_DOSSIER_FIELD_MAX, NPC_GENDER_MAX, NPC_SPECIES_MAX } from '../../config/contentLimits.js';

/**
 * Attach a generated portrait to an NPC by id. Shared by the SET_NPC_PORTRAIT
 * reducer case and flushAutoSave's pre-render merge (the flush reads a state
 * ref that predates the dispatch). normalizeNpcRecord's allowlist drops
 * unsafe URLs.
 */
export function applyNpcPortrait(npcs = [], payload = {}) {
    // Metadata stamps only when the URL survives the allowlist (2026-09-09
    // audit P2): a rejected URL used to leave "Rendered by gemini" beside no
    // picture, and the reroll button flipped to "Reroll" for a portrait that
    // never existed.
    const portraitUrl = sanitizePortraitUrl(payload.portraitUrl);
    if (!portraitUrl) return npcs || [];
    return (npcs || []).map(npc => (
        npc.id === payload.id
            ? normalizeNpcRecord({
                ...npc,
                portraitUrl,
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
        // Deepen memory resolves minutes later; a stamp from another campaign
        // or load never writes here (2026-09-13 audit P1 — the chronicle guard).
        if (isStaleCampaignAction(state, action)) {
            console.warn('[NPC] Dropped an NPC update that started on a different campaign or load.');
            return state;
        }
        let nextNpcs = upsertNpc(state.npcs, action.payload, { messageCount: (state.messages || []).length });
        if (nextNpcs === state.npcs) return state;
        let touched = findTouchedNpc(nextNpcs, action.payload);
        // Deepen memory's regrade of the record's EXISTING bond moments
        // (2026-09-12 follow-up) rides the same action so the autosave flush's
        // single-action replay persists it: kind + salience land on ungraded
        // rows matched by verbatim text, same-scene same-kind twins fold to
        // one, text is never rewritten and rows never invented
        // (gradeBondMoments). upsertNpc strips the field from the record.
        const grades = action.payload?.gradedMoments;
        if (touched && Array.isArray(grades) && grades.length > 0) {
            const bondMoments = gradeBondMoments(touched.bondMoments, grades);
            const regraded = normalizeNpcRecord({ ...touched, bondMoments });
            nextNpcs = nextNpcs.map(npc => (npc === touched ? regraded : npc));
            touched = regraded;
        }
        // The quiet tell + the initiative consume (2026-09-13 overhaul): a
        // key moment landing or the stage moving marks the DM message it
        // came from (a small chip, no text); a seen NPC settles their own
        // reach-out window — the fiction has brought them together again.
        const before = findTouchedNpc(state.npcs || [], action.payload);
        const seen = action.payload?._seen !== false;
        let messages = state.messages;
        let session = state.session;
        if (touched && seen) {
            const marks = describeBondMarks(before, touched);
            if (marks.length > 0) messages = stampLastDmMessage(state.messages, marks);
            if (session?.relationshipBeat && beatTargets(session.relationshipBeat, touched)
                && (state.messages || []).length >= (sanitizeRelationshipBeat(session.relationshipBeat)?.opensAtMessage ?? Infinity)) {
                session = { ...session, relationshipBeat: null };
            }
        }
        let storyMemory = state.storyMemory || [];
        if (touched) {
            const promotion = buildStoryMemoryPromotion(touched);
            if (promotion) {
                const idx = findStoryMemoryMatch(storyMemory, promotion);
                if (idx === -1) {
                    const card = normalizeStoryMemoryCard(promotion);
                    // Birth stamps firstSeenMessage like ADD_STORY_MEMORY_CARD
                    // (2026-08-30 audit — the stamp is an invariant of card
                    // birth, even though promotions are never `witnessed`).
                    if (card) {
                        storyMemory = [...storyMemory, { ...card, firstSeenMessage: (state.messages || []).length }];
                    }
                } else {
                    // Deliberate divergence from ADD_STORY_MEMORY_CARD's merge:
                    // a promotion is a REGENERATED dossier snapshot, so its
                    // text/salience/charge replace the card wholesale — the
                    // fragment guard and salience-max are for Scribe re-reports
                    // of one beat, not for a snapshot that must also SHRINK
                    // when a stance softens. The promotion's stable id wins so
                    // a pre-fix `mem-` card migrates to the id rung here.
                    storyMemory = storyMemory.map((card, i) => (
                        i === idx ? normalizeStoryMemoryCard(promotion, card) : card
                    ));
                }
            }
        }
        return { ...state, npcs: nextNpcs, storyMemory, messages, session };
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
        if (isStaleCampaignAction(state, action)) {
            console.warn('[NPC] Dropped a portrait that started on a different campaign or load.');
            return state;
        }
        // normalizeNpcRecord's SAFE_PORTRAIT_URL allowlist is the belt here —
        // an unsafe URL is dropped rather than stored.
        return {
            ...state,
            npcs: applyNpcPortrait(state.npcs, action.payload || {}),
        };
    },

    /**
     * The player's own edit of a character's look (2026-09-12): a PLAIN
     * REPLACE of appearance / gender / species on the roster record by id —
     * never the Scribe's fragment merge or the dossier append (upsertNpc),
     * because the player IS the rewrite. Only keys the payload carries change;
     * an empty string clears the field. The portrait stays (the card offers a
     * reroll), and everything else on the record is untouched.
     */
    SET_NPC_LOOK(state, action) {
        const payload = action.payload || {};
        const id = typeof payload.id === 'string' ? payload.id : '';
        if (!id || !(state.npcs || []).some(npc => npc.id === id)) return state;
        const fields = [['appearance', NPC_DOSSIER_FIELD_MAX], ['gender', NPC_GENDER_MAX], ['species', NPC_SPECIES_MAX]];
        const update = {};
        for (const [field, max] of fields) {
            if (payload[field] !== undefined) update[field] = cleanTextField(payload[field], max);
        }
        if (Object.keys(update).length === 0) return state;
        return {
            ...state,
            npcs: state.npcs.map(npc => (npc.id === id ? normalizeNpcRecord({ ...npc, ...update }) : npc)),
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
        // Clamped at the WRITE (2026-09-15 audit P2): LOAD_GAME clamps
        // currentLocation at the same ceiling, but the live write was bare, so
        // a 100k location rode every prompt (over the char budget) until the
        // next location event. The registry record clamps tighter on its own.
        const name = cleanTextField(typeof rawPayload === 'string' ? rawPayload : rawPayload?.name, LOCATION_NAME_MAX);
        if (!name) return state;
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
        let locations = regionOnly
            ? departed
            : upsertLocation(departed, name, {
                ...(profile || {}),
                lastVisitedMessage: messageIndex,
                // The place card (2026-09-16): a genuine arrival counts a visit;
                // an alias re-statement of the current place keeps the count.
                ...(arrived ? { visitCount: (Number.isFinite(targetRecord?.visitCount) ? targetRecord.visitCount : 0) + 1 } : {}),
            });

        // Pseudo-place guard (live playtest #8): a destination that neither
        // resolves to nor mints a canonical record ("the threshold of the hidden
        // staircase") is scene furniture, not a place with a gossiping audience.
        // Every such string used to count as an arrival at a brand-new "place",
        // re-offering the same deeds under raw-text ledger keys — one fight was
        // cued at nine spellings inside the same few streets. Keep the live
        // hearsay window untouched (the render guard hides it if the hero truly
        // moved on) and skip selection entirely.
        const destinationIdx = findLocationRecord(locations, name);

        // Geography as canon (2026-09-14): an arrival at a different record IS
        // a bare travel edge from the place just left — detail (direction, time,
        // route) arrives later from the Scribe's `travel` report. linkLocations
        // skips one-cluster hops (the square → its tavern is not a road).
        if (arrived && prevRecord && destinationIdx !== -1) {
            locations = linkLocations(locations, prevRecord.id, locations[destinationIdx].id, { atMessage: messageIndex });
        }

        const next = { ...state, currentLocation: name, locations };
        if (!arrived) return next;
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
            next.session = {
                ...next.session,
                regionalHearsay: { locationName: name, arrivedAtMessage: messageIndex, items: selection.items },
            };
        } else if (hearsayOfferSurvivesArrival(state.session?.regionalHearsay, locations, name)) {
            // Intra-settlement movement (2026-08-31 P1 r3): the first move from
            // the town square to its own tavern used to null the live offer —
            // the cluster rule guarantees an empty selection at a related place
            // while the deeds are already ledger-burned for the whole audience.
            // Re-stamp the offer onto the new spelling (so the render guard's
            // location match keeps working for "The Gilded Eel" with no town
            // token); the original arrival stamp keeps the age window honest.
            next.session = {
                ...next.session,
                regionalHearsay: { ...state.session.regionalHearsay, locationName: name },
            };
        } else {
            next.session = { ...next.session, regionalHearsay: null };
        }

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
        // A drift still pending for a place the hero has LEFT is cancelled
        // (2026-09-20 audit P2): the call would still fire and install
        // agenda/lastNotes + a world fact under a stale awayDistance while the
        // away block (location-gated) never renders — canon without payoff.
        // The hearsay rule decides "left": only an UNRELATED arrival drops it.
        const pendingDrift = state.session?.pendingAbsenceDrift;
        const pendingDriftStale = !!pendingDrift
            && !hearsayOfferSurvivesArrival({ locationName: pendingDrift.locationName }, locations, name);
        if (pendingDriftStale) next.session = { ...next.session, pendingAbsenceDrift: null };
        if (awayDistance !== null && awayDistance >= ABSENCE_DRIFT_MIN_AWAY
            && (!pendingDrift || pendingDriftStale) && !driftCoolingDown && !lingeredNearby) {
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
        // A typed marker only (2026-09-08 P2): a string marker from a hostile
        // save made `pending.key` undefined and `undefined !== undefined` let a
        // keyless install through with no locality check at all.
        if (!pending || typeof pending.key !== 'string' || !pending.key
            || payload.sessionId !== state.session?.id || payload.key !== pending.key) return state;
        const session = { ...state.session, pendingAbsenceDrift: null };
        const drift = payload.drift && typeof payload.drift === 'object' ? payload.drift : {};
        // Strings only — `String(object)` minted "[object Object]" canon.
        const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

        const localNpcs = (state.npcs || []).filter(npc => isAbsenceDriftLocalNpc(npc, pending.locationName));
        const developments = (Array.isArray(drift.developments) ? drift.developments : [])
            .map(dev => ({
                name: text(dev?.name, 100),
                agenda: text(dev?.agenda, 300),
                lastNotes: text(dev?.lastNotes, 400),
                visible: text(dev?.visible, 240),
            }))
            // Local NPCs only (2026-08-19 audit): the director's context holds
            // just the NPCs of the return place, so a development naming a
            // distant roster NPC is a hallucination, never a valid install.
            // The gate and the write name the SAME record (2026-09-08 P2): a
            // bare "Maren" at Millhaven used to pass because the local "Maren
            // Tallow" matched, then upsertNpc wrote to the first roster match —
            // the fen witch "Maren of the Reeds". Resolve to the local record.
            .map(dev => {
                if (!dev.name || !(dev.agenda || dev.lastNotes)) return null;
                const local = localNpcs.find(npc => namesMatch(npc.name, dev.name));
                return local ? { ...dev, name: local.name || dev.name, npcId: local.id || null } : null;
            })
            .filter(Boolean)
            .slice(0, MAX_DRIFT_DEVELOPMENTS);

        let npcs = state.npcs || [];
        for (const dev of developments) {
            // Off-screen developments are not sightings: the hero has not seen
            // these people, so the recency stamps stay untouched (2026-09-06).
            npcs = upsertNpc(npcs, {
                ...(dev.npcId && { id: dev.npcId }),
                name: dev.name,
                ...(dev.agenda && { agenda: dev.agenda }),
                ...(dev.lastNotes && { lastNotes: dev.lastNotes }),
                _seen: false,
            });
        }

        const locations = state.locations || [];
        const idx = findLocationRecord(locations, pending.locationName);
        const record = idx === -1 ? null : locations[idx];
        const theaterFront = record
            ? (state.fronts || []).find(front => (front.status || 'active') === 'active'
                && (record.theaterFrontIds || []).includes(front.id))
            : null;
        const symptomText = text(drift.frontSymptom, 240);
        const frontSymptom = theaterFront && symptomText
            ? { frontId: theaterFront.id, maxIntensity: getFrontIntensityBand(theaterFront), text: symptomText }
            : null;

        const fact = text(drift.worldFact, 300);
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

    /**
     * A narrated journey between two KNOWN records (the Scribe's `travel`
     * report, 2026-09-14). Never mints a place: both ends must already be
     * registry records — the destination is the arrival SET_LOCATION minted
     * moments before. Every detail is evidence-gated against the turn's own
     * text (a compass word the narration never used is a hallucination, not
     * geography), and an unevidenced detail is dropped while the bare edge
     * still lands. The destination itself must be named in the turn.
     */
    ADD_TRAVEL_LINK(state, action) {
        const payload = action.payload && typeof action.payload === 'object' ? action.payload : {};
        const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
        const from = text(payload.from, 120);
        const to = text(payload.to, 120);
        if (!from || !to) return state;
        const locations = state.locations || [];
        const fromIdx = findLocationRecord(locations, from);
        const toIdx = findLocationRecord(locations, to);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return state;
        const evidence = typeof payload.evidenceText === 'string' ? payload.evidenceText : '';
        if (!isLocationEvidencedInText(to, evidence)) return state;
        // The origin is usually the place the hero just left, which the turn
        // may not name again — a visit stamp is the alternative proof.
        if (!isLocationEvidencedInText(from, evidence) && !Number.isFinite(locations[fromIdx].lastVisitedMessage)) return state;

        const direction = normalizeTravelDirection(payload.direction);
        const directionEvidenced = direction && isDirectionEvidencedInText(direction, evidence);
        const travelTime = text(payload.travelTime, 40);
        const route = text(payload.route, 60);
        return {
            ...state,
            locations: linkLocations(locations, locations[fromIdx].id, locations[toIdx].id, {
                direction: directionEvidenced ? direction : null,
                travelTime: travelTime && isLocationEvidencedInText(travelTime, evidence) ? travelTime : null,
                route: route && isLocationEvidencedInText(route, evidence) ? route : null,
                atMessage: (state.messages || []).length,
            }),
        };
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
