/**
 * The wonder die — when nothing is happening, something strange arrives
 * (WOW 2026-09-18; Vesa 2026-09-17: "eventless boring wagon guarding trips
 * from one generic town to another… I want to be surprised").
 *
 * Every shipped pacing system is a PRESSURE system built to stop unprovoked
 * escalation (DECISIONS.md 2026-07-14), and its quiet line only offers the DM
 * "a small hook if the fiction offers one". Nothing is allowed to be big,
 * strange, or off-plot. This module owns the missing category — wonder,
 * intrigue, invitation — with the shape that has worked four times already:
 * the ENGINE decides WHEN (a deterministic lull detector + a crypto die), the
 * LLM decides WHAT (`llm/wonderDirector.js`, 2–3 hooks in distinct registers,
 * at least one standalone — "may or may not fit the larger story" is the
 * point), and the PLAYER decides whether to bite. The DM sees a windowed
 * private cue that lands an INVITATION on screen, never an attack: the
 * anti-escalation guard of THE ORDINARY TURN is untouched.
 *
 * Session-only state: `session.pendingWonder` (one-shot request marker, the
 * frontAftermath pattern), `session.wonder` (the chosen hook with its window),
 * `session.lastWonderMessage` (cooldown). A residue story card is minted at
 * install so even a refused wonder is remembered.
 */

import { computeRecentHeat, distanceSince, getFrontIntensityBand, normalizePaceDial, tempoDirectiveDistances } from './worldTempo.js';

/** Conversational messages of eventlessness before a wonder may be requested, by pace dial. */
export const WONDER_MIN_LULL = { 'slow-burn': 30, standard: 20, breakneck: 14 };
/** Conversational messages between wonders. */
export const WONDER_COOLDOWN_MESSAGES = 60;
/** Conversational messages the DM cue stays open once the die's delay has passed. */
export const WONDER_WINDOW_MESSAGES = 12;
/** Sides of the timing die: rollDie(WONDER_TIMING_DIE_SIDES) - 1 → 0–3 scene delay. */
export const WONDER_TIMING_DIE_SIDES = 4;
/** One scene ≈ one player line + one DM reply. */
export const MESSAGES_PER_SCENE = 2;
/** Raw transcript rows before the opening is over (the BG1 opening rule). */
export const WONDER_OPENING_MIN_MESSAGES = 20;
/** Story cards of at least this salience count as events. */
export const WONDER_EVENT_SALIENCE = 4;
export const WONDER_REGISTERS = ['person', 'relic', 'passage', 'bargain', 'sight'];
export const MAX_WONDER_HOOKS = 3;

const TEXT_LIMITS = { title: 60, hook: 300, invitation: 200, register: 20 };

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const finiteIndex = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && typeof value !== 'boolean' ? Math.max(0, Math.floor(n)) : null;
};

/**
 * A card the ENGINE promoted from an NPC's dossier (`npcBondCard`: tags
 * npc + roster, source npc_roster) restates who someone is, not that something
 * happened — meeting a farmwife minted a salience-4 "relationship" card that
 * reset the lull like a fight would.
 */
function isRosterPromotion(card) {
    return card?.source === 'npc_roster' || (Array.isArray(card?.tags) && card.tags.includes('roster'));
}

/**
 * The newest message index at which something HAPPENED: a fight, a quest
 * opened, a salient story card born, a front resolved, a permitted pressure
 * symptom, or a previous wonder. Null when the campaign has no events yet.
 */
