/**
 * The withheld-setup visibility rules and the LLM message-window filter —
 * previously trapped in ChatPanel closures (strengthening queue, 2026-07-06).
 */
import { describe, expect, it } from 'vitest';
import { buildMessageWindow, deriveSetupVisibility, dropOrphanCombatExchange } from './turnVisibility.js';

const roll = { type: 'skill_check', skill: 'stealth', dc: 12 };

describe('deriveSetupVisibility', () => {
    it('withholds a JSON-declared roll setup and defers its mutations', () => {
        const flags = deriveSetupVisibility({ requestedRolls: [roll] });
        expect(flags).toEqual({ proposalFromProse: false, setupPhase: true, hideSetup: true });
    });

    it('keeps a prose-extracted proposal visible while still deferring mutations', () => {
        const flags = deriveSetupVisibility({ requestedRolls: [roll], _textRollDetected: true });
        expect(flags).toEqual({ proposalFromProse: true, setupPhase: true, hideSetup: false });
    });

    it('hides a prose-extracted setup that pre-narrated the outcome', () => {
        const flags = deriveSetupVisibility({
            requestedRolls: [roll], _textRollDetected: true, _preNarratedOutcome: true,
        });
        expect(flags).toEqual({ proposalFromProse: false, setupPhase: true, hideSetup: true });
    });

    it('hides the setup when the check was rejected as a player-authority override, even with no surviving rolls', () => {
        const flags = deriveSetupVisibility({
            requestedRolls: [], _textRollDetected: true, _playerAuthorityRollRejected: true,
        });
        expect(flags).toEqual({ proposalFromProse: false, setupPhase: true, hideSetup: true });
    });

    it('treats a combat exchange as a setup phase (intent narration never shows)', () => {
        const flags = deriveSetupVisibility({ combatExchange: { playerSlots: [] } });
        expect(flags).toEqual({ proposalFromProse: false, setupPhase: true, hideSetup: true });
    });

    it('shows an ordinary eventless narration', () => {
        expect(deriveSetupVisibility(null)).toEqual({ proposalFromProse: false, setupPhase: false, hideSetup: false });
        expect(deriveSetupVisibility({ itemsFound: [{ name: 'Rope' }] }))
            .toEqual({ proposalFromProse: false, setupPhase: false, hideSetup: false });
    });
});

describe('dropOrphanCombatExchange', () => {
    it('drops an exchange emitted outside active combat so the narration stays visible', () => {
        const events = { combatExchange: { playerSlots: [{ action: 'death_save' }] }, worldFacts: [] };
        expect(dropOrphanCombatExchange(events, false)).toBe(true);
        expect(events.combatExchange).toBeUndefined();
        expect(deriveSetupVisibility(events).hideSetup).toBe(false);
    });

    it('keeps the exchange during live combat', () => {
        const events = { combatExchange: { playerSlots: [] } };
        expect(dropOrphanCombatExchange(events, true)).toBe(false);
        expect(events.combatExchange).toBeDefined();
    });

    it('keeps a combat_start opening exchange (in-medias-res flow)', () => {
        const events = { combatStart: { enemies: [] }, combatExchange: { playerSlots: [] } };
        expect(dropOrphanCombatExchange(events, false)).toBe(false);
        expect(events.combatExchange).toBeDefined();
    });

    it('tolerates null events', () => {
        expect(dropOrphanCombatExchange(null, false)).toBe(false);
    });
});

describe('buildMessageWindow', () => {
    const msg = (role, content, extra = {}) => ({ role, content, ...extra });

    it('drops summarized and hidden messages and keeps only roll-result system lines', () => {
        const history = [
            msg('user', 'old action', { summarized: true }),
            msg('assistant', 'withheld setup', { hidden: true }),
            msg('system', 'Autosave complete.'),
            msg('system', 'Stealth (DC 12): Rolled **14** — Success!'),
            msg('user', 'I sneak in.'),
            msg('assistant', 'You slip inside.'),
        ];
        const window = buildMessageWindow(history, 20);
        expect(window).toEqual([
            { role: 'user', content: 'Stealth (DC 12): Rolled **14** — Success!' },
            { role: 'user', content: 'I sneak in.' },
            { role: 'assistant', content: 'You slip inside.' },
        ]);
    });

    it('applies the sliding window AFTER filtering, so hidden messages never consume window slots', () => {
        const history = [
            msg('user', 'keep-1'),
            ...Array.from({ length: 10 }, (_, i) => msg('assistant', `hidden-${i}`, { hidden: true })),
            msg('assistant', 'keep-2'),
        ];
        const window = buildMessageWindow(history, 2);
        expect(window.map(m => m.content)).toEqual(['keep-1', 'keep-2']);
    });

    it('tolerates missing content on system messages', () => {
        expect(buildMessageWindow([msg('system', undefined)], 5)).toEqual([]);
    });
});
