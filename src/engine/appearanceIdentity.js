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

// "bald" names a HEAD only when nothing else claims the word (2026-10-29
// audit P1): a bald eagle on a tabard, a bald-faced lie and a bald tire locked
// a smooth scalp; a bald patch / spot is the balding state, judged below.
const BALD_PATTERN = /\bbald(?:[- ]headed)?\b(?![- ]?(?:eagle|eagles|patch|patches|spot|spots|tires?|tyres?|faced)\b)|\bshaved?[- ]?head\b|\bshaven[- ]?head(?:ed)?\b|\bhead (?:is |was )?(?:shaved|shaven|clean[- ]shaven)\b|\bshaved (?:her |his |their )?(?:head|scalp|skull)\b|\bhairless (?:head|scalp|skull)\b|\bsmooth (?:bare |shaved |shaven )?(?:scalp|skull|pate)\b|\bbare (?:scalp|skull|pate)\b|\bno hair\b|\bhead shaved\b|\bscalp shaved\b|\bcropped to the skin\b|\bstubbled scalp\b/i;
const BALDING_ONLY = /\bbalding\b|\breceding hairline\b|\bthinning hair\b|\bbald (?:patch|spot)\b/i;

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
// A massive warhammer, a fat purse and a stout chest (the box) locked the
// body too (2026-10-29 audit P1): the gear and the beasts join the list.
const NOT_BODY_NOUN = '(?!\\s+(?:[a-z-]+\\s+)?(?:scar|scars|line|lines|lip|lips|smile|mouth|nose|beard|moustache|mustache|brow|brows|eyebrow|eyebrows|finger|fingers|hand|hands|coat|cloak|blade|sword|dagger|axe|bow|rope|strip|layer|veil|voice|hair|braid|braids|cornrows|face|eyes|neck|waist|wrist|wrists|ankle|ankles|nail|nails|streak|streaks|stubble|door|wall|tail|warhammer|hammer|shield|club|mace|spear|staff|staves|purse|pack|sack|chest|book|tome|boot|boots|belt|buckle|ring|chain|gem|stone|horse|dog|hound|wolf|wolves|frame of the (?:door|window))s?\\b)';
const BUILD_PATTERN = new RegExp(`\\b(${BUILD_TERMS.map(t => t.replace(/[-\s]/g, '[-\\s]')).join('|')})\\b${NOT_BODY_NOUN}`, 'gi');
const BUILD_MAX = 3;