export function lastEventMessage(state) {
    let newest = null;
    const note = (value) => {
        const idx = finiteIndex(value);
        if (idx !== null && (newest === null || idx > newest)) newest = idx;
    };
    for (const entry of (Array.isArray(state?.recentEncounters) ? state.recentEncounters : [])) note(entry?.messageIndex);
    for (const quest of (Array.isArray(state?.quests) ? state.quests : [])) note(quest?.openedAtMessage);
    for (const card of (Array.isArray(state?.storyMemory) ? state.storyMemory : [])) {
        if (Number(card?.salience) >= WONDER_EVENT_SALIENCE && !isRosterPromotion(card)) note(card?.firstSeenMessage);
    }
    for (const front of (Array.isArray(state?.fronts) ? state.fronts : [])) {
        if (front?.status === 'resolved') note(front.resolvedAtMessage);
    }
    // A tempo directive is an EVENT only when it granted a front a window — the
    // quiet directive every journal cadence issues (frontId null, still stamped
    // with the cadence's message index) is the ABSENCE of one. Counting it
    // reset the lull every ~10 messages, so the wonder die could never reach
    // its threshold in the campaign it exists for (live playtest 2026-09-19).
    const directive = state?.worldTempo?.directive;
    if (directive?.frontId) {
        const granted = finiteIndex(directive.grantedAtMessage);
        if (granted !== null) note(granted + tempoDirectiveDistances(directive).activation);
    }
    note(state?.session?.wonder?.openAtMessage);
    note(state?.session?.lastWonderMessage);
    return newest;
}

/** Conversational messages since the last event (from the start when none). */
export function measureLull(state) {
    const messages = Array.isArray(state?.messages) ? state.messages : [];
    const anchor = lastEventMessage(state);
    return distanceSince(messages, anchor === null ? -1 : anchor, messages.length);
}

export function wonderThreshold(paceDial) {
    return WONDER_MIN_LULL[normalizePaceDial(paceDial)] ?? WONDER_MIN_LULL.standard;
}

const PACE_TARGET_IDX = { 'slow-burn': 0, standard: 1, breakneck: 2 };
const HEAT_IDX = { calm: 0, lively: 1, high: 2 };

/**
 * May the engine ask the director for a wonder now? Never in combat, never in
 * the opening, never with one pending or open, never inside the cooldown,
 * never while a front stands at confrontation, never while measured heat is
 * above the pace setpoint (a wonder is not a threat, but it is an event and
 * the thermostat is the thermostat) — and only after a real lull.
 * `onDemand` (the player asked for it) skips the lull, the cooldown, and an
 * already-open wonder (the new one replaces it); a pending request, combat, and
 * the opening still hold.
 */
export function shouldRequestWonder(state, { onDemand = false } = {}) {
    if (!state || state.combat?.active) return false;
    const messages = Array.isArray(state.messages) ? state.messages : [];
    if (messages.length < WONDER_OPENING_MIN_MESSAGES) return false;
    const session = isRecord(state.session) ? state.session : {};
    if (sanitizePendingWonder(session.pendingWonder)) return false;
    // An OPEN wonder blocks an ordinary lull request, never a player's own ask:
    // in both 2026-09-19 playtest runs "OOC: surprise me" arrived while the
    // first wonder's window was still open, was silently dropped, and the DM
    // had already promised "I'll introduce a fitting opportunity".
    const current = sanitizeWonder(session.wonder);
    if (!onDemand && current && !isWonderExpired(current, messages.length, messages)) return false;
    const fronts = Array.isArray(state.fronts) ? state.fronts : [];
    if (fronts.some(front => (front?.status || 'active') === 'active' && getFrontIntensityBand(front) === 'confrontation')) return false;
    const dial = normalizePaceDial(state.settings?.paceDial);
    if (!onDemand) {
        const last = finiteIndex(session.lastWonderMessage);
        if (last !== null && distanceSince(messages, last, messages.length) < WONDER_COOLDOWN_MESSAGES) return false;
        const heat = computeRecentHeat({
            messageCount: messages.length,
            messages,
            combat: state.combat,
            character: state.character,
            recentEncounters: state.recentEncounters || [],
            recentChecks: state.recentChecks || [],
            worldTempo: state.worldTempo || null,
        });
        if ((HEAT_IDX[heat.level] ?? 0) > PACE_TARGET_IDX[dial]) return false;
        if (measureLull(state) < wonderThreshold(dial)) return false;
    }
    return true;
}

