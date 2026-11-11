/**
 * The scripted play the latency harness measures (review queue item 2).
 *
 * One fixed campaign start, twenty ordinary player turns, one line that asks
 * for a skill check, and one fight round. `scripts/latencyEval.mjs record`
 * plays this once through the app's own turn pipeline and saves the campaign
 * state before every turn (`fixture.json`); every later run replays each turn
 * from those saved states, so each model and setting answers the same line
 * with the same story behind it.
 *
 * Kept as data so another loop (the rebuild spike, queue item 4) can be timed
 * on the same lines. Change a line and the fixture must be recorded again.
 */

export const SCRIPT_VERSION = 1;

/** The curated premise starter the campaign opens on (`src/data/premiseStarters.js`). */
export const STARTER_ID = 'saltmere-debt';
export const SESSION_ID = 'session-latency-fixture';

export const HERO = {
    name: 'Astra',
    race: 'human',
    class: 'fighter',
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    skills: ['athletics', 'perception'],
    options: {
        fightingStyle: 'defense',
        gender: 'woman',
        appearance: 'Tall and rope-scarred across both palms, salt-bleached brown hair cut short, a chipped front tooth.',
        background: 'Came to Saltmere two winters ago owing money and saying nothing about where from.',
    },
    // Fixed coins: character creation rolls starting gold, and a roll would make two recordings differ.
    coins: { gold: 0, silver: 7, copper: 20 },
};

/**
 * Twenty ordinary turns: talk, walk, look, small errands, two purchases. No
 * declared attack and no obvious check. The lines are the ones
 * `scripts/turnGrammarEval.mjs` has chained on this starter since 2026-09-11.
 * `kind` is a label for slicing the results; the harness does not read it.
 */
export const TURNS = [
    { kind: 'work', line: 'I climb down to the Kittiwake and start hauling the last of the herring crates up onto the pier.' },
    { kind: 'talk', line: 'I walk over to Old Tammo\'s brazier and sit on the stool he keeps for me. "Cold one," I say.' },
    { kind: 'ask', line: 'I ask Tammo whether he\'s heard anything about the lighthouse on Gannet Rock going dark.' },
    { kind: 'walk', line: 'I head up the quay toward the harbormaster\'s office with the tally of the catch.' },
    { kind: 'act', line: 'I knock, go in, and put the tally on Orsa Pellwyn\'s desk without a word.' },
    { kind: 'ask', line: 'I ask Orsa what I still owe on the Kittiwake after this run.' },
    { kind: 'talk', line: 'I tell her I\'ll have the rest by spring and ask what she wants done about the boat before the gales.' },
    { kind: 'walk', line: 'I leave the office and stop at the fish-market stalls to see who\'s buying today.' },
    { kind: 'coin', line: 'I buy a hot pie from the nearest stall and eat it watching the breakwater.' },
    { kind: 'work', line: 'I go back down to the seaward pier and start checking the Kittiwake\'s hull for rot before we haul her up.' },
    { kind: 'ask', line: 'I ask the nearest deckhand to lend a shoulder getting the boat onto the rollers.' },
    { kind: 'look', line: 'I take a break and look out toward Gannet Rock. Is there anything on the water?' },
    { kind: 'ask', line: 'I walk to the tide-bell tower and ask the bell-keeper if the lighthouse keeper has come ashore lately.' },
    { kind: 'coin', line: 'I head to the harbor tavern and order a small beer.' },
    { kind: 'ask', line: 'I listen to the talk around me for a while and then ask the barkeep about the lighthouse keeper by name, if there is one.' },
    { kind: 'walk', line: 'I finish the beer, thank the barkeep, and go looking for Tammo again.' },
    { kind: 'talk', line: 'I tell Tammo I\'m thinking about rowing out to Gannet Rock tomorrow and ask what he thinks of it.' },
    { kind: 'rest', line: 'I check my coin and my rope and head back to my bunk to sleep before the tide turns.' },
    { kind: 'look', line: 'Next morning I get up before dawn and go down to the pier to check the weather.' },
    { kind: 'ask', line: 'I ask around the pier whether anyone has a small boat they\'d let me borrow for the morning.' },
];

/**
 * The skill-check turn, played from the state after turn 20. The line has to
 * make the DM propose a check; a reply that narrates straight through is
 * recorded as "no check proposed" and the turn is tried again (three tries).
 */
export const CHECK = {
    line: 'I take the smallest skiff on the pier without waiting for anyone\'s leave, row out past the breakwater alone, and pull as hard as I can for Gannet Rock against the swell.',
    maxAttempts: 3,
};

/**
 * The fight round, also from the state after turn 20. The fight is opened by
 * a scripted DM reply (so every run fights the same two foes with the same
 * numbers); the app's parser, reducer and combat engine take it from there.
 * The measured round is `roundLine` answered by the intent call and the
 * narration call.
 */
export const FIGHT = {
    approachLine: 'I walk down the seaward pier toward the boats with my hand on my sword hilt.',
    dmStart: [
        'You are a dozen paces from the skiffs when two men step out from behind the stacked crab pots and block the planks. Tar on their hands, salt in their beards: wreckers from up the coast, by the look of them. The taller one hefts a boat-hook. "Nobody rows out to the Rock today," he says. The shorter one says nothing, and his gutting knife comes out low. The boat-hook swings up.',
        '',
        '```json',
        JSON.stringify({
            combat_start: {
                surprise: 'none',
                enemies: [
                    { id: 'wrecker-1', name: 'Wrecker with a Boat-hook', hp: 11, ac: 12, attack_bonus: 3, damage: '1d6+1', save_bonus: 1, is_undead: false, boss: false },
                    { id: 'wrecker-2', name: 'Wrecker with a Knife', hp: 9, ac: 12, attack_bonus: 3, damage: '1d4+1', save_bonus: 1, is_undead: false, boss: false },
                ],
            },
        }),
        '```',
    ].join('\n'),
    roundLine: 'I step inside the boat-hook\'s reach and cut at the taller wrecker with my sword.',
};
