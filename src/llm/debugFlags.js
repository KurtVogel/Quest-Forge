/**
 * Named flags under the automated-playtest gate (`?debugState=1`, GameContext):
 * `?debugState=1&<name>=1` turns a TRIAL behaviour on for one page load so
 * the eval harnesses can A/B it against the shipped default without a build.
 * Never a production surface — without `debugState` every flag reads false,
 * and in Node (tests, scripts) there is no window, so every flag reads false.
 *
 * First flag (memory-research 2026-11-04 M1): `partnerRows` — a retrieved
 * narrative / player row brings its exchange partner from the transcript.
 */
export function readDebugFlag(name, search = null) {
    const query = typeof search === 'string'
        ? search
        : (typeof window !== 'undefined' && window.location ? window.location.search : '');
    if (!query) return false;
    const params = new URLSearchParams(query);
    return params.has('debugState') && params.get(name) === '1';
}