export function mintPendingWonder(state, { onDemand = false } = {}) {
    const messageCount = (Array.isArray(state?.messages) ? state.messages : []).length;
    return { key: `wonder-${messageCount}-${onDemand ? 'asked' : 'lull'}`, requestedAtMessage: messageCount, onDemand: !!onDemand };
}

export function sanitizePendingWonder(raw) {
    if (!isRecord(raw)) return null;
    const key = text(raw.key, 80);
    const requestedAtMessage = finiteIndex(raw.requestedAtMessage);
    if (!key || requestedAtMessage === null) return null;
    return { key, requestedAtMessage, onDemand: raw.onDemand === true };
}

/**
 * Type the director's hooks complete-or-drop: register whitelisted, texts
 * clamped, `fits` either 'standalone' or a LIVE front id (anything else is
 * standalone), at least one standalone among the survivors (the first is
 * made so if none), duplicate registers folded, at most MAX_WONDER_HOOKS.
 */
export function normalizeWonderHooks(raw, { fronts = [] } = {}) {
    const liveIds = new Set((Array.isArray(fronts) ? fronts : [])
        .filter(front => front && (front.status || 'active') === 'active' && typeof front.id === 'string')
        .map(front => front.id));
    const seenRegisters = new Set();
    const hooks = [];
    for (const item of (Array.isArray(raw) ? raw : [])) {
        if (!isRecord(item)) continue;
        const register = text(item.register, TEXT_LIMITS.register).toLowerCase();
        const title = text(item.title, TEXT_LIMITS.title);
        const hook = text(item.hook, TEXT_LIMITS.hook);
        const invitation = text(item.invitation, TEXT_LIMITS.invitation);
        if (!WONDER_REGISTERS.includes(register) || !title || !hook || !invitation) continue;
        if (seenRegisters.has(register)) continue;
        seenRegisters.add(register);
        const rawFits = text(item.fits, 120);
        const frontId = rawFits.startsWith('front:') ? rawFits.slice(6).trim() : rawFits;
        const fits = liveIds.has(frontId) ? frontId : 'standalone';
        hooks.push({ register, title, hook, invitation, fits });
        if (hooks.length >= MAX_WONDER_HOOKS) break;
    }
    if (hooks.length > 0 && !hooks.some(h => h.fits === 'standalone')) hooks[0] = { ...hooks[0], fits: 'standalone' };
    return hooks;
}

/**
 * The die: arc reasoning nominated the candidates, the engine picks ONE and
 * delays its window by 0–3 scenes (the world-tempo timing-die rule). An
 * on-demand wonder opens at once — the player asked, waiting is wrong.
 */
export function selectWonder(hooks, { messageCount, pick, delayScenes, onDemand = false, key = '' }) {
    const list = Array.isArray(hooks) ? hooks.filter(Boolean) : [];
    if (list.length === 0) return null;
    const index = Math.min(list.length - 1, Math.max(0, Math.floor(Number(pick) || 0)));
    const delay = onDemand ? 0 : Math.max(0, Math.min(WONDER_TIMING_DIE_SIDES - 1, Math.floor(Number(delayScenes) || 0)));
    const chosenAtMessage = finiteIndex(messageCount) ?? 0;
    return {
        ...list[index],
        key: text(key, 80) || `wonder-${chosenAtMessage}`,
        chosenAtMessage,
        openAtMessage: chosenAtMessage + delay * MESSAGES_PER_SCENE,
        onDemand: !!onDemand,
    };
}

export function sanitizeWonder(raw) {
    if (!isRecord(raw)) return null;
    const [hook] = normalizeWonderHooks([raw]);
    if (!hook) return null;
    const chosenAtMessage = finiteIndex(raw.chosenAtMessage);
    const openAtMessage = finiteIndex(raw.openAtMessage);
    if (chosenAtMessage === null || openAtMessage === null) return null;
    return {
        ...hook,
        // `fits` was re-judged against an empty front list above; keep the stored id text.
        fits: text(raw.fits, 120) || 'standalone',
        key: text(raw.key, 80) || `wonder-${chosenAtMessage}`,
        chosenAtMessage,
        openAtMessage: Math.max(chosenAtMessage, openAtMessage),
        onDemand: raw.onDemand === true,
    };
}

