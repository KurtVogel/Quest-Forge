/**
 * WOW 2026-10-22 (hidden-fronts-payoff, slice A parts b + c, Vesa's ruling):
 * a full clock is a DOOM, not a permission ceiling. The engine opens a doom
 * window on the front whose clock filled (crypto die 0–1 scenes, 24 rows),
 * the tempo block renders the final step as a scene the hero may still
 * answer, and a window that closes unanswered — after the DM's one ordinary
 * turn — resolves the front `outcome: 'prevailed'` through the one
 * conclusion ceremony with the sign flipped: the stakes as the pinned fact,
 * a loss-register 🕰️ line, no milestone XP, a doom echo that shows what it
 * COST, and a landing director that says what the world is now. The engine
 * never names the signs the hero walked past (the chapter and the record do,
 * on request).
 */
import { describe, expect, it } from 'vitest';
import {
    buildFrontResolutionFact,
    describeFrontDoom,
    DOOM_WINDOW_MESSAGES,
    FRONT_RECORD_KEYS,
    isFrontClockFull,
    normalizeFront,
    openDoomWindow,
} from './fronts.js';
import { buildWorldTempoBlock, describeDoomCard, describeDoomWindow, findOpenDoom, listClosedDooms } from './worldTempo.js';
import { sanitizeLivingWorldSession } from './livingWorldSession.js';
import { describeRevealedFronts } from '../llm/chronicler.js';
import { selectRegionalHearsay } from './regionalHearsay.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));

const brood = (extra = {}) => ({
    id: 'front-brood', title: 'The Mill Brood', goal: 'Claim the valley.', stakes: 'The mill falls and the valley starves.',
    grimPortents: ['Raids begin.', 'The mill is besieged.', 'The mill falls…'],
    clock: 5, maxClock: 6, stage: 2, status: 'active',
    publicHints: ['Burnt wagons on the north road.'],
    faction: { name: 'The Brood', goal: 'Feed on the valley.', stance: 'Hostile', relationships: [] },
    ...extra,
});

const campaign = (extra = {}) => ({
    ...initialGameState,
    messages: msgs(10),
    session: { ...initialGameState.session, id: 'campaign-1' },
    character: {
        name: 'Rauha', race: 'human', class: 'cleric', level: 3, exp: 0, maxHP: 20, currentHP: 20,
        abilityScores: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
    },
    fronts: [normalizeFront(brood())],
    locations: [
        { id: 'loc-mill', name: 'The Mill', aliases: [], theaterFrontIds: ['front-brood'], type: 'settlement' },
        { id: 'loc-town', name: 'Aldermill', aliases: [], theaterFrontIds: [], type: 'settlement' },
    ],
    currentLocation: 'Aldermill',
    worldTempo: { directive: { frontId: 'front-brood', maxIntensity: 'presence', grantedAtMessage: 8, activationDistance: 0, expiryDistance: 24 } },
    ...extra,
});

const user = (state, content = 'I act.') => gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'user', content } });
const dm = (state, content = 'The DM answers.') => gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'assistant', content } });
const stamp = (state, patch) => ({ ...state, fronts: state.fronts.map(f => (f.id === 'front-brood' ? normalizeFront({ ...f, ...patch }, f) : f)) });

