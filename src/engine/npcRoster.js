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

/** One recorded personal beat between the hero and an NPC. */
export const NPC_BOND_MOMENT_MAX = 220;
export const MAX_NPC_BOND_MOMENTS = 8;

const BOND_STOP_WORDS = new Set([
    'the', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'was', 'were', 'and', 'or',
    'that', 'this', 'it', 'its', 'their', 'his', 'her', 'has', 'have', 'had',
    'by', 'for', 'with', 'at', 'on', 'as', 'be', 'been', 'from', 'now', 'not', 'no',
    'hero', 'player',
]);

function meaningfulTokens(text) {
    const normalized = String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return new Set(normalized.split(' ').filter(token => token && !BOND_STOP_WORDS.has(token)));
}

/** True when `container` holds at least `threshold` of `contained`'s meaningful tokens. */
function coversTokens(container, contained, threshold) {
    if (contained.size === 0) return true;
    if (container.size === 0) return false;
    let overlap = 0;
    for (const token of contained) {
        if (container.has(token)) overlap += 1;
    }
    return overlap / contained.size >= threshold;
}

/** Same containment heuristic as the world-fact dedupe: a text whose meaningful
 * tokens are ~all inside an existing one is a restatement, not new material.
 * Exported for capped append-only lists elsewhere (companion keepsakes). */
export function isNearDuplicateText(candidate, existingText) {
    const tokens = meaningfulTokens(candidate);
    const existing = meaningfulTokens(existingText);
    if (tokens.size === 0) return true;
    if (existing.size === 0) return false;
    const small = tokens.size <= existing.size ? tokens : existing;
    const large = tokens.size <= existing.size ? existing : tokens;
    return coversTokens(large, small, 0.9);
}

export function normalizeBondMoments(list = []) {
    return (Array.isArray(list) ? list : [])
        .map(entry => {
            const text = clampNpcDossierField(
                typeof entry === 'string' ? entry : entry?.text,
                NPC_BOND_MOMENT_MAX,
            );
            if (!text) return null;
            const at = Number.isFinite(entry?.at) ? entry.at : Date.now();
            return { text, at };
        })
        .filter(Boolean)
        .slice(-MAX_NPC_BOND_MOMENTS);
}

/** Append-only merge: new beats join the record, restatements are dropped,
 * and the list never exceeds its cap (oldest fall off first). */
export function appendBondMoments(existing = [], additions = []) {
    let next = normalizeBondMoments(existing);
    for (const addition of normalizeBondMoments(additions)) {
        if (next.some(moment => isNearDuplicateText(addition.text, moment.text))) continue;
        next = [...next, addition];
    }
    return next.slice(-MAX_NPC_BOND_MOMENTS);
}

/**
 * Durable dossier prose (personality, goals, secrets, stance toward the hero)
 * ACCUMULATES — live play showed per-turn Scribe/DM fragments ("impressed by the
 * hero's swordplay just now") wholesale replacing a rich record and erasing the
 * relationship's history every exchange. Deterministic merge policy:
 * - incoming covers the known record's tokens → a complete rewrite; replace
 * - known record covers the incoming tokens → a restatement; keep the record
 * - otherwise genuinely new material → append chronologically
 * When an append exceeds the cap, the OLDEST sentences fall off first so the
 * newest canon always survives.
 */
export const NPC_DURABLE_TEXT_FIELDS = ['personality', 'goals', 'secrets', 'stanceToPlayer'];

