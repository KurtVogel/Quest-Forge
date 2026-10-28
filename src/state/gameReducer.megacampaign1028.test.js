/**
 * Vesa's megacampaign (2026-10-28): a 2,983-message campaign begun on the
 * barest builds, read end to end. Six engine reasons the world kept
 * repeating itself — the old land's fronts never ended and blocked every new
 * land, DM REMINDERS re-billed dead pressures, the callback scorer preferred
 * the oldest memories, KNOWN NPCs seated the dead and the far away, legacy
 * records had no conversational clock, a full clock never doomed — plus the
 * swollen legacy dossiers and the DM claiming memory was loaded mid-outage.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { compactDossierText, curateNpcsForPrompt, isRecordedDead, KNOWN_NPC_STALE_MESSAGES } from '../engine/npcRoster.js';
import { FAR_LAND_CALLBACK_PENALTY, LONG_AGO_CALLBACK_MESSAGES, normalizeStoryMemoryCard, scoreStoryMemory } from '../engine/storyMemory.js';
import { buildSystemPromptParts, isThreatFact, MEMORY_UNAVAILABLE_NOTE } from '../llm/promptBuilder.js';

const T0 = 1_780_000_000_000;
const stampedMsgs = n => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `m${i}`, timestamp: T0 + i * 1000 }));
const msgs = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
const hero = { ...initialGameState.character, name: 'Vesa', level: 5, currentHP: 44, maxHP: 44, levelBonusRetired: true };

describe('legacy records learn when they happened (the transcript clock)', () => {
    it('LOAD_GAME stamps facts, cards and NPC sightings from their wall-clock stamps; a stamped record is untouched', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: hero, inventory: [], messages: stampedMsgs(100), session: { id: 's1' },
                worldFacts: [
                    { id: 'f1', fact: 'The bounty on Vesa stands at twenty crowns.', category: 'event', timestamp: T0 + 40_500, knownBy: [] },
                    { id: 'f2', fact: 'The ford is deep.', category: 'location', timestamp: T0 + 90_000, atMessage: 12, knownBy: [] },
                    { id: 'f3', fact: 'Before the story began.', category: 'lore', timestamp: T0 - 5_000, knownBy: [] },
                ],
                storyMemory: [{ id: 'c1', type: 'mystery', subject: 'The Deep Rooms', text: 'Something waits below the warren.', salience: 5, status: 'active', firstSeenAt: T0 + 10_000, lastSeenAt: T0 + 20_200 }],
                npcs: [{ id: 'n1', name: 'Captain Riven', lastSeen: T0 + 60_000, lastNotes: 'Dead; looted by Vesa.' }],
            },
        });
        const fact = id => loaded.worldFacts.find(f => f.id === id);
        expect(fact('f1').atMessage).toBe(41);
        expect(fact('f2').atMessage).toBe(12);
        expect(fact('f3').atMessage).toBe(0);
        expect(loaded.storyMemory[0]).toMatchObject({ firstSeenMessage: 11, lastSeenMessage: 21 });
        expect(loaded.npcs.find(n => n.name === 'Captain Riven').lastSeenMessage).toBe(61);
    });

    it('a transcript without a full, monotonic clock is never read', () => {
        const messages = stampedMsgs(10);
        messages[4] = { ...messages[4], timestamp: T0 - 1 };
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: hero, inventory: [], messages, session: { id: 's1' }, worldFacts: [{ id: 'f1', fact: 'A fact.', category: 'lore', timestamp: T0 + 5000, knownBy: [] }] },
        });
        expect(loaded.worldFacts[0].atMessage).toBeUndefined();
    });
});

describe('a full clock that never doomed opens its window on load', () => {
    it('the front filled before the doom feature gets doomAtMessage; one window at a time', () => {
        const full = (id) => ({ id, title: id, goal: 'g', stakes: 's', grimPortents: ['a', 'b', 'c', 'd'], clock: 6, maxClock: 6, stage: 4, status: 'active', faction: { name: `${id} faction`, goal: 'x' } });
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: hero, inventory: [], messages: msgs(50), session: { id: 's1' }, fronts: [full('front-a'), full('front-b')] },
        });
        expect(loaded.fronts[0].doomAtMessage).toBe(loaded.messages.length);
        expect(loaded.fronts[1].doomAtMessage ?? null).toBeNull();
    });

    it('never for a front whose every theater lies in another land than the hero\'s', () => {
        const front = { id: 'front-a', title: 'Trouble around Vault', goal: 'g', stakes: 's', grimPortents: ['a', 'b', 'c', 'd'], clock: 6, maxClock: 6, stage: 4, status: 'active', faction: { name: 'Spear-hunters', goal: 'x' } };
        const locations = [
            { id: 'l1', name: 'The basin', aliases: [], region: 'Jewelglade', theaterFrontIds: ['front-a'] },
            { id: 'l2', name: 'South watchtower', aliases: [], region: 'Eir-Vael' },
        ];
        const away = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: hero, inventory: [], messages: msgs(50), session: { id: 's1' }, fronts: [front], locations, currentLocation: 'South watchtower' },
        });
        expect(away.fronts[0].doomAtMessage ?? null).toBeNull();
        expect(away.fronts[0].status).toBe('active');
        const home = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: hero, inventory: [], messages: msgs(50), session: { id: 's1' }, fronts: [front], locations, currentLocation: 'The basin' },
        });
        expect(Number.isFinite(home.fronts[0].doomAtMessage)).toBe(true);
    });
});

describe('legacy dossier accretion compacts once', () => {
    it('drops restated and empty clauses; a richer later clause takes the earlier one\'s place; idempotent', () => {
        expect(compactDossierText('Nervous, timid, and;; Timid,;;;; Anxious and cautious.'))
            .toBe('Nervous, timid, and. Anxious and cautious.');
        const swollen = 'Pragmatic, loyal. Pragmatic, gritty, loyal. Tough in a fight.';
        const once = compactDossierText(swollen);
        expect(once).toBe('Pragmatic, gritty, loyal. Tough in a fight.');
        expect(compactDossierText(once)).toBe(once);
        const clean = 'Feral and devoted; hates the spear-hunters.';
        expect(compactDossierText(clean)).toBe(clean);
    });

    it('LOAD_GAME compacts the four merge-owned fields of every record', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: hero, inventory: [], messages: msgs(4), session: { id: 's1' }, npcs: [{ id: 'n1', name: 'Dim', personality: 'Anxious, loyal. anxious and loyal;;;', goals: 'Survive.', stanceToPlayer: 'Devoted. Devoted.' }] },
        });
        const dim = loaded.npcs.find(n => n.name === 'Dim');
        expect(dim.personality).toBe('Anxious, loyal.');
        expect(dim.stanceToPlayer).toBe('Devoted.');
        expect(dim.goals).toBe('Survive.');
    });
});

describe('KNOWN NPCs seats the living and the near', () => {
    const roster = [
        { id: 'a', name: 'Scarred Guard', rosterTier: 'character', disposition: 'hostile', importance: 5, lastNotes: 'Killed by Vesa.', lastSeenMessage: 10 },
        { id: 'b', name: 'Lady Celeste', rosterTier: 'character', disposition: 'wary', importance: 5, lastNotes: 'Parted ways with Vesa.', lastSeenMessage: 20 },
        { id: 'c', name: 'Gretka', rosterTier: 'character', disposition: 'friendly', lastNotes: 'Wrote a farewell letter.', lastSeenMessage: 30, bondMoments: [{ text: 'A night at the Drowned Rat.', kind: 'intimacy', salience: 5 }] },
        { id: 'd', name: 'Harl Demb', rosterTier: 'character', disposition: 'friendly', lastNotes: 'Thanked the party at the ford.', lastSeenMessage: 900 },
    ];
    const messages = msgs(10 + KNOWN_NPC_STALE_MESSAGES + 700);

    it('the score-fill skips the recorded dead and long-unseen non-friends; a bonded friend and a recent face stay', () => {
        const names = curateNpcsForPrompt(roster, { messages }).map(n => n.name);
        expect(names).toEqual(expect.arrayContaining(['Gretka', 'Harl Demb']));
        expect(names).not.toContain('Scarred Guard');
        expect(names).not.toContain('Lady Celeste');
    });

    it('a name in the prose seats the living and recent first — a far non-friend\'s name is a mention, not presence', () => {
        expect(curateNpcsForPrompt(roster, { messages, presentNames: ['Harl Demb'], limit: 1 }).map(n => n.name)).toEqual(['Harl Demb']);
        expect(curateNpcsForPrompt(roster, { messages, presentNames: ['Lady Celeste', 'Scarred Guard'] }).map(n => n.name))
            .not.toEqual(expect.arrayContaining(['Lady Celeste']));
        // A bonded friend named in the prose is still seated first.
        expect(curateNpcsForPrompt(roster, { messages, presentNames: ['Gretka'], limit: 1 }).map(n => n.name)).toEqual(['Gretka']);
    });

    it('a personality is compacted at the trait level, at most twelve, the most restated first', () => {
        const legacy = 'Pragmatic, ribald, affectionate. Pragmatic, cynical about nobility, protective. pragmatic, resilient, vigilant. Pragmatic, gritty, loyal. cynical';
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: hero, inventory: [], messages: msgs(4), session: { id: 's1' }, npcs: [{ id: 'k', name: 'Ketta Mor', personality: legacy }] },
        });
        expect(loaded.npcs.find(n => n.name === 'Ketta Mor').personality)
            .toBe('Pragmatic, ribald, affectionate, cynical about nobility, protective, resilient, vigilant, gritty, loyal.');
    });

    it('isRecordedDead reads the record\'s own latest note — never a note about someone the NPC killed', () => {
        expect(isRecordedDead({ lastNotes: 'Dead; looted by Vesa.' })).toBe(true);
        expect(isRecordedDead({ lastNotes: 'Bounty hunter defeated and executed by the player.' })).toBe(true);
        expect(isRecordedDead({ lastNotes: 'Struck down by Vesa and impaled; dead on the street.' })).toBe(true);
        expect(isRecordedDead({ lastNotes: 'Killed two guards at the gate and fled.' })).toBe(false);
        expect(isRecordedDead({ lastNotes: 'Mourns her brother, who was killed by bandits.' })).toBe(true); // the conservative edge: a recorded "killed by" reads as death
    });
});

describe('DM REMINDERS: an ended threat is not a pressure, and every pressure says its age', () => {
    it('a fact recording the threat\'s END is skipped', () => {
        expect(isThreatFact({ fact: "Captain Riven's bounty on Vesa is nullified with her death." })).toBe(false);
        expect(isThreatFact({ fact: 'The bounty on Vesa was lifted by the council.' })).toBe(false);
        expect(isThreatFact({ fact: 'A bounty on Vesa stands at twenty crowns.' })).toBe(true);
    });

    it('the reminder line carries "recorded N turns ago"', () => {
        const parts = buildSystemPromptParts({
            character: hero, inventory: [], quests: [], journal: [], npcs: [], party: [], messages: msgs(400), messageCount: 400,
            worldFacts: [{ id: 'f1', fact: 'A bounty on Vesa stands at twenty crowns.', category: 'event', atMessage: 100 }],
        });
        const reminders = parts.find(p => p.name === 'dmReminders').text;
        expect(reminders).toContain('A bounty on Vesa stands at twenty crowns. (recorded 150 turns ago)');
        expect(reminders).toContain('weigh its age');
    });
});

describe('callbacks weigh distance, not only age', () => {
    const locations = [
        { id: 'l1', name: 'Kraul Warren', aliases: [], region: 'Jewelglade' },
        { id: 'l2', name: 'South watchtower', aliases: [], region: 'Eir-Vael' },
    ];
    const card = (over = {}) => normalizeStoryMemoryCard({
        id: 'c1', type: 'mystery', subject: 'Chief Kraul\'s objective', text: 'The goblin archer spoke of a rust-tooth key and the Deep Rooms.',
        salience: 5, emotionalCharge: 0, linkedNpcNames: ['Chief Kraul'], location: 'Kraul Warren', lastSeenMessage: 10, ...over,
    });
    const scene = (n, over = {}) => ({ query: 'we rest at the watchtower', location: 'South watchtower', locations, messages: msgs(n), ...over });

    it('a memory from another land, with nobody here to say it, pays the far-land penalty', () => {
        const here = scoreStoryMemory(card({ location: 'South watchtower' }), scene(200));
        const far = scoreStoryMemory(card(), scene(200));
        expect(here - far).toBeGreaterThanOrEqual(FAR_LAND_CALLBACK_PENALTY);
    });

    it('a present speaker keeps the old rule: the age bonus, no penalty', () => {
        const withSpeaker = scoreStoryMemory(card(), scene(200, { npcs: [{ name: 'Chief Kraul' }] }));
        const without = scoreStoryMemory(card(), scene(200));
        expect(withSpeaker - without).toBeGreaterThanOrEqual(5 + FAR_LAND_CALLBACK_PENALTY + 3);
    });

    it('a memory of an unknown land loses its age bonus once it is long ago', () => {
        const unplaced = card({ location: 'an unnaturally symmetrical tunnel' });
        const recentish = scoreStoryMemory(unplaced, scene(10 + LONG_AGO_CALLBACK_MESSAGES - 2));
        const longAgo = scoreStoryMemory(unplaced, scene(10 + LONG_AGO_CALLBACK_MESSAGES + 50));
        expect(longAgo).toBeLessThan(recentish);
    });
});

describe('a new land makes room by putting a front left behind to sleep', () => {
    it('the front holding ground in the new land is never the one that sleeps', () => {
        let state = { ...initialGameState, messages: msgs(20), session: { ...initialGameState.session, id: 's1' }, character: hero };
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Aldermill' });
        state = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Aldermill', profile: { type: 'settlement', region: 'the Riverlands' }, evidenceText: 'Aldermill, in the Riverlands.' } });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Fort Halla' });
        state = {
            ...state,
            locations: state.locations.map(r => (r.name === 'Fort Halla' ? { ...r, theaterFrontIds: ['f0'] } : r)),
            fronts: ['f0', 'f1', 'f2'].map(id => ({ id, title: id.toUpperCase(), status: 'active' })),
        };
        const seeded = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { region: 'the Icebound Coast' }, evidenceText: 'Fort Halla, on the Icebound Coast.' } });
        expect(seeded.fronts.map(f => f.status)).toEqual(['active', 'dormant', 'active']);
        expect(seeded.session.pendingRegionalFronts).toMatchObject({ region: 'the Icebound Coast' });
    });
});

describe('memory down is said, never denied', () => {
    it('the prompt carries the memory note only while memory is unavailable', () => {
        const base = { character: hero, inventory: [], quests: [], journal: [], npcs: [], party: [], messages: msgs(10), messageCount: 10 };
        expect(buildSystemPromptParts({ ...base, memoryUnavailable: true }).find(p => p.name === 'memoryNote').text).toBe(MEMORY_UNAVAILABLE_NOTE);
        expect(buildSystemPromptParts(base).find(p => p.name === 'memoryNote')).toBeUndefined();
    });
});

describe('an interlude minted mid-turn is not spent by that turn\'s reply', () => {
    it('the reply to the player line before the mint leaves it open; the next reply spends it', () => {
        const interlude = { key: 'region|5', reason: 'region', mintedAtMessage: 5, opensAtMessage: 5, region: 'Eir-Vael', frontId: null, title: null, material: null };
        let state = { ...initialGameState, character: hero, messages: msgs(5), session: { ...initialGameState.session, id: 's1', interlude } };
        // msgs(5) ends on a user row at index 4: the shot was minted (count 5) AFTER it.
        state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'assistant', content: 'Packs hauled up.' } });
        expect(state.session.interlude).toMatchObject({ key: 'region|5' });
        state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'user', content: 'I light the hearth.' } });
        state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'assistant', content: '*Across the melt basin…* The fire catches.' } });
        expect(state.session.interlude ?? null).toBeNull();
    });
});
