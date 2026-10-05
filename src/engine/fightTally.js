/**
 * The fight leaves a mark (WOW 2026-09-27, combat-drama slice B) and is
 * remembered (WOW 2026-09-28, fight memory): the cost tally the reducer keeps
 * on the combat envelope, and everything END_COMBAT and the narration prompt
 * read off it — the cost line, the wound card, the witnesses' bond moments,
 * the place's mark, the resonance cue. Pure and engine-judged: zero LLM
 * calls, no Scribe judgment. Split out of combatExchange.js on 2026-10-05;
 * `handlers/combat.js` and ChatPanel are the importers.
 */
import { HEALTH_CRITICAL_RATIO, enemyOutcome } from './enemyStats.js';
import { namesMatch, splitBondMoments } from './npcRoster.js';
import { conversationalDistance } from './replayLedger.js';

/**
 * The cost tally the reducer keeps on the combat envelope (`combat.fightTally`):
 * START_COMBAT seeds it from the live hero, APPLY_COMBAT_EXCHANGE folds each
 * committed result in through `recordExchangeCost`, the terminal narration
 * prompt carries `describeFightCost`'s ONE line, and END_COMBAT mints ONE
 * salience-4 `wound` story card through `buildFightWoundCard` when the fight
 * MARKED the party. Zero LLM calls; every number is the engine's own. Resources
 * are measured as a DIFF between the start snapshot and the live hero at the
 * end (`snapshotHeroResources`), so a potion drunk from the Inventory panel
 * and a Second Wind declared on the exchange wire count the same way without
 * a hook in either handler.
 */
/** A crit the hero TAKES is "big" — a fight memory of its own — at this share of max HP. */
const FIGHT_BIG_CRIT_RATIO = 0.5;
/** A fight memory resonates (the private cue in a LATER fight) only once it is
 * at least this many conversational messages old — the afterglow of the same
 * scene is the key-moments line's job, not the cue's. */
export const FIGHT_RESONANCE_MIN_DISTANCE = 24;
const MAX_TALLY_CRITS = 6;
const MAX_TALLY_NAMES = 6;
const MAX_TALLY_SAVES = 6;
const MAX_TALLY_KILLING_CRITS = 3;
const MAX_RESONANCE_LINES = 2;
const SAVE_HOWS = new Set(['revived', 'felled', 'intercepted']);
const TALLY_NAME_MAX = 100;
const TALLY_RESOURCE_KEY_MAX = 40;

function tallyName(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, TALLY_NAME_MAX) : '';
}

function finiteInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function isHealingConsumable(item) {
    return !!item && typeof item === 'object' && item.consumableType === 'healing';
}

/** `secondWind` → "Second Wind"; a key the class data never named still reads as words. */
function humanizeResourceKey(key) {
    return String(key)
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
}

