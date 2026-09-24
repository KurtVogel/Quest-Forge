/**
 * A fight's dice lines are weightless to the journal cadence and invisible to
 * scene presence (2026-09-23 combat-exchange P1) — pinned on the REAL reducer,
 * the real exchange planner, and real dice. The audit's fixture: a 9-exchange
 * fight (4 foes vs a L5 fighter + 2 companions) minted 64 `exchangeLine` rows
 * that THE narrative predicate counted as story, so the first post-fight turn
 * fired the cadence TWICE (two Flash calls, two journal entries for one fight)
 * and `buildPresenceText` was three roll lines after every commit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessageMock, backgroundConfigMock } = vi.hoisted(() => ({
    sendMessageMock: vi.fn(),
    backgroundConfigMock: vi.fn(),
}));

vi.mock('../llm/adapter.js', async (importOriginal) => ({
    ...(await importOriginal()),
    sendMessage: sendMessageMock,
}));
vi.mock('../llm/machinery.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getBackgroundConfig: backgroundConfigMock,
}));
vi.mock('../llm/scribe.js', async (importOriginal) => ({
    ...(await importOriginal()),
    runNpcFrontReflection: vi.fn().mockResolvedValue(undefined),
}));

const { gameReducer, initialGameState } = await import('../state/gameReducer.js');
const { COMBAT_PHASES, normalizeCombatExchange, planCombatExchange, planOpeningExchange } = await import('./combatExchange.js');
const { maybeAutoSummarize, resetSummarizeFailureTracker, SUMMARIZE_EVERY } = await import('./worldJournal.js');
const { buildPresenceText, collectNarrativeMessages } = await import('../llm/narrativeMessages.js');

const EXCHANGES = 9;

function fightState() {
    return {
        ...initialGameState,
        character: {
            name: 'Oda',
            race: 'human',
            class: 'fighter',
            level: 5,
            currentHP: 90,
            maxHP: 90,
            armorClass: 18,
            abilityScores: { strength: 18, dexterity: 14, constitution: 16, intelligence: 10, wisdom: 12, charisma: 8 },
            skillProficiencies: [],
            conditions: [],
        },
        inventory: [{ id: 'sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true }],
        party: [
            { id: 'c1', name: 'Torvald', hp: 40, maxHp: 40, ac: 17, level: 4, status: 'healthy' },
            { id: 'c2', name: 'Mira', hp: 36, maxHp: 36, ac: 16, level: 4, status: 'healthy' },
        ],
        npcs: [{ id: 'n1', name: 'Reeve Halvard', rosterTier: 'character', disposition: 'wary' }],
        settings: { ...initialGameState.settings, apiKey: 'k', llmProvider: 'gemini' },
        currentLocation: 'Marsh road',
        session: { ...initialGameState.session, id: 'session-fight' },
        messages: [
            { id: 'u0', role: 'user', content: 'I step onto the marsh road.' },
            { id: 'a0', role: 'assistant', content: 'Reeve Halvard waves you on. Four marsh bandits rise from the reeds.' },
        ],
    };
}

/** Narration is an ADD_MESSAGE plus the COMPLETE_COMBAT_NARRATION acknowledgment. */
function narrate(state, text) {
    const exchangeId = state.combat.lastExchangeResult.exchangeId;
    const withProse = gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'assistant', content: text } });
    return gameReducer(withProse, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId } });
}

