import { describe, expect, it } from 'vitest';
import {
    buildCustomPrompt,
    buildFallbackScenePrompt,
    buildFocusedPrompt,
    describeEntity,
    equippedSummary,
    fallbackNotice,
    pickSceneSituation,
} from './sceneArtHelpers.js';

describe('pickSceneSituation — the moment the art director paints (2026-09-01 P1)', () => {
    const narration = { id: 'm-narr', role: 'assistant', content: 'Kraul lies dead at your feet; the goblins kneel.' };

    it('skips a soft-deleted newest assistant message (a scrubbed refusal) and uses the previous narration', () => {
        const messages = [
            { id: 'm-1', role: 'user', content: 'I strike Kraul down.' },
            narration,
            { id: 'm-2', role: 'user', content: 'I turn to the goblins.' },
            { id: 'm-refusal', role: 'assistant', content: "I can't continue this scene.", deleted: true },
        ];
        const picked = pickSceneSituation({ messages, journal: [], location: 'Cavern' });
        expect(picked.situation).toBe(narration.content);
        // The cache key rides the narration id — a deleted message must never own it.
        expect(picked.narrationId).toBe('m-narr');
    });

    it('skips an OOC table-talk reply (not fiction) and a hidden withheld setup', () => {
        const messages = [
            narration,
            { id: 'm-ooc', role: 'user', content: 'OOC: can you recap what happened?' },
            { id: 'm-ooc-reply', role: 'assistant', content: 'Sure — at the table: you killed Kraul last turn.' },
            { id: 'm-3', role: 'user', content: 'I search the body.' },
            { id: 'm-setup', role: 'assistant', content: 'You rummage… (withheld roll setup)', hidden: true },
        ];
        const picked = pickSceneSituation({ messages, journal: [], location: 'Cavern' });
        expect(picked.situation).toBe(narration.content);
        expect(picked.narrationId).toBe('m-narr');
    });

    it('falls back to the newest journal summary, then to the location, with no narration id', () => {
        const fromJournal = pickSceneSituation({
            messages: [{ id: 'x', role: 'assistant', content: 'gone', deleted: true }],
            journal: [{ summary: 'Old.' }, { summary: 'The hero reached the cavern.' }],
            location: 'Cavern',
        });
        expect(fromJournal).toEqual({ situation: 'The hero reached the cavern.', narrationId: null });
        expect(pickSceneSituation({ messages: [], journal: [], location: 'Cavern' }))
            .toEqual({ situation: 'The scene at Cavern.', narrationId: null });
    });
});

describe('describeEntity', () => {
    it('renders the hero with display names for species and class, never the data key (2026-09-01 P2)', () => {
        const text = describeEntity({
            type: 'player',
            entity: { name: 'Ghazra', gender: 'woman', race: 'halfOrc', class: 'fighter', appearance: 'Tusked, grey-green skin' },
            gear: 'Chain Mail, Longsword',
        });
        expect(text).toBe('Ghazra (woman), a Half-Orc Fighter. Tusked, grey-green skin. Wearing/wielding: Chain Mail, Longsword.');
        expect(text).not.toContain('halfOrc');
    });

    it('tags companions and NPCs with the registered species + gender beside the name', () => {
        expect(describeEntity({
            type: 'companion',
            entity: { name: 'Kaarina', species: 'dwarf', gender: 'woman', role: 'scout', appearance: 'Braided beard', weapon: 'Axe' },
        })).toBe('Kaarina (dwarf woman), scout. Braided beard. Wielding Axe.');
        expect(describeEntity({
            type: 'npc',
            entity: { name: 'Grub', species: 'goblin', gender: 'man', disposition: 'wary', lastNotes: 'Sells rope', lastLocation: 'Docks' },
        })).toBe('Grub (goblin man), wary. Sells rope. Last seen at Docks.');
    });

    it('describes enemies with their condition and falls back to the label for unknown types', () => {
        expect(describeEntity({ type: 'enemy', entity: { name: 'Kraul', condition: 'bloodied' } }))
            .toBe('Kraul, hostile combatant. Condition: bloodied.');
        expect(describeEntity({ type: 'thing', label: 'The Bell' })).toBe('The Bell');
        expect(describeEntity(null)).toBe('');
    });
});

describe('prompt builders', () => {
    it('buildFocusedPrompt frames a waist-up portrait with the setting and the shared portrait style', () => {
        const prompt = buildFocusedPrompt({ type: 'npc', label: 'Grub', entity: { name: 'Grub', disposition: 'wary' } }, 'Docks');
        expect(prompt).toContain('Focused waist-up portrait of Grub.');
        expect(prompt).toContain('Grub, wary');
        expect(prompt).toContain('Current setting: Docks.');
        expect(prompt).toContain('no text, no frame.');
    });

    it('buildCustomPrompt keeps the hero look consistent only when one is recorded', () => {
        const withLook = buildCustomPrompt('A burning mill', 'Millhaven', { name: 'Vesa', appearance: 'white hair' });
        expect(withLook).toContain('A burning mill Set in or near Millhaven.');
        expect(withLook).toContain("Keep Vesa's established look consistent if present: white hair.");
        const noLook = buildCustomPrompt('A burning mill', '', { name: 'Vesa' });
        expect(noLook).not.toContain('Set in or near');
        expect(noLook).not.toContain('established look');
    });

    it('buildFallbackScenePrompt uses display names and carries the situation', () => {
        const prompt = buildFallbackScenePrompt({
            location: 'Cavern',
            character: { name: 'Ghazra', race: 'halfOrc', class: 'fighter' },
            situation: 'Kraul lies dead.',
        });
        expect(prompt).toContain('Featuring Ghazra, a Half-Orc Fighter.');
        expect(prompt).toContain('Kraul lies dead.');
        expect(prompt).not.toContain('halfOrc');
    });

    it('equippedSummary lists equipped names only', () => {
        expect(equippedSummary([{ name: 'Sword', equipped: true }, { name: 'Rope' }, { equipped: true }])).toBe('Sword');
        expect(equippedSummary()).toBe('');
    });
});

describe('fallbackNotice', () => {
    it('is silent for xAI renders and explains every fallback tier', () => {
        expect(fallbackNotice(null)).toBe('');
        expect(fallbackNotice({ provider: 'xai' })).toBe('');
        expect(fallbackNotice({ provider: 'gemini', fallbackReason: 'missing-key' })).toContain('Add an xAI Image API Key');
        expect(fallbackNotice({ provider: 'gemini', fallbackReason: 'xai-empty' })).toContain('possibly filtered');
        expect(fallbackNotice({ provider: 'gemini', fallbackReason: 'xai-http-500' })).toContain('xAI rendering failed');
        expect(fallbackNotice({ provider: 'pollinations', fallbackReason: 'missing-key' })).toContain('Free fallback render');
        expect(fallbackNotice({ provider: 'pollinations', fallbackReason: 'xai-empty; gemini-empty (IMAGE_SAFETY)' })).toContain('No image provider produced an image');
        expect(fallbackNotice({ provider: 'pollinations', fallbackReason: 'xai-network: stalled' })).toContain('lower-quality free fallback');
    });
});
