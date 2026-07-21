/**
 * Tests for the pure events-routing policy extracted from ChatPanel — the
 * malformed-output guards the 2026-07-21 strengthening audit flagged as the
 * suite's sharpest blind spot. Each case pins one routing decision that,
 * regressed, would silently break the game loop (e.g. in-combat requested_rolls
 * falling through to a free LLM-authored enemy attack).
 */
import { describe, expect, it } from 'vitest';
import { extractProposalLoot, needsSpellCastNarration, routeTurnEvents, TURN_ROUTES } from './eventRouting.js';

describe('routeTurnEvents', () => {
    it('routes a malformed combat intent envelope to rejection, marking the intent handled', () => {
        const routed = routeTurnEvents({ combatExchangeRejected: true }, { combatWasActive: true });
        expect(routed.route).toBe(TURN_ROUTES.COMBAT_REJECTED);
        expect(routed.combatIntentHandled).toBe(true);
        expect(routed.reason).toMatch(/malformed combat intent/);
    });

    it('rejection wins over an exchange and rolls in the same response', () => {
        const routed = routeTurnEvents({
            combatExchangeRejected: true,
            combatExchange: { exchangeId: 'x1' },
            requestedRolls: [{ type: 'check' }],
        }, { combatWasActive: true });
        expect(routed.route).toBe(TURN_ROUTES.COMBAT_REJECTED);
    });

    it('routes a live-combat exchange to the exchange machine', () => {
        const routed = routeTurnEvents({ combatExchange: { exchangeId: 'x1' } }, { combatWasActive: true });
        expect(routed.route).toBe(TURN_ROUTES.COMBAT_EXCHANGE);
        expect(routed.combatIntentHandled).toBe(true);
    });

    it('lets an exchange paired with combat_start fall through — it rides START_COMBAT\'s queue', () => {
        const routed = routeTurnEvents({
            combatStart: { enemies: [] },
            combatExchange: { exchangeId: 'x1' },
        }, { combatWasActive: false });
        expect(routed.route).toBe(TURN_ROUTES.NARRATIVE);
        expect(routed.combatIntentHandled).toBe(false);
    });

    it('rejects legacy requested_rolls during active combat instead of resolving them', () => {
        const routed = routeTurnEvents({ requestedRolls: [{ type: 'attack' }] }, { combatWasActive: true });
        expect(routed.route).toBe(TURN_ROUTES.IN_COMBAT_ROLLS_REJECTED);
        expect(routed.combatIntentHandled).toBe(true);
        expect(routed.reason).toMatch(/legacy combat rolls/);
    });

    it('rejects requested_rolls when combat starts in the same response', () => {
        const routed = routeTurnEvents({
            combatStart: { enemies: [] },
            requestedRolls: [{ type: 'attack' }],
        }, { combatWasActive: false });
        expect(routed.route).toBe(TURN_ROUTES.IN_COMBAT_ROLLS_REJECTED);
    });

    it('stages out-of-combat requested_rolls as a proposal, with attached loot as metadata', () => {
        const routed = routeTurnEvents({
            requestedRolls: [{ type: 'check', skill: 'Stealth' }],
            goldFound: 3,
            itemsFound: [{ name: 'Brass Key' }],
        }, { combatWasActive: false });
        expect(routed.route).toBe(TURN_ROUTES.ROLL_PROPOSAL);
        expect(routed.combatIntentHandled).toBe(false);
        expect(routed.proposalLoot).toEqual({
            goldFound: 3,
            silverFound: 0,
            copperFound: 0,
            itemsFound: [{ name: 'Brass Key' }],
        });
    });

    it('stages a lootless proposal with null loot metadata', () => {
        const routed = routeTurnEvents({ requestedRolls: [{ type: 'check' }] }, { combatWasActive: false });
        expect(routed.route).toBe(TURN_ROUTES.ROLL_PROPOSAL);
        expect(routed.proposalLoot).toBeNull();
    });

    it('routes a full player-authority rejection to the no-roll correction call', () => {
        const routed = routeTurnEvents({
            requestedRolls: [],
            _playerAuthorityRollRejected: true,
        }, { combatWasActive: false });
        expect(routed.route).toBe(TURN_ROUTES.AUTHORITY_CORRECTION);
        expect(routed.combatIntentHandled).toBe(false);
    });

    it('routes plain narrative and null events to no orchestration', () => {
        expect(routeTurnEvents({ worldFacts: [] }, { combatWasActive: false }).route).toBe(TURN_ROUTES.NARRATIVE);
        expect(routeTurnEvents(null, { combatWasActive: false }).route).toBe(TURN_ROUTES.NARRATIVE);
        expect(routeTurnEvents(null, { combatWasActive: false }).combatIntentHandled).toBe(false);
    });
});

describe('extractProposalLoot', () => {
    it('returns null when the response carries no loot', () => {
        expect(extractProposalLoot(null)).toBeNull();
        expect(extractProposalLoot({ requestedRolls: [{}] })).toBeNull();
        expect(extractProposalLoot({ goldFound: 0, itemsFound: [] })).toBeNull();
    });

    it('normalizes partial loot fields to a complete payload', () => {
        expect(extractProposalLoot({ silverFound: 12 })).toEqual({
            goldFound: 0, silverFound: 12, copperFound: 0, itemsFound: [],
        });
    });
});

describe('needsSpellCastNarration', () => {
    const cast = { spellCasts: [{ spellKey: 'detectMagic' }] };

    it('fires for a JSON-only out-of-combat cast', () => {
        expect(needsSpellCastNarration(cast, {
            dmNarrative: '',
            combatIntentHandled: false,
            combatActive: false,
        })).toBe(true);
    });

    it('treats whitespace-only prose as an empty message', () => {
        expect(needsSpellCastNarration(cast, {
            dmNarrative: '  \n ',
            combatIntentHandled: false,
            combatActive: false,
        })).toBe(true);
    });

    it('stays silent when prose, combat, a handled intent, or pending rolls exist', () => {
        expect(needsSpellCastNarration(cast, {
            dmNarrative: 'The sigils flare blue.',
            combatIntentHandled: false,
            combatActive: false,
        })).toBe(false);
        expect(needsSpellCastNarration(cast, {
            dmNarrative: '',
            combatIntentHandled: true,
            combatActive: false,
        })).toBe(false);
        expect(needsSpellCastNarration(cast, {
            dmNarrative: '',
            combatIntentHandled: false,
            combatActive: true,
        })).toBe(false);
        expect(needsSpellCastNarration({ ...cast, requestedRolls: [{}] }, {
            dmNarrative: '',
            combatIntentHandled: false,
            combatActive: false,
        })).toBe(false);
        expect(needsSpellCastNarration({ spellCasts: [] }, {
            dmNarrative: '',
            combatIntentHandled: false,
            combatActive: false,
        })).toBe(false);
    });
});