/** Plays the audit's fight through the real reducer and planner with real dice. */
function playFight() {
    let state = gameReducer(fightState(), {
        type: 'START_COMBAT',
        payload: {
            enemies: Array.from({ length: 4 }, (_, i) => ({ name: `Marsh bandit ${i + 1}`, hp: 60, ac: 13, attackBonus: 1, damage: '1d4' })),
        },
    });
    const presenceAfterCommits = [];
    if (state.combat.phase === COMBAT_PHASES.OPENING) {
        state = gameReducer(state, { type: 'APPLY_COMBAT_EXCHANGE', payload: planOpeningExchange(state).payload });
        presenceAfterCommits.push(buildPresenceText(state.messages));
        state = narrate(state, 'The bandits close in through the reeds before you can set your feet.');
    }
    let played = 0;
    while (state.combat.active && played < EXCHANGES && state.character.currentHP > 0) {
        const foes = state.combat.enemies.filter(e => e.combatStatus === 'active' && e.hp > 0);
        if (foes.length === 0) break;
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: foes[0].name }] }],
            enemy_intents: foes.map(e => ({ enemy_id: e.id, action: 'attack', target: 'player' })),
        });
        const plan = planCombatExchange(state, intent);
        if (!plan.ok) break;
        state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'user', content: `I strike at ${foes[0].name}.` } });
        state = gameReducer(state, { type: 'APPLY_COMBAT_EXCHANGE', payload: plan.payload });
        presenceAfterCommits.push(buildPresenceText(state.messages));
        state = narrate(state, `Oda's blade rings against ${foes[0].name}; the reeds shake with the fight.`);
        played += 1;
    }
    if (state.combat.active) {
        state = gameReducer(state, { type: 'END_COMBAT', payload: { escaped: true, slainXpOnly: true } });
    }
    return { state, played, presenceAfterCommits };
}

beforeEach(() => {
    sendMessageMock.mockReset();
    sendMessageMock.mockResolvedValue(JSON.stringify({
        summary: 'Oda and her companions fought four marsh bandits on the marsh road.',
        npcs_encountered: [],
        location: 'Marsh road',
        key_decisions: [],
        consequences: [],
        world_facts: [],
    }));
    backgroundConfigMock.mockReset();
    backgroundConfigMock.mockReturnValue({ apiKey: 'k', provider: 'gemini', model: 'flash' });
    resetSummarizeFailureTracker();
});

describe('a 9-exchange fight and the journal cadence (2026-09-23 combat-exchange P1)', () => {
    it('mints dozens of exchange lines that are neither narrative nor presence, and fires ONE post-fight cadence at most', async () => {
        const { state, played, presenceAfterCommits } = playFight();
        expect(played).toBe(EXCHANGES);

        const exchangeLines = state.messages.filter(m => m.exchangeLine === true);
        // Hero + two companions act every exchange; the foes add theirs.
        expect(exchangeLines.length).toBeGreaterThanOrEqual(EXCHANGES * 3);
        // More raw rows than the batch cap — the shape that used to split the fight.
        expect(state.messages.length).toBeGreaterThan(40);

        // Not narrative: every narrative row is the player's line, the DM's
        // prose, or a plain engine status line — never a dice line.
        const narrative = collectNarrativeMessages(state.messages);
        expect(narrative.some(m => m.exchangeLine)).toBe(false);
        expect(narrative.filter(m => m.role === 'assistant').length).toBeGreaterThanOrEqual(EXCHANGES);
        expect(narrative.length).toBeGreaterThanOrEqual(SUMMARIZE_EVERY);

        // Not presence: after every commit the scene text is prose, never
        // "**Oda attacks Marsh bandit 4** — Rolled **20**…".
        expect(presenceAfterCommits.length).toBeGreaterThanOrEqual(EXCHANGES);
        for (const text of presenceAfterCommits) {
            expect(text).not.toContain('Rolled **');
            expect(text).toContain('Oda');
        }

        // ONE cadence: the first post-fight call summarizes the whole fight in
        // one batch; the next call finds nothing left.
        const dispatch = vi.fn();
        const first = await maybeAutoSummarize(state, dispatch, 0);
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
        expect(first.journalEntry).toBeTruthy();
        expect(first.index).toBe(state.messages.length);
        const payload = sendMessageMock.mock.calls[0][0].userMessage;
        expect(payload).not.toContain('Rolled **');
        expect(payload).toContain('the reeds shake');

        const second = await maybeAutoSummarize(state, dispatch, first.index);
        expect(second).toEqual({ index: first.index, journalEntry: null });
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });
});
