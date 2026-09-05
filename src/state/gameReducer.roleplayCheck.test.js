import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

describe('pending roleplay check state', () => {
    const proposal = {
        rolls: [{ type: 'skill_check', skill: 'insight', dc: 10, description: 'Read the envoy' }],
        playerAction: 'I watch the envoy carefully.',
        challengeUsed: false,
    };

    it('stores and clears a proposal without rolling', () => {
        const proposed = gameReducer(initialGameState, { type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal });
        expect(proposed.pendingRoleplayCheck).toMatchObject(proposal);
        expect(proposed.rollHistory).toEqual([]);

        const cleared = gameReducer(proposed, { type: 'CLEAR_ROLEPLAY_CHECK' });
        expect(cleared.pendingRoleplayCheck).toBeNull();
    });

    it('does not create a roleplay proposal during active combat', () => {
        const combatState = { ...initialGameState, combat: { ...initialGameState.combat, active: true } };
        expect(gameReducer(combatState, { type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal })).toBe(combatState);
    });

    it('appends a heat-ledger entry per proposal, replacing a re-proposal by lineage even after new messages', () => {
        const withMessages = {
            ...initialGameState,
            messages: Array.from({ length: 6 }, () => ({ role: 'user', content: 'x' })),
        };
        const proposed = gameReducer(withMessages, { type: 'PROPOSE_ROLEPLAY_CHECK', payload: { ...proposal, id: 'rc-1' } });
        expect(proposed.recentChecks).toEqual([{ messageIndex: 6, dc: 10, skill: 'insight', proposalId: 'rc-1' }]);

        // A challenge REVISE lands AFTER the "Roll challenge" line and the hidden
        // ruling message — a different messageIndex — but supersedes rc-1, so the
        // same moment is counted once (the old same-index rule never fired live).
        const afterChallenge = {
            ...proposed,
            messages: [...proposed.messages, { role: 'user', content: 'challenge' }, { role: 'assistant', content: '', hidden: true }],
        };
        const revised = gameReducer(afterChallenge, {
            type: 'PROPOSE_ROLEPLAY_CHECK',
            payload: { ...proposal, id: 'rc-2', supersedesId: 'rc-1', rolls: [{ type: 'skill_check', skill: 'insight', dc: 8 }] },
        });
        expect(revised.recentChecks).toEqual([{ messageIndex: 8, dc: 8, skill: 'insight', proposalId: 'rc-2' }]);

        // A genuinely new proposal (no lineage) at a later index appends.
        const later = { ...revised, messages: [...revised.messages, { role: 'user', content: 'y' }] };
        const fresh = gameReducer(later, { type: 'PROPOSE_ROLEPLAY_CHECK', payload: { ...proposal, id: 'rc-3' } });
        expect(fresh.recentChecks.map(e => e.proposalId)).toEqual(['rc-2', 'rc-3']);
    });

    it('LOAD_GAME types and clamps hostile roll fields on a restored proposal (2026-09-02 audit)', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: initialGameState.character,
                inventory: [],
                pendingRoleplayCheck: {
                    id: 'rc-hostile',
                    playerAction: 'I pick the lock.',
                    rolls: [
                        { type: 'skill_check', skill: 'sleight of hand', dc: -100, advantage: 'yes' },
                        { type: 'skill_check', skill: 'perception', dc: '12', disadvantage: 0, modifier: '40', damage: { evil: true } },
                    ],
                },
            },
        });
        const [lock, spot] = loaded.pendingRoleplayCheck.rolls;
        expect(lock.dc).toBe(0);            // clamped — never a guaranteed-success negative DC
        expect(lock.advantage).toBe(true);  // boolean, not the string "yes"
        expect(spot.dc).toBe(12);           // a numeric string DC coerces (2026-09-05); junk still defaults to 10
        expect(spot.disadvantage).toBe(false);
        expect(spot.modifier).toBeNull();
        expect(spot.damage).toBeNull();
    });

    it('records no-dice rulings, capping the ledger and rejecting malformed entries', () => {
        const ruling = {
            objective: 'Convince Maren to share gossip',
            skill: 'persuasion',
            dc: 12,
            outcome: 'set_aside',
            atMessageCount: 6,
            location: 'Gilded Eel',
        };
        const recorded = gameReducer(initialGameState, { type: 'RECORD_ROLL_RULING', payload: ruling });
        expect(recorded.recentRulings).toHaveLength(1);
        expect(recorded.recentRulings[0]).toMatchObject({ objective: 'Convince Maren to share gossip', outcome: 'set_aside' });

        expect(gameReducer(initialGameState, { type: 'RECORD_ROLL_RULING', payload: { outcome: 'set_aside' } })).toBe(initialGameState);

        let state = initialGameState;
        for (let i = 0; i < 8; i++) {
            state = gameReducer(state, { type: 'RECORD_ROLL_RULING', payload: { ...ruling, objective: `Objective ${i}` } });
        }
        expect(state.recentRulings).toHaveLength(5);
        expect(state.recentRulings[4].objective).toBe('Objective 7');
    });

    it('reveals a hidden setup message once, marking it as revealed', () => {
        const withMessages = {
            ...initialGameState,
            messages: [
                { id: 'msg-1', role: 'assistant', content: 'Visible narration.', hidden: false },
                { id: 'msg-2', role: 'assistant', content: 'Withheld setup fiction.', hidden: true },
                { id: 'msg-3', role: 'assistant', content: '', hidden: true },
            ],
        };

        const revealed = gameReducer(withMessages, { type: 'REVEAL_MESSAGE', payload: { id: 'msg-2' } });
        expect(revealed.messages[1]).toMatchObject({ hidden: false, revealedSetup: true, content: 'Withheld setup fiction.' });
        expect(revealed.messages[0].revealedSetup).toBeUndefined();

        // Non-hidden, empty, and unknown targets are all no-ops.
        expect(gameReducer(withMessages, { type: 'REVEAL_MESSAGE', payload: { id: 'msg-1' } })).toBe(withMessages);
        expect(gameReducer(withMessages, { type: 'REVEAL_MESSAGE', payload: { id: 'msg-3' } })).toBe(withMessages);
        expect(gameReducer(withMessages, { type: 'REVEAL_MESSAGE', payload: { id: 'nope' } })).toBe(withMessages);
    });

    it('stores a proposal containing setup-phase loot and sanitizes it correctly', () => {
        const proposalWithLoot = {
            ...proposal,
            loot: {
                goldFound: 15,
                silverFound: 20,
                copperFound: 0,
                itemsFound: ['silver ring', { name: 'Potion of Healing', quantity: 1, itemKey: 'potion_healing' }],
            },
        };
        const proposed = gameReducer(initialGameState, { type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposalWithLoot });
        expect(proposed.pendingRoleplayCheck.loot).toEqual({
            goldFound: 15,
            silverFound: 20,
            copperFound: 0,
            itemsFound: [
                'silver ring',
                { name: 'Potion of Healing', quantity: 1, itemKey: 'potion_healing' },
            ],
        });
    });
});
