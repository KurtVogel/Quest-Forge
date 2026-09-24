import { describe, expect, it } from 'vitest';
import {
    HERO_TELLS_BLOCK_CHAR_CEILING,
    HERO_TELLS_STANDING_RULE,
    HERO_TELL_FADE_MESSAGES,
    HERO_TELL_PROMPT_CAP,
    HERO_TELL_SCENE_MESSAGES,
    MAX_HERO_TELLS,
    beatVoicedByFiction,
    buildHeroTellBeatBlock,
    buildHeroTellsBlock,
    findHeroTellMatch,
    isHeroTellEstablished,
    isHeroTellLive,
    isSameTell,
    listVoiceableTells,
    mintHeroTellBeat,
    normalizeHeroTell,
    prepareHeroTellReports,
    recordHeroTells,
    sanitizeHeroTellBeat,
    sanitizeHeroTells,
    selectHeroTellCandidate,
    stampTellVoiced,
} from './heroTells.js';

const PIPE = { text: 'digs out his pipe and walks off when a conversation turns on him', kind: 'habit', witnesses: ['Maren'] };
const JOKES = { text: 'jokes the moment things get serious', kind: 'manner', witnesses: ['Maren', 'Bran'] };

function sightings(reports, scenes) {
    let tells = [];
    for (const at of scenes) tells = recordHeroTells(tells, reports, { messageCount: at });
    return tells;
}

describe('hero tells — recording (2026-09-23)', () => {
    it('a new pattern joins with its first sighting; the same scene restated is still ONE sighting', () => {
        const first = recordHeroTells([], [PIPE], { messageCount: 10 });
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({ kind: 'habit', witnesses: ['Maren'], sightings: [10], firstSeenMessage: 10, lastSeenMessage: 10 });
        const sameScene = recordHeroTells(first, [PIPE], { messageCount: 10 + HERO_TELL_SCENE_MESSAGES });
        expect(sameScene[0].sightings).toEqual([10]);
        expect(sameScene[0].lastSeenMessage).toBe(10 + HERO_TELL_SCENE_MESSAGES);
    });

    it('a re-worded restatement merges into the held tell (id or containment), unions witnesses, keeps the richer text', () => {
        const held = recordHeroTells([], [PIPE], { messageCount: 10 });
        const reworded = { text: 'he digs out his pipe and walks away whenever the conversation turns on him', kind: 'habit', witnesses: ['Bran'] };
        const merged = recordHeroTells(held, [reworded], { messageCount: 40 });
        expect(merged).toHaveLength(1);
        expect(merged[0].sightings).toEqual([10, 40]);
        expect(merged[0].witnesses).toEqual(['Maren', 'Bran']);
        expect(merged[0].text).toBe(reworded.text);
        const byId = recordHeroTells(merged, [{ id: merged[0].id, text: 'the pipe again', kind: 'habit', witnesses: ['Maren'] }], { messageCount: 80 });
        expect(byId).toHaveLength(1);
        expect(byId[0].sightings).toEqual([10, 40, 80]);
        // A fragment never clobbers the fuller wording.
        expect(byId[0].text).toBe(reworded.text);
    });

    it('a different KIND under similar words is a different tell; opposite manners sharing words stay apart; junk reports are dropped; the per-pass cap holds', () => {
        expect(isSameTell({ text: 'never strikes first', kind: 'principle' }, { text: 'never strikes first', kind: 'manner' })).toBe(false);
        expect(isSameTell({ text: 'jokes when things get serious', kind: 'manner' }, { text: 'goes quiet when things get serious', kind: 'manner' })).toBe(false);
        const tells = recordHeroTells([], [null, 'string', { text: '   ' }, PIPE, JOKES, { text: 'third one over the cap', kind: 'manner' }], { messageCount: 5 });
        expect(tells).toHaveLength(2);
        expect(recordHeroTells([], [null, 42], { messageCount: 5 })).toEqual([]);
    });

    it('established after sightings in three different scenes; an intimate tell after one', () => {
        const three = sightings([PIPE], [10, 40, 70]);
        expect(isHeroTellEstablished(three[0])).toBe(true);
        expect(isHeroTellEstablished(sightings([PIPE], [10, 40])[0])).toBe(false);
        const bed = recordHeroTells([], [{ text: 'prefers to be touched from behind and says so plainly', kind: 'intimate', witnesses: ['Maren'] }], { messageCount: 10 });
        expect(isHeroTellEstablished(bed[0])).toBe(true);
    });

    it('a pattern nobody has seen for HERO_TELL_FADE_MESSAGES goes quiet (never deleted)', () => {
        const three = sightings([PIPE], [10, 40, 70]);
        expect(isHeroTellLive(three[0], { messageCount: 100 })).toBe(true);
        expect(isHeroTellLive(three[0], { messageCount: 70 + HERO_TELL_FADE_MESSAGES + 1 })).toBe(false);
    });

    it('the store caps at MAX_HERO_TELLS, evicting the least-established, least-seen first', () => {
        let tells = sightings([PIPE], [10, 40, 70]);
        const words = ['apple', 'brick', 'candle', 'dagger', 'ember', 'falcon', 'garnet', 'harbor', 'ivory', 'jasper', 'kettle', 'lantern', 'marble', 'needle', 'oyster', 'pebble', 'quiver', 'ribbon', 'saddle', 'thimble', 'umber', 'velvet', 'walnut', 'yarrow'];
        for (let i = 0; i < MAX_HERO_TELLS; i += 1) {
            tells = recordHeroTells(tells, [{ text: `turns a ${words[i]} ${words[(i + 5) % words.length]} ${words[(i + 11) % words.length]} over his knuckles`, kind: 'manner', witnesses: ['Bran'] }], { messageCount: 100 + i * 20 });
        }
        expect(tells).toHaveLength(MAX_HERO_TELLS);
        expect(tells.some(t => t.text === PIPE.text)).toBe(true);
        expect(tells.some(t => t.text.startsWith('turns a apple'))).toBe(false);
    });
});