function joinNames(names) {
    if (names.length <= 1) return names[0] || '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The hero's spendable state at one moment: class resources used, spell slots used, healing potions carried. */
export function snapshotHeroResources(character, inventory = []) {
    const resources = {};
    const classResources = character?.classResources;
    if (classResources && typeof classResources === 'object' && !Array.isArray(classResources)) {
        for (const [key, res] of Object.entries(classResources)) {
            if (!res || typeof res !== 'object' || !key) continue;
            resources[key.slice(0, TALLY_RESOURCE_KEY_MAX)] = Math.max(0, finiteInt(res.used, 0));
        }
    }
    const slots = character?.spellSlots;
    const slotsUsed = slots && typeof slots === 'object' && !Array.isArray(slots)
        ? Object.values(slots).reduce((sum, slot) => sum + Math.max(0, finiteInt(slot?.used, 0)), 0)
        : 0;
    const potions = (Array.isArray(inventory) ? inventory : [])
        .filter(isHealingConsumable)
        .reduce((sum, item) => sum + Math.max(1, finiteInt(item.quantity, 1)), 0);
    return { resources, slotsUsed, potions };
}

/**
 * Complete-or-null (the 2026-09-08 living-world rule): a stored tally is
 * untrusted input at load, and a half-typed one would render "undefined→3 HP"
 * into the AUTHORITATIVE terminal prompt.
 */
export function sanitizeFightTally(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const heroMaxHp = finiteInt(value.heroMaxHp, NaN);
    if (!Number.isFinite(heroMaxHp) || heroMaxHp < 1) return null;
    const heroHpStart = Math.max(0, finiteInt(value.heroHpStart, 0));
    const start = value.resourcesStart && typeof value.resourcesStart === 'object' && !Array.isArray(value.resourcesStart)
        ? value.resourcesStart
        : {};
    const resources = {};
    if (start.resources && typeof start.resources === 'object' && !Array.isArray(start.resources)) {
        for (const [key, used] of Object.entries(start.resources)) {
            if (!key || !Number.isFinite(Number(used))) continue;
            resources[key.slice(0, TALLY_RESOURCE_KEY_MAX)] = Math.max(0, finiteInt(used, 0));
        }
    }
    const critsTaken = (Array.isArray(value.critsTaken) ? value.critsTaken : [])
        .filter(crit => crit && typeof crit === 'object' && !Array.isArray(crit))
        .map(crit => ({
            by: tallyName(crit.by) || 'a foe',
            target: tallyName(crit.target) || 'the hero',
            damage: Math.max(0, finiteInt(crit.damage, 0)),
            round: Math.max(1, finiteInt(crit.round, 1)),
        }))
        .slice(0, MAX_TALLY_CRITS);
    const companionsDowned = [...new Set((Array.isArray(value.companionsDowned) ? value.companionsDowned : [])
        .map(tallyName).filter(Boolean))].slice(0, MAX_TALLY_NAMES);
    // The fight-memory fields (2026-09-28) default EMPTY on a pre-fix tally —
    // the ledger stays complete; only the memories it never recorded are absent.
    const witnesses = [...new Set((Array.isArray(value.witnesses) ? value.witnesses : [])
        .map(tallyName).filter(Boolean))].slice(0, MAX_TALLY_NAMES);
    const saves = (Array.isArray(value.saves) ? value.saves : [])
        .filter(save => save && typeof save === 'object' && !Array.isArray(save) && SAVE_HOWS.has(save.how))
        .map(save => ({
            how: save.how,
            by: tallyName(save.by),
            saved: tallyName(save.saved),
            detail: tallyName(save.detail),
            round: Math.max(1, finiteInt(save.round, 1)),
        }))
        .filter(save => save.by && save.saved)
        .slice(0, MAX_TALLY_SAVES);
    const heroKillingCrits = (Array.isArray(value.heroKillingCrits) ? value.heroKillingCrits : [])
        .filter(crit => crit && typeof crit === 'object' && !Array.isArray(crit))
        .map(crit => ({
            target: tallyName(crit.target) || 'a foe',
            damage: Math.max(0, finiteInt(crit.damage, 0)),
            round: Math.max(1, finiteInt(crit.round, 1)),
            decisive: crit.decisive === true,
        }))
        .slice(0, MAX_TALLY_KILLING_CRITS);
    return {
        heroHpStart,
        heroMaxHp,
        heroLowestHp: Math.max(0, Math.min(heroHpStart, finiteInt(value.heroLowestHp, heroHpStart))),
        heroDroppedRound: Number.isInteger(value.heroDroppedRound) && value.heroDroppedRound >= 1 ? value.heroDroppedRound : null,
        // The foe whose blow dropped the hero the LAST time (the last chapter,
        // 2026-09-30): the epitaph's killer when the clock then ran out.
        heroDroppedBy: tallyName(value.heroDroppedBy) || null,
        deathSaves: Math.max(0, finiteInt(value.deathSaves, 0)),
        critsTaken,
        companionsDowned,
        witnesses,
        saves,
        heroKillingCrits,
        heroLowExchangeId: typeof value.heroLowExchangeId === 'string' && value.heroLowExchangeId.trim()
            ? value.heroLowExchangeId.trim().slice(0, 80)
            : null,
        resourcesStart: {
            resources,
            slotsUsed: Math.max(0, finiteInt(start.slotsUsed, 0)),
            potions: Math.max(0, finiteInt(start.potions, 0)),
        },
        rounds: Math.max(1, finiteInt(value.rounds, 1)),
    };
}

/** START_COMBAT: the fight's opening ledger, from the live hero. */
export function startFightTally(state) {
    const character = state?.character || {};
    const hp = Math.max(0, finiteInt(character.currentHP, 0));
    return sanitizeFightTally({
        heroHpStart: hp,
        heroMaxHp: Math.max(1, finiteInt(character.maxHP, hp || 1)),
        heroLowestHp: hp,
        heroDroppedRound: null,
        heroDroppedBy: null,
        deathSaves: 0,
        critsTaken: [],
        companionsDowned: [],
        // Witnesses only (fight memory, 2026-09-28): the companions standing
        // here when the blades come out are the ones who can remember it.
        witnesses: (Array.isArray(state?.party) ? state.party : []).map(c => tallyName(c?.name)).filter(Boolean),
        saves: [],
        heroKillingCrits: [],
        heroLowExchangeId: null,
        resourcesStart: snapshotHeroResources(character, state?.inventory),
        rounds: 1,
    });
}

/**
 * APPLY_COMBAT_EXCHANGE: fold one committed result into the tally. Pure —
 * the caller passes the hero's HP and the party before and after the commit.
 * A crit is counted on the hero or a companion (the guard's intercepted blow
 * lands on the guardian and is theirs); a companion is "downed" when an attack
 * event leaves them at 0 or the party snapshot does.
 */
export function recordExchangeCost(tally, { result, heroName, hpBefore, hpAfter, partyBefore = [], partyAfter = [] } = {}) {
    const base = sanitizeFightTally(tally);
    if (!base || !result || typeof result !== 'object') return base;
    const hero = tallyName(heroName) || 'Player';
    const round = Math.max(base.rounds, finiteInt(result.round, base.rounds));
    const before = Array.isArray(partyBefore) ? partyBefore : [];
    const after = Array.isArray(partyAfter) ? partyAfter : [];
    const companionNames = new Set(before.map(c => tallyName(c?.name)).filter(Boolean));
    let lowest = base.heroLowestHp;
    if (Number.isFinite(hpAfter)) lowest = Math.min(lowest, Math.max(0, Math.trunc(hpAfter)));
    let droppedRound = base.heroDroppedRound;
    let droppedBy = base.heroDroppedBy;
    let deathSaves = base.deathSaves;
    const crits = [...base.critsTaken];
    const downed = [...base.companionsDowned];
    const saves = [...base.saves];
    const killingCrits = [...base.heroKillingCrits];
    const noteDowned = (name) => {
        if (name && !downed.includes(name) && downed.length < MAX_TALLY_NAMES) downed.push(name);
    };
    const noteSave = (save) => {
        if (saves.length < MAX_TALLY_SAVES) saves.push({ ...save, round });
    };
    const events = Array.isArray(result.events) ? result.events : [];
    // The hero is DOWN through the companion phase when they entered the
    // exchange at 0 and no natural 20 stood them up first (the revive lands
    // before the companions act — DECISIONS 2026-09-02).
    const heroDownThisExchange = Number.isFinite(hpBefore) && hpBefore <= 0
        && !events.some(event => event?.type === 'death_save' && event.natural === 20);
    const heroLowThisExchange = Number.isFinite(hpBefore) && hpBefore > 0 && hpBefore <= base.heroMaxHp * HEALTH_CRITICAL_RATIO;
    for (const event of events) {
        if (!event || typeof event !== 'object') continue;
        if (event.type === 'death_save') {
            deathSaves += 1;
            continue;
        }
        if (event.type !== 'attack' || !event.hit) continue;
        const target = tallyName(event.target);
        const actor = tallyName(event.actor);
        const remaining = finiteInt(event.remainingHp, NaN);
        const onHero = target === hero;
        const onCompanion = companionNames.has(target);
        if (!onHero && !onCompanion) {
            // A blow on a FOE: the hero's own killing crit, or a companion's
            // kill while the hero lay at 0 — the fight memories (2026-09-28).
            if (!Number.isFinite(remaining) || remaining > 0) continue;
            if (actor === hero && event.critical && killingCrits.length < MAX_TALLY_KILLING_CRITS) {
                killingCrits.push({ target: target || 'a foe', damage: Math.max(0, finiteInt(event.damage, 0)), round, decisive: result.terminal === 'victory' });
            } else if (heroDownThisExchange && companionNames.has(actor)) {
                noteSave({ how: 'felled', by: actor, saved: hero, detail: target || 'a foe' });
            }
            continue;
        }
        if (event.intercepted === true && onCompanion && heroLowThisExchange) {
            noteSave({ how: 'intercepted', by: target, saved: hero, detail: actor || 'a foe' });
        }
        if (onHero && Number.isFinite(remaining)) {
            lowest = Math.min(lowest, Math.max(0, remaining));
            if (remaining <= 0) {
                if (droppedRound === null) droppedRound = round;
                // The LAST dropper wins: a natural-20 revive and a second
                // drop make the second blow the one the clock ran out on.
                droppedBy = actor || droppedBy;
            }
        }
        if (onCompanion && Number.isFinite(remaining) && remaining <= 0) noteDowned(target);
        if (event.critical && crits.length < MAX_TALLY_CRITS) {
            crits.push({
                by: tallyName(event.actor) || 'a foe',
                target,
                damage: Math.max(0, finiteInt(event.damage, 0)),
                round,
            });
        }
    }
    if (Number.isFinite(hpBefore) && Number.isFinite(hpAfter) && hpBefore > 0 && hpAfter <= 0 && droppedRound === null) {
        droppedRound = round;
    }
    for (const companion of after) {
        const name = tallyName(companion?.name);
        if (!name) continue;
        const was = before.find(c => (companion.id != null && c?.id === companion.id) || tallyName(c?.name) === name);
        if (!was) continue;
        if ((companion?.hp ?? 0) <= 0) {
            if ((was.hp ?? 0) > 0) noteDowned(name);
        } else if ((was.hp ?? 0) <= 0 && hero) {
            // Only the hero heals mid-fight (companions attack, defend, guard
            // or pass): a companion back on their feet was the hero's doing.
            noteSave({ how: 'revived', by: hero, saved: name, detail: '' });
        }
    }
    // The exchange that first brought a standing hero to a quarter or less —
    // the resonance cue's second trigger (describeFightResonance).
    const lowRatio = base.heroMaxHp * HEALTH_CRITICAL_RATIO;
    const heroLowExchangeId = base.heroLowExchangeId
        || (base.heroLowestHp > lowRatio && lowest <= lowRatio && typeof result.exchangeId === 'string' ? result.exchangeId : null);
    return {
        ...base,
        heroLowestHp: lowest,
        heroDroppedRound: droppedRound,
        heroDroppedBy: droppedBy,
        deathSaves,
        critsTaken: crits,
        companionsDowned: downed,
        saves,
        heroKillingCrits: killingCrits,
        heroLowExchangeId,
        rounds: round,
    };
}

/** What the hero spent between the start snapshot and now, as short phrases. */
export function spentFightResources(tally, character, inventory = []) {
    const t = sanitizeFightTally(tally);
    if (!t) return [];
    const now = snapshotHeroResources(character, inventory);
    const spent = [];
    for (const [key, used] of Object.entries(now.resources)) {
        const delta = used - (t.resourcesStart.resources[key] ?? used);
        if (delta <= 0) continue;
        spent.push(delta > 1 ? `${humanizeResourceKey(key)} ×${delta}` : `${humanizeResourceKey(key)} spent`);
    }
    const slots = now.slotsUsed - t.resourcesStart.slotsUsed;
    if (slots > 0) spent.push(`${slots} spell slot${slots === 1 ? '' : 's'} spent`);
    const potions = t.resourcesStart.potions - now.potions;
    if (potions > 0) spent.push(`${potions} potion${potions === 1 ? '' : 's'} drunk`);
    return spent;
}

/** The cost line's word for each `enemyOutcome`. */
const FOE_OUTCOME_WORDS = Object.freeze({ defeated: 'slain', fled: 'fled', surrendered: 'surrendered', active: 'standing' });

function foeOutcomeCounts(enemies) {
    const counts = { slain: 0, fled: 0, surrendered: 0, standing: 0 };
    for (const enemy of Array.isArray(enemies) ? enemies : []) {
        if (!enemy || typeof enemy !== 'object') continue;
        counts[FOE_OUTCOME_WORDS[enemyOutcome(enemy)]] += 1;
    }
    return counts;
}

function summarizeFoeOutcomes(enemies) {
    const counts = foeOutcomeCounts(enemies);
    return ['slain', 'fled', 'surrendered', 'standing']
        .filter(key => counts[key] > 0)
        .map(key => `${counts[key]} ${key}`)
        .join(', ');
}

/** "the Goblin Cutter", "the Goblin Cutter and Wolf", "the Goblin Cutter and 3 others". */
function describeFoes(enemies) {
    const names = [...new Set((Array.isArray(enemies) ? enemies : []).map(e => tallyName(e?.name)).filter(Boolean))];
    if (names.length === 0) return 'the foes';
    if (names.length <= 2) return joinNames(names);
    return `${names[0]} and ${names.length - 1} others`;
}

/**
 * The ONE line the terminal narration prompt carries. `state` is the live
 * state at narration time (the exchange has committed; the hero's HP and
 * resources are post-fight).
 */
export function describeFightCost(tally, state) {
    const t = sanitizeFightTally(tally);
    if (!t || !state?.character) return null;
    const hero = tallyName(state.character.name) || 'The hero';
    const hpNow = Math.max(0, finiteInt(state.character.currentHP, 0));
    const notes = [];
    if (t.heroLowestHp < Math.min(t.heroHpStart, hpNow)) notes.push(`lowest ${t.heroLowestHp}`);
    if (t.heroDroppedRound !== null) {
        const saves = t.deathSaves ? `, ${t.deathSaves} death save${t.deathSaves === 1 ? '' : 's'}` : '';
        notes.push(`DOWN at 0 HP in round ${t.heroDroppedRound}${saves}`);
    }
    for (const crit of t.critsTaken) {
        const on = crit.target !== hero ? ` on ${crit.target}` : '';
        const dmg = crit.damage ? `, ${crit.damage} damage` : '';
        notes.push(`${crit.by}'s critical blow${on} in round ${crit.round}${dmg}`);
    }
    const parts = [`${hero} ${t.heroHpStart}→${hpNow} HP${notes.length ? ` (${notes.join('; ')})` : ''}`];
    if (t.companionsDowned.length > 0) parts.push(`${joinNames(t.companionsDowned)} downed`);
    const spent = spentFightResources(t, state.character, state.inventory);
    if (spent.length > 0) parts.push(spent.join(', '));
    const foes = summarizeFoeOutcomes(state.combat?.enemies);
    if (foes) parts.push(`foes: ${foes}`);
    parts.push(`${t.rounds} round${t.rounds === 1 ? '' : 's'}`);
    return `COST OF THIS FIGHT: ${parts.join('; ')}.`;
}

/**
 * A fight MARKS the party when the hero was dropped to 0, brought to a quarter
 * of their HP or less (from higher — a hero who walked in wounded and took
 * nothing is not marked), took a critical hit, or a companion went down.
 */
export function isMarkingFight(tally) {
    const t = sanitizeFightTally(tally);
    if (!t) return false;
    const heroDropped = t.heroDroppedRound !== null;
    const heroLow = t.heroLowestHp < t.heroHpStart && t.heroLowestHp <= t.heroMaxHp * HEALTH_CRITICAL_RATIO;
    return heroDropped || heroLow || t.critsTaken.length > 0 || t.companionsDowned.length > 0;
}

/**
 * END_COMBAT's ONE engine-minted `wound` card for a marking fight — narrative-
 * only by DECISIONS 2026-06-17 (no harm track): it rides DRAMATIC CALLBACK
 * OPPORTUNITIES so a later scene can name the wound, and the Scribe's
 * appearance merge can make the scar canon. `source: 'engine'` + the
 * `fight-cost` tag are what the dormancy pass keys on.
 */
export function buildFightWoundCard(tally, state, outcome = 'victory') {
    const t = sanitizeFightTally(tally);
    if (!t || !isMarkingFight(t) || !state?.character) return null;
    const hero = tallyName(state.character.name) || 'The hero';
    const foes = describeFoes(state.combat?.enemies);
    const place = tallyName(state.currentLocation);
    const verb = outcome === 'defeat' ? 'fell to' : outcome === 'escaped' ? 'fled from' : 'beat';
    const clauses = [];
    if (t.heroDroppedRound !== null) {
        clauses.push(`went down at 0 HP in round ${t.heroDroppedRound}${t.deathSaves ? ` and rolled ${t.deathSaves} death save${t.deathSaves === 1 ? '' : 's'}` : ''}`);
    } else if (t.heroLowestHp < t.heroHpStart) {
        clauses.push(`was cut down to ${t.heroLowestHp} of ${t.heroMaxHp} HP`);
    }
    const heroCrit = t.critsTaken.find(crit => crit.target === hero);
    if (heroCrit) clauses.push(`took ${heroCrit.by}'s critical blow in round ${heroCrit.round}`);
    const companionCrits = t.critsTaken.filter(crit => crit.target !== hero);
    const sentences = [`${hero} ${verb} ${foes}${place ? ` at ${place}` : ''}${clauses.length ? `, ${joinNames(clauses)}` : ''}.`];
    if (t.companionsDowned.length > 0) {
        sentences.push(`${joinNames(t.companionsDowned)} went down in the fight.`);
    } else if (companionCrits.length > 0) {
        sentences.push(`${companionCrits[0].target} took ${companionCrits[0].by}'s critical blow.`);
    }
    const spent = spentFightResources(t, state.character, state.inventory);
    if (spent.length > 0) sentences.push(`${spent.join(', ')}.`);
    sentences.push('The wound is fresh and unnamed.');
    return {
        type: 'wound',
        subject: `${hero}'s wound from ${foes}`.slice(0, 80),
        text: sentences.join(' ').slice(0, 260),
        salience: 4,
        emotionalCharge: 3,
        status: 'active',
        source: 'engine',
        tags: ['fight-cost', outcome],
        linkedNpcNames: t.companionsDowned.slice(0, 6),
        ...(place && { location: place }),
    };
}

// ─── The fight is remembered (WOW 2026-09-28, fight memory) ─────────────────
/**
 * Three deterministic patterns make a fight STRIKING, read from the tally the
 * exchanges already keep — no Scribe judgment, no extra call:
 *   5 — a life saved: the hero pulled a companion back from the ground, or a
 *       companion felled a foe while the hero lay at 0 (the fight was won);
 *   4 — a save at the edge: a companion took a blow meant for a hero at a
 *       quarter or less; the hero went down and the party carried the fight;
 *       the hero's critical blow ENDED the fight; a companion fought over the
 *       downed hero's body and still lost;
 *   3 — "lately": a companion's own fall in a won fight, a killing crit that
 *       did not end it, the hero cut to a quarter and the fight won, a big crit
 *       taken (≥ FIGHT_BIG_CRIT_RATIO of max HP).
 * The moment is minted on WITNESSES only (the party at START_COMBAT, still in
 * the party at the end), ONE per companion (the most salient), with the
 * direction said in plain words — who saved whom — so the Scribe's later
 * voice cannot get gratitude and pride backwards. Salience 4–5 is a KEY
 * moment (`splitBondMoments`): it rides the party line, the Companions card,
 * the ✦ quiet tell, and the resonance cue below; a 3 fades from "lately".
 */
function memoryPlace(place) {
    return place ? ` at ${place}` : '';
}

function fightMemoryFor(name, t, { hero, foes, place, outcome, others }) {
    const won = outcome === 'victory';
    const revived = t.saves.find(save => save.how === 'revived' && save.saved === name);
    if (revived) {
        return { kind: 'rescue', salience: 5, text: `${hero} pulled ${name} back from the ground mid-fight against ${foes}${memoryPlace(place)} — ${hero} saved ${name}'s life.` };
    }
    const felled = t.saves.find(save => save.how === 'felled' && save.by === name);
    if (felled && won) {
        return { kind: 'rescue', salience: 5, text: `${name} cut down ${felled.detail} while ${hero} lay at 0 HP against ${foes}${memoryPlace(place)} — ${name} kept ${hero} alive until it was won.` };
    }
    if (felled) {
        return { kind: 'shared_danger', salience: 4, text: `${name} fought on over ${hero}'s body against ${foes}${memoryPlace(place)}, felling ${felled.detail}, and still the fight was lost.` };
    }
    const intercepted = t.saves.find(save => save.how === 'intercepted' && save.by === name);
    if (intercepted) {
        return { kind: 'rescue', salience: 4, text: `${name} stepped into ${intercepted.detail}'s blow meant for ${hero}, who stood at ${t.heroLowestHp} of ${t.heroMaxHp} HP, against ${foes}${memoryPlace(place)} — ${name} took the hit for ${hero}.` };
    }
    if (t.heroDroppedRound !== null && won) {
        const with_ = others.length ? ` with ${joinNames(others)}` : ' alone';
        return { kind: 'shared_danger', salience: 4, text: `${hero} went down at 0 HP against ${foes}${memoryPlace(place)}; ${name}${with_} fought on until it was won.` };
    }
    const decisive = t.heroKillingCrits.find(crit => crit.decisive);
    if (decisive) {
        return { kind: 'shared_danger', salience: 4, text: `${hero}'s critical blow felled ${decisive.target} and ended the fight against ${foes}${memoryPlace(place)}, with ${name} there to see it.` };
    }
    if (t.companionsDowned.includes(name) && won) {
        return { kind: 'shared_danger', salience: 3, text: `${name} went down against ${foes}${memoryPlace(place)}; ${hero} carried the fight to its end.` };
    }
    if (t.heroKillingCrits.length > 0) {
        const crit = t.heroKillingCrits[0];
        return { kind: 'shared_danger', salience: 3, text: `${hero}'s critical blow felled ${crit.target} against ${foes}${memoryPlace(place)}, with ${name} fighting beside them.` };
    }
    const heroLow = t.heroLowestHp < t.heroHpStart && t.heroLowestHp <= t.heroMaxHp * HEALTH_CRITICAL_RATIO;
    if (heroLow && won) {
        return { kind: 'shared_danger', salience: 3, text: `${hero} was cut to ${t.heroLowestHp} of ${t.heroMaxHp} HP against ${foes}${memoryPlace(place)} and still won, ${name} beside them.` };
    }
    const bigCrit = t.critsTaken.find(crit => crit.target === hero && crit.damage >= t.heroMaxHp * FIGHT_BIG_CRIT_RATIO);
    if (bigCrit) {
        return { kind: 'shared_danger', salience: 3, text: `${name} watched ${bigCrit.by}'s critical blow take ${bigCrit.damage} HP off ${hero} in one stroke against ${foes}${memoryPlace(place)}.` };
    }
    return null;
}

/**
 * END_COMBAT's engine-minted bond moments: `[{ name, moment: { text, kind,
 * salience } }]`, one per witness companion still in the party, or `[]` for
 * a fight nobody will speak of. Pure; the reducer dispatches each through
 * UPDATE_NPC so the bond machinery (scene collapse, salience eviction, the
 * ✦ tell) treats it exactly like a Scribe moment.
 */
export function buildFightMemories(tally, state, outcome = 'victory') {
    const t = sanitizeFightTally(tally);
    if (!t || !state?.character || t.witnesses.length === 0) return [];
    const hero = tallyName(state.character.name) || 'The hero';
    const foes = describeFoes(state.combat?.enemies);
    const place = tallyName(state.currentLocation);
    const party = (Array.isArray(state.party) ? state.party : []).map(c => tallyName(c?.name)).filter(Boolean);
    const present = t.witnesses.filter(name => party.some(member => namesMatch(member, name)));
    const out = [];
    for (const name of present) {
        const others = present.filter(other => other !== name);
        const moment = fightMemoryFor(name, t, { hero, foes, place, outcome, others });
        if (moment) out.push({ name, moment: { ...moment, text: moment.text.slice(0, 220) } });
    }
    return out;
}

/**
 * The striking particular a PLACE keeps of the fight (≤ 160 chars) — rides
 * the encounter-ledger entry as `mark`, so regional hearsay repeats the thing
 * worth repeating ("went down and the dwarf fought on over the body") instead
 * of only who won. Null for a fight with nothing to tell.
 */
export function describeFightMark(tally, state, outcome = 'victory') {
    const t = sanitizeFightTally(tally);
    if (!t || !state?.character) return null;
    const hero = tallyName(state.character.name) || 'the hero';
    const won = outcome === 'victory';
    const revived = t.saves.find(save => save.how === 'revived');
    const felled = t.saves.find(save => save.how === 'felled');
    const intercepted = t.saves.find(save => save.how === 'intercepted');
    const decisive = t.heroKillingCrits.find(crit => crit.decisive);
    let mark = null;
    if (felled && won) mark = `${hero} went down and ${felled.by} fought on over the body until it was won`;
    else if (revived) mark = `${hero} brought ${revived.saved} back from the ground mid-fight`;
    else if (t.heroDroppedRound !== null && won) mark = `${hero} went down and the companions carried the fight`;
    else if (decisive) mark = `one blow of ${hero}'s ended it — ${decisive.target} felled outright`;
    else if (intercepted) mark = `${intercepted.by} took a blow meant for ${hero}`;
    else if (t.heroDroppedRound !== null) mark = `${hero} was left at 0 HP`;
    else if (t.companionsDowned.length > 0) mark = `${joinNames(t.companionsDowned)} went down`;
    else if (t.heroKillingCrits.length > 0) mark = `${hero}'s critical blow felled ${t.heroKillingCrits[0].target}`;
    // The last two marking kinds (grand playtest 2026-10-02): isMarkingFight
    // counts a hero cut to a quarter and any critical blow taken, and such a
    // fight minted its wound card while the place kept no mark for hearsay.
    else if (t.heroLowestHp < t.heroHpStart && t.heroLowestHp <= t.heroMaxHp * HEALTH_CRITICAL_RATIO) {
        mark = `${hero} was cut down to ${t.heroLowestHp} HP${won ? ' and still won' : ''}`;
    } else if (t.critsTaken.length > 0) mark = `${t.critsTaken[0].target} took ${t.critsTaken[0].by}'s critical blow`;
    return mark ? mark.slice(0, 160) : null;
}

/**
 * What a fight leaves behind, read off the tally ONCE — END_COMBAT calls this
 * before the envelope resets: the engine `wound` card (never for a dead hero —
 * the last chapter, 2026-09-30: the epitaph is the mark), the witnesses'
 * graded bond moments, and the particular the place keeps for hearsay.
 */
export function rememberFight(tally, state, outcome = 'victory') {
    return {
        woundCard: state?.character?.isDead ? null : buildFightWoundCard(tally, state, outcome),
        memories: buildFightMemories(tally, state, outcome),
        mark: describeFightMark(tally, state, outcome),
    };
}

const RESONANCE_KINDS = new Set(['rescue', 'shared_danger']);

/**
 * The resonance cue — where "way later" lands. On an ONGOING narration, at
 * the first exchange of a fight or the exchange that first cut the hero to a
 * quarter, a present standing companion who carries an OLD (≥
 * FIGHT_RESONANCE_MIN_DISTANCE conversational messages) rescue /
 * shared-danger KEY moment gets one private line: the echo shows in the next
 * dangerous moment, not at every campfire. ≤ 2 companions; null otherwise.
 * Engine-only, no call, never on a terminal beat.
 */
export function describeFightResonance(state, result) {
    if (!state?.combat?.active || !result || result.terminal) return null;
    const tally = sanitizeFightTally(state.combat.fightTally);
    const resolved = Array.isArray(state.combat.resolvedExchangeIds) ? state.combat.resolvedExchangeIds : [];
    const firstBeat = resolved.length <= 1;
    const lowBeat = !!tally?.heroLowExchangeId && tally.heroLowExchangeId === result.exchangeId;
    if (!firstBeat && !lowBeat) return null;
    const messages = Array.isArray(state.messages) ? state.messages : [];
    const now = messages.length;
    const npcs = Array.isArray(state.npcs) ? state.npcs : [];
    const lines = [];
    for (const companion of Array.isArray(state.party) ? state.party : []) {
        if (lines.length >= MAX_RESONANCE_LINES) break;
        const name = tallyName(companion?.name);
        if (!name || (companion?.hp ?? 0) <= 0 || companion?.status === 'downed') continue;
        const record = npcs.find(npc => namesMatch(npc?.name, name));
        if (!record) continue;
        const carried = splitBondMoments(record.bondMoments).key
            .filter(moment => RESONANCE_KINDS.has(moment.kind) && Number.isFinite(moment.salience) && moment.salience >= 4
                && Number.isFinite(moment.atMessage))
            .map(moment => ({ moment, distance: conversationalDistance(messages, moment.atMessage, now) }))
            .filter(entry => entry.distance >= FIGHT_RESONANCE_MIN_DISTANCE)
            .sort((a, b) => (b.moment.salience - a.moment.salience) || (a.distance - b.distance))[0];
        if (!carried) continue;
        const turns = Math.max(1, Math.round(carried.distance / 2));
        lines.push(`${name} carries this from ${turns} turns ago: "${carried.moment.text}"`);
    }
    if (lines.length === 0) return null;
    const when = lowBeat ? 'with the hero cut this low' : 'as the fight opens';
    return `FIGHT MEMORY (private, engine record): ${lines.join(' · ')} Let it show ${when} in ONE beat of their bearing or a single line in their own voice — never a speech, never narrator commentary, never a second mention this fight.`;
}

