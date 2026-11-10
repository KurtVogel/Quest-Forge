/**
 * Character domain: creation/update, ability score improvements, damage &
 * healing, the death-save state machine, XP/levels, and conditions.
 */
import { addConditionCapped, computeACFromInventory, getModifier, normalizeConditionName, CONDITION_LIST_CAP } from '../../engine/rules.js';
import { judgeDeathSave } from '../../engine/deathSaves.js';
import { ABILITY_NAMES, normalizeAbilityScoreImprovementState, normalizeFightingStyle, normalizeMartialArchetype } from '../../engine/characterUtils.js';
import { foldExperience, getDmBonusXpCap, getStoryMilestoneXp, isHeroDown, isMaxLevel } from '../../engine/progression.js';
import { sanitizePortraitUrl } from '../../engine/portraitUrl.js';
import { mergeNpcAppearance } from '../../engine/npcRoster.js';
import { CHARACTER_APPEARANCE_MAX, cleanTextField } from '../../config/contentLimits.js';
import { isRecord } from '../../engine/text.js';
import {
    applyDeath,
    applyEarlyDefeat,
    currentMessageIndex,
    findRecentTransactionDuplicate,
    isLowLevelSolo,
    isStaleCampaignAction,
    rememberTransaction,
    reviveCharacter,
    systemMessage,
    withCondition,
    withInventoryAndAC,
} from './shared.js';
import { gameReducer } from '../gameReducer.js';
import { repeatCard, repeatContext } from './ledger.js';

/**
 * The last chapter (2026-09-30): a death that ends OUTSIDE a fight (the
 * resolver's death save, a fatal blow while dying) has no END_COMBAT to write
 * its epitaph, so the death route writes it at once. Inside a fight the
 * envelope is still live — END_COMBAT posts the epitaph after the terminal
 * narration, and RECORD_HERO_DEATH is idempotent either way.
 */
function recordDeathOutsideCombat(state, cause) {
    if (state.combat?.active) return state;
    return gameReducer(state, { type: 'RECORD_HERO_DEATH', payload: { cause } });
}

// XP replay ledger (2026-08-26, Vesa's live report: "asked the DM for the XP it
// forgot, it promised it on my next action, then awarded the same amount on the
// TWO next turns"). The DECISIONS.md 2026-07-21 exemption for exp_awarded ended
// on that observation, per its own escape clause. XP is gain-side, so the coin
// asymmetry rule keeps the window TIGHT (the coin-grant 4, not the loss 12):
// over-suppressing a reward robs the player; the visible "Duplicate XP award
// ignored" line plus the repeat-intent escape hatch ("award it again") make a
// rare false positive one sentence to fix. Guards only DM-path dispatches
// (payload carries _meta) — engine-computed XP (combat, quests, fronts) is
// one-shot by construction and must never be suppressed.
// ONE replay window for every gain (2026-10-31, Vesa: doubles are "the worst
// problem for the game, always"): the 4-message gain windows rested on "never
// refuse to give on suspicion", and a recap five messages later paid twice.
// Gains now guard as long as spends (12 conversational messages); an
// explicit repeat in the player's own words ("another…", "again") still pays.
const RECENT_EXP_AWARD_MESSAGE_WINDOW = 12;
// Bare alternation for the repeat-intent proximity test ("another 100 xp",
// "give me the experience again").

function buildExpAwardTransaction(amount) {
    return {
        // Value-based signature — a re-emission is the same award (the coin rule).
        signature: `exp|${amount}`,
        item: { itemKey: 'exp-award', name: `${amount} XP` },
        quantity: 1,
        priceCp: amount,
    };
}

/**
 * One ledger dance for both DM XP lanes — ADD_EXP and LEVEL_UP's riding
 * bonusExp used to hand-copy it (2026-08-30 audit): probe for a
 * value-signature duplicate inside the window and record the outcome. The
 * player's repeat-intent escape hatch ("another 150 xp") is gone (identity by
 * reference, lane 11, 2026-11-08): a twin from an earlier message is the
 * repeat judge's question, asked on a card by ADD_EXP; a decided lane (the
 * judge's "new", the player's "Record it again") is never suppressed. Returns
 * the updated ledger, whether the award was suppressed, the twin and whether
 * it was this very emission re-parsed — each caller owns its own line.
 */