describe('the record: the doom stamps and the outcome ride the front', () => {
    it('FRONT_RECORD_KEYS carries the four new keys and normalizeFront round-trips them', () => {
        expect(FRONT_RECORD_KEYS).toEqual(expect.arrayContaining(['outcome', 'doomAtMessage', 'doomActivationDistance', 'doomClosedAtMessage']));
        const front = normalizeFront(brood({ doomAtMessage: 40, doomActivationDistance: 2, doomClosedAtMessage: 70, outcome: 'prevailed', status: 'resolved' }));
        expect(front).toMatchObject({ doomAtMessage: 40, doomActivationDistance: 2, doomClosedAtMessage: 70, outcome: 'prevailed' });
        // A re-normalization without the fields keeps the existing stamps (the load twin).
        expect(normalizeFront({}, front)).toMatchObject({ doomAtMessage: 40, doomActivationDistance: 2, doomClosedAtMessage: 70, outcome: 'prevailed' });
        // Junk: an unknown outcome is null, a junk stamp is null, the delay clamps.
        expect(normalizeFront(brood({ outcome: 'lost', doomAtMessage: 'soon', doomActivationDistance: 99 })))
            .toMatchObject({ outcome: null, doomAtMessage: null, doomActivationDistance: 2 });
    });

    it('isFrontClockFull reads the clock against its own max', () => {
        expect(isFrontClockFull(brood())).toBe(false);
        expect(isFrontClockFull(brood({ clock: 6 }))).toBe(true);
        expect(isFrontClockFull(brood({ clock: 8, maxClock: 8 }))).toBe(true);
    });

    it('describeFrontDoom: the last authored step and the stakes as a clause; a portent-less front has only the stakes', () => {
        expect(describeFrontDoom(brood())).toEqual({ lastStep: 'The mill falls', stakes: 'The mill falls and the valley starves' });
        expect(describeFrontDoom(brood({ grimPortents: [] }))).toEqual({ lastStep: '', stakes: 'The mill falls and the valley starves' });
    });

    it('the canon fact of a doom states what the world now carries — no sign, no reproach', () => {
        const fact = buildFrontResolutionFact(normalizeFront(brood({ status: 'resolved', outcome: 'prevailed', resolution: 'The mill falls and the valley starves' })));
        expect(fact).toBe('The pressure known as "The Mill Brood" has come to pass; the world now carries it. The mill falls and the valley starves');
        expect(fact).not.toMatch(/could have|should have|missed|ignored/i);
        expect(buildFrontResolutionFact(normalizeFront(brood({ status: 'resolved' })), 'burned out')).toContain('resolved through the hero');
    });
});

describe('openDoomWindow — one window, on the first full clock', () => {
    it('opens on the first ACTIVE full front without a window, stamps the count and the die (0 or 1 scenes → 0 or 2 rows)', () => {
        const fronts = [normalizeFront(brood({ id: 'front-a', clock: 6 })), normalizeFront(brood({ id: 'front-b', clock: 6 }))];
        const { fronts: next, opened } = openDoomWindow(fronts, { messageCount: 30, delayScenes: 1 });
        expect(opened?.id).toBe('front-a');
        expect(next[0]).toMatchObject({ doomAtMessage: 30, doomActivationDistance: 2 });
        expect(next[1].doomAtMessage).toBeNull();
        expect(openDoomWindow(fronts, { messageCount: 30, delayScenes: 0 }).opened.doomActivationDistance).toBe(0);
    });

    it('never a second window while one is pending or open; a closed-and-stamped one frees the slot; never twice on one front; never on a resolved or unfilled front', () => {
        const open = normalizeFront(brood({ id: 'front-a', clock: 6, doomAtMessage: 10 }));
        const full = normalizeFront(brood({ id: 'front-b', clock: 6 }));
        expect(openDoomWindow([open, full], { messageCount: 20 }).opened).toBeNull();
        const stamped = normalizeFront({ ...open, doomClosedAtMessage: 40 }, open);
        expect(openDoomWindow([stamped, full], { messageCount: 41 }).opened?.id).toBe('front-b');
        expect(openDoomWindow([open], { messageCount: 50 }).opened).toBeNull();
        expect(openDoomWindow([normalizeFront(brood({ clock: 6, status: 'resolved' }))], { messageCount: 50 }).opened).toBeNull();
        expect(openDoomWindow([normalizeFront(brood({ clock: 5 }))], { messageCount: 50 }).opened).toBeNull();
        // Nothing to open returns the same array — no churn for the autosave.
        const unfilled = [normalizeFront(brood())];
        expect(openDoomWindow(unfilled, { messageCount: 5 }).fronts).toBe(unfilled);
        expect(openDoomWindow([], {}).fronts).toEqual([]);
    });
});