describe('hero tells — the load boundary', () => {
    it('types every field, clamps stamps to the transcript, re-mints duplicate ids, drops junk', () => {
        const loaded = sanitizeHeroTells([
            null, 'x', { text: 42 },
            { id: 'a', text: ' jokes  when things get serious ', kind: 'MANNER', witnesses: 'Maren', sightings: [3, '9', 999, 'x'], lastSeenMessage: 999, lastVoicedMessage: -4, voicedCount: '2' },
            { id: 'a', text: 'never draws first', kind: 'nonsense', witnesses: [{ name: 'obj' }, 'Bran'] },
        ], { maxMessageCount: 50 });
        expect(loaded).toHaveLength(2);
        // A sighting past the transcript is DROPPED (its count is semantic); a fade/voice stamp is clamped.
        expect(loaded[0]).toMatchObject({ id: 'a', text: 'jokes when things get serious', kind: 'manner', witnesses: ['Maren'], sightings: [3, 9], lastSeenMessage: 50, lastVoicedMessage: 0, voicedCount: 2, lastBeatMessage: null });
        expect(loaded[1].id).not.toBe('a');
        expect(loaded[1]).toMatchObject({ kind: 'manner', witnesses: ['Bran'], sightings: [], voicedCount: 0 });
        expect(sanitizeHeroTells('nope')).toEqual([]);
        expect(normalizeHeroTell({ text: 'x'.repeat(400) }).text).toHaveLength(160);
    });

    it('a beat is complete-or-null', () => {
        expect(sanitizeHeroTellBeat({ tellId: 't', opensAtMessage: 10, closesAtMessage: 30, witnesses: ['Maren'] })).toMatchObject({ tellId: 't', mintedAtMessage: 10, witnesses: ['Maren'] });
        expect(sanitizeHeroTellBeat({ tellId: 't', opensAtMessage: 30, closesAtMessage: 10 })).toBeNull();
        expect(sanitizeHeroTellBeat({ opensAtMessage: 1, closesAtMessage: 2 })).toBeNull();
        expect(sanitizeHeroTellBeat([])).toBeNull();
    });
});