function dropLeadingSentence(text) {
    const match = text.match(/^[^.!?…]*[.!?…]+["')\]]*\s+/);
    if (!match || match[0].length >= text.length) return null;
    return text.slice(match[0].length).trim();
}

export function mergeNpcDossierText(existingText, incomingText, max = NPC_DOSSIER_FIELD_MAX) {
    const prev = clampNpcDossierField(existingText, max);
    const next = clampNpcDossierField(incomingText, max);
    if (!prev) return next;
    if (!next) return prev;

    const prevTokens = meaningfulTokens(prev);
    const nextTokens = meaningfulTokens(next);
    if (coversTokens(nextTokens, prevTokens, 0.85)) return next;
    if (coversTokens(prevTokens, nextTokens, 0.85)) return prev;

    let merged = /[.!?…]["')\]]*$/.test(prev) ? `${prev} ${next}` : `${prev}; ${next}`;
    while (merged.length > max) {
        const shorter = dropLeadingSentence(merged);
        if (!shorter) return clampNpcDossierField(merged, max);
        merged = shorter;
    }
    return merged;
}

/** Callback hooks are a rolling shortlist, not a per-turn scratchpad: new hooks
 * join the record, restatements are dropped, and the oldest fall off at the cap. */
export const MAX_NPC_CALLBACK_HOOKS = 5;

export function appendCallbackHooks(existing = [], additions = []) {
    const clean = list => (Array.isArray(list) ? list : [])
        .map(hook => clampNpcDossierField(typeof hook === 'string' ? hook : hook?.text, NPC_HOOK_FIELD_MAX))
        .filter(Boolean);
    let next = clean(existing);
    for (const hook of clean(additions)) {
        if (next.some(existingHook => isNearDuplicateText(hook, existingHook))) continue;
        next = [...next, hook];
    }
    return next.slice(-MAX_NPC_CALLBACK_HOOKS);
}

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
    if (cleanText(npc.stanceToPlayer)) return true;
    if (Array.isArray(npc.bondMoments) && npc.bondMoments.length > 0) return true;
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
        || cleanText(npc.stanceToPlayer)
        || (Array.isArray(npc.bondMoments) && npc.bondMoments.length > 0)
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
    // A personal bond with the hero is exactly what should keep an NPC in memory.
    if (cleanText(npc.stanceToPlayer)) score += 2;
    if (Array.isArray(npc.bondMoments) && npc.bondMoments.length > 0) score += 1;
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
        stanceToPlayer: '',
        bondMoments: [],
        trust: null,
        privateNotes: '',
        callbackHooks: [],
        ...npc,
    };
    merged.bondMoments = normalizeBondMoments(merged.bondMoments);
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
    if (cleanText(npc.stanceToPlayer)) score += 6;
    if (Array.isArray(npc.bondMoments) && npc.bondMoments.length > 0) score += 2;
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
    const stance = cleanText(npc.stanceToPlayer);
    const agenda = cleanText(npc.agenda);
    const basedIn = cleanText(npc.basedIn);
    const lastLocation = cleanText(npc.lastLocation);
    const appearance = cleanText(npc.appearance);
    const parts = [`${name} (${npc.disposition || 'unknown'})`];
    if (appearance) parts.push(`Looks: ${appearance.slice(0, 160)}`);
    if (basedIn) parts.push(`Based in: ${basedIn}`);
    if (lastLocation) parts.push(`Last seen: ${lastLocation}`);
    if (notes) parts.push(notes);
    if (stance) parts.push(`Toward the hero: ${stance.slice(0, 160)}`);
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
    const stance = cleanText(npc.stanceToPlayer);
    const hooks = Array.isArray(npc.callbackHooks) ? npc.callbackHooks.filter(Boolean) : [];
    const agenda = cleanText(npc.agenda);
    const notes = cleanText(npc.lastNotes || npc.notes);

    if (!tension && !stance && hooks.length === 0 && !agenda) return null;

    const textParts = [];
    if (stance) textParts.push(`Toward the hero: ${stance}`);
    if (tension) textParts.push(tension);
    if (agenda) textParts.push(`Agenda: ${agenda}`);
    if (hooks.length > 0) textParts.push(`Hooks: ${hooks.slice(0, 2).join('; ')}`);
    if (!textParts.length && notes) textParts.push(notes);

    const text = textParts.join(' ').slice(0, 260);
    if (!text) return null;

    const emotionalCharge = (tension || stance) ? 4 : (hooks.length > 0 ? 3 : 2);
    const salience = npc.pinned ? 5 : ((tension || stance) ? 4 : 3);

    return {
        type: (tension || stance) ? 'relationship' : (agenda ? 'npcAgenda' : 'callback'),
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

const NAME_STOP_TOKENS = new Set(['the', 'a', 'an', 'of', 'von', 'van', 'de', 'da', 'la', 'le']);

function meaningfulNameTokens(name) {
    return getCoreNpcName(name)
        .split(/[^a-z0-9']+/)
        .filter(token => token.length > 1 && !NAME_STOP_TOKENS.has(token));
}

/**
 * Compares two NPC names, returning true if they are case-insensitive exact matches,
 * if their core names match after title-stripping, or if one name's meaningful
 * tokens are contained in the other's ("Saima" ⊂ "Saima Aallotar").
 *
 * The containment rule is the roster fork guard (2026-07-23 romance playtest: the DM
 * narrative alternated "Saima" / "Saima Aallotar" and the roster split one woman into
 * separate records, each holding half the relationship history). Same tradeoff the
 * location registry accepted for containment folding: two distinct same-campaign NPCs
 * sharing a first name is rarer and cheaper than every long-named NPC forking. Generic
 * creature/role names ("Guard", "a bandit") never containment-match — only proper names
 * fold, and title-only names strip to zero tokens so they cannot match anything.
 */
export function namesMatch(name1, name2) {
    if (!name1 || !name2) return false;
    const n1 = name1.toLowerCase();
    const n2 = name2.toLowerCase();
    if (n1 === n2) return true;

    const core1 = getCoreNpcName(name1);
    const core2 = getCoreNpcName(name2);
    if (core1 && core2 && core1 === core2) return true;

    const tokens1 = meaningfulNameTokens(name1);
    const tokens2 = meaningfulNameTokens(name2);
    const [shortTokens, longTokens, shortName] = tokens1.length <= tokens2.length
        ? [tokens1, tokens2, name1]
        : [tokens2, tokens1, name2];
    if (shortTokens.length === 0) return false;
    if (isGenericCreatureName(shortName)) return false;
    const longSet = new Set(longTokens);
    return shortTokens.every(token => longSet.has(token));
}

/**
 * Fold same-person roster records that forked before the namesMatch containment
 * rule existed (LOAD_GAME heal, the dedupeLocationRecords pattern). The record
 * with the LONGER name keeps its identity; dossier prose merges through the
 * normal fragment/restatement policy, bond moments and hooks union with their
 * own dedupe, and current-state fields come from whichever record was seen last.
 */
export function dedupeNpcRoster(npcs = []) {
    const kept = [];
    for (const raw of npcs) {
        const npc = raw || {};
        const matchIdx = kept.findIndex(existing => namesMatch(existing.name, npc.name));
        if (matchIdx === -1) {
            kept.push(npc);
            continue;
        }
        const other = kept[matchIdx];
        // `newer` drives current-state fields; `base` is the other record.
        const [base, newer] = (npc.lastSeen || 0) >= (other.lastSeen || 0) ? [other, npc] : [npc, other];
        const longerName = (String(npc.name || '').length > String(other.name || '').length ? npc.name : other.name);
        const merged = {
            ...base,
            ...pruneRecordBlanks(newer),
            name: longerName,
            id: other.id || npc.id,
            firstMet: Math.min(base.firstMet || Infinity, newer.firstMet || Infinity) === Infinity
                ? undefined
                : Math.min(base.firstMet || Infinity, newer.firstMet || Infinity),
            lastSeen: Math.max(base.lastSeen || 0, newer.lastSeen || 0) || undefined,
            pinned: !!(base.pinned || newer.pinned),
            trust: Number.isFinite(newer.trust) ? newer.trust : base.trust,
            kind: base.kind === 'character' || newer.kind === 'character' ? 'character' : (newer.kind || base.kind),
            rosterTier: base.rosterTier === 'character' || newer.rosterTier === 'character'
                ? 'character'
                : (newer.rosterTier || base.rosterTier),
            bondMoments: appendBondMoments(base.bondMoments, newer.bondMoments),
            callbackHooks: appendCallbackHooks(base.callbackHooks, newer.callbackHooks),
            knownFacts: [...new Set([...(base.knownFacts || []), ...(newer.knownFacts || [])])],
            relationshipHistory: [...(base.relationshipHistory || []), ...(newer.relationshipHistory || [])]
                .sort((a, b) => (a.at || 0) - (b.at || 0)),
        };
        for (const field of NPC_DURABLE_TEXT_FIELDS) {
            merged[field] = mergeNpcDossierText(base[field], newer[field]);
        }
        kept[matchIdx] = normalizeNpcRecord(merged);
    }
    return kept;
}

function pruneRecordBlanks(record) {
    const out = {};
    for (const [key, value] of Object.entries(record)) {
        if (value === '' || value === null || value === undefined) continue;
        out[key] = value;
    }
    return out;
}