describe('describeDoomWindow — pending, open, closed in conversational rows', () => {
    const front = normalizeFront(brood({ clock: 6, doomAtMessage: 10, doomActivationDistance: 2 }));
    it('counts from the stamp: before the die lands pending, then open for DOOM_WINDOW_MESSAGES rows, then closed', () => {
        expect(describeDoomWindow(front, 11, msgs(11))).toEqual({ phase: 'pending', distance: 1 });
        expect(describeDoomWindow(front, 12, msgs(12))).toEqual({ phase: 'open', distance: 2 });
        expect(describeDoomWindow(front, 12 + DOOM_WINDOW_MESSAGES, msgs(12 + DOOM_WINDOW_MESSAGES)).phase).toBe('open');
        expect(describeDoomWindow(front, 13 + DOOM_WINDOW_MESSAGES, msgs(13 + DOOM_WINDOW_MESSAGES)).phase).toBe('closed');
    });

    it('dice-turn chatter never advances it; a resolved or window-less front has none', () => {
        const chatter = [...msgs(12), ...Array.from({ length: 30 }, () => ({ role: 'system', content: 'roll' }))];
        expect(describeDoomWindow(front, chatter.length, chatter).phase).toBe('open');
        expect(describeDoomWindow(normalizeFront({ ...front, status: 'resolved' }, front), 20, msgs(20))).toBeNull();
        expect(describeDoomWindow(normalizeFront(brood()), 20, msgs(20))).toBeNull();
        expect(findOpenDoom([front], 20, msgs(20))?.id).toBe('front-brood');
        expect(listClosedDooms([front], 60, msgs(60)).map(f => f.id)).toEqual(['front-brood']);
    });
});