describe('hero tells — who may voice it', () => {
    const roster = [{ id: 'npc-maren', name: 'Maren Holt', rosterTier: 'character' }, { id: 'npc-bran', name: 'Bran', rosterTier: 'character' }];

    it('only a present WITNESS gets the standing line; an unestablished tell never renders; combat hides it', () => {
        const tells = [...sightings([PIPE], [10, 40, 70]), ...sightings([JOKES], [12])];
        const voiceable = listVoiceableTells(tells, { presentNames: ['Maren'], messageCount: 100 });
        expect(voiceable).toHaveLength(1);
        expect(voiceable[0].tell.text).toBe(PIPE.text);
        expect(listVoiceableTells(tells, { presentNames: ['Bran'], messageCount: 100 })).toEqual([]);
        const block = buildHeroTellsBlock(tells, { presentNames: ['Maren'], messageCount: 100 });
        expect(block).toContain('WHAT THEY HAVE NOTICED ABOUT THE HERO');
        expect(block).toContain(PIPE.text);
        expect(block).toContain('seen by Maren');
        expect(block).not.toContain(JOKES.text);
        expect(buildHeroTellsBlock(tells, { presentNames: ['Maren'], messageCount: 100, combatActive: true })).toBe('');
        expect(buildHeroTellsBlock(tells, { presentNames: [], messageCount: 100 })).toBe('');
    });

    it('an intimate tell renders only for its partner, labelled intimate; the private-only rule lives in the standing rule (cached prefix), not the block', () => {
        const bed = recordHeroTells([], [{ text: 'likes to be held afterwards and falls asleep fast', kind: 'intimate', witnesses: ['Maren'] }], { messageCount: 10 });
        expect(buildHeroTellsBlock(bed, { presentNames: ['Bran'], messageCount: 30 })).toBe('');
        const block = buildHeroTellsBlock(bed, { presentNames: ['Maren', 'Bran'], messageCount: 30 });
        expect(block).toContain('intimate — known only to the one who shared the bed');
        expect(block).not.toContain('spoken of only by the partner who knows it');
        expect(HERO_TELLS_STANDING_RULE).toContain('spoken of only by the partner who knows it');
        expect(HERO_TELLS_STANDING_RULE).toContain('never states the hero\'s feelings or motives as fact');
    });

    it('the candidate is a live tell with an on-roster witness; voiced tells wait out the cooldown; the beat block needs the witness present', () => {
        const tells = [...sightings([PIPE], [10, 40, 70]), ...sightings([{ ...JOKES, witnesses: ['Nobody Known'] }], [10, 40, 70])];
        const candidate = selectHeroTellCandidate(tells, roster, { messageCount: 100 });
        expect(candidate.tell.text).toBe(PIPE.text);
        expect(candidate.witnesses).toEqual(['Maren']);
        const beat = mintHeroTellBeat(candidate, { messageCount: 100, delayScenes: 2 });
        expect(beat).toMatchObject({ tellId: candidate.tell.id, witnesses: ['Maren'], opensAtMessage: 112, closesAtMessage: 136 });
        expect(buildHeroTellBeatBlock(beat, tells, { presentNames: ['Maren'], messageCount: 105 })).toBe('');
        const open = buildHeroTellBeatBlock(beat, tells, { presentNames: ['Maren'], messageCount: 120 });
        expect(open).toContain("SOMEONE HAS THE HERO'S NUMBER");
        expect(open).toContain('Maren has noticed a pattern in the hero: ' + PIPE.text);
        expect(open).toContain('Let me guess');
        expect(buildHeroTellBeatBlock(beat, tells, { presentNames: ['Bran'], messageCount: 120 })).toBe('');
        expect(buildHeroTellBeatBlock(beat, tells, { presentNames: ['Maren'], messageCount: 120, combatActive: true })).toBe('');
        expect(buildHeroTellBeatBlock(beat, tells, { presentNames: ['Maren'], messageCount: 140 })).toBe('');
        // Expired unvoiced → the ENGINE's stamp at the close runs the cooldown; the fiction's keys stay untouched.
        const closed = stampTellVoiced(tells, beat);
        expect(closed[0]).toMatchObject({ lastBeatMessage: 136, voicedCount: 0, lastVoicedMessage: null });
        expect(selectHeroTellCandidate(closed, roster, { messageCount: 150 })).toBeNull();
        expect(selectHeroTellCandidate(closed, roster, { messageCount: 136 + 40 })?.tell.text).toBe(PIPE.text);
    });

    it('an intimate beat carries the private-only register', () => {
        const bed = recordHeroTells([], [{ text: 'likes to be held afterwards', kind: 'intimate', witnesses: ['Maren Holt'] }], { messageCount: 10 });
        const candidate = selectHeroTellCandidate(bed, roster, { messageCount: 30 });
        const beat = mintHeroTellBeat(candidate, { messageCount: 30 });
        const block = buildHeroTellBeatBlock(beat, bed, { presentNames: ['Maren Holt'], messageCount: 31 });
        expect(block).toContain('intimate knowledge');
        expect(block).toContain('never before others');
    });
});

