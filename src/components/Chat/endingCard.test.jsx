/**
 * The ending card (WOW 2026-09-30, death-and-stakes W1 — the last chapter):
 * the pure assembler and the element. UI only: nothing here touches
 * messages, the save, or any prompt. The card replaces the composer on
 * `isDead`; the epilogue button's state is read from the transcript.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildEndingCard, findEpilogueState } from './endingCard.js';
import { EPILOGUE_REQUEST_MESSAGE } from '../../llm/tableTalk.js';
import EndingCard from './EndingCard.jsx';

function makeState(overrides = {}) {
    return {
        session: { id: 'campaign-1', heroDeath: { atMessage: 4, cause: 'slain by the Cutter', location: 'Rimehollow', level: 4 } },
        messages: [
            { id: 'u1', role: 'user', content: 'I hold the bridge.' },
            { id: 'a1', role: 'assistant', content: 'The Cutter comes on.' },
            { id: 'u2', role: 'user', content: 'I swing.' },
            { id: 'a2', role: 'assistant', content: 'The blade finds you. Astra dies on the bridge.' },
            { id: 's1', role: 'system', kind: 'epitaph', content: '🪦 **Here ends the story of Astra**' },
        ],
        character: { name: 'Astra', race: 'human', class: 'fighter', level: 4, isDead: true, currentHP: 0, maxHP: 36 },
        party: [{ id: 'c1', name: 'Tam' }, { id: 'c2', name: 'Hesper' }],
        quests: [
            { id: 'q1', name: 'The missing crates', status: 'active' },
            { id: 'q2', name: 'Old debt', status: 'completed' },
        ],
        currentLocation: 'Rimehollow',
        ...overrides,
    };
}

describe('buildEndingCard', () => {
    it('is null while the hero lives', () => {
        expect(buildEndingCard(makeState({ character: { name: 'Astra', isDead: false } }))).toBeNull();
        expect(buildEndingCard(makeState({ character: null }))).toBeNull();
    });

    it('carries the epitaph from the stamp, the party, the active quests, and an unasked epilogue', () => {
        const card = buildEndingCard(makeState());
        expect(card.name).toBe('Astra');
        expect(card.epitaph).toBe('🪦 **Here ends the story of Astra**, level 4 human fighter — slain by the Cutter, at Rimehollow, after 2 turns.');
        expect(card.companions).toEqual(['Tam', 'Hesper']);
        expect(card.openThreads).toEqual(['The missing crates']);
        expect(card.epilogue).toEqual({ asked: false, answered: false });
    });

    it('a pre-stamp dead save (the old spirit mode) still ends the story from the live sheet', () => {
        const card = buildEndingCard(makeState({ session: { id: 'campaign-1' } }));
        expect(card.epitaph).toBe('🪦 **Here ends the story of Astra**, level 4 human fighter — at Rimehollow, after 2 turns.');
    });

    it('the epilogue is one call: asked (and answered) is read from the transcript after the death', () => {
        const state = makeState();
        const asked = { ...state, messages: [...state.messages, { id: 'u3', role: 'user', content: EPILOGUE_REQUEST_MESSAGE }] };
        expect(buildEndingCard(asked).epilogue).toEqual({ asked: true, answered: false });
        const answered = { ...asked, messages: [...asked.messages, { id: 'a3', role: 'assistant', content: 'Tam buried her on the bridge.' }] };
        expect(buildEndingCard(answered).epilogue).toEqual({ asked: true, answered: true });
        // A request BEFORE the death (impossible in play, possible in a save) does not count.
        expect(findEpilogueState([{ role: 'user', content: EPILOGUE_REQUEST_MESSAGE }], 1)).toEqual({ asked: false, answered: false });
        // A deleted request does not count either.
        expect(findEpilogueState([{ role: 'user', content: EPILOGUE_REQUEST_MESSAGE, deleted: true }], 0)).toEqual({ asked: false, answered: false });
    });
});

describe('EndingCard', () => {
    it('renders the heading, the epitaph, and the three handles', () => {
        const card = buildEndingCard(makeState());
        const html = renderToStaticMarkup(
            <EndingCard card={card} onEpilogue={() => {}} onCloseChapter={() => {}} onBeginAgain={() => {}} />,
        );
        expect(html).toContain('The story of Astra ends here');
        expect(html).toContain('Here ends the story of Astra');
        expect(html).toContain('What became of them');
        expect(html).toContain('Close the last chapter');
        expect(html).toContain('Begin again with this hero');
        expect(html).toContain('Tam, Hesper');
        expect(html).toContain('The missing crates');
        expect(html).not.toContain('disabled=""');
    });

    it('disables the epilogue button once asked, and renders a Stop only while a call runs', () => {
        const state = makeState();
        const asked = { ...state, messages: [...state.messages, { id: 'u3', role: 'user', content: EPILOGUE_REQUEST_MESSAGE }] };
        const html = renderToStaticMarkup(
            <EndingCard card={buildEndingCard(asked)} onEpilogue={() => {}} onCloseChapter={() => {}} onBeginAgain={() => {}} onStop={() => {}} notice="Saving…" />,
        );
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>What became of them<\/button>/);
        expect(html).toContain('>Stop</button>');
        expect(html).toContain('Saving…');
        expect(renderToStaticMarkup(<EndingCard card={null} />)).toBe('');
    });
});
