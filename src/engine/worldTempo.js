/**
 * World tempo — engine-owned pacing state (DECISIONS.md 2026-07-14).
 *
 * Fixes the "every campaign is violent by turn 7" failure with three pieces:
 *
 * 1. INTENSITY BANDS: a front's clock/stage derives the maximum narrative
 *    intensity its symptoms may reach (whispers → indirect → presence →
 *    confrontation). A clock-1 front cannot put raiders on-screen.
 * 2. HEAT: a deterministic score computed from what actually just happened
 *    (combat, recent fights, a badly hurt hero) — the thermometer half of the
 *    thermostat. The player's pace dial (Settings) is the setpoint half.
 * 3. TEMPO DIRECTIVE: the journal-cadence reflection proposes which single
 *    front may surface a symptom in the coming scenes; the engine validates
 *    it (band clamp, active-front check, alternation) and an engine-rolled
 *    timing die delays WHEN it lands by 0–4 scenes — arc reasoning decides
 *    what/where, dice decide when, because an LLM surfaces permitted content
 *    immediately and predictably on its own.
 *
 * The DM never sees clocks, portents, or notes any more — promptBuilder
 * renders a compact WORLD TEMPO block from this state (hiding beats
 * instructing). Player-sought danger is never gated by any of this.
 */

import { findLocationRecord, getCurrentLocationRecord, isSameLocation } from './locationRegistry.js';
import { conversationalDistance } from './replayLedger.js';
import { DEFAULT_MAX_CLOCK } from './fronts.js';

export const INTENSITY_LEVELS = ['whispers', 'indirect', 'presence', 'confrontation'];
export const PACE_DIALS = ['slow-burn', 'standard', 'breakneck'];
/** Sides of the timing die: rollDie(TEMPO_TIMING_DIE_SIDES) - 1 → 0–4 scene delay. */
export const TEMPO_TIMING_DIE_SIDES = 5;
/**
 * A granted window dies on its own if the next cadence never arrives.
 * All tempo windows are measured in CONVERSATIONAL distance (system lines and
 * hidden roll-setup messages don't count — DECISIONS.md 2026-07-30 / 2026-08-04):
 * a dice turn burns ~5 raw messages, which made raw-index windows expire ~2.5×
 * early on check-heavy stretches. A scene ≈ 2 conversational messages.
 */
export const TEMPO_WINDOW_MESSAGES = 24;
export const MAX_RECENT_ENCOUNTERS = 10;
export const MAX_ACTIVE_FRONTS = 4;
/**
 * The creation/upgrade TARGET size of the front web (2–3 pressures), distinct
 * from MAX_ACTIVE_FRONTS (the hard active cap emergent installs may reach).
 * Counting rule (2026-08-26, the 4-front-upgrade P1): sizing against the target
 * counts NON-RESOLVED fronts (active + dormant — resolved fronts are history,
 * never web members), while the aftermath/regional installers keep topping up
 * against ACTIVE-only counts as before.
 */
export const WEB_TARGET_FRONTS = 3;
/**
 * DM-channel front clock/stage GAIN throttle (2026-08-26): one +1 per front
 * per this many conversational messages through `front_updates` — roughly the
 * journal cadence, matching the cadence engine's one-gain-per-cadence pacing.
 * Softening and symptom/notes/status updates are never throttled.
 */
export const DM_CLOCK_GAIN_WINDOW = 10;
/** A foe family fielded in this many ledger encounters is fatigued — the DM must vary. */
export const FOE_FATIGUE_THRESHOLD = 3;
/** How long (in conversational messages) a resolved front's absence keeps being echoed to the DM. */
export const RESOLVED_ECHO_WINDOW_MESSAGES = 40;
/**
 * Living-world absence drift (DECISIONS.md 2026-08-05): a return to a known
 * place after this many conversational messages away (~15 scenes) qualifies
 * for a private "what happened here since you left" pass. Constants live here
 * so reducer handlers never import from llm/.
 */
export const ABSENCE_DRIFT_MIN_AWAY = 30;
export const ABSENCE_DRIFT_WINDOW_MESSAGES = 12;
export const MAX_DRIFT_DEVELOPMENTS = 2;
/**
 * A homecoming stroll re-touches several stale records in a row; without a
 * cooldown each fired its own background DM-model call (two within a few
 * turns in the 2026-08-05 live playtest). One drift per return, not per door.
 */