describe('the doom card — the final step as a scene the hero may answer', () => {
    const full = normalizeFront(brood({ clock: 6, stage: 3, doomAtMessage: 10, doomActivationDistance: 0 }));
    const locations = campaign().locations;

    it('names the step and the stakes, happens HERE at the theater and arrives as NEWS elsewhere, and never reproaches', () => {
        const here = describeDoomCard(full, { locations, currentLocation: 'The Mill' });
        expect(here).toContain('THE CLOCK HAS RUN OUT for front-brood (The Brood — Feed on the valley.)');
        expect(here).toContain('The step: The mill falls.');
        expect(here).toContain('Unless it is stopped here, The mill falls and the valley starves.');
        expect(here).toContain('It happens in THIS scene');
        expect(here).toContain('status "resolved"');
        const away = describeDoomCard(full, { locations, currentLocation: 'Aldermill' });
        expect(away).toContain('It happens at The Mill; here it arrives as NEWS');
        // A front with no theater yet happens wherever the hero stands.
        expect(describeDoomCard(full, { locations: [], currentLocation: 'Aldermill' })).toContain('It happens in THIS scene');
        for (const card of [here, away]) {
            expect(card).toContain('never let the narrator say what the hero could have done earlier');
            expect(card).not.toMatch(/you missed|ignored the signs/i);
        }
    });

    it('rides the tempo block in the permission card\'s place, outranks a granted window, hides in combat, and is the doom echo after', () => {
        const state = campaign({ fronts: [full, normalizeFront(brood({ id: 'front-other', title: 'Other', faction: { name: 'Others', goal: 'g' } }))] });
        const args = (extra = {}) => ({
            fronts: state.fronts, worldTempo: { directive: { frontId: 'front-other', maxIntensity: 'presence', grantedAtMessage: 8, activationDistance: 0, expiryDistance: 24 } },
            paceDial: 'standard', messageCount: 20, messages: msgs(20), locations: state.locations, currentLocation: 'The Mill', ...extra,
        });
        const block = buildWorldTempoBlock(args());
        expect(block).toContain('THE CLOCK HAS RUN OUT for front-brood');
        expect(block).not.toContain("THIS SCENE'S PERMISSION");
        expect(block).not.toContain('The world is QUIET this scene');
        expect(buildWorldTempoBlock(args({ combatActive: true }))).not.toContain('THE CLOCK HAS RUN OUT');
        // Once prevailed: the loss register, and the victory instruction absent.
        const prevailed = normalizeFront({ ...full, status: 'resolved', outcome: 'prevailed', resolvedAtMessage: 40, resolution: 'The mill falls and the valley starves' }, full);
        const after = buildWorldTempoBlock(args({ fronts: [prevailed], worldTempo: null, messageCount: 50, messages: msgs(50) }));
        expect(after).toContain('THE PRESSURE "The Mill Brood" HAS COME TO PASS — The mill falls and the valley starves. It is done and it stands.');
        expect(after).toContain('Show what it cost concretely');
        expect(after).toContain('never let the narrator remark on what the hero might have done');
        expect(after).not.toContain('RECENT VICTORY');
        expect(after).not.toContain('Never resurrect it');
    });

    it('the everything-at-once ceiling holds with a doom card and a doom echo in the block (worldTempo pins 5,800)', () => {
        const pad = (label, n) => `${label} `.padEnd(n, label[0]);
        const big = (id, extra = {}) => normalizeFront(brood({
            id, faction: { name: pad(`Faction ${id}`, 100), goal: 'g'.repeat(300) },
            publicHints: Array.from({ length: 6 }, (_, i) => pad(`hint ${i}`, 240)),
            grimPortents: Array.from({ length: 6 }, (_, i) => pad(`portent ${i}`, 240)),
            stakes: 's'.repeat(280), clock: 8, maxClock: 8, stage: 6, ...extra,
        }));
        const doomed = big('front-a', { doomAtMessage: 90, doomActivationDistance: 0 });
        const echo = (id, outcome) => normalizeFront({ ...big(id), status: 'resolved', outcome, resolvedAtMessage: 95, resolution: 'r'.repeat(240), title: pad(`Ended ${id}`, 160) });
        const block = buildWorldTempoBlock({
            fronts: [doomed, big('front-b'), big('front-c'), big('front-d'), echo('front-x', null), echo('front-y', 'prevailed')],
            worldTempo: { directive: { frontId: 'front-b', maxIntensity: 'confrontation', where: 'w'.repeat(200), suggestedSymptom: 's'.repeat(300), grantedAtMessage: 90, activationDistance: 0, expiryDistance: 40 } },
            heat: { level: 'high', reasons: ['combat is happening right now', 'the hero is badly hurt'] },
            paceDial: 'slow-burn', messageCount: 100, messages: msgs(100), solo: true,
            locations: Array.from({ length: 3 }, (_, i) => ({ id: `t-${i}`, name: pad(`Theater ${i}`, 120), aliases: [], theaterFrontIds: ['front-a'] })),
            currentLocation: 'Elsewhere',
            recentEncounters: Array.from({ length: 10 }, (_, i) => ({ enemies: pad(`${i + 2}× marsh ghoul`, 200), location: pad(`Place ${i}`, 120), outcome: 'victory', messageIndex: 50 + i * 4 })),
        });
        expect(block).toContain('THE CLOCK HAS RUN OUT');
        expect(block).toContain('RECENT VICTORY');
        expect(block).toContain('HAS COME TO PASS');
        expect(block.length).toBeLessThan(5800);
    });
});

describe('the reducer: the window opens on both clock lanes', () => {
    it('the cadence batch that fills the clock opens the window at the live count', () => {
        const next = gameReducer(campaign(), {
            type: 'APPLY_FRONT_ADVANCE_BATCH',
            payload: { cadenceId: 'journal-campaign-1-10', journalEnd: 10, advances: [{ id: 'front-brood', delta: 1, symptom: 'Smoke over the mill.' }] },
        });
        const front = next.fronts[0];
        expect(front.clock).toBe(6);
        expect(front.doomAtMessage).toBe(10);
        expect([0, 2]).toContain(front.doomActivationDistance);
        // A batch that leaves the clock short opens nothing.
        const short = gameReducer(campaign(), {
            type: 'APPLY_FRONT_ADVANCE_BATCH',
            payload: { cadenceId: 'journal-campaign-1-10', journalEnd: 10, advances: [{ id: 'front-brood', delta: 0, symptom: 'Smoke.' }] },
        });
        expect(short.fronts[0].doomAtMessage).toBeNull();
    });

    it('a DM clock gain that fills the clock opens the window too', () => {
        const next = gameReducer(campaign(), { type: 'UPDATE_FRONT', payload: { id: 'front-brood', clock: 6 } });
        expect(next.fronts[0]).toMatchObject({ clock: 6 });
        expect(next.fronts[0].doomAtMessage).toBe(10);
    });
});

