/**
 * Identity lock for generated art (2026-09-12).
 *
 * The appearance record is free prose, and image models drift on exactly the
 * features that make a person recognizable: skin tone ("black" read as a
 * clothing color or lightened to a generic figure), hair state (a bald head
 * quietly given cornrows), build (statuesque painted heavy), and age. Gender
 * and species already ride beside the name as an inviolable tag
 * (DECISIONS.md 2026-07-25); this module gives the same treatment to the rest
 * of the recorded look — deterministically, from the record itself, so no
 * LLM paraphrase sits between the canon and the painter.
 *
 * `extractIdentityLocks(appearance)` finds the identity-defining features the
 * record states and normalizes each into the least ambiguous wording an image
 * model responds to ("black woman" → "deep dark brown skin"; "shaved head" →
 * "completely bald, a smooth shaved scalp with no hair at all"). Nothing is
 * ever inferred — a record that never states skin tone yields no skin lock.
 * `buildIdentityLockLine` renders the lead line every portrait / scene prompt
 * opens with.
 */

const SKIN_RULES = [
    // Order matters: the first matching rule wins for skin tone. Hair colors
    // ("black hair", "white hair") must never read as skin — every pattern
    // below anchors on a skin/person noun or a "-skinned" compound.
    { pattern: /\b(?:very |deep |rich )?dark[- ]skin(?:ned)?\b|\bdark (?:brown |umber |ebony )?skin\b|\bebony(?:[- ]skin(?:ned)?)?\b|\b(?:deep|rich|dark) brown skin\b|\bblack[- ]skin(?:ned)?\b|\bblack (?:woman|man|girl|boy|person|lady|gentleman|youth|elder|fellow|features|complexion)\b|\bumber skin\b|\bmahogany skin\b|\bonyx skin\b|\bof african (?:descent|features|cast)\b/i, lock: 'deep dark brown skin' },
    { pattern: /\bbrown[- ]skin(?:ned)?\b|\b(?:warm |medium |light )?brown skin\b|\bbrown (?:woman|man|complexion)\b|\bcopper[- ]skin(?:ned)?\b|\bcopper skin\b|\bcaramel skin\b|\bsienna skin\b|\bterracotta skin\b/i, lock: 'brown skin' },
    { pattern: /\bolive[- ]skin(?:ned)?\b|\bolive (?:skin|complexion)\b/i, lock: 'olive skin' },
    { pattern: /\b(?:sun[- ]?)?tan(?:ned)?[- ]skin(?:ned)?\b|\btanned\b|\bbronze(?:d)?[- ]skin(?:ned)?\b|\bbronze skin\b|\bgolden[- ]brown skin\b|\bweathered brown skin\b/i, lock: 'tanned bronze skin' },
    { pattern: /\bpale[- ]skin(?:ned)?\b|\bpale (?:skin|complexion)\b|\bfair[- ]skin(?:ned)?\b|\bfair (?:skin|complexion)\b|\bwhite[- ]skin(?:ned)?\b|\bwhite (?:woman|man|girl|boy|complexion)\b|\bmilk[- ]white skin\b|\bporcelain skin\b|\bivory skin\b|\balabaster skin\b|\bpallid\b|\bpasty\b/i, lock: 'pale skin' },
    { pattern: /\bruddy(?:[- ]skin(?:ned)?| complexion| face)?\b|\bflorid\b/i, lock: 'ruddy skin' },
    { pattern: /\bsallow\b|\bjaundiced\b|\byellowish skin\b/i, lock: 'sallow skin' },
    { pattern: /\bashen(?:[- ]skin(?:ned)?)?\b|\bgrey[- ]skin(?:ned)?\b|\bgray[- ]skin(?:ned)?\b|\bgr[ae]y skin\b/i, lock: 'grey ashen skin' },
    { pattern: /\bgreen[- ]skin(?:ned)?\b|\bgreen skin\b/i, lock: 'green skin' },
    { pattern: /\bblue[- ]skin(?:ned)?\b|\bblue skin\b/i, lock: 'blue skin' },
    { pattern: /\bred[- ]skin(?:ned)?\b|\bcrimson skin\b/i, lock: 'red skin' },
];