export const ABSENCE_DRIFT_COOLDOWN_MESSAGES = 20;

/**
 * Absence-drift developments may touch only the NPCs OF the return place —
 * the same eligibility buildAbsenceDriftContext uses to project the prompt's
 * NPC list. Shared by BOTH validators (sanitizeAbsenceDrift and
 * INSTALL_ABSENCE_DRIFT, 2026-08-19 audit) so a hallucinated development for
 * a distant roster NPC can never rewrite their agenda/lastNotes; it lives
 * here beside the drift constants so reducer handlers never import from llm/.
 */
export function isAbsenceDriftLocalNpc(npc, locationName) {
    return !!(npc?.name && npc.rosterTier !== 'archived_creature'
        && npc.lastLocation && isSameLocation(npc.lastLocation, String(locationName || '')));
}

/**
 * Conversational distance since an anchor stamped as "message count at the
 * time" (encounter ledger, directive grants, front resolutions): the first
 * message appended after the stamp sits at index `anchorIndex`, so counting
 * starts there. Without a messages array, degrades to the raw difference.
 */
export function distanceSince(messages, anchorIndex, messageCount) {
    if (!Array.isArray(messages)) return Math.max(0, messageCount - anchorIndex);
    return conversationalDistance(messages, anchorIndex - 1, messageCount);
}

const INTENSITY_GUIDANCE = {
    whispers: 'rumors, atmosphere, prices, and secondhand news only — the pressure has NO on-screen presence',
    indirect: 'indirect contact only — refugees, a closed road, a worried NPC, evidence left behind; its agents do not confront the hero',
    presence: 'its agents or effects may appear on-screen (watching, taking, threatening), but open confrontation with the hero only if the player seeks it',
    confrontation: 'the pressure may confront the hero directly and the world visibly changes',
};

function cleanText(value, max = 200) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizePaceDial(value) {
    return PACE_DIALS.includes(value) ? value : 'standard';
}

/** Maximum narrative intensity a front's current clock/stage justifies. */
export function getFrontIntensityBand(front) {
    if (!front) return 'whispers';
    const maxClock = front.maxClock || DEFAULT_MAX_CLOCK;
    const ratio = (front.clock || 0) / maxClock;
    const stage = front.stage || 0;
    if (ratio >= 1) return 'confrontation';
    if (ratio >= 2 / 3 || stage >= 3) return 'presence';
    if (ratio >= 1 / 3 || stage >= 1) return 'indirect';
    return 'whispers';
}

export function clampIntensity(requested, band) {
    const requestedIdx = INTENSITY_LEVELS.indexOf(requested);
    const bandIdx = INTENSITY_LEVELS.indexOf(band);
    if (requestedIdx === -1) return band;
    return INTENSITY_LEVELS[Math.min(requestedIdx, bandIdx === -1 ? 0 : bandIdx)];
}

export function describeIntensity(level) {
    return INTENSITY_GUIDANCE[level] || INTENSITY_GUIDANCE.whispers;
}

/** Condense an enemy roster into "2× ghoul, scarred hound". */
export function summarizeEncounterEnemies(enemies = []) {
    const counts = new Map();
    for (const enemy of enemies) {
        const name = cleanText(enemy?.name, 60).replace(/\s+\d+$/, '') || 'unknown foe';
        const key = name.toLowerCase();
        const existing = counts.get(key);
        if (existing) existing.count += 1;
        else counts.set(key, { name, count: 1 });
    }
    return [...counts.values()]
        .map(({ name, count }) => (count > 1 ? `${count}× ${name}` : name))
        .join(', ');
}

/**
 * The head noun of a foe name, singularized — the token that groups a monster
 * family: "ichor ghoul" / "Ghoul 2" / "ghouls" all key to "ghoul". Imperfect
 * for irregular plurals ("wolves"), which is fine: this powers a variety
 * nudge, not an exact count.
 */
export function foeFamilyKey(name) {
    const words = cleanText(name, 60).toLowerCase().replace(/\s+\d+$/, '').split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    let head = words[words.length - 1];
    if (head.length > 3 && head.endsWith('s') && !head.endsWith('ss')) head = head.slice(0, -1);
    return head;
}

