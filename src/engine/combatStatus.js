import { COMBAT_PHASES, isEnemyActive } from './combatExchange.js';

/**
 * Derive the concise player-facing combat status from engine state.
 * Kept outside React so the priority order is testable.
 */
export function getCombatStatus({ character = {}, combat = {}, party = [] } = {}) {
    const enemies = combat.enemies || [];
    const aliveEnemies = enemies.filter(isEnemyActive);
    if (combat.active && enemies.length > 0 && aliveEnemies.length === 0) {
        return {
            variant: 'victory',
            title: 'Victory secured',
            detail: 'All tracked enemies are down. The system will close combat after the DM resolves rewards.',
        };
    }

    if (character.isDead) {
        return {
            variant: 'dead',
            title: 'Dead',
            detail: 'This character cannot act or recover through ordinary rests.',
        };
    }

    if (character.lowLevelDefeat) {
        return {
            variant: 'defeated',
            title: 'Defeated, not dead',
            detail: 'Play through the setback. Healing or rest can get you back on your feet.',
        };
    }

    if (character.dying) {
        const saves = character.deathSaves || { successes: 0, failures: 0 };
        return {
            variant: 'danger',
            title: 'Dying',
            detail: `Death saves ${saves.successes || 0}/3 successes, ${saves.failures || 0}/3 failures. Your next combat exchange is an engine-owned death save; healing can still revive you.`,
        };
    }

    if ((character.currentHP ?? 1) <= 0) {
        return {
            variant: 'stable',
            title: 'Stable at 0 HP',
            detail: 'You are unconscious and safe from death saves for now. Healing brings you back.',
        };
    }

    if (combat.phase === COMBAT_PHASES.OPENING) {
        return {
            variant: 'enemy',
            title: 'Opening Initiative',
            detail: 'Actors who beat your initiative are resolving their one opening action.',
        };
    }

    if (combat.phase === COMBAT_PHASES.AWAITING_NARRATION) {
        return {
            variant: 'neutral',
            title: 'Exchange resolved',
            detail: 'The mechanics are committed. The DM is narrating the stored result without rerolling.',
        };
    }

    if (combat.phase === COMBAT_PHASES.AWAITING_INTENT) {
        return {
            variant: 'neutral',
            title: 'Action committed',
            detail: 'The DM is translating your declared action into bounded intent; no mechanics have resolved yet.',
        };
    }

    if (character.pendingActionSurge) {
        return {
            variant: 'surge',
            title: 'Action Surge active',
            detail: `Your next declared action gets one additional action. Bonus action: ${combat.bonusActionUsed ? 'used' : 'available'}.`,
        };
    }

    const current = combat.turnOrder?.[combat.currentTurn];
    if (current?.type === 'player') {
        return {
            variant: 'player',
            title: 'Your turn',
            detail: `Describe your ${character?.class || 'character'} action in chat. Bonus action: ${combat.bonusActionUsed ? 'used' : 'available'}.`,
        };
    }

    if (current?.type === 'companion') {
        const companion = party.find(c => c.id === current.id);
        const downed = companion && ((companion.hp ?? 0) <= 0 || companion.status === 'downed');
        return {
            variant: downed ? 'ally-down' : 'ally',
            title: downed ? `${current.name} is down` : `${current.name} is ready`,
            detail: downed
                ? 'A downed ally cannot act until recovered.'
                : 'Direct the ally in chat, or let the DM choose their move.',
        };
    }

    if (current?.type === 'enemy') {
        return {
            variant: 'enemy',
            title: `${current.name}'s turn`,
            detail: 'The DM should resolve the enemy action with engine-owned rolls when needed.',
        };
    }

    return {
        variant: 'neutral',
        title: 'Combat active',
        detail: 'Describe what you do next.',
    };
}
