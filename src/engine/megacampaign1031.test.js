import { describe, expect, it } from 'vitest';
import {
    appendCallbackHooks, curateNpcsForPrompt, findNamedPeople, findNameTypoTwin, isLabelTension, isNameNamedIn,
    migrateLegacyNpc, properWordSet,
} from './npcRoster.js';
import { applyStoryMemoryDormancy, selectSettleCandidates } from './storyMemory.js';
import { dedupeLocationRecords, isSameLocation, normalizeLocationRecord, seedTravelLinksFromTrail } from './locationRegistry.js';
import { listFrontsLeftBehind } from './regionProfile.js';
import { describeFrontDoom } from './fronts.js';
import { listVoiceableTells } from './heroTells.js';
import { textWordSet } from './textMatch.js';
import { buildKnownFacts, settleReflectedCards } from '../llm/scribe.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

// 2026-10-31, Vesa's megacampaign read on the HEALED save: the DM's KNOWN
// NPCs carried seven friends a sea away, "scarred" / "heavy" seated dead
// fodder in the scene, 511 story cards stayed open with every kept promise,
// the Scribe never saw a world fact, and a single-word "tunnel" claimed a
// tunnel on another continent.

const scene = (text, player = '') => ({ playerWords: textWordSet(player), sceneWords: textWordSet(text), properWords: properWordSet(text) });

describe('a person is present when the scene NAMES them', () => {
    it('a role word in the narration is not a name; a capitalized name is', () => {
        expect(isNameNamedIn('Scarred Guard', scene('He flexed his scarred hand by the fire.'))).toBe(false);
        expect(isNameNamedIn('The heavy crossbowman', scene('A heavy rain fell on the parapet.'))).toBe(false);
        expect(isNameNamedIn('The heavy crossbowman', scene('The heavy crossbowman raised his weapon.'))).toBe(true);
        expect(isNameNamedIn('Armory Guard (Spearman)', scene('They dropped the rope into the armory racks.'))).toBe(false);
        expect(isNameNamedIn('Ketta Mor', scene('Ketta wipes her blade.'))).toBe(true);
        expect(isNameNamedIn('Ketta Mor', scene('', 'i ask ketta what she thinks'))).toBe(true);
    });

    it('a place word inside a person\'s name names nobody on its own', () => {
        const options = { ...scene('Jewelglade lies far to the north.'), placeTokens: new Set(['jewelglade']) };
        expect(isNameNamedIn('Jewelglade Guard', options)).toBe(false);
        expect(isNameNamedIn('Lady Celeste Jewelglade', options)).toBe(false);
        expect(isNameNamedIn('Lady Celeste Jewelglade', { ...options, ...scene('Celeste of Jewelglade waits.') })).toBe(true);
    });

    it('never an archived creature or the recorded dead', () => {
        const npcs = [
            { name: 'Scarred Cave-Worg', rosterTier: 'archived_creature' },
            { name: 'Marv', rosterTier: 'character', lastNotes: 'Killed by Vesa.' },
            { name: 'Ketta Mor', rosterTier: 'character' },
        ];
        const found = findNamedPeople(npcs, { sceneText: 'Marv\'s ghost? No — Ketta laughs at the Scarred Cave-Worg tale.' });
        expect(found.map(npc => npc.name)).toEqual(['Ketta Mor']);
    });
});

describe('KNOWN NPCs: a friend a land away leaves the score-fill', () => {
    const messages = Array.from({ length: 900 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: 'x' }));
    const locations = [
        { name: 'South watchtower', region: 'Eir-Vael' },
        { name: 'Oxtooth Gorge', region: 'Jewelglade' },
        { name: 'Crown Way', region: 'Eir-Vael' },
    ];
    const gretka = { id: 'g', name: 'Gretka', rosterTier: 'character', disposition: 'friendly', trust: 75, lastLocation: 'Oxtooth Gorge', lastSeenMessage: 10, stanceToPlayer: 'Fond.' };
    const harl = { id: 'h', name: 'Harl Demb', rosterTier: 'character', disposition: 'friendly', trust: 80, lastLocation: 'Crown Way', lastSeenMessage: 10, stanceToPlayer: 'Grateful.' };

    it('in a named land, a long-unseen friend known elsewhere (or nowhere) leaves; one known here stays', () => {
        const shown = curateNpcsForPrompt([gretka, harl], { location: 'South watchtower', messages, locations });
        expect(shown.map(npc => npc.name)).toEqual(['Harl Demb']);
    });

    it('with no land on record the 10-28 rule stands: the friend stays; named in the scene, she is seated', () => {
        expect(curateNpcsForPrompt([gretka], { location: 'Somewhere', messages, locations: [] }).map(n => n.name)).toEqual(['Gretka']);
        expect(curateNpcsForPrompt([gretka], { location: 'South watchtower', messages, locations, presentNames: ['Gretka'] }).map(n => n.name)).toEqual(['Gretka']);
    });
});