/** Build the ledger entry END_COMBAT appends (cap MAX_RECENT_ENCOUNTERS). */
export function buildEncounterEntry(state, payload = {}) {
    const outcome = payload.defeat ? 'defeat' : payload.escaped ? 'escaped' : 'victory';
    const enemies = state.combat?.enemies || [];
    return {
        at: Date.now(),
        messageIndex: (state.messages || []).length,
        location: cleanText(state.currentLocation, 120) || null,
        enemies: summarizeEncounterEnemies(enemies),
        foeFamilies: [...new Set(enemies.map(enemy => foeFamilyKey(enemy?.name)).filter(Boolean))].slice(0, 8),
        outcome,
    };
}

export function appendRecentEncounter(list = [], entry) {
    if (!entry || !entry.enemies) return list;
    return [...(Array.isArray(list) ? list : []), entry].slice(-MAX_RECENT_ENCOUNTERS);
}

function entryFoeFamilies(entry) {
    if (Array.isArray(entry?.foeFamilies) && entry.foeFamilies.length > 0) return entry.foeFamilies;
    // Pre-ledger-upgrade entries only stored the display summary ("2× ichor ghoul, hound").
    return String(entry?.enemies || '')
        .split(',')
        .map(part => foeFamilyKey(part.replace(/^\s*\d+×\s*/, '')))
        .filter(Boolean);
}

/**
 * Foe families the recent-encounter ledger shows being fielded again and again
 * ("ichor ghouls in EVERY dungeon" — the 2026-08-03 repetition complaint).
 * Counts distinct encounters per family, not bodies; deterministic, no LLM.
 */
export function computeFoeFatigue(recentEncounters = []) {
    const counts = new Map();
    for (const entry of Array.isArray(recentEncounters) ? recentEncounters : []) {
        for (const family of new Set(entryFoeFamilies(entry))) {
            counts.set(family, (counts.get(family) || 0) + 1);
        }
    }
    return [...counts.entries()]
        .filter(([, count]) => count >= FOE_FATIGUE_THRESHOLD)
        .sort((a, b) => b[1] - a[1])
        .map(([family, count]) => ({ family, count }));
}

/** Fronts whose resolution is recent enough that the DM should still show the aftermath. */
export function recentlyResolvedFronts(fronts = [], messageCount = 0, messages = null) {
    return (Array.isArray(fronts) ? fronts : [])
        .filter(front => front?.status === 'resolved'
            && Number.isFinite(front.resolvedAtMessage)
            && distanceSince(messages, front.resolvedAtMessage, messageCount) <= RESOLVED_ECHO_WINDOW_MESSAGES)
        .slice(-2);
}

const HEAT_LEVELS = ['calm', 'lively', 'high'];

function heatLevel(score) {
    if (score >= 7) return 'high';
    if (score >= 3) return 'lively';
    return 'calm';
}

/**
 * Deterministic "how hot have things been" score, 0–10, from live state.
 * No LLM involvement — this is the thermometer.
 */
export function computeRecentHeat(state, { window = 15 } = {}) {
    const reasons = [];
    let score = 0;
    const messages = Array.isArray(state.messages) ? state.messages : null;
    const messageCount = Number.isFinite(state.messageCount)
        ? state.messageCount
        : (state.messages || []).length;

    if (state.combat?.active) {
        score += 4;
        reasons.push('combat is happening right now');
    }

    const recentFights = (state.recentEncounters || [])
        .filter(entry => Number.isFinite(entry?.messageIndex)
            && distanceSince(messages, entry.messageIndex, messageCount) <= window);
    if (recentFights.length > 0) {
        score += Math.min(7, 3 + (recentFights.length - 1) * 2);
        reasons.push(recentFights.length === 1 ? 'a fight within the last few scenes' : `${recentFights.length} fights within the last few scenes`);
    }

    const character = state.character;
    if (character?.maxHP > 0) {
        const ratio = (character.currentHP ?? character.maxHP) / character.maxHP;
        if (ratio <= 0.35) {
            score += 2;
            reasons.push('the hero is badly hurt');
        } else if (ratio <= 0.6) {
            score += 1;
            reasons.push('the hero is wounded');
        }
    }

    // Roleplay-check pressure: out-of-combat dice only exist when the fiction has
    // genuine opposition and stakes, so a dense stretch of proposals marks a hot
    // diceless arc (a chase, heist, interrogation) the combat inputs cannot see.
    // One check is routine and scores nothing; the contribution caps below the
    // combat weights so diceless tension alone never reads as post-battle heat.
    const recentChecks = (state.recentChecks || [])
        .filter(entry => Number.isFinite(entry?.messageIndex)
            && distanceSince(messages, entry.messageIndex, messageCount) <= window);
    if (recentChecks.length >= 2) {
        const hardestDc = Math.max(...recentChecks.map(entry => entry.dc || 0));
        score += Math.min(3, recentChecks.length - 1) + (hardestDc >= 15 ? 1 : 0);
        reasons.push(`${recentChecks.length} checks under pressure in the last scenes${hardestDc >= 15 ? ', some against strong opposition' : ''}`);
    }

    const directive = state.worldTempo?.directive;
    if (directive?.frontId && Number.isFinite(directive.grantedAtMessage)) {
        const { activation } = tempoDirectiveDistances(directive);
        const distance = distanceSince(messages, directive.grantedAtMessage, messageCount);
        if (distance >= activation && distance - activation <= window) {
            score += 1;
            reasons.push('a pressure symptom was recently permitted');
        }
    }

    score = Math.max(0, Math.min(10, score));
    return { score, level: heatLevel(score), reasons };
}

