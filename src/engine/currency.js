export const COPPER_PER_SILVER = 10;
export const COPPER_PER_GOLD = 100;

export function toCopper({ gold = 0, silver = 0, copper = 0 } = {}) {
    return Math.max(0, Math.trunc(gold)) * COPPER_PER_GOLD
        + Math.max(0, Math.trunc(silver)) * COPPER_PER_SILVER
        + Math.max(0, Math.trunc(copper));
}

export function characterCurrencyToCopper(character = {}) {
    return toCopper({
        gold: character.gold || 0,
        silver: character.silver || 0,
        copper: character.copper || 0,
    });
}

export function fromCopper(totalCopper) {
    let remaining = Math.max(0, Math.trunc(totalCopper || 0));
    const gold = Math.floor(remaining / COPPER_PER_GOLD);
    remaining -= gold * COPPER_PER_GOLD;
    const silver = Math.floor(remaining / COPPER_PER_SILVER);
    remaining -= silver * COPPER_PER_SILVER;
    return { gold, silver, copper: remaining };
}

export function addCurrency(character, delta = {}) {
    return {
        ...character,
        ...fromCopper(characterCurrencyToCopper(character) + toCopper(delta)),
    };
}

export function spendCurrency(character, cost = {}) {
    const current = characterCurrencyToCopper(character);
    const costCp = typeof cost === 'number' ? Math.max(0, Math.trunc(cost)) : toCopper(cost);
    if (costCp > current) {
        return { character, paid: false, missingCp: costCp - current, costCp };
    }
    return {
        character: { ...character, ...fromCopper(current - costCp) },
        paid: true,
        missingCp: 0,
        costCp,
    };
}

export function formatCurrency(totalCopper) {
    const { gold, silver, copper } = fromCopper(totalCopper);
    const parts = [];
    if (gold) parts.push(`${gold} gp`);
    if (silver) parts.push(`${silver} sp`);
    if (copper || parts.length === 0) parts.push(`${copper} cp`);
    return parts.join(', ');
}