describe('the reducer: the close — one ordinary DM turn, then the pressure prevails', () => {
    // The window opened at row 10 with the die at 0: open through row 34, closed from 35.
    const doomed = () => stamp({ ...campaign(), messages: msgs(36) }, { clock: 6, stage: 3, doomAtMessage: 10, doomActivationDistance: 0 });

    it('inside the window a player row changes nothing', () => {
        const inside = stamp({ ...campaign(), messages: msgs(20) }, { clock: 6, stage: 3, doomAtMessage: 10, doomActivationDistance: 0 });
        const next = user(inside);
        expect(next.fronts[0].doomClosedAtMessage).toBeNull();
        expect(next.fronts[0].status).toBe('active');
    });

    it('the first player row after the close STAMPS; the DM answers; the next player row concludes the front as prevailed through the one ceremony', () => {
        const stamped = user(doomed());
        expect(stamped.fronts[0]).toMatchObject({ status: 'active', doomClosedAtMessage: 37 });
        const answered = dm(stamped);
        expect(answered.fronts[0].status).toBe('active');
        const next = user(answered);
        const front = next.fronts[0];
        expect(front).toMatchObject({ status: 'resolved', outcome: 'prevailed', resolvedAtMessage: 39, resolution: 'The mill falls and the valley starves', resolvedTheaterIds: ['loc-mill'] });
        // The sign flipped: no milestone XP, the doom marker (not the aftermath's), the nudge, the pinned fact, the freed theater, the cancelled window.
        expect(next.character.exp).toBe(0);
        expect(next.session.pendingFrontDoom).toEqual({ frontId: 'front-brood', title: 'The Mill Brood' });
        expect(next.session.pendingFrontAftermath).toBeUndefined();
        expect(next.session.chapterCloseSuggested).toMatchObject({ reason: 'front', frontId: 'front-brood' });
        expect(next.worldFacts.find(f => f.pinned && f.fact.includes('has come to pass'))).toBeTruthy();
        expect(next.locations.find(l => l.id === 'loc-mill').theaterFrontIds).toEqual([]);
        expect(next.worldTempo.directive).toBeNull();
        const line = next.messages.find(m => m.role === 'system' && m.content.includes('🕰️'));
        expect(line.content).toContain('"The Mill Brood" has come to pass.** What it wanted — Feed on the valley — it now has: The mill falls and the valley starves.');
        expect(line.content).not.toMatch(/What you saw|could have|should have|ignored|missed/i);
        expect(line.content).not.toContain('milestone');
        // Terminal: later rows change nothing, a DM "active" cannot revive it.
        const later = user(dm(next));
        expect(later.fronts[0].status).toBe('resolved');
        expect(gameReducer(later, { type: 'UPDATE_FRONT', payload: { id: 'front-brood', status: 'active', clock: 0 } }).fronts[0]).toMatchObject({ status: 'resolved', outcome: 'prevailed', clock: 6 });
    });

    it('the hero who ENDS it inside the window gets the victory ceremony, and no doom ever lands', () => {
        const inside = stamp({ ...campaign(), messages: msgs(20) }, { clock: 6, stage: 3, doomAtMessage: 10, doomActivationDistance: 0 });
        const won = gameReducer(inside, { type: 'UPDATE_FRONT', payload: { id: 'front-brood', status: 'resolved', notes: 'the nest burned' } });
        expect(won.fronts[0]).toMatchObject({ status: 'resolved', outcome: null, resolution: 'the nest burned' });
        expect(won.character.exp).toBe(900);
        expect(won.session.pendingFrontAftermath).toEqual({ frontId: 'front-brood', title: 'The Mill Brood' });
        expect(won.session.pendingFrontDoom).toBeUndefined();
        let state = won;
        for (let i = 0; i < 20; i += 1) state = user(dm(state));
        expect(state.fronts[0]).toMatchObject({ status: 'resolved', outcome: null });
        expect(state.session.pendingFrontDoom).toBeUndefined();
    });

    it('never settles inside combat, and a fight that ended since the stamp re-arms the DM\'s one turn', () => {
        const inCombat = { ...doomed(), combat: { ...initialGameState.combat, active: true } };
        expect(user(inCombat).fronts[0].doomClosedAtMessage).toBeNull();
        const stamped = user(doomed());
        const fought = { ...dm(stamped), recentEncounters: [{ enemies: 'brood drones', location: 'The Mill', outcome: 'victory', messageIndex: 38 }] };
        const rearmed = user(fought);
        expect(rearmed.fronts[0]).toMatchObject({ status: 'active', doomClosedAtMessage: 39 });
        expect(user(dm(rearmed)).fronts[0]).toMatchObject({ status: 'resolved', outcome: 'prevailed' });
    });

    it('a hidden player row (a withheld setup) is not a tick', () => {
        const next = gameReducer(doomed(), { type: 'ADD_MESSAGE', payload: { role: 'user', content: 'x', hidden: true } });
        expect(next.fronts[0].doomClosedAtMessage).toBeNull();
    });
});