const PACE_TARGET = { 'slow-burn': 'calm', standard: 'lively', breakneck: 'high' };

/** The thermostat line: player's setpoint vs measured heat → one guidance sentence. */
export function buildPaceGuidance(paceDial, heat) {
    const dial = normalizePaceDial(paceDial);
    const target = PACE_TARGET[dial];
    const targetIdx = HEAT_LEVELS.indexOf(target);
    const actualIdx = HEAT_LEVELS.indexOf(heat?.level || 'calm');
    const why = heat?.reasons?.length ? ` (${heat.reasons.join('; ')})` : '';

    if (actualIdx > targetIdx) {
        return `Recent scenes ran hotter than this campaign's ${dial} pace${why}. Give the player breathing room: quiet character beats, recovery, daily life, local color. Introduce NO new unprovoked threats; let earned tension settle.`;
    }
    if (actualIdx < targetIdx) {
        return dial === 'breakneck'
            ? `The last stretch has been quieter than this campaign's breakneck pace${why}. A complication, hook, or permitted pressure symptom would land well now.`
            : `The last stretch has been quiet${why} — which fits, but a small hook or complication may land well if the fiction offers one naturally.`;
    }
    return `Pacing sits on this campaign's ${dial} target${why}. Follow the fiction.`;
}

/**
 * Validate the reflection's proposed tempo directive into engine-owned state.
 * Everything invalid degrades to a QUIET directive, never to more permission.
 */
