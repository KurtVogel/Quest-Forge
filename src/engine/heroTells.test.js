import { describe, expect, it } from 'vitest';
import {
    HERO_TELL_FADE_MESSAGES,
    HERO_TELL_SCENE_MESSAGES,
    MAX_HERO_TELLS,
    buildHeroTellBeatBlock,
    buildHeroTellsBlock,
    isHeroTellEstablished,
    isHeroTellLive,
    isSameTell,
    listVoiceableTells,
    mintHeroTellBeat,
    normalizeHeroTell,
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
        expect(loaded[0]).toMatchObject({ id: 'a', text: 'jokes when things get serious', kind: 'manner', witnesses: ['Maren'], sightings: [3, 9, 50], lastSeenMessage: 50, lastVoicedMessage: 0, voicedCount: 2 });
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

    it('an intimate tell renders only for its partner and carries the private-only rule', () => {
        const bed = recordHeroTells([], [{ text: 'likes to be held afterwards and falls asleep fast', kind: 'intimate', witnesses: ['Maren'] }], { messageCount: 10 });
        expect(buildHeroTellsBlock(bed, { presentNames: ['Bran'], messageCount: 30 })).toBe('');
        const block = buildHeroTellsBlock(bed, { presentNames: ['Maren', 'Bran'], messageCount: 30 });
        expect(block).toContain('intimate — known only to the one who shared the bed');
        expect(block).toContain('spoken of only by the partner who knows it');
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
        // Voiced → the cooldown holds it back; a second live tell would win instead.
        const voiced = stampTellVoiced(tells, beat);
        expect(voiced[0]).toMatchObject({ lastVoicedMessage: 112, voicedCount: 1 });
        expect(selectHeroTellCandidate(voiced, roster, { messageCount: 130 })).toBeNull();
        expect(selectHeroTellCandidate(voiced, roster, { messageCount: 200 })?.tell.text).toBe(PIPE.text);
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
