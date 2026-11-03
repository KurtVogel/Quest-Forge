import { describe, expect, it, vi } from 'vitest';
import { initialGameState } from '../state/gameReducer.js';
import { LOOT_AUDIT_RULES, runNarrationAudits } from './scribeAudits.js';

// The Scribe's own link (2026-11-03): "recorded_as" names the applied item a
// narrated item IS, copied from EVENTS ALREADY APPLIED. The engine's check is
// a character compare, never a word match — the megacampaign's "transit
// manifest stamped with Factor Vane's running-hound seal" vs the recorded
// "Syndicate cargo manifest" shared one word and earned a spurious card.

const base = (inventory = []) => ({ ...initialGameState, inventory, messages: [], npcs: [], ledger: [] });
const audit = (state, appliedEvents) => ({ sourceId: 'msg-20:scribe-loot', getState: () => state, appliedEvents, playerMessage: '' });
const applied = (overrides = {}) => ({ itemsFound: [], itemsLost: [], purchases: [], sells: [], startingItems: [], ...overrides });
const actions = (dispatch) => dispatch.mock.calls.map(([action]) => action);
const card = (dispatch) => actions(dispatch).find(action => action.payload?.kind === 'recovery');
const MANIFEST = "transit manifest stamped with Factor Vane's running-hound seal";

describe('the Scribe links a narrated item to the applied one it IS (recorded_as)', () => {
    it('the megacampaign manifest: a linked item is no leftover — no card, no grant', () => {
        const dispatch = vi.fn();
        runNarrationAudits({ narrated_loot: { items: [{ name: MANIFEST, quantity: 1, recorded_as: 'Syndicate cargo manifest' }] } }, {
            lootAudit: audit(base(), applied({ itemsFound: [{ name: 'Syndicate cargo manifest' }] })),
        }, dispatch);
        expect(card(dispatch)).toBeUndefined();
        expect(actions(dispatch).some(action => action.type === 'ADD_ITEM')).toBe(false);
    });

    it('the same pair WITHOUT the link is the card the word rule posted (the belt still holds)', () => {
        const dispatch = vi.fn();
        runNarrationAudits({ narrated_loot: { items: [{ name: MANIFEST, quantity: 1 }] } }, {
            lootAudit: audit(base(), applied({ itemsFound: [{ name: 'Syndicate cargo manifest' }] })),
        }, dispatch);
        expect(card(dispatch).payload.recovery.items).toEqual([{ name: MANIFEST, quantity: 1 }]);
    });

    it('a link to a name NOT on the applied list is ignored — the item falls through to the card', () => {
        const dispatch = vi.fn();
        runNarrationAudits({ narrated_loot: { items: [{ name: 'bone whistle', quantity: 1, recorded_as: 'Bounty writ' }] } }, {
            lootAudit: audit(base(), applied({ itemsFound: [{ name: 'Syndicate cargo manifest' }] })),
        }, dispatch);
        expect(card(dispatch).payload.recovery.items).toEqual([{ name: 'bone whistle', quantity: 1 }]);
    });

    it('the copy is compared with case and punctuation folded, never by words', () => {
        const dispatch = vi.fn();
        runNarrationAudits({ narrated_loot: { items: [
            { name: MANIFEST, quantity: 1, recorded_as: 'syndicate cargo manifest.' },
            { name: 'a second manifest', quantity: 1, recorded_as: 'cargo manifest' }, // two of three words: not a copy
        ] } }, {
            lootAudit: audit(base(), applied({ itemsFound: [{ name: 'Syndicate cargo manifest' }] })),
        }, dispatch);
        expect(card(dispatch).payload.recovery.items).toEqual([{ name: 'a second manifest', quantity: 1 }]);
    });

    it('a link covers a purchase and a starting item too', () => {
        const dispatch = vi.fn();
        runNarrationAudits({ narrated_loot: { items: [
            { name: 'the chandler\'s waxed coil', quantity: 1, recorded_as: 'ropeHempen' },
            { name: 'her father\'s knife', quantity: 1, recorded_as: 'Hunting knife' },
        ] } }, {
            lootAudit: audit(base(), applied({ purchases: [{ itemKey: 'ropeHempen', priceCp: 100 }], startingItems: [{ name: 'Hunting knife' }] })),
        }, dispatch);
        expect(card(dispatch)).toBeUndefined();
    });

    it('with nothing evented the link points at nothing and the item is recovered as before, link stripped', () => {
        const dispatch = vi.fn();
        runNarrationAudits({ narrated_loot: { items: [{ name: 'rusty iron key', quantity: 1, recorded_as: 'Iron keep keys' }] } }, {
            lootAudit: audit(base(), applied()),
        }, dispatch);
        const grant = actions(dispatch).find(action => action.type === 'ADD_ITEM');
        expect(grant.payload.name).toBe('rusty iron key');
        expect(grant.payload).not.toHaveProperty('recordedAs');
        expect(grant.payload).not.toHaveProperty('recorded_as');
    });

    it('a narrated loss linked to the applied loss or sale is no leftover; unlinked it is the card', () => {
        const stocked = base([{ id: 'p1', name: 'Pine brand', quantity: 1 }, { id: 't1', name: 'Torch', quantity: 2 }, { id: 'r1', name: 'Silver Ring', quantity: 1 }]);
        const linked = vi.fn();
        runNarrationAudits({ narrated_losses: { items: [
            { name: 'Pine brand', quantity: 1, recorded_as: 'Torch' },
            { name: 'Silver Ring', quantity: 1, recorded_as: 'Silver Ring' },
        ] } }, {
            lootAudit: audit(stocked, applied({ itemsLost: [{ name: 'Torch' }], sells: [{ name: 'Silver Ring', priceCp: 300 }] })),
        }, linked);
        expect(card(linked)).toBeUndefined();
        expect(actions(linked).some(action => action.type === 'REMOVE_ITEM_BY_NAME')).toBe(false);

        const unlinked = vi.fn();
        runNarrationAudits({ narrated_losses: { items: [{ name: 'Pine brand', quantity: 1 }] } }, {
            lootAudit: audit(stocked, applied({ itemsLost: [{ name: 'Torch' }] })),
        }, unlinked);
        expect(card(unlinked).payload.recovery).toMatchObject({ direction: 'out', items: [{ name: 'Pine brand', quantity: 1 }] });
    });

    it('a hostile recorded_as (huge, numeric, an object) is no link and never throws', () => {
        for (const recorded_as of ['x'.repeat(20000), 42, { name: 'Syndicate cargo manifest' }, null, ['Syndicate cargo manifest']]) {
            const dispatch = vi.fn();
            expect(() => runNarrationAudits({ narrated_loot: { items: [{ name: MANIFEST, quantity: 1, recorded_as }] } }, {
                lootAudit: audit(base(), applied({ itemsFound: [{ name: 'Syndicate cargo manifest' }] })),
            }, dispatch)).not.toThrow();
            expect(card(dispatch).payload.recovery.items).toEqual([{ name: MANIFEST, quantity: 1 }]);
        }
    });

    it('the Scribe is asked for the link, in both lanes, as a verbatim copy', () => {
        expect(LOOT_AUDIT_RULES).toContain('"recorded_as"');
        expect(LOOT_AUDIT_RULES).toMatch(/copied EXACTLY as listed/);
        expect(LOOT_AUDIT_RULES).toMatch(/"item lost by hero:" or "sale:"/);
    });
});
