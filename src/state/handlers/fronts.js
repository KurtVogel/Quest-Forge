/**
 * Hidden campaign fronts and world tempo: generated/emergent front installs,
 * the v2 upgrade, tempo directives, and cadence-paced clock advancement.
 */
import {
    applyFrontAdvanceBatch,
    buildFrontResolutionFact,
    describeFrontDoom,
    describeFrontReveal,
    DEFAULT_MAX_CLOCK,
    DOOM_TIMING_DIE_SIDES,
    FRONTS_VERSION,
    isFrontGenerationClosed,
    normalizeFront,
    normalizeFrontProposal,
    normalizeFrontUpdate,
    openDoomWindow,
    cadenceIdFor,
} from '../../engine/fronts.js';
import {
    DM_CLOCK_GAIN_WINDOW, MAX_ACTIVE_FRONTS, MAX_DOOM_DEVELOPMENTS, MAX_DOOM_PLACES,
    listClosedDooms, normalizeTempoDirective, sanitizeRecentEncounters, WEB_TARGET_FRONTS,
} from '../../engine/worldTempo.js';
import { conversationalDistance } from '../../engine/replayLedger.js';
import { DIRECTOR_MAX_ATTEMPTS, getDirectorFailure, RETRYABLE_DIRECTORS } from '../../engine/directorRetry.js';
import { foldExperience, getFrontResolutionMilestoneXp, isHeroDown } from '../../engine/progression.js';
import { findLocationRecord, isSameRegion, normalizeLocationRecord, upsertLocation } from '../../engine/locationRegistry.js';
import { findRegionProfile, recordRegionFaceAttempt, rememberRegionProfile } from '../../engine/regionProfile.js';
import { detectFrontTurning, INTERLUDE_CONCLUSION_DELAY, mintInterlude, openRegionInterlude } from '../../engine/interlude.js';
import { namesMatch } from '../../engine/npcRoster.js';
import { rollDie } from '../../engine/dice.ts';
import { isRecord } from '../../engine/text.js';
import { gameReducer } from '../gameReducer.js';
import { systemMessage, upsertNpc } from './shared.js';

/**
 * Shared installer core for the aftermath/regional one-shot proposals
 * (2026-08-24 P2: the two handlers carried the same 25-line loop twice).
 * Validates each proposal complete-or-nothing via normalizeFrontProposal
 * (the engine's one proposal boundary), deduped against the web and the
 * batch's earlier accepts by title or faction.
 */
function buildProposedFrontAdditions(fronts, proposals, room, idPrefix) {
    const additions = [];
    for (const proposal of (Array.isArray(proposals) ? proposals : []).slice(0, 2)) {
        if (additions.length >= room) break;
        const front = normalizeFrontProposal(proposal, {
            existing: [...fronts, ...additions],
            id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        });
        if (front) additions.push(front);
    }
    return additions;
}

/**
 * A full clock opens the doom window (WOW 2026-10-22): after either lane
 * moves a clock — the cadence batch or a DM gain — the engine stamps the
 * window on at most one front and rolls the crypto die for WHEN (0–1
 * scenes), the UPDATE_NPC turn-beat precedent. The card renders from the
 * stamp; nothing else changes until the window closes.
 */
function openDoomIfFull(state) {
    const { fronts, opened } = openDoomWindow(state.fronts || [], {
        messageCount: (state.messages || []).length,
        delayScenes: rollDie(DOOM_TIMING_DIE_SIDES) - 1,
    });
    return opened ? { ...state, fronts } : state;
}

/**
 * After either clock lane moved (the cadence batch, a DM gain): the doom
 * check above, then the interlude's TURNING seam (WOW 2026-10-26) — a
 * hidden front's stage crossed, so a portent came to pass off-screen and
 * the world's wide shot may say its public face. Never in combat; the
 * interlude's own cooldown keeps it rare.
 */
function afterClockMove(before, after) {
    const next = openDoomIfFull(after);
    const turning = detectFrontTurning(before.fronts || [], next.fronts || []);
    if (!turning || next.combat?.active) return next;
    const session = mintInterlude(next.session, {
        reason: 'turning',
        frontId: turning.frontId,
        material: turning.passed.at(-1) || null,
        messageCount: (next.messages || []).length,
        messages: next.messages,
    });
    return session === next.session ? next : { ...next, session };
}