describe('hero tells — follow-up slices (2026-09-23): the sheet, hearsay, voiced-by-the-fiction, the absence beat', () => {
    const roster = [{ id: 'npc-maren', name: 'Maren', rosterTier: 'character' }];

    it('a voiced report stamps the voice without adding a sighting unless sighted; the sheet lists only voiced tells with who said it; the load twin types the new fields', async () => {
        const { listVoicedTells, listPublicTells, setHeroTellDormant } = await import('./heroTells.js');
        let tells = sightings([PIPE], [10, 40, 70]);
        expect(listVoicedTells(tells)).toEqual([]);
        tells = recordHeroTells(tells, [{ id: tells[0].id, text: 'the pipe', kind: 'habit', witnesses: ['Maren'], voiced: true, voicedBy: 'Maren' }], { messageCount: 100 });
        expect(tells[0]).toMatchObject({ sightings: [10, 40, 70], lastSeenMessage: 70, lastVoicedMessage: 100, voicedCount: 1, voicedBy: ['Maren'] });
        tells = recordHeroTells(tells, [{ id: tells[0].id, text: 'the pipe', kind: 'habit', witnesses: ['Bran'], voiced: true, voicedBy: 'Bran', sighted: true }], { messageCount: 130 });
        expect(tells[0]).toMatchObject({ sightings: [10, 40, 70, 130], voicedCount: 2, voicedBy: ['Maren', 'Bran'], witnesses: ['Maren', 'Bran'] });
        const sheet = listVoicedTells(tells);
        expect(sheet).toHaveLength(1);
        expect(sheet[0]).toMatchObject({ text: PIPE.text, saidBy: ['Maren', 'Bran'], dormant: false, intimate: false });
        // Struck by the player: still listed (restorable), never live, never travels.
        const struck = setHeroTellDormant(tells, tells[0].id, true);
        expect(listVoicedTells(struck)[0].dormant).toBe(true);
        expect(isHeroTellLive(struck[0], { messageCount: 140 })).toBe(false);
        expect(setHeroTellDormant(struck, struck[0].id, true)).toBe(struck);
        expect(isHeroTellLive(setHeroTellDormant(struck, struck[0].id, false)[0], { messageCount: 140 })).toBe(true);
        // A remark about an unrecorded pattern is its first sighting AND its first voice.
        const fresh = recordHeroTells([], [{ text: 'never draws first', kind: 'principle', witnesses: ['Maren'], voiced: true, voicedBy: 'Maren' }], { messageCount: 5 });
        expect(fresh[0]).toMatchObject({ sightings: [5], voicedCount: 1, voicedBy: ['Maren'] });
        // Load twin.
        const loaded = sanitizeHeroTells([{ text: 'x', kind: 'intimate', public: true, dormant: 'yes', voicedBy: ['A', { name: 'B' }], lastAbsenceRemarkMessage: '900' }], { maxMessageCount: 50 });
        expect(loaded[0]).toMatchObject({ public: false, dormant: false, voicedBy: ['A'], lastAbsenceRemarkMessage: 50 });
        expect(listPublicTells(loaded, { messageCount: 60 })).toEqual([]);
    });

    it('a public non-intimate live tell travels as hearsay; intimate and dormant ones never do', async () => {
        const { listPublicTells } = await import('./heroTells.js');
        const { selectRegionalHearsay } = await import('./regionalHearsay.js');
        let tells = sightings([{ ...PIPE, public: true }], [10, 40, 70]);
        tells = recordHeroTells(tells, [{ text: 'takes her from behind by preference', kind: 'intimate', witnesses: ['Maren'], public: true }], { messageCount: 80 });
        const travel = listPublicTells(tells, { messageCount: 100 });
        expect(travel).toHaveLength(1);
        expect(travel[0].tell.text).toBe(PIPE.text);
        expect(tells[1].public).toBe(false);
        const picked = selectRegionalHearsay({ heroTells: tells, locations: [], locationName: 'Farport', messageIndex: 100 });
        expect(picked.items).toHaveLength(1);
        expect(picked.items[0].text).toContain(PIPE.text);
        expect(picked.items[0].grade).toBe('secondhand');
        expect(picked.ledgerEntries[0]).toMatch(new RegExp(`^tell:${tells[0].id}\\|farport\\|100$`));
        // Too fresh to have traveled; struck tells stay home; a faded one stops traveling.
        expect(selectRegionalHearsay({ heroTells: tells, locations: [], locationName: 'Farport', messageIndex: 75 }).items).toEqual([]);
        expect(selectRegionalHearsay({ heroTells: tells.map(t => ({ ...t, dormant: true })), locations: [], locationName: 'Farport', messageIndex: 100 }).items).toEqual([]);
        expect(selectRegionalHearsay({ heroTells: tells, locations: [], locationName: 'Farport', messageIndex: 70 + HERO_TELL_FADE_MESSAGES + 5 }).items).toEqual([]);
    });

    it('a beat voiced by the fiction inside its window is spent and not double-stamped at expiry; an unvoiced window stamps the engine key only and never reaches the sheet', async () => {
        const { beatVoicedByFiction, listVoicedTells } = await import('./heroTells.js');
        let tells = sightings([PIPE], [10, 40, 70]);
        const beat = mintHeroTellBeat(selectHeroTellCandidate(tells, roster, { messageCount: 100 }), { messageCount: 100, delayScenes: 0 });
        expect(beatVoicedByFiction(beat, tells)).toBe(false);
        tells = recordHeroTells(tells, [{ id: tells[0].id, text: 'the pipe', kind: 'habit', witnesses: ['Maren'], voiced: true, voicedBy: 'Maren' }], { messageCount: 110 });
        expect(beatVoicedByFiction(beat, tells)).toBe(true);
        const stamped = stampTellVoiced(tells, beat);
        expect(stamped).toBe(tells);
        expect(stamped[0]).toMatchObject({ lastVoicedMessage: 110, voicedCount: 1, lastBeatMessage: null });
        const unvoiced = stampTellVoiced(tells.map(t => ({ ...t, lastVoicedMessage: null, voicedCount: 0, voicedBy: [] })), beat);
        expect(unvoiced[0]).toMatchObject({ lastBeatMessage: 124, lastVoicedMessage: null, voicedCount: 0 });
        // "How others see you" reads the fiction's keys only: a closed-unvoiced window is not a line anyone said.
        expect(listVoicedTells(unvoiced)).toEqual([]);
        // A bare `voiced: true` (no speaker) lists as said aloud by nobody named — never a guessed witness.
        expect(listVoicedTells([{ ...unvoiced[0], voicedCount: 1 }])[0].saidBy).toEqual([]);
    });

    it('the absence beat: a faded, once-voiced habit with its witness on the roster gets an absence window, cooled by its own stamp', async () => {
        const { selectAbsenceTellCandidate, beatVoicedByFiction } = await import('./heroTells.js');
        let tells = sightings([PIPE], [10, 40, 70]);
        const late = 70 + HERO_TELL_FADE_MESSAGES + 10;
        // Never voiced → nobody knew it as the hero's habit → no absence to notice.
        expect(selectAbsenceTellCandidate(tells, roster, { messageCount: late })).toBeNull();
        tells = recordHeroTells(tells, [{ id: tells[0].id, text: 'the pipe', kind: 'habit', witnesses: ['Maren'], voiced: true, voicedBy: 'Maren' }], { messageCount: 75 });
        // Still live → not an absence yet; the remark lane has the cooldown instead.
        expect(selectAbsenceTellCandidate(tells, roster, { messageCount: 100 })).toBeNull();
        const candidate = selectAbsenceTellCandidate(tells, roster, { messageCount: late });
        expect(candidate).toMatchObject({ mode: 'absence', witnesses: ['Maren'] });
        expect(selectHeroTellCandidate(tells, roster, { messageCount: late })).toBeNull();
        const beat = mintHeroTellBeat(candidate, { messageCount: late, delayScenes: 1 });
        expect(beat).toMatchObject({ mode: 'absence', opensAtMessage: late + 6 });
        expect(sanitizeHeroTellBeat({ ...beat, mode: 'nonsense' }).mode).toBe('remark');
        const block = buildHeroTellBeatBlock(beat, tells, { presentNames: ['Maren'], messageCount: late + 8 });
        expect(block).toContain('SOMEONE NOTICES WHAT THE HERO STOPPED DOING');
        expect(block).toContain("haven't done that in a while");
        expect(buildHeroTellBeatBlock(beat, tells, { presentNames: ['Bran'], messageCount: late + 8 })).toBe('');
        // The standing block never lists a faded tell.
        expect(buildHeroTellsBlock(tells, { presentNames: ['Maren'], messageCount: late + 8 })).toBe('');
        // Expiry stamps the absence remark, never a voice; the cooldown then holds.
        const stamped = stampTellVoiced(tells, beat);
        expect(stamped[0]).toMatchObject({ lastAbsenceRemarkMessage: late + 6, voicedCount: 1 });
        expect(beatVoicedByFiction(beat, stamped)).toBe(false);
        expect(selectAbsenceTellCandidate(stamped, roster, { messageCount: late + 50 })).toBeNull();
        expect(selectAbsenceTellCandidate(stamped, roster, { messageCount: late + 6 + 120 })).not.toBeNull();
    });
});