describe('INSTALL_DOOM_AFTERMATH — the landing, bounded like absence drift', () => {
    const prevailed = () => {
        const base = user(dm(user(stamp({ ...campaign(), messages: msgs(36) }, { clock: 6, stage: 3, doomAtMessage: 10, doomActivationDistance: 0 }))));
        return {
            ...base,
            npcs: [
                { id: 'npc-ansa', name: 'Miller Ansa', rosterTier: 'character', agenda: 'Keep the mill.', lastNotes: 'At the mill.' },
                { id: 'npc-tam', name: 'Tam', rosterTier: 'character' },
                { id: 'npc-tam2', name: 'Tam Reed', rosterTier: 'character' },
            ],
        };
    };
    const successor = {
        title: 'The Brood Tithe', goal: 'Bleed the valley dry.', stakes: 'Every farm pays in grain and sons.',
        grimPortents: ['Collectors ride out.', 'A farm burns for refusing.', 'The sons march.'],
        faction: { name: 'The Brood', goal: 'Rule the valley through fear.', stance: 'Owns the hero', relationships: [] },
    };

    it('writes the fact, moves ONLY exact roster people, states known places, and the successor inherits the prevailed ground', () => {
        const state = prevailed();
        const next = gameReducer(state, {
            type: 'INSTALL_DOOM_AFTERMATH',
            payload: {
                sessionId: 'campaign-1', frontId: 'front-brood',
                change: {
                    fact: 'The Brood holds the mill and the valley pays it grain.',
                    developments: [
                        { name: 'Miller Ansa', agenda: 'Hide the seed grain from the Brood.' },
                        { name: 'Nobody Known', lastNotes: 'Should not appear.' },
                        { name: 'Tam', lastNotes: 'A shared name resolves to nobody.' },
                    ],
                    places: [{ name: 'The Mill', lastState: 'Held by the Brood; the wheel turns for them.' }, { name: 'Nowhere', lastState: 'x' }],
                    successors: [successor],
                },
            },
        });
        expect(next.session.pendingFrontDoom).toBeNull();
        expect(next.worldFacts.some(f => f.fact === 'The Brood holds the mill and the valley pays it grain.')).toBe(true);
        expect(next.npcs).toHaveLength(3);
        expect(next.npcs.find(n => n.id === 'npc-ansa')).toMatchObject({ agenda: 'Hide the seed grain from the Brood.', lastNotes: 'At the mill.' });
        expect(next.npcs.find(n => n.id === 'npc-tam').lastNotes).toBeUndefined();
        expect(next.locations.find(l => l.id === 'loc-mill').lastState).toBe('Held by the Brood; the wheel turns for them.');
        expect(next.locations).toHaveLength(2);
        const born = next.fronts.find(f => f.title === 'The Brood Tithe');
        expect(born).toMatchObject({ status: 'active', clock: 0, faction: { name: 'The Brood' } });
        expect(next.locations.find(l => l.id === 'loc-mill').theaterFrontIds).toEqual([born.id]);
        // One-shot: a replay installs nothing more.
        const replay = gameReducer(next, { type: 'INSTALL_DOOM_AFTERMATH', payload: { sessionId: 'campaign-1', frontId: 'front-brood', change: { successors: [{ ...successor, title: 'Again' }] } } });
        expect(replay).toBe(next);
    });

    it('the quiet landing clears the marker and installs nothing; a wrong key or session is dropped', () => {
        const state = prevailed();
        const quiet = gameReducer(state, { type: 'INSTALL_DOOM_AFTERMATH', payload: { sessionId: 'campaign-1', frontId: 'front-brood', change: {} } });
        expect(quiet.session.pendingFrontDoom).toBeNull();
        expect(quiet.fronts).toHaveLength(1);
        expect(quiet.npcs).toEqual(state.npcs);
        expect(gameReducer(state, { type: 'INSTALL_DOOM_AFTERMATH', payload: { sessionId: 'other', frontId: 'front-brood', change: {} } })).toBe(state);
        expect(gameReducer(state, { type: 'INSTALL_DOOM_AFTERMATH', payload: { sessionId: 'campaign-1', frontId: 'front-x', change: {} } })).toBe(state);
    });

    it('the give-up path consumes the marker through the registry row like every director', () => {
        let state = prevailed();
        for (let i = 0; i < 3; i += 1) {
            state = gameReducer(state, { type: 'DIRECTOR_ATTEMPT_FAILED', payload: { sessionId: 'campaign-1', name: 'frontDoom', key: 'front-brood' } });
        }
        expect(state.session.pendingFrontDoom).toBeNull();
        expect(state.session.directorFailures.frontDoom).toBeUndefined();
    });
});