/**
 * THE conclusion of a front — one ceremony, two registers (2026-10-22). The
 * hero's ending (`outcome` null: the DM's `resolved`) and the doom
 * (`'prevailed'`: the window closed unanswered) share every structural
 * step — the stamps, the freed theaters, the cancelled window, the pinned
 * canon fact, the 🕰️ line, the Chronicle nudge, a background director — and
 * differ in the register: the victory reveals the clockwork and pays the
 * milestone, the doom states what the world now carries, pays nothing, and
 * names no sign (the player who wants the signs asks the record or reads
 * the chapter; the engine never reproaches).
 */
function concludeFront(state, idx, front, { outcome = null, note = '' } = {}) {
    const prevailed = outcome === 'prevailed';
    const messageCount = (state.messages || []).length;
    const doom = describeFrontDoom(front);
    const concluded = normalizeFront({
        ...front,
        status: 'resolved',
        outcome,
        resolvedAtMessage: messageCount,
        resolution: prevailed ? (doom.stakes || doom.lastStep) : note,
        // Remember the territory before it is freed below — regional
        // hearsay grades a retelling at the front's own ground as
        // firsthand (2026-08-31 P2).
        resolvedTheaterIds: (state.locations || [])
            .filter(record => (record.theaterFrontIds || []).includes(front.id))
            .map(record => record.id),
    }, front);
    let next = {
        ...state,
        fronts: (state.fronts || []).map((entry, i) => (i === idx ? concluded : entry)),
    };
    // A dead pressure holds no territory: free its theaters so a future,
    // different front can claim those places without inheriting the flavor.
    next.locations = (state.locations || []).map(record =>
        (record.theaterFrontIds || []).includes(front.id)
            ? { ...record, theaterFrontIds: record.theaterFrontIds.filter(id => id !== front.id) }
            : record);
    // Cancel any granted-but-unspent symptom window pointed at this front.
    if (next.worldTempo?.directive?.frontId === front.id) {
        next.worldTempo = { ...next.worldTempo, directive: null };
    }
    // The payoff reveal: the private clockwork surfaces as table canon
    // exactly once, at the moment the player has earned it.
    // The reveal shows the clockwork (WOW 2026-10-21): the record's goal,
    // the placed symptoms and the unfired portents used to die unread by
    // anyone but the aftermath director — the line said the same sentence
    // for every front. A DOOM reveals the title and what it took — never
    // the signs (Vesa, 2026-10-22: an itemized "what you missed" is the
    // game grading the player).
    const wanted = typeof concluded.faction?.goal === 'string' && concluded.faction.goal.trim()
        ? concluded.faction.goal.trim().slice(0, 200)
        : concluded.goal.slice(0, 200);
    next.messages = [...(next.messages || []), systemMessage(prevailed
        ? `🕰️ **The world shifts: "${concluded.title}" has come to pass.** What it wanted — ${wanted.replace(/[.…]+$/, '')} — it now has${concluded.resolution ? `: ${concluded.resolution.replace(/[.…]+$/, '')}` : ''}. This is part of the campaign's canon now; the Journal's Chronicle tab is ready to retell it as a chapter of your saga.`
        : `🕰️ **The world shifts: "${concluded.title}" has ended.** A hidden pressure that has been moving against you since it first stirred is now broken for good — this victory is part of the campaign's canon. ${describeFrontReveal(concluded)} A major arc just closed: the Journal's Chronicle tab is ready to retell it as a chapter of your saga.`
    )];
    // Milestone XP (DECISIONS.md 2026-08-05 ×2, rpg-balance-master ruling):
    // engine-computed from the character's CURRENT level at this exact
    // moment — never via the LLM's exp_awarded channel. The resolution's
    // own one-shot guard is the replay ledger. A doom pays nothing.
    if (!prevailed && next.character) {
        next = foldExperience(next, getFrontResolutionMilestoneXp(next.character.level), {
            reason: `campaign milestone — "${concluded.title}" ended`,
            // No DM channel stands a DOWN hero up (DECISIONS 2026-10-14 point 2,
            // extended 2026-10-23 quests P1): the amount is the engine's, the
            // TRIGGER is the DM's `front_updates: resolved`. A standing hero
            // keeps the full level-up heal.
            keepDowned: isHeroDown(next.character),
        });
    }
    // Aftermath hook: a background director decides (later, outside the
    // reducer) what the ending leaves behind — survivors, debts, a vacuum
    // after a victory; the new order, who profits and who is gone after a
    // doom. chapterCloseSuggested is the Chronicle tab's ceremony nudge,
    // cleared when a chapter is written.
    const marker = { frontId: front.id, title: concluded.title };
    next.session = {
        ...next.session,
        ...(prevailed ? { pendingFrontDoom: marker } : { pendingFrontAftermath: marker }),
        chapterCloseSuggested: {
            reason: 'front',
            frontId: front.id,
            title: concluded.title,
            at: Date.now(),
        },
    };
    // The world exhales a dozen rows later (the interlude's CONCLUSION seam,
    // WOW 2026-10-26): the title is public now (the 🕰️ line showed it), the
    // outcome is canon, and the wide shot shows the world settling around
    // it — never the signs, never a reproach.
    if (!next.combat?.active) {
        next.session = mintInterlude(next.session, {
            reason: 'conclusion',
            frontId: front.id,
            title: concluded.title,
            material: concluded.resolution || null,
            delay: INTERLUDE_CONCLUSION_DELAY,
            messageCount,
            messages: next.messages,
        });
    }
    return gameReducer(next, {
        type: 'ADD_WORLD_FACTS',
        payload: [{ fact: buildFrontResolutionFact(concluded, prevailed ? '' : note), category: 'event', pinned: true }],
    });
}