const BALD_PATTERN = /\bbald(?:[- ]headed)?\b|\bshaved?[- ]?head\b|\bshaven[- ]?head(?:ed)?\b|\bhead (?:is |was )?(?:shaved|shaven|clean[- ]shaven)\b|\bshaved (?:her |his |their )?(?:head|scalp|skull)\b|\bhairless (?:head|scalp|skull)\b|\bsmooth (?:bare |shaved |shaven )?(?:scalp|skull|pate)\b|\bbare (?:scalp|skull|pate)\b|\bno hair\b|\bhead shaved\b|\bscalp shaved\b|\bcropped to the skin\b|\bstubbled scalp\b/i;
const BALDING_ONLY = /\bbalding\b|\breceding hairline\b|\bthinning hair\b/i;

const HAIR_NOUNS = 'hair|braids|braid|cornrows|locs|dreadlocks|dreads|curls|ringlets|ponytail|topknot|mohawk|plaits|plait|bun|mane|tresses|afro|buzz cut|crew cut|undercut|pigtails';
// Up to three descriptive words before the hair noun ("long white hair",
// "salt-bleached brown hair", "tight grey cornrows"), no crossing a clause.
const HAIR_PATTERN = new RegExp(`\\b((?:[a-z][a-z-]*\\s+){0,3}?(?:${HAIR_NOUNS}))\\b`, 'i');
// Function words that must not lead a captured hair phrase.
const HAIR_STOP_LEAD = /^(?:the|a|an|her|his|their|its|with|and|of|in|into|has|had|have|wears|wearing|worn|some|no|any|whose|that|which)\s+/i;

const BUILD_TERMS = [
    'statuesque', 'towering', 'very tall', 'tall', 'broad-shouldered', 'broad shouldered', 'muscular', 'brawny', 'burly', 'heavyset',
    'heavy-set', 'stout', 'thickset', 'thick-set', 'obese', 'fat', 'plump', 'portly', 'rotund', 'corpulent', 'voluptuous', 'curvaceous',
    'buxom', 'slender', 'slim', 'lean', 'lanky', 'rangy', 'wiry', 'willowy', 'thin', 'skinny', 'scrawny', 'gaunt', 'emaciated', 'bony',
    'petite', 'diminutive', 'short', 'squat', 'stocky', 'athletic', 'sinewy', 'hulking', 'massive', 'big-boned', 'small-framed',
    'hunched', 'hunchbacked', 'stooped', 'pot-bellied', 'potbellied', 'barrel-chested', 'barrel chested',
];
// A build word describing something other than the body must not lock the
// body: "a thin scar", "short hair", "a lean smile", "a massive sword".
const NOT_BODY_NOUN = '(?!\\s+(?:[a-z-]+\\s+)?(?:scar|scars|line|lines|lip|lips|smile|mouth|nose|beard|moustache|mustache|brow|brows|eyebrow|eyebrows|finger|fingers|hand|hands|coat|cloak|blade|sword|dagger|axe|bow|rope|strip|layer|veil|voice|hair|braid|braids|cornrows|face|eyes|neck|waist|wrist|wrists|ankle|ankles|nail|nails|streak|streaks|stubble|door|wall|tail)s?\\b)';
const BUILD_PATTERN = new RegExp(`\\b(${BUILD_TERMS.map(t => t.replace(/[-\s]/g, '[-\\s]')).join('|')})\\b${NOT_BODY_NOUN}`, 'gi');
const BUILD_MAX = 3;

