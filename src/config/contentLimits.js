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

/** Short plain-replace roster gender field ("woman", "man", the fiction's own
 * wording) — reducer boundary and NPC enrichment share the cap. */
export const NPC_GENDER_MAX = 40;

/** Short plain-replace roster race/species field ("goblin", "human", "half-orc")
 * — reducer boundary and NPC enrichment share the cap, like gender. */
export const NPC_RACE_MAX = 40;

export function normalizeCampaignPremise(value) {
    return String(value || '').trim().slice(0, CAMPAIGN_PREMISE_MAX_LENGTH);
}