export function normalizeTempoDirective(raw, {
    fronts = [],
    messageCount = 0,
    previousDirective = null,
    paceDial = 'standard',
    timingDelay = 0,
    locations = [],
    currentLocation = null,
} = {}) {
    const dial = normalizePaceDial(paceDial);
    const quiet = {
        frontId: null,
        maxIntensity: 'whispers',
        where: '',
        suggestedSymptom: '',
        rationale: cleanText(raw?.rationale),
        quietHook: cleanText(raw?.quiet_hook || raw?.quietHook),
        grantedAtMessage: messageCount,
        activationDistance: 0,
        expiryDistance: TEMPO_WINDOW_MESSAGES,
    };
    if (!raw || typeof raw !== 'object') return quiet;

    const frontId = cleanText(raw.front_id || raw.frontId, 60);
    if (!frontId) return quiet;
    const front = fronts.find(f => f.id === frontId && (f.status || 'active') === 'active');
    if (!front) return quiet;

    // Alternation guards: the same front never gets two consecutive windows,
    // and slow-burn campaigns always get a quiet cadence after any window.
    if (previousDirective?.frontId === frontId) return quiet;
    if (dial === 'slow-burn' && previousDirective?.frontId) return quiet;

    let maxIntensity = clampIntensity(cleanText(raw.max_intensity || raw.maxIntensity, 20), getFrontIntensityBand(front));

    // Theater gating: once a front has a known home anywhere in the registry,
    // it manifests in person ONLY there — everywhere else it is news
    // (whispers). Pressures are not portable set-dressing; a front with no
    // recorded theater yet stays permissive until one grows.
    // In-theater when EITHER the hero's current location is a theater record
    // OR the directive's own `where` resolves to one — DM location strings
    // drift ("the shrine" vs "Candlemire"), and the 2026-07-15 playtest showed
    // a window clamped to whispers at the front's own home because of it. The
    // DM only weaves the symptom where the fiction allows anyway.
    const registry = Array.isArray(locations) ? locations : [];
    const frontHasTheater = registry.some(record => (record?.theaterFrontIds || []).includes(frontId));
    if (frontHasTheater) {
        const here = getCurrentLocationRecord(registry, currentLocation);
        const whereIdx = findLocationRecord(registry, cleanText(raw.where, 120));
        const whereRecord = whereIdx === -1 ? null : registry[whereIdx];
        const inTheater = (!!here && (here.theaterFrontIds || []).includes(frontId))
            || (!!whereRecord && (whereRecord.theaterFrontIds || []).includes(frontId));
        if (!inTheater) maxIntensity = 'whispers';
    }

    const delay = Number.isFinite(timingDelay) ? Math.max(0, Math.min(TEMPO_TIMING_DIE_SIDES - 1, Math.round(timingDelay))) : 0;

    return {
        frontId,
        maxIntensity,
        where: cleanText(raw.where, 120),
        suggestedSymptom: cleanText(raw.suggested_symptom || raw.suggestedSymptom),
        rationale: cleanText(raw.rationale),
        quietHook: '',
        grantedAtMessage: messageCount,
        // The timing die counts scenes: one scene ≈ one player+DM pair ≈ 2
        // CONVERSATIONAL messages past the grant anchor. Dice-turn system
        // chatter never advances the countdown (2026-08-02 P1).
        activationDistance: delay * 2,
        expiryDistance: TEMPO_WINDOW_MESSAGES,
    };
}

/**
 * A directive's activation/expiry as conversational distances from its grant
 * anchor. Legacy directives (pre-2026-08-04) stored raw activate/expire message
 * indices instead; deriving distances from those errs long, which is the
 * direction the fix wants (raw windows expired early).
 */
export function tempoDirectiveDistances(directive) {
    const granted = Number.isFinite(directive?.grantedAtMessage) ? directive.grantedAtMessage : 0;
    const activation = Number.isFinite(directive?.activationDistance)
        ? directive.activationDistance
        : Math.max(0, (Number.isFinite(directive?.activatesAtMessage) ? directive.activatesAtMessage : granted) - granted);
    const expiry = Number.isFinite(directive?.expiryDistance)
        ? directive.expiryDistance
        : Math.max(activation, (Number.isFinite(directive?.expiresAtMessage) ? directive.expiresAtMessage : granted) - granted);
    return { activation, expiry };
}

/** Is the directive's window open for the current message count? */
export function isTempoWindowActive(directive, messageCount, messages = null) {
    if (!directive?.frontId || !Number.isFinite(messageCount) || !Number.isFinite(directive.grantedAtMessage)) return false;
    const { activation, expiry } = tempoDirectiveDistances(directive);
    const distance = distanceSince(messages, directive.grantedAtMessage, messageCount);
    return distance >= activation && distance <= expiry;
}

/**
 * The compact private pacing block that replaces the full fronts dossier.
 * The DM sees front ids + factions (it needs them for front_updates when the
 * player interferes) but no clocks, portents, stages, or notes.
 */