describe('story cards retire', () => {
    const journal = Array.from({ length: 12 }, (_, i) => ({ id: `j${i}`, summary: 's', messageRange: [i * 20, i * 20 + 19] }));
    const card = (extra) => ({ id: 'c', type: 'foreshadow', status: 'active', salience: 3, text: 't', subject: 's', lastSeenMessage: 5, ...extra });

    it('a salience-3 card or a promise sleeps after twelve silent cadences; canon and salience 5 never do', () => {
        const [fore, promise, canon, five] = applyStoryMemoryDormancy([
            card({ id: 'a' }), card({ id: 'b', type: 'promise' }), card({ id: 'c', type: 'playerCanon' }), card({ id: 'd', salience: 5 }),
        ], journal);
        expect([fore.status, promise.status, canon.status, five.status]).toEqual(['dormant', 'dormant', 'active', 'active']);
        expect(applyStoryMemoryDormancy([card({ id: 'a' })], journal.slice(1))[0].status).toBe('active');
    });

    it('the reflection is offered open cards the cadence touched first, then the longest silent', () => {
        const cards = [
            { id: 'old', type: 'promise', status: 'active', subject: 'Boru Senn', text: 'owes wages', lastSeenMessage: 3 },
            { id: 'toris', type: 'promise', status: 'active', subject: 'Toris escort payment', text: 'Toris owes three gold', linkedNpcNames: ['Toris'], lastSeenMessage: 400 },
            { id: 'canon', type: 'playerCanon', status: 'active', subject: 'x', text: 'y' },
            { id: 'done', type: 'promise', status: 'resolved', subject: 'z', text: 'z' },
        ];
        const offered = selectSettleCandidates(cards, { text: 'Toris paid the last three gold at the drop-yard.' });
        expect(offered.map(c => c.id)).toEqual(['toris', 'old']);
    });

    it('only an offered id, only resolved or dormant, once each', () => {
        const offered = [{ id: 'a' }, { id: 'b' }];
        expect(settleReflectedCards([
            { id: 'a', outcome: 'Resolved', reason: 'paid' }, { id: 'a', outcome: 'dormant' },
            { id: 'zzz', outcome: 'resolved' }, { id: 'b', outcome: 'active' }, 'junk',
        ], offered)).toEqual([{ id: 'a', status: 'resolved' }]);
    });

    it('a settle verdict lands through UPDATE_STORY_MEMORY', () => {
        const state = { ...initialGameState, storyMemory: [{ id: 'toris', type: 'promise', status: 'active', subject: 'Toris', text: 'Toris owes three gold.' }] };
        const next = gameReducer(state, { type: 'UPDATE_STORY_MEMORY', payload: { id: 'toris', status: 'resolved' } });
        expect(next.storyMemory[0].status).toBe('resolved');
    });
});

describe('the Scribe sees the facts on record', () => {
    it('the newest facts plus older ones the turn touches; never a plan', () => {
        const worldFacts = [
            { id: 'f1', fact: 'The old road slabs across the River Ghyll ford broke in the spring melt.', atMessage: 1 },
            ...Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, fact: `Newer fact number ${i} about the citadel.`, atMessage: 100 + i })),
            { id: 'p', fact: 'The baron plans to seize the mill.', aspect: 'intent', atMessage: 200 },
        ];
        const block = buildKnownFacts({ worldFacts }, 'We wade across the River Ghyll where the road slabs broke.');
        expect(block).toContain('Newer fact number 8');
        expect(block).toContain('River Ghyll ford broke');
        expect(block).not.toContain('baron');
        expect(buildKnownFacts({ worldFacts: [] }, 'x')).toBeNull();
    });
});

describe('NPC fields carry meaning', () => {
    it('a one-word tension is a label and leaves the record', () => {
        expect(isLabelTension('loyalty')).toBe(true);
        expect(isLabelTension('fear and leverage')).toBe(true);
        expect(isLabelTension('Owes him her life and hates needing him.')).toBe(false);
        expect(migrateLegacyNpc({ name: 'Hobb', relationshipTension: 'loyalty' }).relationshipTension).toBe('');
    });

    it('two hooks about one thing fold; the newer wording keeps the place', () => {
        const hooks = appendCallbackHooks(["His toast 'to new management' over Riven's dark liquor"], ["The toast shared over Riven's dark liquor", 'the ledger he still wants']);
        expect(hooks).toEqual(["The toast shared over Riven's dark liquor", 'the ledger he still wants']);
    });

    it('a one-letter slip of a bonded person\'s name is that person', () => {
        const npcs = [{ name: 'Ketta Mor', stanceToPlayer: 'Lover.' }, { name: 'Jon Hale' }];
        expect(findNameTypoTwin(npcs, 'Ketta Nor')).toBe(0);
        expect(findNameTypoTwin(npcs, 'Ketta Morrow')).toBe(-1);
        expect(findNameTypoTwin(npcs, 'Jon Hall')).toBe(-1); // no bond with the hero: no guess
        expect(findNameTypoTwin(npcs, 'Ketta')).toBe(-1);
        const state = { ...initialGameState, npcs: [{ id: 'k', name: 'Ketta Mor', rosterTier: 'character', kind: 'character', stanceToPlayer: 'Lover.' }] };
        const next = gameReducer(state, { type: 'UPDATE_NPC', payload: { name: 'Ketta Nor', lastNotes: 'Took the second watch.' } });
        expect(next.npcs).toHaveLength(1);
        expect(next.npcs[0]).toMatchObject({ name: 'Ketta Mor', lastNotes: 'Took the second watch.' });
    });

    it('a witness present twice is named once', () => {
        const tells = [{ id: 't', kind: 'manner', text: 'jokes on the trail', witnesses: ['Ketta Mor'], sightings: [{ atMessage: 1 }, { atMessage: 40 }, { atMessage: 80 }], lastSeenMessage: 80 }];
        const [entry] = listVoiceableTells(tells, { presentNames: ['Ketta Mor', 'Ketta Mor'], messageCount: 90 });
        expect(entry?.witnesses).toEqual(['Ketta Mor']);
    });
});