describe('the readers of a prevailed front', () => {
    const done = normalizeFront(brood({ status: 'resolved', outcome: 'prevailed', resolvedAtMessage: 40, resolution: 'The mill falls and the valley starves', stage: 3, clock: 6 }));

    it('the load marker types like the aftermath\'s, keys only', () => {
        const session = sanitizeLivingWorldSession({ id: 's', pendingFrontDoom: { frontId: 'front-brood', title: 'The Mill Brood', junk: 1 } });
        expect(session.pendingFrontDoom).toEqual({ frontId: 'front-brood', title: 'The Mill Brood' });
        expect(sanitizeLivingWorldSession({ id: 's', pendingFrontDoom: 'front-brood' }).pendingFrontDoom).toBeNull();
    });

    it('hearsay carries a doom as news of what came to pass, never as a hero deed', () => {
        const { items } = selectRegionalHearsay({ fronts: [done], locations: campaign().locations, locationName: 'Aldermill', messages: msgs(60), messageIndex: 60 });
        expect(items[0].text).toBe('the pressure known as "The Mill Brood" coming to pass (The mill falls and the valley starves)');
        expect(items[0].text).not.toContain('the hero');
    });

    it('the chronicler receives a doom marked CAME TO PASS beside an ENDED one — the chapter is where the signs read back', () => {
        const lines = describeRevealedFronts([done, normalizeFront(brood({ id: 'front-won', title: 'Won', status: 'resolved', resolvedAtMessage: 42 }))], 30, 50);
        expect(lines[0]).toContain('"The Mill Brood" (CAME TO PASS — nobody ended it; what it wanted, it got): What it wanted: Feed on the valley.');
        expect(lines[1]).toContain('"Won" (ENDED by the hero)');
    });
});
