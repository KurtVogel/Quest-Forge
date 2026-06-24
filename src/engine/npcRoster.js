/**
 * NPC roster promotion — separates durable characters from combat fodder.
 * Legacy saves grandfather every existing NPC as a character so long-running
 * campaigns keep early antagonists (e.g. a starting-town captain).
 */

export const NPC_ROSTER_TIERS = new Set(['character', 'archived_creature']);
export const NPC_KINDS = new Set(['character', 'creature', 'ephemeral']);

const GENERIC_SPECIES = new Set([
    'goblin', 'goblinoid', 'hobgoblin', 'bugbear', 'orc', 'half-orc', 'bandit', 'thug',
    'guard', 'soldier', 'sentry', 'zombie', 'skeleton', 'wolf', 'warg', 'rat', 'spider',
    'cultist', 'acolyte', 'imp', 'demon', 'fiend', 'beast', 'monster', 'enemy', 'foe',
    'raider', 'marauder', 'brigand', 'scout', 'archer', 'warrior', 'fighter', 'mage',
    'wizard', 'cleric', 'priest', 'druid', 'knight', 'peasant', 'villager', 'farmer',
    'troll', 'ogre', 'gnoll', 'kobold', 'gnome', 'drow',
]);

const GENERIC_EPITHETS = new Set([
    'runt', 'grunt', 'minion', 'lackey', 'henchman', 'fodder', 'skirmisher', 'crawler',
    'stalker', 'shaman', 'berserker', 'brute', 'snarl', 'fang', 'claw', 'young', 'elder',
    'cave', 'forest', 'swamp', 'mountain', 'tunnel', 'patrol', 'wounded', 'snarling',
    'angry', 'hostile', 'sneaky', 'sneak', 'lone', 'pack', 'alpha', 'beta', 'gamma',
    'scout', 'archer', 'warrior', 'fighter', 'sentry', 'raider', 'marauder', 'brigand',
    'chieftain', 'chief', 'boss', 'king', 'queen', 'captain', 'lieutenant', 'adept',
    'acolyte', 'cultist', 'priest', 'shaman', 'berserker', 'hunter', 'stabber', 'slasher',
    'spearman', 'swordsman', 'axeman', 'bowman',
]);

const DISAMBIGUATOR = /^(?:[a-z]|\d{1,3}|i{1,3}|iv|v|vi{0,3}|ix|x|one|two|three|four|five)$/i;

const COMBAT_ONLY_NOTE = /\b(attack|fought|slain|killed|defeated|stabbed|shot|arrow|spear|sword|combat|battle|ambush|patrol)\b/i;

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

/** Journal dossier fields — full depth for player review and Scribe context. */
export const NPC_DOSSIER_FIELD_MAX = 600;
/** Compact excerpts injected into the live DM prompt. */
export const NPC_PROMPT_FIELD_MAX = 180;
export const NPC_HOOK_FIELD_MAX = 200;
export const NPC_PLACE_FIELD_MAX = 120;

export function clampNpcDossierField(value, max = NPC_DOSSIER_FIELD_MAX) {
    const cleaned = cleanText(value);
    if (!cleaned || cleaned.length <= max) return cleaned;

    const slice = cleaned.slice(0, max);
    const sentenceEnd = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
    );
    if (sentenceEnd >= Math.floor(max * 0.55)) {
        return slice.slice(0, sentenceEnd + 1).trim();
    }

    const space = slice.lastIndexOf(' ');
    return (space > 0 ? slice.slice(0, space) : slice).trim();
}

export function briefNpcFieldForPrompt(value, max = NPC_PROMPT_FIELD_MAX) {
    const cleaned = cleanText(value);
    if (!cleaned) return '';
    if (cleaned.length <= max) return cleaned;
    return `${cleaned.slice(0, Math.max(0, max - 1)).trim()}…`;
}

/** Loose place match — "Jewelglade" matches "Jewelglade, east gate". */
export function locationMatchesPlace(playerLocation, npcPlace) {
    const player = cleanText(playerLocation).toLowerCase().replace(/^the\s+/, '');
    const place = cleanText(npcPlace).toLowerCase().replace(/^the\s+/, '');
    if (!player || !place) return false;
    return player === place || player.includes(place) || place.includes(player);
}

