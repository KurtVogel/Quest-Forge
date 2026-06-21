const DEFAULT_MAX_CLOCK = 6;
export const FRONTS_VERSION = 2;

function cleanText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeTextArray(value, fallback = []) {
    const source = Array.isArray(value) ? value : fallback;
    return source
        .map(v => cleanText(v))
        .filter(Boolean)
        .slice(0, 6);
}

function normalizeRecentTextArray(value, fallback = []) {
    const source = Array.isArray(value) ? value : fallback;
    return source
        .map(v => cleanText(v))
        .filter(Boolean)
        .slice(-6);
}

function normalizeFaction(value, fallback = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    const name = cleanText(value.name).slice(0, 100);
    if (!name) return fallback;
    return {
        name,
        goal: cleanText(value.goal).slice(0, 280),
        stance: cleanText(value.stance).slice(0, 180),
        relationships: normalizeTextArray(value.relationships).map(text => text.slice(0, 220)),
    };
}

function normalizeStatus(value, fallback = 'active') {
    const status = cleanText(value).toLowerCase();
    if (status === 'completed') return 'resolved';
    return ['active', 'dormant', 'resolved'].includes(status) ? status : fallback;
}

export function createInitialFronts({ premise = '', character = null, location = null } = {}) {
    const anchor = cleanText(location)
        || cleanText(premise).split(/[.!?]/)[0]?.slice(0, 90)
        || 'the starting region';
    const name = cleanText(character?.name, 'the hero');

    return [normalizeFront({
        id: 'front-local-pressure',
        title: `Trouble around ${anchor}`,
        goal: `A local threat wants to turn ${anchor} into leverage before ${name} can build allies.`,
        stakes: `What changes in ${anchor} if nobody interferes? Who becomes desperate enough to help or betray ${name}?`,
        grimPortents: [
            'Rumors, shortages, missing people, or frightened witnesses reveal the pressure indirectly.',
            'A vulnerable NPC is forced to choose a side or ask the hero for help.',
            'The threat claims territory, a hostage, a route, or a useful resource.',
            'Open violence or public betrayal makes the danger impossible to ignore.',
        ],
        publicHints: [],
    })];
}

export function normalizeFront(front = {}, existing = null) {
    const maxClock = clampInt(front.maxClock ?? front.max_clock, 3, 12, existing?.maxClock || DEFAULT_MAX_CLOCK);
    const clock = clampInt(front.clock, 0, maxClock, existing?.clock || 0);
    const grimPortents = normalizeTextArray(front.grimPortents || front.grim_portents, existing?.grimPortents || []);
    const stage = clampInt(front.stage, 0, grimPortents.length || maxClock, existing?.stage || 0);

    return {
        id: cleanText(front.id, existing?.id || `front-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
        title: cleanText(front.title || front.name, existing?.title || 'Unnamed Front'),
        goal: cleanText(front.goal, existing?.goal || 'A hidden threat advances its agenda.'),
        stakes: cleanText(front.stakes, existing?.stakes || 'What happens if the player does nothing?'),
        grimPortents,
        clock,
        maxClock,
        stage,
        status: normalizeStatus(front.status, existing?.status || 'active'),
        publicHints: normalizeRecentTextArray(front.publicHints || front.public_hints, existing?.publicHints || []),
        lastAdvancedAt: front.lastAdvancedAt || front.last_advanced_at || existing?.lastAdvancedAt || null,
        lastAdvanceId: cleanText(front.lastAdvanceId || front.last_advance_id, existing?.lastAdvanceId || '') || null,
        notes: cleanText(front.notes, existing?.notes || ''),
        faction: normalizeFaction(front.faction, existing?.faction || null),
    };
}

export function normalizeFrontUpdate(update = {}) {
    if (!update || typeof update !== 'object') return null;
    const id = cleanText(update.id || update.frontId || update.front_id);
    const title = cleanText(update.title || update.name);
    if (!id && !title) return null;

    const normalized = {
        ...(id && { id }),
        ...(title && { title }),
        ...(update.clock !== undefined && { clock: clampInt(update.clock, 0, 12, 0) }),
        ...(update.stage !== undefined && { stage: clampInt(update.stage, 0, 12, 0) }),
        ...((update.publicHints || update.public_hints) && { publicHints: normalizeRecentTextArray(update.publicHints || update.public_hints) }),
        ...(update.notes !== undefined && { notes: cleanText(update.notes).slice(0, 500) }),
        lastAdvancedAt: Date.now(),
    };
    if (update.status !== undefined) normalized.status = normalizeStatus(update.status);
    return normalized;
}

function normalizeAdvance(advance = {}) {
    if (!advance || typeof advance !== 'object' || Array.isArray(advance)) return null;
    const id = cleanText(advance.id || advance.frontId || advance.front_id).slice(0, 120);
    const deltaValue = Math.round(Number(advance.delta));
    if (!id || !Number.isFinite(deltaValue)) return null;
    return {
        id,
        delta: Math.max(-1, Math.min(1, deltaValue)),
        symptom: cleanText(advance.symptom || advance.publicHint || advance.public_hint).slice(0, 240),
        reason: cleanText(advance.reason || advance.notes).slice(0, 500),
    };
}

/**
 * Apply one private, cadenced living-world batch. Fiction decides whether pressure
 * changes; the engine owns the bounded delta, monotonic portent stage, and identity.
 */
export function applyFrontAdvanceBatch(fronts = [], batch = {}) {
    const cadenceId = cleanText(batch.cadenceId || batch.cadence_id).slice(0, 160);
    if (!cadenceId || !Array.isArray(batch.advances)) return { fronts, appliedCount: 0 };

    const seen = new Set();
    const advances = batch.advances
        .map(normalizeAdvance)
        .filter(advance => advance && !seen.has(advance.id) && seen.add(advance.id))
        .slice(0, 3);
    if (advances.length === 0) return { fronts, appliedCount: 0 };

    let appliedCount = 0;
    const nextFronts = fronts.map(front => {
        const advance = advances.find(candidate => candidate.id === front.id);
        if (!advance || (front.status || 'active') !== 'active' || front.lastAdvanceId === cadenceId) return front;

        const clock = clampInt((front.clock || 0) + advance.delta, 0, front.maxClock || DEFAULT_MAX_CLOCK, front.clock || 0);
        const portentCount = Math.max(0, (front.grimPortents || []).length);
        const derivedStage = portentCount > 0
            ? Math.min(portentCount, Math.floor((clock / (front.maxClock || DEFAULT_MAX_CLOCK)) * portentCount))
            : 0;
        const publicHints = advance.symptom
            ? [...(front.publicHints || []), advance.symptom]
            : front.publicHints;
        appliedCount += 1;
        return normalizeFront({
            ...front,
            clock,
            stage: Math.max(front.stage || 0, derivedStage),
            publicHints,
            notes: advance.reason || front.notes,
            lastAdvancedAt: Date.now(),
            lastAdvanceId: cadenceId,
        }, front);
    });

    return { fronts: nextFronts, appliedCount };
}
