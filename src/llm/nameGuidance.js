export const STOCK_LLM_FANTASY_NAMES = [
    'Elara', 'Elora', 'Elyra', 'Silas', 'Sylas', 'Thorne', 'Thorn',
    'Kael', 'Lyra', 'Rowan', 'Aria', 'Liora', 'Seraphina', 'Nyx',
    'Zephyr', 'Aldric', 'Garrick', 'Mira', 'Vesper', 'Cassian',
];

export const NPC_NAME_DIVERSITY_RULES = `## NPC NAME DIVERSITY — AVOID THE LLM FANTASY DEFAULTS

For NEW people or person-like factions you invent, never use or cosmetically respell these stock LLM fantasy names: ${STOCK_LLM_FANTASY_NAMES.join(', ')}.
- This restriction applies only to names you create. Never rename or erase an established name from the CAMPAIGN PREMISE, WORLD FACTS, NPC records, journal, memories, or player input.
- Build names from the person's culture, region, class, age, and community. Let people from one culture share a subtle naming logic, while varying sounds, syllable counts, initials, and endings across the cast.
- Do not replace the blocked list with one new repeated shortlist. Mix ordinary, occupational, regional, devotional, nickname-based, and unusual names as the setting supports; not every fantasy person needs a lyrical or ornate name.`;
