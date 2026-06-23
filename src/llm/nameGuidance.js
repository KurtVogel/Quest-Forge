export const STOCK_LLM_FANTASY_NAMES = [
    'Elara', 'Elora', 'Elyra', 'Silas', 'Sylas', 'Thorne', 'Thorn',
    'Kael', 'Lyra', 'Rowan', 'Aria', 'Liora', 'Seraphina', 'Nyx',
    'Zephyr', 'Aldric', 'Garrick', 'Mira', 'Vesper', 'Cassian',
];

export const STOCK_LLM_LOCATION_NAMES = [
    'Whispering Woods', 'Oakhaven',
];

export const NPC_NAME_DIVERSITY_RULES = `## NAME DIVERSITY — AVOID LLM FANTASY DEFAULTS

For NEW people, factions, or locations you invent:
1. Never use or cosmetically respell these stock LLM fantasy person names: ${STOCK_LLM_FANTASY_NAMES.join(', ')}.
2. Never use these overused stock LLM location/settlement names: ${STOCK_LLM_LOCATION_NAMES.join(', ')}.
- This restriction applies only to names you create. Never rename or erase an established name from the CAMPAIGN PREMISE, WORLD FACTS, NPC records, journal, memories, or player input.
- Build names from the setting's culture, region, geography, and community. Let people and places from the same region share a subtle naming logic, while varying sounds, syllable counts, initials, and endings.
- Do not replace the blocked list with one new repeated shortlist. Mix ordinary, occupational, regional, nickname-based, and unusual names; not every person or place needs a lyrical or ornate name.`;
