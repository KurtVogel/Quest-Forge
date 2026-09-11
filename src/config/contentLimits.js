export const CAMPAIGN_PREMISE_MAX_LENGTH = 8000;

/** Durable NPC dossier prose (personality/goals/secrets/stanceToPlayer/appearance):
 * full depth for the Journal and Scribe merges. One constant everywhere — the
 * merge clamp, the reducer boundary, and the Scribe's own summaries must agree
 * or a record silently truncates on its first round-trip. */
export const NPC_DOSSIER_FIELD_MAX = 600;

/** The hero's physical appearance (wizard seed, vault import, Scribe merge).
 * Must equal the Scribe-merge clamp: a longer imported/authored seed would
 * silently truncate on the first merged appearance update. */
export const CHARACTER_APPEARANCE_MAX = 600;

/** Ceiling for a single DM-emitted coin event (gold/silver/copper found or
 * lost) — shared by the event-channel clamps, the reducer's clampCoinAmount,
 * and the Scribe loot audit so no boundary is looser than the others. */
export const MAX_COIN_EVENT = 10000;

/** Ceiling for a single coin denomination the hero can HOLD (gold, silver,
 * or copper as its own field) — the vault import clamp and the load heal
 * share it (2026-09-11 persistence P1: the live-save boundary had none, and a
 * non-numeric field made the purse total NaN so the first coin movement wiped
 * the whole purse to zero). The per-event caps (MAX_COIN_EVENT, the sale
 * ceiling) stay far below it. */
export const MAX_COIN_HELD = 1_000_000;

/** Short plain-replace roster gender field ("woman", "man", the fiction's own
 * wording) — reducer boundary and NPC enrichment share the cap. */
export const NPC_GENDER_MAX = 40;

/** Short plain-replace roster species field ("goblin", "human", "high elf") —
 * same contract as gender: captured once knowable, anchors portraits, scene
 * art, and the DM's own prose so a goblin can never quietly turn human. */
export const NPC_SPECIES_MAX = 40;

/**
 * String-or-empty for a persisted text field (2026-09-09 audit P1). `x?.trim()`
 * reads as a null guard but is a TYPE assumption — an object in a hand-edited
 * or hostile save threw at every consumer. Non-strings become '' rather than
 * "[object Object]" canon.
 */
export function cleanTextField(value, max = Infinity) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, max);
}

export function normalizeCampaignPremise(value) {
    return String(value || '').trim().slice(0, CAMPAIGN_PREMISE_MAX_LENGTH);
}