function tokenizeCreatureName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .replace(/[-']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
}

function isDisambiguatorToken(token) {
    return DISAMBIGUATOR.test(cleanText(token));
}

function isGenericModifierToken(token) {
    const t = cleanText(token);
    if (!t) return false;
    return GENERIC_SPECIES.has(t)
        || GENERIC_EPITHETS.has(t)
        || isDisambiguatorToken(t)
        || t === 'with'
        || t === 'a'
        || t === 'an'
        || t === 'the';
}

export function isGenericCreatureName(name) {
    const raw = cleanText(name);
    if (!raw) return true;
    const lower = raw.toLowerCase();

    if (/^(a|an|the)\s+/.test(lower)) return true;
    if (/#\d+\b/.test(lower) || /\bnumber\s+\d+\b/.test(lower)) return true;
    if (/\bwith\s+(a\s+)?(spear|sword|axe|bow|dagger|club|mace|shield|armor)\b/.test(lower)) return true;
    if (/\bgoblin\s+runt\b/.test(lower)) return true;
    if (/\b(goblin|orc|hobgoblin|bugbear|warg|wolf|bandit|skeleton|zombie)\s+[a-z]\b/i.test(lower)) return true;

    const tokens = tokenizeCreatureName(lower);
    if (tokens.length === 0) return true;

    const speciesIndexes = tokens
        .map((token, index) => (GENERIC_SPECIES.has(token) ? index : -1))
        .filter(index => index >= 0);
    if (speciesIndexes.length === 0) return false;

    if (tokens.length === 1 && GENERIC_SPECIES.has(tokens[0])) return true;

    if (tokens.length <= 6 && tokens.every(isGenericModifierToken)) return true;

    if (tokens.length === 2 && GENERIC_SPECIES.has(tokens[1]) && GENERIC_EPITHETS.has(tokens[0])) {
        return true;
    }

    const first = tokens[0];
    if (GENERIC_SPECIES.has(first) && tokens.length <= 4) return true;

    return false;
}

/** Bulk archive should ignore disposition arcs on obvious fodder names. */
export function blocksFodderArchive(npc = {}) {
    if (npc.pinned) return true;
    if (cleanText(npc.agenda) || cleanText(npc.relationshipTension)) return true;
    if (cleanText(npc.personality) || cleanText(npc.goals) || cleanText(npc.secrets)) return true;
    if (Array.isArray(npc.callbackHooks) && npc.callbackHooks.length > 0) return true;
    if (Number.isFinite(npc.trust)) return true;
    if (!isGenericCreatureName(npc.name)
        && Array.isArray(npc.relationshipHistory)
        && npc.relationshipHistory.length > 0) {
        return true;
    }
    return false;
}

export function hasNpcNarrativeWeight(npc = {}) {
    return Boolean(
        cleanText(npc.personality)
        || cleanText(npc.goals)
        || cleanText(npc.agenda)
        || cleanText(npc.secrets)
        || cleanText(npc.relationshipTension)
        || cleanText(npc.privateNotes)
        || (Array.isArray(npc.callbackHooks) && npc.callbackHooks.length > 0)
        || (Array.isArray(npc.relationshipHistory) && npc.relationshipHistory.length > 0)
        || Number.isFinite(npc.trust)
        || npc.pinned
    );
}

export function isCombatOnlyNotes(npc = {}) {
    const notes = cleanText(npc.lastNotes || npc.notes);
    if (!notes) return false;
    if (hasNpcNarrativeWeight(npc)) return false;
    return COMBAT_ONLY_NOTE.test(notes) && notes.length < 140;
}

/**
 * Classify an incoming NPC candidate. Existing roster characters are never
 * downgraded by classification alone.
 */
export function classifyNpcCandidate(payload = {}, existing = null) {
    const name = cleanText(payload.name || existing?.name);
    const kind = NPC_KINDS.has(payload.kind) ? payload.kind : null;
    const rosterEligible = payload.rosterEligible === true || payload.roster_eligible === true;
    const explicitTier = NPC_ROSTER_TIERS.has(payload.rosterTier) ? payload.rosterTier : null;
    const pinned = !!(payload.pinned ?? existing?.pinned);

    if (existing?.rosterTier === 'character' || existing?.pinned || pinned) {
        return {
            allowRoster: true,
            rosterTier: 'character',
            kind: kind || existing?.kind || 'character',
            importance: computeNpcImportance({ ...existing, ...payload, rosterTier: 'character', pinned: pinned || existing?.pinned }),
        };
    }

    if (explicitTier === 'archived_creature') {
        return { allowRoster: true, rosterTier: 'archived_creature', kind: kind || 'creature', importance: 1 };
    }

    if (rosterEligible || kind === 'character' || explicitTier === 'character') {
        return {
            allowRoster: true,
            rosterTier: 'character',
            kind: 'character',
            importance: computeNpcImportance({ ...existing, ...payload, rosterTier: 'character' }),
        };
    }

    if (kind === 'creature' || kind === 'ephemeral') {
        return { allowRoster: false, rosterTier: null, kind, importance: 1 };
    }

    const candidate = { ...existing, ...payload, name };
    const genericName = isGenericCreatureName(name);
    const narrativeWeight = hasNpcNarrativeWeight(candidate);
    const combatOnly = isCombatOnlyNotes(candidate);

    if (!genericName || narrativeWeight) {
        return {
            allowRoster: true,
            rosterTier: 'character',
            kind: 'character',
            importance: computeNpcImportance({ ...candidate, rosterTier: 'character' }),
        };
    }

    if (genericName && (combatOnly || kind === 'creature' || kind === 'ephemeral')) {
        return { allowRoster: false, rosterTier: null, kind: kind || 'creature', importance: 1 };
    }

    if (genericName && !narrativeWeight) {
        return { allowRoster: false, rosterTier: null, kind: 'creature', importance: 1 };
    }

    return {
        allowRoster: true,
        rosterTier: 'character',
        kind: 'character',
        importance: computeNpcImportance({ ...candidate, rosterTier: 'character' }),
    };
}

export function computeNpcImportance(npc = {}) {
    let score = clampImportance(npc.importance, 3);

    if (npc.pinned) score = 5;
    if (npc.rosterTier === 'character') score += 1;
    if (cleanText(npc.agenda)) score += 1;
    if (cleanText(npc.relationshipTension)) score += 2;
    if (Array.isArray(npc.callbackHooks) && npc.callbackHooks.length > 0) score += 1;
    if (Array.isArray(npc.relationshipHistory) && npc.relationshipHistory.length > 0) score += 1;
    if (Number.isFinite(npc.trust)) score += 0.5;
    if (!isGenericCreatureName(npc.name)) score += 1;
    if (cleanText(npc.personality) || cleanText(npc.goals) || cleanText(npc.secrets)) score += 0.5;

    return clampImportance(score, 3);
}

function clampImportance(value, fallback = 3) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(5, Math.round(n)));
}