/** Open = the delay has passed and the window has not run out (conversational distance). */
export function isWonderOpen(wonder, messageCount, messages = null) {
    const w = sanitizeWonder(wonder);
    if (!w || !Number.isFinite(messageCount) || messageCount < w.openAtMessage) return false;
    return distanceSince(messages, w.openAtMessage, messageCount) <= WONDER_WINDOW_MESSAGES;
}

export function isWonderExpired(wonder, messageCount, messages = null) {
    const w = sanitizeWonder(wonder);
    if (!w) return true;
    return Number.isFinite(messageCount) && messageCount >= w.openAtMessage
        && distanceSince(messages, w.openAtMessage, messageCount) > WONDER_WINDOW_MESSAGES;
}

const REGISTER_LABELS = {
    person: 'someone who takes an interest',
    relic: 'a thing of a dead age that wakes',
    passage: 'a way to somewhere forbidden',
    bargain: 'an offer from something old',
    sight: 'a sight that should not exist',
};

/**
 * The DM cue. Rendered only while the window is open and no fight is on;
 * everything invalid renders nothing.
 */
export function buildWonderBlock(wonder, { messageCount, messages = null, combatActive = false, fronts = [] } = {}) {
    const w = sanitizeWonder(wonder);
    if (!w || combatActive || !isWonderOpen(w, messageCount, messages)) return '';
    const front = w.fits !== 'standalone'
        ? (Array.isArray(fronts) ? fronts : []).find(f => f && f.id === w.fits && (f.status || 'active') === 'active')
        : null;
    const tie = front
        ? `It is quietly tied to ${text(front.faction?.name || front.title, 80) || 'an existing pressure'} — let that show only as a detail, never as an explanation.`
        : 'It stands on its own: it may or may not connect to anything else in this campaign, and you must not force it to.';
    return `## SOMETHING STRANGE ARRIVES — PRIVATE
The world has been quiet for a long stretch and the engine has rolled for wonder: this is the window. In this scene or the next, land the following ON SCREEN as an INVITATION — a thing that arrives, is seen, or speaks — never as an attack, ambush, grab, or threat:
**${w.title}** (${REGISTER_LABELS[w.register] || w.register}): ${w.hook} What it offers or asks: ${w.invitation}
- Make it concrete and particular, in this place, through someone or something present; let a character present react to it on their own want. ${tie}
- The hero may refuse. A refusal costs something or leaves a residue — someone remembers, the light keeps pulsing over the hills, the ship sails without them.
- THE ORDINARY TURN still governs length; the arrival IS the ask. Once it has landed, never repeat this cue and never reveal that it was rolled.`;
}

/** The residue: a story card minted at install so even a refused wonder is remembered. */
export function buildWonderResidueCard(wonder) {
    const w = sanitizeWonder(wonder);
    if (!w) return null;
    return {
        type: 'foreshadow',
        subject: w.title,
        text: `${w.hook} ${w.invitation}`.slice(0, 500),
        salience: 4,
        emotionalCharge: 3,
        status: 'active',
        tags: ['wonder', w.register],
    };
}

/** The player asking the DM for wonder out of character — the one exempt case. */
const WONDER_REQUEST_RE = /\b(?:surprise\s+me|something\s+(?:wild|strange|new|unexpected|crazy|weird)|shake\s+things\s+up|make\s+something\s+happen|give\s+me\s+(?:a\s+)?(?:twist|plot|hook)|liven\s+(?:this|things)\s+up)\b/i;
export function isWonderRequest(message) {
    return WONDER_REQUEST_RE.test(String(message || ''));
}
