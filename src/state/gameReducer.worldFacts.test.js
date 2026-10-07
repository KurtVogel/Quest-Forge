import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { liveWorldFacts } from '../engine/worldFacts.js';

function stateWithFacts(facts) {
    return {
        ...initialGameState,
        worldFacts: facts.map((fact, i) => ({ id: `fact-${i}`, fact, category: 'event', timestamp: i })),
    };
}

describe('world-fact near-duplicate guard', () => {
    it('adds genuinely new facts in bulk', () => {
        const next = gameReducer(stateWithFacts(['The bandit captain Rarg is dead.']), {
            type: 'ADD_WORLD_FACTS',
            payload: [
                { fact: 'The village of Millhaven burned to the ground.', category: 'location' },
                { fact: 'Serah now leads the dockworkers.', category: 'character' },
            ],
        });
        expect(next.worldFacts).toHaveLength(3);
    });

    it('rejects an exact duplicate regardless of casing and punctuation', () => {
        const state = stateWithFacts(['The bandit captain Rarg is dead.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'the bandit captain Rarg is dead' }],
        });
        expect(next).toBe(state);
    });

    it('rejects a restatement whose meaningful tokens are contained in an existing fact', () => {
        const state = stateWithFacts(['Odo Ferrin is dead, killed at the docks during the smuggler raid.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'Odo Ferrin was killed at the docks.' }],
        });
        expect(next).toBe(state);
    });

    it('rejects the longer restatement of an existing shorter fact', () => {
        const state = stateWithFacts(['Odo Ferrin is dead.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'Odo Ferrin is now dead.' }],
        });
        expect(next).toBe(state);
    });

    it('keeps facts that merely share a subject but state something different', () => {
        const state = stateWithFacts(['Odo Ferrin is dead.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'Odo Ferrin secretly owned the Brine Rat tavern.' }],
        });
        expect(next.worldFacts).toHaveLength(2);
    });

    it('dedupes near-identical facts arriving within the same batch', () => {
        const next = gameReducer(stateWithFacts([]), {
            type: 'ADD_WORLD_FACTS',
            payload: [
                { fact: 'The north bridge collapsed into the river.' },
                { fact: 'The north bridge has collapsed into the river.' },
            ],
        });
        expect(next.worldFacts).toHaveLength(1);
    });

    it('applies the same guard to a single-entry batch', () => {
        // The singular ADD_WORLD_FACT action was removed in the 2026-07-31
        // dead-code sweep (never dispatched); the bulk path is the only path.
        const state = stateWithFacts(['The treaty between Harrowmont and the Guild is broken.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'The treaty between Harrowmont and the Guild is now broken!' }],
        });
        expect(next).toBe(state);
    });
});

describe('world-fact hostile-input type guard (2026-07-23 audit)', () => {
    it('rejects non-string facts instead of persisting a prompt-crashing record', () => {
        const state = stateWithFacts(['The bandit captain Rarg is dead.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACTS',
            payload: [
                { fact: 42, category: 'event' },
                { fact: ['an', 'array'], category: 'event' },
                { fact: { nested: 'object' } },
                'not-an-object',
                null,
            ],
        });
        expect(next).toBe(state); // nothing usable — state untouched
    });

    it('coerces a non-string category to general and clamps fact length', () => {
        const next = gameReducer(stateWithFacts([]), {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'X'.repeat(1000) + ' unique trailing detail', category: { weird: true } }],
        });
        expect(next.worldFacts).toHaveLength(1);
        expect(next.worldFacts[0].category).toBe('general');
        expect(next.worldFacts[0].fact.length).toBeLessThanOrEqual(400);
        expect(() => next.worldFacts[0].fact.toLowerCase()).not.toThrow();
    });

    it('LOAD_GAME heals poisoned saves: fixable records re-typed, unfixable dropped', () => {
        const save = {
            ...initialGameState,
            character: { name: 'Hero', race: 'human', class: 'fighter', level: 1, currentHP: 10, maxHP: 10, abilityScores: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 } },
            worldFacts: [
                { id: 'ok', fact: 'The mill burned down.', category: 'event', timestamp: 1 },
                { id: 'bad-cat', fact: 'Serah leads the dockworkers.', category: 9, timestamp: 2 },
                { id: 'poison', fact: { oops: true }, category: 'event', timestamp: 3 },
            ],
        };
        const loaded = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: save });
        const facts = loaded.worldFacts;
        expect(facts.map(f => f.id)).toEqual(['ok', 'bad-cat']);
        expect(facts[1].category).toBe('general');
        for (const f of facts) expect(typeof f.fact).toBe('string');
    });
});