/** Grandfather legacy saves: every pre-existing NPC becomes a durable character. */
export function migrateLegacyNpc(npc = {}) {
    const merged = {
        rosterTier: 'character',
        kind: 'character',
        pinned: !!npc.pinned,
        importance: computeNpcImportance({ ...npc, rosterTier: 'character' }),
        personality: '',
        goals: '',
        secrets: '',
        knownFacts: [],
        basedIn: null,
        lastLocation: null,
        relationshipHistory: [],
        agenda: '',
        relationshipTension: '',
        trust: null,
        privateNotes: '',
        callbackHooks: [],
        ...npc,
    };
    if (!NPC_ROSTER_TIERS.has(merged.rosterTier)) {
        merged.rosterTier = 'character';
    }
    if (!NPC_KINDS.has(merged.kind)) {
        merged.kind = merged.rosterTier === 'archived_creature' ? 'creature' : 'character';
    }
    merged.importance = computeNpcImportance(merged);
    return merged;
}

export function normalizeNpcRecord(npc = {}, { legacy = false } = {}) {
    if (legacy || !npc.rosterTier) {
        return migrateLegacyNpc(npc);
    }
    const rosterTier = NPC_ROSTER_TIERS.has(npc.rosterTier) ? npc.rosterTier : 'character';
    const kind = NPC_KINDS.has(npc.kind) ? npc.kind : (rosterTier === 'archived_creature' ? 'creature' : 'character');
    return {
        ...migrateLegacyNpc(npc),
        rosterTier,
        kind,
        pinned: !!npc.pinned,
        importance: computeNpcImportance({ ...npc, rosterTier, kind }),
    };
}

export function isPromptRosterNpc(npc = {}) {
    return npc.rosterTier !== 'archived_creature';
}

export function scoreNpcForPrompt(npc = {}, { location = '', now = Date.now() } = {}) {
    if (!isPromptRosterNpc(npc)) return 0;

    let score = computeNpcImportance(npc) * 4;
    if (npc.pinned) score += 100;
    if (npc.lastSeen) {
        const ageHours = Math.max(0, (now - npc.lastSeen) / (1000 * 60 * 60));
        score += Math.max(0, 8 - ageHours / 12);
    }
    if (location && locationMatchesPlace(location, npc.lastLocation)) {
        score += 14;
    } else if (location && locationMatchesPlace(location, npc.basedIn)) {
        score += 8;
    } else if (cleanText(npc.basedIn)) {
        score += 2;
    }
    if (cleanText(npc.relationshipTension)) score += 6;
    if (Array.isArray(npc.callbackHooks) && npc.callbackHooks.length > 0) score += 4;
    if (Array.isArray(npc.relationshipHistory) && npc.relationshipHistory.length > 0) score += 3;
    if (cleanText(npc.agenda)) score += 2;
    return score;
}