function guardExpAwardLedger(recentExpAwards, amount, meta, messageIndex, messages) {
    const transaction = buildExpAwardTransaction(amount);
    const sourceId = String(meta.sourceId || '').slice(0, 160);
    const duplicate = findRecentTransactionDuplicate(
        recentExpAwards, transaction, sourceId, messageIndex, RECENT_EXP_AWARD_MESSAGE_WINDOW, messages
    );
    const exactSourceReplay = !!sourceId && duplicate?.sourceId === sourceId;
    const decided = meta.lane === 'judge' || meta.lane === 'player';
    const suppressed = !!duplicate && !decided;
    return {
        recentExpAwards: rememberTransaction(
            recentExpAwards, transaction, sourceId, messageIndex, suppressed ? 'ignored' : 'applied'
        ),
        suppressed,
        duplicate,
        exactSourceReplay,
    };
}

export const handlers = {
    START_CHARACTER(state, action) {
        const inventory = Array.isArray(action.payload.inventory) ? action.payload.inventory : [];
        const character = {
            gold: 0, silver: 0, copper: 0,
            exp: 0,
            conditions: [],
            ...action.payload.character,
            fightingStyle: normalizeFightingStyle(action.payload.character?.class, action.payload.character?.fightingStyle),
            martialArchetype: normalizeMartialArchetype(action.payload.character?.class, action.payload.character?.level, action.payload.character?.martialArchetype),
            ...normalizeAbilityScoreImprovementState(action.payload.character),
        };
        // A hero who arrives WITH a picture (the wizard's reveal) gets its time
        // stamped here — the reducer owns the stamp, as applyNpcPortrait does
        // for an NPC (2026-10-03 audit: the component stamped the hero's, the
        // reducer the NPC's). A roster hero keeps the stamp it carries.
        if (character.portraitUrl && !Number.isFinite(character.portraitUpdatedAt)) {
            character.portraitUpdatedAt = Date.now();
        }
        return {
            ...state,
            character: {
                ...character,
                armorClass: computeACFromInventory(inventory, character),
            },
            inventory,
        };
    },

    UPDATE_CHARACTER(state, action) {
        // The sheet's portrait write rides a campaign stamp (2026-10-16 audit
        // P2) — a render that lands after Settings loaded another save never
        // writes here; the stamp-less callers (the wizard, applyEvents, the
        // ASI sheet edits) are untouched.
        if (isStaleCampaignAction(state, action)) {
            console.warn('[Character] Dropped a character update that started on a different campaign or load.');
            return state;
        }
        const payload = { ...(action.payload || {}) };
        // The hero portrait gets the shared allowlist at the WRITE too
        // (2026-09-09 audit P2): the sheet/wizard dispatch whatever the provider
        // chain returned. A URL that fails it never lands, and the portrait
        // metadata stamps only when the URL survived — "Rendered by gemini"
        // beside no picture was the NPC-side symptom of the same gap.
        // Never stored: nothing reads it (2026-09-21 audit P2).
        delete payload.portraitPrompt;
        if (Object.prototype.hasOwnProperty.call(payload, 'portraitUrl')) {
            const safeUrl = sanitizePortraitUrl(payload.portraitUrl);
            if (safeUrl) {
                payload.portraitUrl = safeUrl;
                // A picture that lands is stamped HERE, whatever the caller
                // sent — one owner of the stamp, the NPC path's rule.
                payload.portraitUpdatedAt = Date.now();
            } else if (payload.portraitUrl === '' || payload.portraitUrl == null) {
                // An explicit clear stays a clear.
                payload.portraitUrl = '';
            } else {
                delete payload.portraitUrl;
                delete payload.portraitProvider;
                delete payload.portraitUpdatedAt;
            }
        }
        return { ...state, character: { ...state.character, ...payload } };
    },

    /**
     * The Scribe's lane for the hero's look (2026-09-16 audit P1): the NPC
     * fragment belt, applied to the character. A FRAGMENT (under half the
     * record's length, covering under half its tokens) merges into the
     * recorded description; a rewrite replaces it. The wizard and the sheet
     * keep the plain UPDATE_CHARACTER replace — the player's own edit is
     * exactly what they typed (the SET_NPC_LOOK contract).
     */
    MERGE_CHARACTER_APPEARANCE(state, action) {
        const incoming = cleanTextField(action.payload?.appearance, CHARACTER_APPEARANCE_MAX);
        if (!incoming) return state;
        const existing = cleanTextField(state.character?.appearance, CHARACTER_APPEARANCE_MAX);
        const merged = mergeNpcAppearance(existing, incoming, CHARACTER_APPEARANCE_MAX);
        if (!merged || merged === existing) return state;
        return { ...state, character: { ...state.character, appearance: merged } };
    },

    APPLY_ABILITY_SCORE_IMPROVEMENT(state, action) {
        if (!state.character?.pendingAbilityScoreImprovements) return state;
        const increases = action.payload?.increases || {};
        const entries = Object.entries(increases)
            .filter(([ability, value]) => ABILITY_NAMES.includes(ability) && Number.isInteger(value) && value > 0);
        const total = entries.reduce((sum, [, value]) => sum + value, 0);
        if (total !== 2 || entries.some(([, value]) => value > 2)) {
            return {
                ...state,
                messages: [...state.messages, systemMessage('Ability Score Improvement must assign exactly two ability points.')],
            };
        }

        const abilityScores = { ...state.character.abilityScores };
        for (const [ability, value] of entries) {
            if ((abilityScores[ability] || 0) + value > 20) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage('Ability scores cannot be raised above 20 with this improvement.')],
                };
            }
            abilityScores[ability] += value;
        }

        const oldConMod = getModifier(state.character.abilityScores.constitution || 10);
        const newConMod = getModifier(abilityScores.constitution || 10);
        const hpGain = Math.max(0, newConMod - oldConMod) * (state.character.level || 1);
        // The CON gain raises currentHP only for a hero on their feet: while
        // dying, defeated, or dead it grows maxHP alone — a sheet-menu click
        // must never nudge a 0-HP hero into a not-dying-yet-not-conscious limbo
        // or write HP onto a corpse (2026-08-30 audit; the level-up heal owns
        // revive semantics, an ability-point spend does not).
        // ONE downed predicate with the level-up heal (2026-09-19 audit P2): the
        // narrow dying/defeated test let a STABILIZED hero (0 HP, not dying,
        // Unconscious) gain HP here and stay Unconscious — the same limbo,
        // reached through the ability-point lane.
        const heroDown = state.character.isDead || isHeroDown(state.character);
        const improvedCharacter = {
            ...state.character,
            abilityScores,
            maxHP: state.character.maxHP + hpGain,
            currentHP: heroDown
                ? state.character.currentHP
                : Math.min(state.character.maxHP + hpGain, state.character.currentHP + hpGain),
            abilityScoreImprovementsApplied: (state.character.abilityScoreImprovementsApplied || 0) + 1,
            pendingAbilityScoreImprovements: Math.max(0, (state.character.pendingAbilityScoreImprovements || 0) - 1),
        };
        const improvedState = withInventoryAndAC({ ...state, character: improvedCharacter }, state.inventory);
        const summary = entries.map(([ability, value]) => `${ability.slice(0, 3).toUpperCase()} +${value}`).join(', ');
        return {
            ...improvedState,
            messages: [
                ...improvedState.messages,
                systemMessage(`**Ability Score Improvement applied:** ${summary}.${hpGain > 0 ? ` Constitution increased maximum HP by ${hpGain}.` : ''}`),
            ],
        };
    },

    TAKE_DAMAGE(state, action) {
        const prevHP = state.character.currentHP;
        const newHP = Math.max(0, prevHP - action.payload);
        let character = { ...state.character, currentHP: newHP };
        const messages = [...state.messages];
        const earlyDefeatProtected = isLowLevelSolo(state.character, state.party);

        if (newHP === 0 && prevHP > 0 && !character.isDead) {
            if (earlyDefeatProtected) {
                character = applyEarlyDefeat(character);
                messages.push(systemMessage(`**${character.name} is defeated.** At level ${character.level}, this is a severe setback, not a campaign-ending death: the enemy may capture, rob, spare, bind, abandon, or bargain with you, but the story continues.`));
            } else {
                // Dropped to 0: the character falls unconscious and starts dying.
                character.dying = true;
                character.deathSaves = { successes: 0, failures: 0 };
                character = withCondition(character, 'Unconscious');
                messages.push(systemMessage(`💔 **${character.name} falls!** You are unconscious at 0 HP and DYING. Each round, a death saving throw decides your fate — three successes stabilize you, three failures end your story.`));
            }
        } else if (prevHP === 0 && !character.dying && !character.lowLevelDefeat && !character.isDead && action.payload > 0) {
            // A blow on a STABLE hero (2026-10-17 audit P1): 5e's damage at 0 HP
            // is a death-save failure and ends the stability — the dying clock
            // restarts with one failure. It used to be a no-op (the first branch
            // needs prevHP > 0, the second `dying`), so the out-of-combat
            // damage_taken wire let "the ogre stamps on the unconscious hero"
            // cost nothing; the exchange never strikes a fallen hero, so this
            // is that wire's hole alone.
            if (earlyDefeatProtected) {
                character = applyEarlyDefeat(character);
                messages.push(systemMessage(`**${character.name} is defeated.** The blow on the unconscious hero deepens the setback; low-level solo protection keeps it a defeat, not a death.`));
            } else {
                character.dying = true;
                character.deathSaves = { successes: 0, failures: 1 };
                character = withCondition(character, 'Unconscious');
                messages.push(systemMessage(`💔 **Struck while down!** ${character.name} is no longer stable — DYING again, and the blow counts as a death save failure (1/3).`));
            }
        } else if (prevHP === 0 && character.dying && action.payload > 0) {
            if (earlyDefeatProtected) {
                character = applyEarlyDefeat(character);
                messages.push(systemMessage('**Defeat deepens.** The hit worsens the setback, but low-level solo protection prevents a death-save spiral. The DM should turn this into capture, loss, leverage, or a narrow escape.'));
                return { ...state, character, messages };
            }
            // Taking damage while dying counts as a death save failure.
            const failures = (character.deathSaves?.failures || 0) + 1;
            character.deathSaves = { ...(character.deathSaves || { successes: 0 }), failures };
            if (failures >= 3) {
                character = applyDeath(character);
                messages.push(systemMessage('**The blow proves fatal. Your character dies.**'));
                return recordDeathOutsideCombat({ ...state, character, messages }, 'struck down while dying');
            } else {
                messages.push(systemMessage(`💔 **Struck while dying!** That counts as a death save failure (${failures}/3).`));
            }
        }

        return { ...state, character, messages };
    },

    HEAL(state, action) {
        if (action.payload <= 0 || state.character.isDead) return state;
        const healed = Math.min(
            state.character.maxHP,
            Math.max(0, state.character.currentHP) + action.payload
        );
        let character = { ...state.character, currentHP: healed };
        const messages = [...state.messages];
        if (character.dying) {
            // Any healing brings a dying character back to consciousness.
            character = reviveCharacter(character);
            messages.push(systemMessage(`**${character.name} regains consciousness!** Healing pulls you back from the brink (${healed} HP).`));
        } else if (character.lowLevelDefeat && healed > 0) {
            character = reviveCharacter(character);
            messages.push(systemMessage(`**${character.name} comes around.** You are hurt, but the early defeat setback is over (${healed} HP).`));
        }
        return { ...state, character, messages };
    },

    DEATH_SAVE_RESULT(state, action) {
        const character = state.character;
        if (!character?.dying || character.isDead) return state;
        if (isLowLevelSolo(character, state.party)) {
            return {
                ...state,
                character: applyEarlyDefeat(character),
                // `quiet`: the exchange lane posted its own skipped-save note (2026-10-30).
                messages: action.payload?.quiet
                    ? state.messages
                    : [
                        ...state.messages,
                        systemMessage('**Death save skipped.** Low-level solo protection converts this into a defeat setback instead of permanent death.'),
                    ],
            };
        }
        const die = action.payload?.die;
        // A die-less dispatch is the exchange engine's "death save skipped"
        // (it judged the hero low-level solo). If the live check above
        // disagreed, nothing was rolled, so nothing is tallied — never let a
        // null die count as a failure.
        // THE one judge (engine/deathSaves.js, WOW 2026-09-30): the exchange
        // engine's death_save event and the out-of-combat resolver judge the
        // same die through it, so the chat line's count and this tally can
        // never disagree. Integer tallies 0..3 behind the load heal, never
        // `"1" + 1`. This handler posts no line by design — the two lanes
        // that roll the die render THE shared `deathSaveLine` (the exchange
        // line in combat, the resolver's system line outside it).
        const judged = judgeDeathSave(character.deathSaves, die);
        if (!judged) return state;

        if (judged.outcome === 'revived') {
            // Natural 20: back on your feet with 1 HP.
            const revived = reviveCharacter({ ...character, currentHP: 1 });
            return { ...state, character: revived };
        }
        if (judged.outcome === 'stable') {
            // Stable: unconscious at 0 HP, but no longer dying.
            const stable = { ...character, dying: false, deathSaves: { successes: 0, failures: 0 } };
            return { ...state, character: stable };
        }
        if (judged.outcome === 'dead') {
            // The last chapter (2026-09-30): outside a fight this IS the
            // death's last word, so the epitaph lands here; inside one,
            // END_COMBAT writes it after the terminal narration.
            return recordDeathOutsideCombat({ ...state, character: applyDeath(character) }, 'the wounds proved fatal — three failed death saves');
        }
        return { ...state, character: { ...character, deathSaves: { successes: judged.successes, failures: judged.failures } } };
    },

    PLAYER_DEFEAT(state, action) {
        if (!state.character || state.character.isDead) return state;
        if (!isLowLevelSolo(state.character, state.party)) return state;
        const character = applyEarlyDefeat(state.character);
        const description = action.payload?.description
            || `${character.name} is defeated, but the story continues.`;
        return {
            ...state,
            character,
            messages: [
                ...state.messages,
                systemMessage(`**${description}**\n\nAt level ${character.level}, defeat becomes a story setback instead of permanent death. Expect capture, loss, bargaining, rescue, or a grim escape route.`),
            ],
        };
    },

    /**
     * THE DM's `exp_awarded` lane — ONE lane since 2026-10-14 (progression
     * Lap-4 P2): the payload is `{ amount, _meta }` from applyEvents. Engine
     * awards (combat, quests, fronts, the load replay) never dispatch here —
     * they fold `awardExperience` directly, unbounded and unledgered by
     * construction. The old bare-number "engine/legacy" branch had no
     * production dispatcher and four tests pinned it as a contract; a
     * payload that is not a record is a no-op now.
     */
    ADD_EXP(state, action) {
        if (!isRecord(action.payload)) return state;
        const requested = Math.max(0, Math.floor(Number(action.payload.amount) || 0));
        const meta = isRecord(action.payload._meta) ? action.payload._meta : {};
        // DM lane bound (2026-09-07 audit P1): a freeform bonus pays at most the
        // quest tier for the hero's level — the prompt promises "tens to low
        // hundreds" and one 10000-XP emission used to take a hero L1→L5. The
        // clamp runs BEFORE the ledger so a re-emitted oversized award still
        // matches its own echo signature.
        // The cap is said ON the XP line (`+38 XP (capped from 50)`, 2026-10-02):
        // one DM-visible receipt, not an award row plus a note the DM never saw.
        const amount = Math.min(requested, getDmBonusXpCap(state.character?.level));
        let recentExpAwards = state.recentExpAwards || [];
        if (amount > 0) {
            // The ledger keys on the REQUESTED amount (2026-10-27 P2): an echo
            // repeats the request, while two DIFFERENT over-cap awards (60, then
            // 80) clamp to one number and used to collide as a "duplicate".
            const guarded = guardExpAwardLedger(recentExpAwards, requested, meta, currentMessageIndex(state), state.messages);
            recentExpAwards = guarded.recentExpAwards;
            if (guarded.suppressed) {
                // The exact re-parse of one narration is certain and stays a
                // note; a twin from an EARLIER message is the repeat judge's
                // question (lane 11, 2026-11-08), asked on a dmVisible card:
                // "new" books exactly this award on the judge lane.
                const line = `Duplicate XP award ignored — **+${amount} XP** matches an award just granted.`;
                const card = guarded.exactSourceReplay
                    ? null
                    : repeatCard(state, repeatContext(meta), guarded.duplicate, line,
                        { type: 'ADD_EXP', payload: { amount: requested } },
                        { earlier: `the hero was awarded ${guarded.duplicate.priceCp} XP` });
                return {
                    ...state,
                    recentExpAwards,
                    messages: [
                        ...state.messages,
                        // dmVisible: the DM must learn its re-emission was suppressed.
                        card || systemMessage(`${line} If a second identical award is genuinely owed, ask the DM for it again.`, { dmVisible: true }),
                    ],
                };
            }
        }
        return foldExperience({ ...state, recentExpAwards }, amount, {
            cappedFrom: amount < requested ? requested : undefined,
            // No DM channel stands a DOWN hero up (2026-09-19 ruling, the
            // 09-04 "gasped prayer" class through the XP door; widened
            // 2026-10-14 progression P2 from `dying` alone to isHeroDown —
            // a STABILIZED hero at 0 HP, Unconscious, took the full heal from
            // a 30-XP award and stood up "Fully healed!"): a DM award that
            // crosses a level while the hero is down grows the sheet and leaves
            // the hero where the fiction left them. Engine-computed XP keeps
            // the revive.
            keepDowned: isHeroDown(state.character || {}),
        });
    },

    // Both take the canonical form (normalizeConditionName) and match
    // case-insensitively against whatever a legacy save still carries, so
    // "Poisoned" gained then "poisoned" removed cannot strand the condition
    // (2026-09-05 audit P1). Junk payloads are no-ops.
    // The cap goes through THE capped writer (2026-11-05 strengthening P2):
    // the 11th condition used to be refused SILENTLY even when it was the
    // table's `paralyzed`. Now a table condition evicts the oldest flavour
    // one, and every eviction or refusal is a visible line the DM reads.
    ADD_CONDITION(state, action) {
        const result = addConditionCapped(state.character.conditions || [], action.payload);
        if (result.refused) {
            return {
                ...state,
                messages: [...state.messages, systemMessage(`**${result.refused}** is not recorded — ${state.character.name || 'the hero'} already carries ${CONDITION_LIST_CAP} conditions. Narrate it, or clear one with conditions_removed first.`, { dmVisible: true })],
            };
        }
        if (!result.added) return state;
        return {
            ...state,
            character: { ...state.character, conditions: result.conditions },
            ...(result.evicted && {
                messages: [...state.messages, systemMessage(`*${result.evicted}* gives way to **${result.added}** — the hero carries at most ${CONDITION_LIST_CAP} conditions.`, { dmVisible: true })],
            }),
        };
    },

    REMOVE_CONDITION(state, action) {
        const condition = normalizeConditionName(action.payload);
        if (!condition) return state;
        const existing = state.character.conditions || [];
        return {
            ...state,
            character: { ...state.character, conditions: existing.filter(c => normalizeConditionName(c) !== condition) },
        };
    },

    /**
     * THE DM's `level_up: true` lane — ONE lane since 2026-10-14 (progression
     * Lap-4 P2): `{ bonusExp, _meta }` from applyEvents, paying the front
     * tier plus a bounded bonus. The meta-less "engine/legacy" branch handed
     * out a WHOLE level — the lane the 09-07 ruling closed — and nothing in
     * production dispatched it; a payload that is not a record is a no-op.
     */
    LEVEL_UP(state, action) {
        if (!isRecord(action.payload)) return state;
        const meta = isRecord(action.payload._meta) ? action.payload._meta : {};
        let bonusExp = Math.max(0, Math.floor(Number(action.payload.bonusExp) || 0));
        let recentExpAwards = state.recentExpAwards || [];
        const extraMessages = [];
        // DM-path milestone level-ups ride the same ledger: a level_up re-emitted
        // while the first one's narration is still in the DM's window would
        // otherwise silently hand out a whole second level (the rest_taken echo
        // pattern at maximum stakes). The signature is constant — value-keying on
        // the reached level would never match, since the first echo already
        // raised it. No player-phrasing escape: milestones are DM initiative.
        {
            const sourceId = String(meta.sourceId || '').slice(0, 160);
            const messageIndex = currentMessageIndex(state);
            const levelUpMarker = {
                signature: 'levelup',
                item: { itemKey: 'level-up', name: 'milestone level-up' },
                quantity: 1,
                priceCp: 0,
            };
            const duplicate = findRecentTransactionDuplicate(
                recentExpAwards, levelUpMarker, sourceId, messageIndex, RECENT_EXP_AWARD_MESSAGE_WINDOW, state.messages
            );
            if (duplicate) {
                return {
                    ...state,
                    recentExpAwards: rememberTransaction(recentExpAwards, levelUpMarker, sourceId, messageIndex, 'ignored'),
                    messages: [
                        ...state.messages,
                        systemMessage('Duplicate level-up ignored — a milestone level-up was just applied.', { dmVisible: true }),
                    ],
                };
            }
            recentExpAwards = rememberTransaction(recentExpAwards, levelUpMarker, sourceId, messageIndex);
            // The bonus XP riding the level-up answers to the exp ledger too — the
            // observed double-award lands here whenever the recap turn adds
            // level_up: true beside the re-emitted exp_awarded. Bounded at the
            // quest tier like ADD_EXP's DM lane (clamped before the ledger).
            const level = state.character?.level || 1;
            const requestedBonus = bonusExp;
            bonusExp = Math.min(bonusExp, getDmBonusXpCap(level));
            if (bonusExp > 0) {
                const guarded = guardExpAwardLedger(recentExpAwards, requestedBonus, meta, messageIndex, state.messages);
                recentExpAwards = guarded.recentExpAwards;
                if (guarded.suppressed) {
                    extraMessages.push(systemMessage(`Duplicate XP award ignored — **+${bonusExp} XP** matches an award just granted; the milestone itself stands.`, { dmVisible: true }));
                    bonusExp = 0;
                }
            }
            // DM lane bound (2026-09-07 audit P1, rpg-balance-master ruling): a
            // DM milestone is worth the FRONT tier of XP (half the current
            // threshold — two milestones = exactly one level), never a whole
            // level on the DM's say-so. With the bonus capped at the quest tier
            // a single emission can bank at most 62.5% of a level, so the old
            // level_up + big-bonus double-level is structurally gone. At max
            // level the XP line says so explicitly — a silent no-op used to be
            // the one suppressed reward with no line (2026-09-07 P2).
            // At max level the milestone pays nothing (2026-10-27 P2: it banked
            // +25000 XP through the threshold table's last-row fallback — a
            // number with no level behind it); the bonus still pays.
            const atCap = isMaxLevel(level);
            // ONE DM milestone per level (2026-11-10, rpg-balance-master
            // ruling): the tier bounded what one `level_up` pays, nothing
            // bounded how OFTEN it fires — outside the 12-row replay window
            // every emission paid half a level, so a DM that marks each
            // quest's end a milestone levels the hero every second quest.
            // `character.milestoneLevel` is the level the last one paid at; a
            // second at that level pays nothing and says so (the bonus, like
            // at max level, still pays). At least half of every level now
            // comes from what the engine can verify: fronts, quests, fights.
            const spent = !atCap && state.character?.milestoneLevel === level;
            const unpaid = atCap
                ? 'max level reached, no level gained'
                : (spent ? `this level's milestone is already paid (one per level)` : '');
            const milestoneXp = unpaid ? 0 : getStoryMilestoneXp(level);
            if (unpaid && bonusExp <= 0) {
                return {
                    ...state,
                    recentExpAwards,
                    messages: [
                        ...state.messages,
                        ...extraMessages,
                        systemMessage(`**Story milestone** — ${unpaid}.`, { dmVisible: true }),
                    ],
                };
            }
            // A capped bonus that survived the ledger is said on the XP line itself.
            const bonusNote = bonusExp > 0 && bonusExp < requestedBonus
                ? ` + bonus ${bonusExp}, capped from ${requestedBonus}`
                : '';
            // The stamp is the level the milestone was PAID at — read before
            // the award may cross into the next one, where a new one is owed.
            const character = milestoneXp > 0 && state.character
                ? { ...state.character, milestoneLevel: level }
                : state.character;
            return foldExperience({ ...state, character, recentExpAwards, messages: [...state.messages, ...extraMessages] }, milestoneXp + bonusExp, {
                reason: `${unpaid ? `story milestone — ${unpaid}` : 'story milestone'}${bonusNote}`,
                // A DM-declared milestone never stands a down hero up (see ADD_EXP).
                keepDowned: isHeroDown(state.character || {}),
            });
        }
    },
};