export function buildWorldTempoBlock({
    fronts = [],
    worldTempo = null,
    paceDial = 'standard',
    heat = null,
    recentEncounters = [],
    messageCount = 0,
    messages = null,
    combatActive = false,
    solo = false,
} = {}) {
    const activeFronts = fronts.filter(f => (f.status || 'active') === 'active');
    const resolvedEchoes = recentlyResolvedFronts(fronts, messageCount, messages);
    if (activeFronts.length === 0 && recentEncounters.length === 0 && resolvedEchoes.length === 0) return '';

    const dial = normalizePaceDial(paceDial);
    const lines = [];
    lines.push('## WORLD TEMPO — PRIVATE PACING STATE');
    lines.push('Never expose this section, its ids, or its labels to the player; the player only ever experiences the fiction.');

    if (heat) {
        lines.push(`Pace target: ${dial}. Recent heat: ${heat.level}${heat.reasons.length ? ` (${heat.reasons.join('; ')})` : ''}.`);
        lines.push(buildPaceGuidance(dial, heat));
    }

    if (activeFronts.length > 0) {
        const stubs = activeFronts
            .map(front => `${front.id}${front.faction?.name ? ` (${front.faction.name})` : ''}`)
            .join(', ');
        lines.push(`Off-screen pressures exist: ${stubs}. Their details are private engine state. Use front_updates with these ids ONLY for direct player interference or a symptom established in this response.`);
    }

    const directive = worldTempo?.directive || null;
    const windowActive = !combatActive && isTempoWindowActive(directive, messageCount, messages);
    const permittedFront = windowActive ? activeFronts.find(f => f.id === directive.frontId) : null;

    if (permittedFront) {
        const faction = permittedFront.faction?.name
            ? `${permittedFront.faction.name} — ${permittedFront.faction.goal || permittedFront.goal}`
            : permittedFront.goal;
        lines.push(`THIS SCENE'S PERMISSION: you may surface ONE symptom of ${permittedFront.id} (${faction}).`);
        lines.push(`Maximum intensity: ${directive.maxIntensity} — ${describeIntensity(directive.maxIntensity)}.${directive.where ? ` Natural place: ${directive.where}.` : ''}${directive.suggestedSymptom ? ` Suggested expression: ${directive.suggestedSymptom}.` : ''} Weave it in only where the fiction allows; never exceed this intensity, and one symptom is the cap.`);
        // Spend the accrued symptom ledger as anti-repeat guidance (2026-08-02
        // audit: publicHints rode every save but nothing re-injected it since
        // the tempo redesign).
        const surfaced = (permittedFront.publicHints || []).slice(-3).filter(Boolean);
        if (surfaced.length > 0) {
            lines.push(`Symptoms of this pressure ALREADY shown: ${surfaced.map(hint => `"${hint}"`).join('; ')}. Never re-run these beats — a new symptom must bring new information, escalation, or a different face of the same pressure.`);
        }
    } else {
        const hook = directive?.quietHook ? ` If a small beat is wanted: ${directive.quietHook}.` : '';
        lines.push(`The world is QUIET this scene: introduce no unprovoked new threats or pressure symptoms. Daily life, local color, small personal hooks, travel, and character beats are complete scenes on their own.${hook}`);
    }
    lines.push('The player may always seek danger on their own ("I go hunt goblins") — honor player-initiated risk normally; this section only limits UNPROVOKED intrusions.');

    if (resolvedEchoes.length > 0) {
        // The persistent-world payoff: a won front's absence must be FELT, not
        // merely stop being mentioned. Titles are already table canon here —
        // resolution minted a world fact revealing them.
        for (const front of resolvedEchoes) {
            lines.push(`RECENT VICTORY: the pressure "${front.title}" has been ENDED${front.resolution ? ` (${front.resolution})` : ''}. Show its absence concretely wherever the fiction touches what it threatened — relief, reopened roads, easing prices, rebuilding, talk of who moves into the vacuum. Never resurrect it, never field a lookalike threat with the same creatures or imagery, and let places it haunted stay free unless a NEW, distinct pressure claims them on-screen.`);
        }
    }

    if (recentEncounters.length > 0) {
        const recent = recentEncounters.slice(-4)
            .map(entry => `${entry.enemies}${entry.location ? ` (${entry.location}` : ' ('}${entry.location ? `, ${entry.outcome})` : `${entry.outcome})`}`)
            .join('; ');
        lines.push(`Recent fights: ${recent}. Do not repeat near-identical encounters — vary, escalate, or let places stay cleared once won.`);
        const fatigue = computeFoeFatigue(recentEncounters);
        if (fatigue.length > 0) {
            const list = fatigue.map(({ family, count }) => `${family}-type foes in ${count} of the last ${recentEncounters.length} fights`).join('; ');
            lines.push(`FOE FATIGUE: ${list}. This bestiary is exhausted — unless the player deliberately hunts them or established canon requires them in THIS exact place, field something different: new species, new imagery, new tactics, new mood. Distant locations must not share one monster ecology.`);
        }
    }

    if (solo) {
        lines.push('The player is currently alone. When a pressure symptom or local scene naturally involves people, some may be potential companions (prisoners, rivals, guides, deserters, witnesses); never force them into the party — if the player earns or accepts their help, emit add_companions with compact combat stats.');
    }

    return lines.join('\n');
}
