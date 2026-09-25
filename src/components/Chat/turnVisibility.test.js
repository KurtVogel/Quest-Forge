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

    it('keeps dmVisible system lines — coin/loot receipts the DM must see (P1 2026-08-31)', () => {
        // Without these the DM was structurally blind to engine coin/loot
        // accounting and re-emitted an already-banked reward at quest completion.
        const history = [
            msg('user', 'I hand over the caravan papers.'),
            msg('system', '**+2 gp** received — purse: 25 gp.', { dmVisible: true }),
            msg('system', '**Loot recovered from narration:** Potion of Healing added to your possessions.', { dmVisible: true }),
            msg('system', 'Autosave complete.'),
            msg('assistant', 'The merchant counts out your pay.'),
        ];
        const window = buildMessageWindow(history, 20);
        // Two consecutive receipts fold into ONE row (2026-09-25) — same bytes, one slot.
        expect(window.map(m => m.content)).toEqual([
            'I hand over the caravan papers.',
            '**+2 gp** received — purse: 25 gp.\n**Loot recovered from narration:** Potion of Healing added to your possessions.',
            'The merchant counts out your pay.',
        ]);
        // System lines still travel as user role.
        expect(window[1].role).toBe('user');
    });

    describe('consecutive receipts fold into one window row (2026-09-25 inventory-economy Lap-3 P2)', () => {
        const receipt = (content) => msg('system', content, { dmVisible: true });

        it('seven receipts from one response consume ONE slot and reach the provider as one user turn', () => {
            const receipts = [
                'Bought Dagger for 2 gp — purse: 98 gp.',
                'Bought Torch for 1 cp — purse: 97 gp, 9 sp, 9 cp.',
                'Bought Potion of Healing for 50 gp — purse: 47 gp, 9 sp, 9 cp.',
                'Bought 3x Rations (1 day) for 1 gp, 5 sp — purse: 46 gp, 4 sp, 9 cp.',
                'Bought Hempen Rope (50 ft) for 1 gp — purse: 45 gp, 4 sp, 9 cp.',
                'Bought Shortsword for 10 gp — purse: 35 gp, 4 sp, 9 cp.',
                '**+5 gp** received — purse: 40 gp, 4 sp, 9 cp.',
            ];
            const history = [
                ...Array.from({ length: 16 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `fiction-${i}`)),
                msg('user', 'I buy the lot and take the reward.'),
                msg('assistant', 'The merchant tallies it up.'),
                ...receipts.map(receipt),
                msg('system', 'Autosave complete.'),
            ];
            const window = buildMessageWindow(history, 20);
            // Every receipt line is present, in order, in one row...
            const folded = window[window.length - 1];
            expect(folded.role).toBe('user');
            expect(folded.content).toBe(receipts.join('\n'));
            // ...so the window still holds 18 rows of fiction, not 12.
            expect(window).toHaveLength(19);
            expect(window.filter(m => m.content.startsWith('fiction-'))).toHaveLength(16);
            // The receipt row follows an assistant row: no run of consecutive user turns.
            const consecutiveUsers = window.reduce((n, m, i) => (i > 0 && m.role === 'user' && window[i - 1].role === 'user' ? n + 1 : n), 0);
            expect(consecutiveUsers).toBe(0);
        });

        it('a roll line or fiction between receipts breaks the run; dropped rows are transparent to it', () => {
            const history = [
                receipt('Bought Dagger for 2 gp — purse: 3 gp.'),
                msg('system', 'Autosave complete.'),
                receipt('**+1 gp** received — purse: 4 gp.'),
                msg('system', 'Stealth (DC 12): Rolled **14** — Success!'),
                receipt('Sold Dagger for 1 gp — purse: 5 gp.'),
                msg('assistant', 'Done.'),
                receipt('Bought Torch for 1 cp — purse: 4 gp, 9 sp, 9 cp.'),
            ];
            expect(buildMessageWindow(history, 20).map(m => m.content)).toEqual([
                'Bought Dagger for 2 gp — purse: 3 gp.\n**+1 gp** received — purse: 4 gp.',
                'Stealth (DC 12): Rolled **14** — Success!',
                'Sold Dagger for 1 gp — purse: 5 gp.',
                'Done.',
                'Bought Torch for 1 cp — purse: 4 gp, 9 sp, 9 cp.',
            ]);
        });

        it('the fold happens BEFORE the slice, so a receipt run never costs more than one slot', () => {
            const history = [
                msg('user', 'keep-1'),
                msg('assistant', 'keep-2'),
                ...Array.from({ length: 10 }, (_, i) => receipt(`receipt-${i}`)),
            ];
            const window = buildMessageWindow(history, 3);
            expect(window.map(m => m.content.split('\n')[0])).toEqual(['keep-1', 'keep-2', 'receipt-0']);
            expect(window[2].content.split('\n')).toHaveLength(10);
        });

        it('a folded row still respects the content belt', () => {
            const history = Array.from({ length: 3 }, (_, i) => receipt('x'.repeat(9000) + i));
            const [row] = buildMessageWindow(history, 5);
            expect(row.content.length).toBeLessThanOrEqual(20000);
        });
    });

    it('drops combat-exchange result lines even though they match the roll-line keep rule', () => {
        // A full exchange (hero + companions + 4 foes) used to eat ~8 of 20 window
        // slots per round; the narration prompt already carries these lines as
        // RESOLVED EVENTS (DECISIONS.md 2026-08-04).
        const history = [
            msg('user', 'I attack the worg.'),
            msg('system', '**Astra attacks Worg** — Rolled **17** vs AC 13; **Hit for 8 damage.**', { exchangeLine: true }),
            msg('system', '**Worg attacks Astra** — Rolled **9** vs AC 16; Miss.', { exchangeLine: true }),
            msg('system', 'Stealth (DC 12): Rolled **14** — Success!'),
            msg('assistant', 'Steel rings against fur and fury.'),
        ];
        const window = buildMessageWindow(history, 20);
        expect(window.map(m => m.content)).toEqual([
            'I attack the worg.',
            'Stealth (DC 12): Rolled **14** — Success!',
            'Steel rings against fur and fury.',
        ]);
    });
});