// An age word locks the PERSON, never the gear (2026-10-29 audit P1): "an old
// leather jerkin" locked elderly, "an ancient bronze amulet" too, "a child's
// wooden horse" locked a child. The bare age words (old / aged / ancient /
// elderly) need a person anchor — a person noun within two words after them,
// or a copula / degree phrase before them ("is old", "looks old", "grown
// old", "very old", "an old one") — and never an object noun right after;
// the words that NAME an old person (wizened, crone, greybeard) stay
// unconditional. "young" keeps locking on its own but gets the object guard.
const AGE_WORDS = '(?:elderly|ancient|aged|old)';
const PERSON_NOUN = '(?:woman|women|man|men|lady|ladies|gentleman|gentlemen|crone|hag|fellow|soldier|sailor|priest|priestess|merchant|farmer|fisher\\w*|elf|elves|dwarf|dwarves|orc|goblin|human|halfling|face|features|eyes|hands|voice|frame|body|figure|person|girl|boy|mother|father|grandmother|grandfather|widow|widower|veteran|beggar|guard|servant|witch|wife|husband|king|queen|lord|knight|warrior|wizard|scholar|healer|hunter|smith|innkeeper|one)';
// Garments, gear, places, relations — an age word before one of these names
// the thing, not the person wearing or holding it.
const NOT_OBJECT_NOUN = '(?!\\s+(?:[a-z-]+\\s+)?(?:jerkin|coat|cloak|boot|leather|amulet|sword|blade|book|tome|map|scar|wound|ruin|stone|tree|oak|pine|tower|house|inn|wall|road|bridge|song|habit|friend|debt|wine|ale|tunic|shirt|dress|gown|robe|hat|cap|helm|helmet|armou?r|mail|belt|bag|pack|satchel|purse|ring|chain|pendant|necklace|brooch|dagger|knife|axe|bow|staff|spear|shield|hammer|warhammer|lantern|lamp|pipe|key|coin|scroll|letter|parchment|ledger|journal|name|word|tale|story|stories|saying|joke|way|custom|grudge|quarrel|rivalry|rival|enemy|foe|comrade|crew|dog|hound|horse|mare|mule|cart|wagon|boat|ship|hull|net|rope|sail|dock|pier|mill|barn|farm|fort|keep|castle|temple|shrine|church|chapel|cellar|well|gate|door|path|trail|track|forest|wood|god|kingdom|empire|war|blood|magic|spell|curse|oath|vow|promise|law|lore|rite|burn|break|injury|injuries|fracture|limp|cut|bruise|silver|gold|iron|bronze|brass|copper|steel|wool|linen|silk|fur|hide|bone|wooden|toy|doll|drawing|game|trick|fashion|style|world|days|times|country|town|city|village|port|quarter|district|street|lane|market|square|family|line|lineage|house|clan|order|guild|faith|religion|tongue|language|dialect|script|rune|runes|sign|mark|brand|tattoo)s?\\b)';
// "an old, weathered face" / "an aged elven woman": the age word, at most two
// words, then a person noun — and nothing object-like straight after the age word.
const AGE_PERSON_ANCHOR = `\\b(?:very |extremely |quite |rather )?${AGE_WORDS}\\b${NOT_OBJECT_NOUN}(?:[,\\s]+[a-z-]+){0,2}?[,\\s]+${PERSON_NOUN}\\b`;
// "is old", "looks old", "grown old", "very old" — a predicate about the
// person; still never when an object noun follows ("a very old sword").
const AGE_COPULA_ANCHOR = `\\b(?:is|was|looks?|looked|looking|seems?|seemed|grown|grew|getting|gotten|very|extremely|quite|rather|too|so) ${AGE_WORDS}\\b${NOT_OBJECT_NOUN}`;
const AGE_RULES = [
    // "middle-aged" contains "aged": it must be judged before the elderly rule.
    { pattern: /\bmiddle[- ]aged\b|\bin (?:her|his|their) (?:forties|fifties)\b|\b(?:4\d|5\d|forty|fifty)(?:[- ]\w+)? years old\b|\bmatronly\b|\bgreying\b|\bgraying\b/i, lock: 'middle-aged' },
    { pattern: new RegExp(`${AGE_PERSON_ANCHOR}|${AGE_COPULA_ANCHOR}|\\b(?:an|the) old one\\b|\\b(?:wizened|crone|greybeard|graybeard)\\b|\\bin (?:her|his|their) (?:sixties|seventies|eighties|nineties)\\b|\\b(?:[6-9]\\d|1\\d\\d|sixty|seventy|eighty|ninety)(?:[- ]\\w+)? years old\\b`, 'i'), lock: 'elderly' },
    { pattern: new RegExp(`\\b(?:very )?young\\b${NOT_OBJECT_NOUN}|\\byouthful\\b|\\bteenage(?:d)?\\b|\\badolescent\\b|\\bin (?:her|his|their) (?:teens|twenties)\\b|\\b(?:1[3-9]|2\\d|eighteen|nineteen|twenty)(?:[- ]\\w+)? years old\\b|\\bboyish\\b|\\bgirlish\\b|\\bbarely (?:grown|adult|of age)\\b`, 'i'), lock: 'young adult' },
    // "child" only as the head noun of the person: never the possessive
    // ("a child's wooden horse"), never a compound ("child-sized"), never a
    // past self ("as a child", "when she was a child"), never before an object.
    { pattern: new RegExp(`(?<!\\bas a )(?<!\\bwas a )(?<!\\bwere a )\\bchild\\b(?!['’]s?\\b)(?!-)${NOT_OBJECT_NOUN}|\\blittle (?:girl|boy)\\b|\\bsmall (?:girl|boy)\\b|\\btoddler\\b|\\binfant\\b`, 'i'), lock: 'a child' },
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