const AGE_RULES = [
    // "middle-aged" contains "aged": it must be judged before the elderly rule.
    { pattern: /\bmiddle[- ]aged\b|\bin (?:her|his|their) (?:forties|fifties)\b|\bmatronly\b|\bgreying\b|\bgraying\b/i, lock: 'middle-aged' },
    { pattern: /\b(?:very |extremely )?(?:elderly|ancient|aged|old|wizened|crone|greybeard|graybeard)\b|\bin (?:her|his|their) (?:sixties|seventies|eighties|nineties)\b|\b(?:an old|the old) (?:woman|man)\b/i, lock: 'elderly' },
    { pattern: /\b(?:very )?young\b|\byouthful\b|\bteenage(?:d)?\b|\badolescent\b|\bin (?:her|his|their) (?:teens|twenties)\b|\bboyish\b|\bgirlish\b|\bbarely (?:grown|adult|of age)\b/i, lock: 'young adult' },
    { pattern: /\bchild\b|\blittle (?:girl|boy)\b|\bsmall (?:girl|boy)\b|\btoddler\b|\binfant\b/i, lock: 'a child' },
];

const clean = value => (typeof value === 'string' ? value.trim() : '');

function skinLock(text) {
    for (const rule of SKIN_RULES) {
        if (rule.pattern.test(text)) return rule.lock;
    }
    return '';
}

function hairLock(text) {
    if (BALDING_ONLY.test(text) && !BALD_PATTERN.test(text)) return 'balding with a receding hairline';
    if (BALD_PATTERN.test(text)) {
        return 'completely bald — a smooth shaved scalp with no hair at all (no braids, no cornrows, no stubble of a hairstyle)';
    }
    const match = text.match(HAIR_PATTERN);
    if (!match) return '';
    let phrase = match[1].replace(/\s+/g, ' ').trim();
    // Strip a leading function word the greedy prefix may have caught.
    while (HAIR_STOP_LEAD.test(phrase)) phrase = phrase.replace(HAIR_STOP_LEAD, '');
    if (!phrase || /^(?:hair|braids|braid|curls|bun)$/i.test(phrase)) return '';
    return `${phrase.toLowerCase()} as recorded`;
}

function buildLock(text) {
    const seen = new Set();
    const terms = [];
    for (const match of text.matchAll(BUILD_PATTERN)) {
        const term = match[1].toLowerCase().replace(/\s+/g, '-');
        // "very tall" and "tall" are one feature; keep the stronger first hit.
        const key = term.replace(/^very-/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        terms.push(term.replace(/-/g, ' '));
        if (terms.length >= BUILD_MAX) break;
    }
    return terms.length ? `${terms.join(', ')} build` : '';
}

function ageLock(text) {
    for (const rule of AGE_RULES) {
        if (rule.pattern.test(text)) return rule.lock;
    }
    return '';
}

/**
 * The identity-defining features an appearance record states, normalized.
 * @returns {{ skin: string, hair: string, build: string, age: string }}
 */
export function extractIdentityLocks(appearance) {
    const text = clean(appearance);
    if (!text) return { skin: '', hair: '', build: '', age: '' };
    return {
        skin: skinLock(text),
        hair: hairLock(text),
        build: buildLock(text),
        age: ageLock(text),
    };
}

/**
 * The lead line a portrait or scene prompt opens with for one character:
 * "IDENTITY LOCK — Name (goblin woman): deep dark brown skin; completely bald …;
 * tall, statuesque build. Non-negotiable: every one of these must read
 * unmistakably in the image." Empty when the record states none of them and
 * no species/gender tag is registered — nothing is ever inferred.
 */
export function buildIdentityLockLine(name, appearance, { species = '', gender = '' } = {}) {
    const locks = extractIdentityLocks(appearance);
    const identity = [clean(species), clean(gender)].filter(Boolean).join(' ');
    const parts = [identity, locks.skin, locks.hair, locks.build, locks.age].filter(Boolean);
    if (parts.length === 0) return '';
    const who = clean(name) || 'this character';
    return `IDENTITY LOCK — ${who}: ${parts.join('; ')}. Non-negotiable: every one of these must read unmistakably in the image; never substitute a different skin tone, hairstyle, body type, age, gender, or species.`;
}

/** The one-line reminder that closes a prompt carrying an identity lock. */
export const IDENTITY_LOCK_REMINDER = 'Honor every IDENTITY LOCK above exactly.';