export function curateNpcsForPrompt(npcs = [], { location = '', limit = 8, now = Date.now() } = {}) {
    const roster = (npcs || []).filter(isPromptRosterNpc);
    const pinned = roster.filter(n => n.pinned);
    const ranked = roster
        .map(npc => ({ npc, score: scoreNpcForPrompt(npc, { location, now }) }))
        .sort((a, b) => b.score - a.score);

    const chosen = [];
    const seen = new Set();
    for (const npc of pinned) {
        if (seen.has(npc.id)) continue;
        chosen.push(npc);
        seen.add(npc.id);
    }
    for (const { npc } of ranked) {
        if (chosen.length >= limit) break;
        if (seen.has(npc.id)) continue;
        chosen.push(npc);
        seen.add(npc.id);
    }
    return chosen;
}

export function formatNpcEmbeddingText(npc = {}) {
    const name = cleanText(npc.name);
    if (!name) return '';
    const notes = cleanText(npc.lastNotes || npc.notes);
    const tension = cleanText(npc.relationshipTension);
    const agenda = cleanText(npc.agenda);
    const basedIn = cleanText(npc.basedIn);
    const lastLocation = cleanText(npc.lastLocation);
    const parts = [`${name} (${npc.disposition || 'unknown'})`];
    if (basedIn) parts.push(`Based in: ${basedIn}`);
    if (lastLocation) parts.push(`Last seen: ${lastLocation}`);
    if (notes) parts.push(notes);
    if (tension) parts.push(`Tension: ${tension}`);
    if (agenda) parts.push(`Agenda: ${agenda}`);
    return parts.join(' | ').slice(0, 500);
}

export function listArchivableFodder(npcs = []) {
    return (npcs || []).filter(npc => {
        if (npc.rosterTier === 'archived_creature') return false;
        if (!isGenericCreatureName(npc.name)) return false;
        if (blocksFodderArchive(npc)) return false;
        return true;
    });
}

export function buildStoryMemoryPromotion(npc = {}) {
    if (!isPromptRosterNpc(npc)) return null;
    const name = cleanText(npc.name);
    if (!name) return null;

    const tension = cleanText(npc.relationshipTension);
    const hooks = Array.isArray(npc.callbackHooks) ? npc.callbackHooks.filter(Boolean) : [];
    const agenda = cleanText(npc.agenda);
    const notes = cleanText(npc.lastNotes || npc.notes);

    if (!tension && hooks.length === 0 && !agenda) return null;

    const textParts = [];
    if (tension) textParts.push(tension);
    if (agenda) textParts.push(`Agenda: ${agenda}`);
    if (hooks.length > 0) textParts.push(`Hooks: ${hooks.slice(0, 2).join('; ')}`);
    if (!textParts.length && notes) textParts.push(notes);

    const text = textParts.join(' ').slice(0, 260);
    if (!text) return null;

    const emotionalCharge = tension ? 4 : (hooks.length > 0 ? 3 : 2);
    const salience = npc.pinned ? 5 : (tension ? 4 : 3);

    return {
        type: tension ? 'relationship' : (agenda ? 'npcAgenda' : 'callback'),
        text,
        subject: name,
        tags: ['npc', 'roster'],
        salience,
        emotionalCharge,
        linkedNpcNames: [name],
        location: cleanText(npc.basedIn) || cleanText(npc.lastLocation) || undefined,
        source: 'npc_roster',
    };
}

/**
 * Strips leading common titles and articles case-insensitively to get the core name.
 */
export function getCoreNpcName(name) {
    if (!name) return '';
    let core = name.trim();
    let prev;
    do {
        prev = core;
        core = core.replace(/^(?:the|a|an|high\s+priest(?:ess)?|grand\s+master|lord\s+commander|first\s+mate|confessor|brother-in-arms|sister-in-arms|brother|sister|magister|father|mother|captain|lord|lady|commander|sir|baron|king|queen|elder|magistrate|inquisitor|officer|warden|sheriff|constable|priest(?:ess)?|acolyte|abbot|cardinal|bishop|magus|archmage|archmagus|baroness|duke|duchess|prince|princess|count|countess|emperor|empress|master|mistress|doctor|general|sergeant|corporal|lieutenant|guard|sentry|innkeeper|blacksmith|merchant|saint|st\.?)\b\s*/gi, '');
    } while (core !== prev);
    return core.trim().toLowerCase();
}

/**
 * Compares two NPC names, returning true if they are case-insensitive exact matches
 * or if their core names match after title-stripping.
 */
export function namesMatch(name1, name2) {
    if (!name1 || !name2) return false;
    const n1 = name1.toLowerCase();
    const n2 = name2.toLowerCase();
    if (n1 === n2) return true;

    const core1 = getCoreNpcName(name1);
    const core2 = getCoreNpcName(name2);
    return core1 && core2 && core1 === core2;
}