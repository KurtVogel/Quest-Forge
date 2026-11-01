// Test helper (2026-11-01 night): the repeat judge's verdict on the newest
// "Recorded once" card still judging — what llm/repeatJudge.js dispatches
// after reading the two turns. Tests only.
import { gameReducer } from './gameReducer.js';

export function judgeLatest(state, verdict = 'new', reason = '') {
    const card = (state.messages || []).findLast(message => message?.kind === 'recovery' && message.recovery?.status === 'judging');
    return card ? gameReducer(state, { type: 'JUDGE_REPEAT', payload: { messageId: card.id, verdict, reason } }) : state;
}