describe('polarity-aware supersession (2026-09-29 — a fact can stop being true)', () => {
    it('a FLIP is stored and supersedes its twin; the twin leaves the live set but stays on the record', () => {
        const state = { ...stateWithFacts(['The bridge at Ashford is passable.']), messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] };
        const next = gameReducer(state, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The bridge at Ashford is not passable.' }] });
        expect(next.worldFacts).toHaveLength(2);
        const [old, fresh] = next.worldFacts;
        expect(old.supersededBy).toBe(fresh.id);
        expect(old.supersededAtMessage).toBe(2);
        expect(fresh.supersedes).toBe(old.id);
        expect(fresh.supersededBy).toBeUndefined();
    });

    it('a same-polarity restatement is still rejected, and a re-flip judges against the LIVE truth only', () => {
        const state = stateWithFacts(['The bridge at Ashford is passable.']);
        const flipped = gameReducer(state, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The bridge at Ashford is not passable.' }] });
        // Restating the now-superseded claim in the same polarity as the LIVE fact: duplicate.
        expect(gameReducer(flipped, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The Ashford bridge is not passable' }] })).toBe(flipped);
        // Flipping back: a third row superseding the second; the first stays buried.
        const back = gameReducer(flipped, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The bridge at Ashford is passable again.' }] });
        expect(back.worldFacts).toHaveLength(3);
        expect(back.worldFacts[1].supersededBy).toBe(back.worldFacts[2].id);
        expect(back.worldFacts[0].supersededBy).toBe(back.worldFacts[1].id);
        expect(back.worldFacts[2].supersedes).toBe(back.worldFacts[1].id);
    });

    it('LOAD_GAME types the ledger stamps and revives a fact whose superseding twin is not on record', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...initialGameState.character, name: 'A', race: 'human', class: 'fighter', level: 1 },
                inventory: [],
                messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
                worldFacts: [
                    { id: 'f1', fact: 'The bridge is passable.', supersededBy: 'f2', supersededAtMessage: '99' },
                    { id: 'f2', fact: 'The bridge is not passable.', supersedes: 'f1' },
                    { id: 'f3', fact: 'The mill is empty.', supersededBy: 'ghost', supersededAtMessage: 1 },
                    { id: 'f4', fact: 'The well is dry.', supersededBy: { evil: true }, supersedes: 42 },
                ],
            },
        });
        const byId = Object.fromEntries(next.worldFacts.map(f => [f.id, f]));
        expect(byId.f1.supersededBy).toBe('f2');
        expect(byId.f1.supersededAtMessage).toBe(2); // clamped to the transcript
        expect(byId.f2.supersedes).toBe('f1');
        expect(byId.f3.supersededBy).toBeUndefined(); // dangling pointer → live again
        expect(byId.f3.supersededAtMessage).toBeUndefined();
        expect(byId.f4.supersededBy).toBeUndefined();
        expect(byId.f4.supersedes).toBeUndefined();
    });
});

describe('an intent is not a deed (2026-10-07 — a plan ages, a restatement re-stamps it, the deed closes it)', () => {
    const msgs = n => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: 'x' }));

    it('stores a plan with aspect intent and its birth stamp; a restatement re-stamps the age instead of being dropped', () => {
        const born = gameReducer({ ...stateWithFacts([]), messages: msgs(2) }, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The baron plans to seize the Ashford mill at the new moon.' }] });
        expect(born.worldFacts).toHaveLength(1);
        expect(born.worldFacts[0].aspect).toBe('intent');
        expect(born.worldFacts[0].atMessage).toBe(2);
        const restated = gameReducer({ ...born, messages: msgs(8) }, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The baron still plans to seize the Ashford mill at the new moon' }] });
        expect(restated.worldFacts).toHaveLength(1);
        expect(restated.worldFacts[0].atMessage).toBe(8);
    });

    it('a deed naming the plan closes it: the plan leaves the live set and stays on the record, the deed stands', () => {
        const born = gameReducer({ ...stateWithFacts([]), messages: msgs(2) }, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The baron plans to seize the Ashford mill at the new moon.' }] });
        const planId = born.worldFacts[0].id;
        const done = gameReducer({ ...born, messages: msgs(12) }, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The baron seized the Ashford mill.', supersedes: planId }] });
        expect(done.worldFacts).toHaveLength(2);
        const [plan, deed] = done.worldFacts;
        expect(plan.supersededBy).toBe(deed.id);
        expect(plan.supersededAtMessage).toBe(12);
        expect(deed.supersedes).toBe(planId);
        expect(deed.aspect).toBeUndefined();
        expect(liveWorldFacts(done.worldFacts).map(f => f.id)).toEqual([deed.id]);
        // A failed plan closes the same way — the outcome is the fact, the plan is history.
        const failed = gameReducer({ ...born, messages: msgs(12) }, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The baron gave up the Ashford mill after the militia mustered.', supersedes: planId }] });
        expect(failed.worldFacts[0].supersededBy).toBe(failed.worldFacts[1].id);
    });

    it('the ref closes only a LIVE INTENT fact — a standing truth, a buried plan, or junk is ignored and the new fact still lands', () => {
        const standing = stateWithFacts(['Odo is dead.']);
        const ignored = gameReducer({ ...standing, messages: msgs(2) }, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'Odo lived in Ashford all his life.', supersedes: 'fact-0' }] });
        expect(ignored.worldFacts).toHaveLength(2);
        expect(ignored.worldFacts[0].supersededBy).toBeUndefined();
        expect(ignored.worldFacts[1].supersedes).toBeUndefined();
        const junk = gameReducer({ ...standing, messages: msgs(2) }, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The weir failed in the spring flood.', supersedes: { evil: true } }] });
        expect(junk.worldFacts).toHaveLength(2);
        expect(junk.worldFacts[1].supersedes).toBeUndefined();
    });

    it('LOAD_GAME keeps aspect intent, drops an unknown aspect, and a plan whose closing deed is missing is live again', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...initialGameState.character, name: 'A', race: 'human', class: 'fighter', level: 1 },
                inventory: [],
                messages: msgs(4),
                worldFacts: [
                    { id: 'p1', fact: 'The baron plans to seize the mill.', aspect: 'intent', atMessage: 2 },
                    { id: 'p2', fact: 'Tammo promised to return the knife.', aspect: 'intent', atMessage: 1, supersededBy: 'gone' },
                    { id: 's1', fact: 'Odo is dead.', aspect: 'bogus' },
                ],
            },
        });
        const byId = Object.fromEntries(next.worldFacts.map(f => [f.id, f]));
        expect(byId.p1.aspect).toBe('intent');
        expect(byId.p2.aspect).toBe('intent');
        expect(byId.p2.supersededBy).toBeUndefined();
        expect(byId.s1.aspect).toBeUndefined();
    });
});