describe('places: a kind of place is not a place', () => {
    it('a name of place-kind words matches only by its whole word set', () => {
        expect(isSameLocation('tunnel', 'Crown Way transit tunnel (under the northern ridge)')).toBe(false);
        expect(isSameLocation('The basin', 'Submerged Imperial Toll Slip, Crown Way (Eir-Vael Basin)')).toBe(false);
        expect(isSameLocation('The Tunnel', 'tunnel')).toBe(true);
        expect(isSameLocation('Clockwork Tower', 'Library landing, Clockwork Tower')).toBe(true);
    });

    it('"<the place>, <its town>" folds into the place even when the place was typed a settlement', () => {
        const inn = normalizeLocationRecord({ name: 'Gatehouse Inn', type: 'settlement' });
        const twin = normalizeLocationRecord({ name: 'Gatehouse Inn, Bramblecross' });
        expect(dedupeLocationRecords([inn, twin])).toHaveLength(1);
        const town = normalizeLocationRecord({ name: 'Bramblecross', type: 'settlement' });
        expect(dedupeLocationRecords([town, normalizeLocationRecord({ name: 'Bramblecross market' })])).toHaveLength(2);
    });

    it('the trail backfill is rebuilt each load and never spans a step it cannot place', () => {
        const a = normalizeLocationRecord({ name: 'Fissure of Kraul' });
        const b = normalizeLocationRecord({ name: 'South watchtower' });
        const c = normalizeLocationRecord({ name: 'Outer bailey' });
        const stale = [{ ...b, links: [{ id: a.id }] }, a, c];
        const seeded = seedTravelLinksFromTrail(stale, ['Fissure of Kraul', 'Somewhere unrecorded', 'Outer bailey', 'South watchtower']);
        const tower = seeded.find(r => r.name === 'South watchtower');
        expect(tower.links.map(link => link.id)).toEqual([c.id]);
        const stamped = [{ ...b, links: [{ id: a.id, atMessage: 40 }] }, a, c];
        expect(seedTravelLinksFromTrail(stamped, []).find(r => r.name === 'South watchtower').links).toHaveLength(1);
    });
});

describe('a doom left behind waits for the hero', () => {
    const locations = [
        { name: 'tunnel', region: 'Jewelglade', theaterFrontIds: ['vault'] },
        { name: 'South watchtower', region: 'Eir-Vael' },
    ];
    const front = { id: 'vault', status: 'active', clock: 6, maxClock: 6, stage: 4, title: 'Trouble around Vault', grimPortents: ['a', 'b', 'c', 'd'], stakes: 'What changes in Vault if nobody interferes?' };

    it('abroad it is left behind; home again it is not', () => {
        expect(listFrontsLeftBehind([front], locations, 'South watchtower')).toEqual(['vault']);
        expect(listFrontsLeftBehind([front], locations, 'tunnel')).toEqual([]);
    });

    it('a full clock abroad opens nothing; the first player row home opens it', () => {
        const base = { ...initialGameState, fronts: [front], locations, currentLocation: 'South watchtower', messages: [] };
        const abroad = gameReducer(base, { type: 'SETTLE_DOOMS' });
        expect(abroad.fronts[0].doomAtMessage).toBeUndefined();
        const home = gameReducer({ ...base, currentLocation: 'tunnel' }, { type: 'SETTLE_DOOMS' });
        expect(Number.isFinite(home.fronts[0].doomAtMessage)).toBe(true);
    });

    it('a question is not stakes', () => {
        expect(describeFrontDoom(front).stakes).toBe('');
        expect(describeFrontDoom({ ...front, stakes: 'The vault opens and the dead walk.' }).stakes).toContain('vault opens');
    });
});