describe('hero tells — queue sweep 2026-09-24 (scene window, id claim, witnesses, window edges, stamps, the block ceiling)', () => {
    const roster = [{ id: 'npc-maren', name: 'Maren', rosterTier: 'character' }];

    it('P1: a habit re-reported every 4 rows reaches three scenes — the window is measured from the last accepted SIGHTING, lastSeenMessage slides for the fade only', () => {
        const rows = Array.from({ length: 11 }, (_, i) => 10 + i * 4); // 10 … 50
        const tells = sightings([PIPE], rows);
        expect(tells[0].sightings).toEqual([10, 30, 50]);
        expect(tells[0].lastSeenMessage).toBe(50);
        expect(isHeroTellEstablished(tells[0])).toBe(true);
        // Report at 14: the fade stamp moves, the scene does not.
        const two = sightings([PIPE], [10, 14]);
        expect(two[0]).toMatchObject({ sightings: [10], lastSeenMessage: 14 });
        // Exactly HERO_TELL_SCENE_MESSAGES after the sighting is still the same scene; one more row is a new one.
        expect(sightings([PIPE], [10, 10 + HERO_TELL_SCENE_MESSAGES])[0].sightings).toEqual([10]);
        expect(sightings([PIPE], [10, 12, 10 + HERO_TELL_SCENE_MESSAGES + 1])[0].sightings).toEqual([10, 27]);
    });

    it('a Scribe id from another tell does not attach: the kind must agree and the text must touch the held wording; a shorthand by id still lands', () => {
        const jokes = sightings([JOKES], [10, 40]);
        const wrongKind = recordHeroTells(jokes, [{ id: jokes[0].id, text: 'pays the poor double without being asked', kind: 'principle', witnesses: ['Brother Anselm'] }], { messageCount: 80 });
        expect(wrongKind).toHaveLength(2);
        expect(wrongKind[0]).toMatchObject({ sightings: [10, 40], witnesses: ['Maren', 'Bran'] });
        expect(wrongKind[1]).toMatchObject({ kind: 'principle', witnesses: ['Brother Anselm'], sightings: [80] });
        // Same kind, no shared meaningful token: still a new tell.
        const sameKind = recordHeroTells(jokes, [{ id: jokes[0].id, text: 'pays the poor double without being asked', kind: 'manner', witnesses: ['Brother Anselm'] }], { messageCount: 80 });
        expect(sameKind).toHaveLength(2);
        expect(sameKind[0].sightings).toEqual([10, 40]);
        // A shorthand re-report by id ("the jokes again") shares a token: the id claim holds.
        expect(findHeroTellMatch(jokes, { id: jokes[0].id, text: 'the jokes again', kind: 'manner' })).toBe(0);
        // A bare reference with no meaningful token rides the id alone.
        expect(findHeroTellMatch(jokes, { id: jokes[0].id, text: 'it', kind: 'manner' })).toBe(0);
        expect(findHeroTellMatch(jokes, { id: 'nope', text: JOKES.text, kind: 'manner' })).toBe(0);
    });

    it('prepareHeroTellReports: companions witness every non-intimate sighting, the speaker of a voiced report is a witness, and a witness-less report is dropped', () => {
        expect(prepareHeroTellReports([{ text: 'never draws first', kind: 'principle' }], { partyNames: [] })).toEqual([]);
        expect(prepareHeroTellReports([{ text: 'never draws first', kind: 'principle', witnesses: [] }], { partyNames: ['Osma', 'Osma', 42] })[0].witnesses).toEqual(['Osma']);
        expect(prepareHeroTellReports([{ text: 'never draws first', kind: 'principle', witnesses: 'Bran' }], { partyNames: ['Osma'] })[0].witnesses).toEqual(['Bran', 'Osma']);
        // An intimate tell's witnesses stay exactly the partner(s): a companion is not in the bed.
        expect(prepareHeroTellReports([{ text: 'likes to be held afterwards', kind: 'intimate' }], { partyNames: ['Osma'] })).toEqual([]);
        expect(prepareHeroTellReports([{ text: 'likes to be held afterwards', kind: 'intimate', witnesses: ['Maren'] }], { partyNames: ['Osma'] })[0].witnesses).toEqual(['Maren']);
        // Whoever named the pattern aloud has seen it.
        expect(prepareHeroTellReports([{ text: 'the pipe', kind: 'habit', voiced: true, voicedBy: 'Maren' }], { partyNames: [] })[0].witnesses).toEqual(['Maren']);
        expect(prepareHeroTellReports([null, 'x', [], { text: 'y', kind: 'habit', witnesses: ['Maren'] }], {})).toHaveLength(1);
    });

    it('a voice at or after the MINT spends a delayed beat: the cue never renders at the opening and expiry stamps nothing', () => {
        let tells = sightings([PIPE], [10, 40, 70]);
        const beat = mintHeroTellBeat(selectHeroTellCandidate(tells, roster, { messageCount: 100 }), { messageCount: 100, delayScenes: 4 });
        expect(beat).toMatchObject({ mintedAtMessage: 100, opensAtMessage: 124, closesAtMessage: 148 });
        tells = recordHeroTells(tells, [{ id: tells[0].id, text: 'the pipe', kind: 'habit', witnesses: ['Maren'], voiced: true, voicedBy: 'Maren' }], { messageCount: 110 });
        expect(beatVoicedByFiction(beat, tells)).toBe(true);
        expect(buildHeroTellBeatBlock(beat, tells, { presentNames: ['Maren'], messageCount: 126 })).toBe('');
        expect(stampTellVoiced(tells, beat)).toBe(tells);
        expect(tells[0]).toMatchObject({ voicedCount: 1, lastVoicedMessage: 110, lastBeatMessage: null });
        // A voice BEFORE the mint is an older remark: the beat stands.
        const earlier = tells.map(t => ({ ...t, lastVoicedMessage: 90 }));
        expect(beatVoicedByFiction(beat, earlier)).toBe(false);
        expect(buildHeroTellBeatBlock(beat, earlier, { presentNames: ['Maren'], messageCount: 126 })).toContain("SOMEONE HAS THE HERO'S NUMBER");
    });

    it('the load twin drops a future or negative sighting instead of clamping it, and types lastBeatMessage', () => {
        const loaded = sanitizeHeroTells([{ id: 't', text: 'never draws first', kind: 'principle', witnesses: ['Maren'], sightings: [900, -2, 12.7], lastBeatMessage: '900' }], { maxMessageCount: 50 });
        expect(loaded[0]).toMatchObject({ sightings: [12], lastBeatMessage: 50 });
        expect(isHeroTellEstablished(loaded[0])).toBe(false);
        expect(normalizeHeroTell({ text: 'x', sightings: [1, 2, 3] }).sightings).toEqual([1, 2, 3]);
    });

    it('the standing block carries lines only, under its ceiling at every cap; the instruction paragraph is the cached-prefix rule', () => {
        const one = buildHeroTellsBlock(sightings([PIPE], [10, 40, 70]), { presentNames: ['Maren'], messageCount: 100 });
        expect(one).not.toContain('They may draw on it');
        expect(one.length).toBeLessThan(300);
        const words = ['apple', 'brick', 'candle', 'dagger', 'ember', 'falcon', 'garnet', 'harbor', 'ivory', 'jasper', 'kettle', 'lantern'];
        const witnesses = Array.from({ length: 8 }, (_, w) => `Witness ${w} `.padEnd(80, 'n'));
        let tells = [];
        for (let i = 0; i < HERO_TELL_PROMPT_CAP + 2; i += 1) {
            const text = Array.from({ length: 30 }, (_, k) => `${words[(i + k) % words.length]}${i}`).join(' ').slice(0, 160);
            for (const at of [10, 40, 70]) tells = recordHeroTells(tells, [{ text, kind: i % 2 ? 'intimate' : 'manner', witnesses }], { messageCount: at });
        }
        expect(tells).toHaveLength(HERO_TELL_PROMPT_CAP + 2);
        const block = buildHeroTellsBlock(tells, { presentNames: witnesses, messageCount: 100 });
        expect(block.split('\n').filter(line => line.startsWith('- '))).toHaveLength(HERO_TELL_PROMPT_CAP);
        expect(block.length).toBeLessThanOrEqual(HERO_TELLS_BLOCK_CHAR_CEILING);
        expect(HERO_TELLS_STANDING_RULE.length).toBeLessThan(1000);
    });
});