/**
 * The establishing shot opens where the face LANDS (2026-10-27 living-world
 * P2): the classification defers it while a face is coming, and the call
 * that resolves (a face, or the attempt that leaves the land faceless) opens
 * it here — when the hero still stands at a place of that land.
 */
function openRegionShotIfHere(state, region) {
    const locations = state.locations || [];
    const idx = findLocationRecord(locations, state.currentLocation);
    const here = idx === -1 ? null : locations[idx];
    if (!here || !isSameRegion(here.region, region)) return state;
    return openRegionInterlude(state, region, { recordId: here.id });
}

export const handlers = {
    INSTALL_GENERATED_FRONTS(state, action) {
        if (action.payload?.sessionId !== state.session?.id
            || isFrontGenerationClosed(state.session)
            || !Array.isArray(action.payload?.fronts)) return state;
        // Generation runs on the slow DM model while play continues, so the
        // result routinely lands after the opening exchange. A late install is
        // safe as long as the deterministic fallback front hasn't started
        // moving — once it has clock/stage history, keep it (2026-07-14 eval).
        const visibleCount = (state.messages || []).filter(message => !message.hidden && !message.deleted).length;
        const existingFronts = state.fronts || [];
        const untouchedFallback = existingFronts.length === 0
            || (existingFronts.length === 1
                && existingFronts[0].id === 'front-local-pressure'
                && !(existingFronts[0].clock > 0)
                && !(existingFronts[0].stage > 0));
        if (visibleCount > 2 && !untouchedFallback) return state;
        // Re-validated at the reducer through the engine's one proposal boundary
        // on the director's own terms (sanitizeGeneratedFronts) — `normalizeFront`
        // alone is not complete-or-nothing: a keyless payload entry used to
        // install as "Unnamed Front".
        const fronts = [];
        action.payload.fronts.slice(0, WEB_TARGET_FRONTS).forEach((proposal, index) => {
            const front = normalizeFrontProposal(proposal, {
                existing: fronts,
                id: typeof proposal?.id === 'string' && proposal.id ? proposal.id : `front-v2-${index + 1}`,
                maxHints: 1,
                allowSharedFaction: true,
            });
            if (front) fronts.push(front);
        });
        if (fronts.length < 2) return state;
        return {
            ...state,
            fronts,
            session: {
                ...state.session,
                frontDirector: {
                    generationVersion: FRONTS_VERSION,
                    lastJournalEnd: 0,
                },
            },
        };
    },

    APPLY_TEMPO_DIRECTIVE(state, action) {
        const payload = action.payload || {};
        const cadenceId = payload.cadenceId || null;
        // One directive per cadence; a replayed reflection cannot re-roll the timing die.
        if (cadenceId && state.worldTempo?.lastCadenceId === cadenceId) return state;
        const directive = normalizeTempoDirective(payload.directive, {
            fronts: state.fronts || [],
            messageCount: (state.messages || []).length,
            previousDirective: state.worldTempo?.directive || null,
            paceDial: state.settings?.paceDial,
            timingDelay: payload.timingDelay,
            locations: state.locations || [],
            currentLocation: state.currentLocation,
        });
        // Theaters grow organically: placing a front's symptom somewhere
        // records that place as part of the front's home territory — but only
        // when the grant was IN theater or the front had none (2026-10-15
        // hidden-fronts P2, measured): a directive clamped to whispers for
        // lying OUTSIDE a homed front's theater used to record its `where` as
        // that front's theater anyway, so the same ask landed at full band one
        // quiet cadence later — the gate was a one-cadence delay. The engine's
        // own judgement (normalizeTempoDirective's `inTheater`) decides.
        const growsTheater = !!directive.frontId && !!directive.where && directive.inTheater !== false;
        const locations = growsTheater
            ? upsertLocation(state.locations || [], directive.where, { theaterFrontIds: [directive.frontId] })
            : state.locations || [];
        return {
            ...state,
            locations,
            worldTempo: { directive, lastCadenceId: cadenceId, updatedAt: Date.now() },
        };
    },

    ADD_EMERGENT_FRONT(state, action) {
        const payload = action.payload || {};
        const cadenceId = payload.cadenceId || null;
        if (cadenceId && state.session?.frontDirector?.lastEmergentCadenceId === cadenceId) return state;
        const fronts = state.fronts || [];
        if (fronts.filter(f => (f.status || 'active') === 'active').length >= MAX_ACTIVE_FRONTS) return state;
        const front = normalizeFrontProposal(payload.proposal, { existing: fronts });
        if (!front) return state;
        // Private, like every front: no system line — the player only ever feels it.
        return {
            ...state,
            fronts: [...fronts, front],
            session: {
                ...state.session,
                frontDirector: {
                    ...state.session?.frontDirector,
                    lastEmergentCadenceId: cadenceId,
                },
            },
        };
    },

    UPGRADE_FRONTS_V2(state, action) {
        if (action.payload?.sessionId !== state.session?.id
            || state.session?.frontDirector?.generationVersion >= FRONTS_VERSION
            || !Array.isArray(action.payload?.enrichments)
            || !Array.isArray(action.payload?.newFronts)) return state;
        const existingFronts = state.fronts || [];
        const enrichmentById = new Map(action.payload.enrichments
            .filter(entry => entry?.id && entry?.faction?.name && entry?.faction?.goal)
            .map(entry => [entry.id, entry.faction]));
        const enriched = existingFronts.map(front => enrichmentById.has(front.id)
            ? normalizeFront({ ...front, faction: enrichmentById.get(front.id) }, front)
            : front);
        // Web-membership counting rule (WEB_TARGET_FRONTS, 2026-08-26): resolved
        // fronts are history — they need no faction, block nothing, and don't
        // count toward the 2–3 target. This mirrors upgradeCampaignFrontsV2
        // exactly, so a promise that resolves can no longer be rejected here
        // (the 2026-08-24 P1: 4 actives "upgraded" in the dialog, state unchanged).
        const isWebMember = (front) => (front.status || 'active') !== 'resolved';
        if (enriched.some(front => isWebMember(front) && (!front.faction?.name || !front.faction?.goal))) return state;
        const webCount = enriched.filter(isWebMember).length;

        // The trust-boundary re-validation is the engine's one proposal
        // boundary on the director's own terms (sanitizeFrontUpgrade): a
        // repeated title is a duplicate, a faction may drive two fronts, one
        // already-visible symptom — plus an id the web does not hold yet.
        const existingIds = new Set(enriched.map(front => front.id));
        const room = Math.max(0, WEB_TARGET_FRONTS - webCount);
        const additions = [];
        for (const proposal of action.payload.newFronts) {
            if (additions.length >= room) break;
            const id = typeof proposal?.id === 'string' ? proposal.id : '';
            if (!id || existingIds.has(id) || additions.some(front => front.id === id)) continue;
            const front = normalizeFrontProposal(proposal, {
                existing: [...enriched, ...additions],
                id,
                maxHints: 1,
                allowSharedFaction: true,
            });
            if (front) additions.push(front);
        }
        const fronts = [...enriched, ...additions];
        const webTotal = webCount + additions.length;
        if (webTotal < 2 || webTotal > Math.max(WEB_TARGET_FRONTS, webCount)) return state;

        return {
            ...state,
            fronts,
            session: {
                ...state.session,
                frontDirector: {
                    ...state.session?.frontDirector,
                    generationVersion: FRONTS_VERSION,
                    lastJournalEnd: state.session?.frontDirector?.lastJournalEnd || state.session?.prunedMessageCount || 0,
                },
            },
        };
    },

    UPDATE_FRONT(state, action) {
        const rawUpdate = normalizeFrontUpdate(action.payload);
        if (!rawUpdate?.id) return state;
        const fronts = state.fronts || [];
        // By id only (2026-09-01 P2): titles are private — the DM cannot know
        // one, so a title match was an untested phantom path.
        const idx = fronts.findIndex(f => f.id === rawUpdate.id);
        if (idx === -1) return state;
        const existing = fronts[idx];
        // RESOLVED IS TERMINAL in the engine (DECISIONS.md 2026-09-01): a
        // resolved front never changes status, clock, or stage again — a DM
        // "status: active" on a resolved front used to resurrect it, and a
        // later "resolved" re-ran the whole ceremony (second milestone XP,
        // second canon fact, second 🕰️ line, second aftermath). Notes and
        // hints may still update; the mechanics are frozen.
        const alreadyResolved = (existing.status || 'active') === 'resolved';
        const update = alreadyResolved
            ? Object.fromEntries(Object.entries(rawUpdate).filter(([key]) => !['status', 'clock', 'stage'].includes(key)))
            : rawUpdate;
        // DM clock-GAIN throttle (2026-08-24 P2: front_updates was the last
        // DM-writable numeric channel with no replay guard — a re-emitted +1
        // walked a clock 0→max in maxClock turns around the cadence pacing).
        // One +1 per front per DM_CLOCK_GAIN_WINDOW conversational messages;
        // softening and symptom/notes/status updates are NEVER throttled —
        // player interference always lands, the applyFrontAdvanceBatch rule.
        const wantsGain = (update.clock !== undefined && update.clock > (existing.clock || 0))
            || (update.stage !== undefined && update.stage > (existing.stage || 0));
        const gainThrottled = wantsGain
            && Number.isFinite(existing.lastDmClockGainMessage)
            && conversationalDistance(state.messages, existing.lastDmClockGainMessage, (state.messages || []).length) <= DM_CLOCK_GAIN_WINDOW;
        const boundedUpdate = {
            ...update,
            ...(update.clock !== undefined && {
                clock: gainThrottled
                    ? Math.min(existing.clock || 0, Math.max((existing.clock || 0) - 1, update.clock))
                    : Math.max((existing.clock || 0) - 1, Math.min((existing.clock || 0) + 1, update.clock)),
            }),
            ...(wantsGain && !gainThrottled && {
                lastDmClockGainMessage: (state.messages || []).length,
            }),
            // Stage is non-regressing (like the cadence engine, fronts.js): portents
            // already manifest in the world stay manifest. Clock may soften instead.
            // A throttled update keeps the existing stage (never regresses).
            ...(update.stage !== undefined && {
                stage: gainThrottled
                    ? (existing.stage || 0)
                    : Math.max(existing.stage || 0, Math.min((existing.stage || 0) + 1, update.stage)),
            }),
            // Symptoms ACCUMULATE (2026-09-08 P2): the DM only ever sees the
            // last three hints, so its one new symptom used to replace — i.e.
            // wipe — the front's whole ledger and the tempo block's anti-repeat
            // line with it. Append, dedupe case-insensitively, keep the cadence
            // engine's rolling cap through normalizeFront.
            ...(Array.isArray(update.publicHints) && {
                publicHints: [
                    ...(existing.publicHints || []),
                    ...update.publicHints.filter(hint =>
                        !(existing.publicHints || []).some(known => known.toLowerCase() === hint.toLowerCase())),
                ],
            }),
            maxClock: existing.maxClock || DEFAULT_MAX_CLOCK,
        };
        // Resolution is a one-way, one-time transition with side effects; a DM
        // re-emitting "resolved" on later turns hits the already-resolved branch
        // (status stripped above) and changes nothing beyond notes. A dormant
        // front resolving goes through the full ceremony like an active one —
        // dormancy is an engine pacing state, not a lesser kind of pressure.
        const resolvingNow = update.status === 'resolved' && !alreadyResolved;
        const updatedFront = normalizeFront(boundedUpdate, existing);
        if (!resolvingNow) {
            // A DM clock gain can fill the clock too (2026-10-22): the doom
            // opens on this lane exactly as on the cadence's.
            return afterClockMove(state, {
                ...state,
                fronts: fronts.map((front, i) => i === idx ? updatedFront : front),
            });
        }
        return concludeFront(state, idx, updatedFront, { note: update.notes || '' });
    },

    /**
     * The doom's close (WOW 2026-10-22), ticked by ADD_MESSAGE on every
     * player row outside combat. A front whose window has CLOSED is first
     * STAMPED (`doomClosedAtMessage`) and prevails on the next player row —
     * the DM gets one ordinary turn after the card is gone, because the
     * fight the doom started may have ended inside the window and a victory
     * narration carries no events (the resolve lands on the turn after).
     * A fight that ended since the stamp re-arms that grace for the same
     * reason. Never inside combat.
     */
    SETTLE_DOOMS(state) {
        if (state.combat?.active) return state;
        const messageCount = (state.messages || []).length;
        const closed = listClosedDooms(state.fronts || [], messageCount, state.messages);
        if (closed.length === 0) return state;
        const encounters = sanitizeRecentEncounters(state.recentEncounters);
        let next = state;
        for (const front of closed) {
            const idx = (next.fronts || []).findIndex(entry => entry.id === front.id);
            if (idx === -1) continue;
            const live = next.fronts[idx];
            const stamped = Number.isFinite(live.doomClosedAtMessage);
            const fightSince = stamped && encounters.some(entry =>
                Number.isFinite(entry.messageIndex) && entry.messageIndex >= live.doomClosedAtMessage);
            if (!stamped || fightSince) {
                next = {
                    ...next,
                    fronts: next.fronts.map((entry, i) => (i === idx
                        ? normalizeFront({ ...entry, doomClosedAtMessage: messageCount }, entry)
                        : entry)),
                };
                continue;
            }
            if (messageCount <= live.doomClosedAtMessage) continue;
            next = concludeFront(next, idx, live, { outcome: 'prevailed' });
        }
        return next;
    },

    /**
     * The doom's landing (WOW 2026-10-22): what the world is now that the
     * pressure has won — one canon fact, existing roster NPCs' agenda /
     * lastNotes moved by it, known places' current state, and 0–2 successor
     * pressures born of the WIN (the new order, the resistance, the
     * collaborator), which inherit the prevailed front's ground as their
     * theater. The absence-drift bounds: known people only, nobody dies
     * off-screen, mechanics untouched, an empty answer installs nothing.
     */
    INSTALL_DOOM_AFTERMATH(state, action) {
        const payload = action.payload || {};
        const pending = state.session?.pendingFrontDoom;
        if (!pending || typeof pending.frontId !== 'string' || !pending.frontId
            || payload.sessionId !== state.session?.id || payload.frontId !== pending.frontId) return state;
        const session = { ...state.session, pendingFrontDoom: null };
        const change = isRecord(payload.change) ? payload.change : {};
        const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
        const prevailed = (state.fronts || []).find(front => front?.id === pending.frontId) || null;

        let npcs = state.npcs || [];
        for (const dev of (Array.isArray(change.developments) ? change.developments : []).slice(0, MAX_DOOM_DEVELOPMENTS)) {
            const name = text(dev?.name, 100);
            const agenda = text(dev?.agenda, 300);
            const lastNotes = text(dev?.lastNotes, 400);
            if (!name || !(agenda || lastNotes)) continue;
            // Exactly ONE roster record, or nobody (the shared-name rule).
            const matches = npcs.filter(npc => namesMatch(npc.name, name));
            if (matches.length !== 1) continue;
            npcs = upsertNpc(npcs, {
                ...(matches[0].id && { id: matches[0].id }),
                name: matches[0].name,
                ...(agenda && { agenda }),
                ...(lastNotes && { lastNotes }),
                _seen: false,
            });
        }

        let locations = state.locations || [];
        for (const place of (Array.isArray(change.places) ? change.places : []).slice(0, MAX_DOOM_PLACES)) {
            const name = text(place?.name, 120);
            const lastState = text(place?.lastState, 200);
            if (!name || !lastState) continue;
            const idx = findLocationRecord(locations, name);
            if (idx === -1) continue;
            // A current-state replace on the record itself — not an arrival
            // (upsertLocation stamps a visit).
            locations = locations.map((record, i) => (i === idx ? normalizeLocationRecord({ ...record, lastState }, record) : record));
        }

        const fronts = state.fronts || [];
        const activeCount = fronts.filter(f => (f.status || 'active') === 'active').length;
        const room = Math.min(2, Math.max(0, WEB_TARGET_FRONTS - activeCount));
        const additions = buildProposedFrontAdditions(fronts, change.successors, room, 'front-doom');
        const ground = prevailed?.resolvedTheaterIds || [];
        if (additions.length > 0 && ground.length > 0) {
            locations = locations.map(record => (ground.includes(record.id)
                ? { ...record, theaterFrontIds: [...new Set([...(record.theaterFrontIds || []), ...additions.map(front => front.id)])] }
                : record));
        }

        const next = {
            ...state,
            session,
            npcs,
            locations,
            ...(additions.length > 0 && { fronts: [...fronts, ...additions] }),
        };
        const fact = text(change.fact, 300);
        // Private like every front: no system line, the player only ever feels it.
        return fact
            ? gameReducer(next, { type: 'ADD_WORLD_FACTS', payload: [{ fact, category: 'event' }] })
            : next;
    },

    INSTALL_AFTERMATH_FRONTS(state, action) {
        const payload = action.payload || {};
        const pending = state.session?.pendingFrontAftermath;
        // One-shot per resolution: only the pending front's own generation may
        // land, and it lands once — stale or cross-session results are dropped.
        // A typed marker only (2026-09-08 P2): a string marker from a hostile
        // save made `pending.frontId` undefined, and `undefined !== undefined`
        // let a keyless install through. Load sanitizes; this is the backstop.
        if (!pending || typeof pending.frontId !== 'string' || !pending.frontId
            || payload.sessionId !== state.session?.id || payload.frontId !== pending.frontId) return state;
        const session = { ...state.session, pendingFrontAftermath: null };
        const fronts = state.fronts || [];
        const activeCount = fronts.filter(f => (f.status || 'active') === 'active').length;
        // Successors top the web back up toward the creation-size 2–3, never
        // beyond: a crowded world doesn't need the vacuum filled.
        const room = Math.min(2, Math.max(0, WEB_TARGET_FRONTS - activeCount));
        const additions = buildProposedFrontAdditions(fronts, payload.fronts, room, 'front-aftermath');
        // Private like every front: no system line, the player only ever feels it.
        return {
            ...state,
            session,
            ...(additions.length > 0 && { fronts: [...fronts, ...additions] }),
        };
    },

    /**
     * One-shot install of a new region's native pressures (world-tempo
     * component 9, DECISIONS.md 2026-08-05 ×2). The region is marked seeded
     * even when every proposal fails validation — one shot per region, no
     * retry loops. Additions top the web only to MAX_ACTIVE_FRONTS - 1
     * (one slot always stays free — DECISIONS.md 2026-08-06) and are born
     * with the arrival place as their theater, so existing gating keeps
     * them local from day one.
     */
    INSTALL_REGIONAL_FRONTS(state, action) {
        const payload = action.payload || {};
        const pending = state.session?.pendingRegionalFronts;
        if (!pending || typeof pending.key !== 'string' || !pending.key
            || payload.sessionId !== state.session?.id || payload.key !== pending.key) return state;
        // The land's face (WOW 2026-10-26): re-validated here like every
        // director reply, written once — a profile already on record stands.
        const wantedFace = !findRegionProfile(state.regions, pending.region);
        const regions = rememberRegionProfile(state.regions, pending.region, payload.profile, {
            atMessage: (state.messages || []).length,
        });
        // A call that was asked for the face and brought none (an incomplete
        // reply, a give-up) counts against the LAND (2026-10-27 P2): it used to
        // clear the marker with no tally at all.
        const faceSession = wantedFace && !findRegionProfile(regions, pending.region)
            ? { ...state.session, regionFaceAttempts: recordRegionFaceAttempt(state.session?.regionFaceAttempts, pending.region, { atMessage: (state.messages || []).length }) }
            : state.session;
        // A profile-only marker (the home region, a land met while the web was
        // full, a pre-profile save's known land) seeds nothing and marks
        // nothing seeded: the fronts' own one-shot stays the installer's below.
        if (pending.profileOnly === true) {
            return openRegionShotIfHere({ ...state, regions, session: { ...faceSession, pendingRegionalFronts: null } }, pending.region);
        }
        const seededRegions = [...(state.session?.seededRegions || []), pending.region].slice(-12);
        // A region seeded now leaves the deferred ledger (2026-10-15).
        const deferredRegions = (state.session?.deferredRegions || []).filter(region => !isSameRegion(region, pending.region));
        const session = { ...faceSession, pendingRegionalFronts: null, seededRegions, deferredRegions };
        state = openRegionShotIfHere({ ...state, regions, session }, pending.region);
        const fronts = state.fronts || [];
        const activeCount = fronts.filter(f => (f.status || 'active') === 'active').length;
        // Like the aftermath installer, regional natives top the web up to
        // MAX_ACTIVE_FRONTS - 1, never to the cap: a misattributed region
        // (2026-08-06 live playtest #3 — a backstory land seeded 2 natives and
        // filled the web) must never be able to lock the last slot away from
        // the region the hero actually travels to next.
        const room = Math.min(2, Math.max(0, (MAX_ACTIVE_FRONTS - 1) - activeCount));
        const additions = buildProposedFrontAdditions(fronts, payload.fronts, room, 'front-region');
        if (additions.length === 0) return state;
        let locations = state.locations || [];
        for (const front of additions) {
            locations = upsertLocation(locations, pending.locationName, { theaterFrontIds: [front.id] });
        }
        // Private like every front: no system line, the player only ever feels it.
        return { ...state, fronts: [...fronts, ...additions], locations };
    },

    /**
     * A background director's call failed (2026-09-20 audit P1). The tally is
     * reducer-owned so it survives reloads: ChatPanel holds a failed key back
     * for DIRECTOR_RETRY_MIN_DISTANCE conversational messages, and the third
     * failure CONSUMES the marker through the director's own installer with
     * an empty result — the quiet answer ("clean victory", "nothing changed",
     * "no natives", "no wonder") every installer already treats as
     * first-class. A failure for a marker that is no longer pending (a late
     * rejection, another campaign) is dropped.
     */
    DIRECTOR_ATTEMPT_FAILED(state, action) {
        const payload = action.payload && typeof action.payload === 'object' ? action.payload : {};
        const { name, key } = payload;
        if (typeof name !== 'string' || !Object.hasOwn(RETRYABLE_DIRECTORS, name)) return state;
        if (typeof key !== 'string' || !key || payload.sessionId !== state.session?.id) return state;
        const director = RETRYABLE_DIRECTORS[name];
        if (director.pendingKey(state.session) !== key) return state;
        const attempts = (getDirectorFailure(state.session, name, key)?.attempts || 0) + 1;
        // A failed regional call that was asked for a land's face counts
        // against that LAND (2026-10-27 P2): the marker's key is new per mint,
        // so the per-key tally alone let a deterministic failure buy three calls
        // per classified place for the whole campaign.
        const pendingRegion = name === 'regionalFronts' ? state.session?.pendingRegionalFronts?.region : null;
        if (pendingRegion && !findRegionProfile(state.regions, pendingRegion)) {
            state = { ...state, session: { ...state.session, regionFaceAttempts: recordRegionFaceAttempt(state.session?.regionFaceAttempts, pendingRegion, { atMessage: (state.messages || []).length }) } };
        }
        const failures = { ...(state.session?.directorFailures || {}) };
        if (attempts < DIRECTOR_MAX_ATTEMPTS) {
            failures[name] = { key, attempts, atMessage: (state.messages || []).length };
            return { ...state, session: { ...state.session, directorFailures: failures } };
        }
        delete failures[name];
        console.warn(`[LivingWorld] ${name} failed ${attempts} times for ${key}; giving up — the quiet answer stands.`);
        return gameReducer(
            { ...state, session: { ...state.session, directorFailures: failures } },
            director.install(state.session.id, key, director.empty)
        );
    },

    APPLY_FRONT_ADVANCE_BATCH(state, action) {
        const cadenceId = String(action.payload?.cadenceId || '').trim().slice(0, 160);
        const journalEnd = Math.max(0, Math.round(Number(action.payload?.journalEnd) || 0));
        const previousEnd = state.session?.frontDirector?.lastJournalEnd || 0;
        if (!cadenceId || journalEnd <= previousEnd) return state;
        // "The immediately previous cadence" is the previous JOURNAL cadence,
        // not the last APPLIED batch (2026-10-15 hidden-fronts nit): a failed
        // reflection left a two-cadences-ago gain reading as last cadence's
        // and held the front's clock one cadence longer than the rule says.
        const journal = Array.isArray(state.journal) ? state.journal : [];
        const thisIdx = journal.findIndex(entry => entry?.messageRange?.[1] === journalEnd);
        const previousEntry = thisIdx > 0 ? journal[thisIdx - 1] : (thisIdx === -1 ? journal.at(-1) : null);
        const previousCadenceId = Number.isInteger(previousEntry?.messageRange?.[1])
            ? cadenceIdFor(state.session?.id, previousEntry.messageRange[1])
            : (state.session?.frontDirector?.lastCadenceId || null);
        const result = applyFrontAdvanceBatch(state.fronts || [], {
            cadenceId,
            previousCadenceId,
            advances: action.payload?.advances,
        });
        return afterClockMove(state, {
            ...state,
            fronts: result.fronts,
            session: {
                ...state.session,
                frontDirector: {
                    ...state.session?.frontDirector,
                    lastCadenceId: cadenceId,
                    lastJournalEnd: journalEnd,
                },
            },
        });
    },
};
