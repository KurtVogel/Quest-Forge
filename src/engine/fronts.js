const DEFAULT_MAX_CLOCK = 6;

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
    const stage = clampInt(front.stage, 0, maxClock, existing?.stage || 0);

    return {
        id: cleanText(front.id, existing?.id || `front-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
        title: cleanText(front.title || front.name, existing?.title || 'Unnamed Front'),
        goal: cleanText(front.goal, existing?.goal || 'A hidden threat advances its agenda.'),
        stakes: cleanText(front.stakes, existing?.stakes || 'What happens if the player does nothing?'),
        grimPortents: normalizeTextArray(front.grimPortents || front.grim_portents, existing?.grimPortents || []),
        clock,
        maxClock,
        stage,
        status: cleanText(front.status, existing?.status || 'active'),
        publicHints: normalizeTextArray(front.publicHints || front.public_hints, existing?.publicHints || []),
        lastAdvancedAt: front.lastAdvancedAt || front.last_advanced_at || existing?.lastAdvancedAt || null,
        notes: cleanText(front.notes, existing?.notes || ''),
    };
}

export function normalizeFrontUpdate(update = {}) {
    if (!update || typeof update !== 'object') return null;
    const id = cleanText(update.id || update.frontId || update.front_id);
    const title = cleanText(update.title || update.name);
    if (!id && !title) return null;

    return {
        ...update,
        ...(id && { id }),
        ...(title && { title }),
        ...(update.clock !== undefined && { clock: clampInt(update.clock, 0, 12, 0) }),
        ...(update.stage !== undefined && { stage: clampInt(update.stage, 0, 12, 0) }),
        ...(update.maxClock !== undefined || update.max_clock !== undefined
            ? { maxClock: clampInt(update.maxClock ?? update.max_clock, 3, 12, DEFAULT_MAX_CLOCK) }
            : {}),
        ...(update.public_hints && { publicHints: update.public_hints }),
        ...(update.grim_portents && { grimPortents: update.grim_portents }),
        lastAdvancedAt: Date.now(),
    };
}
