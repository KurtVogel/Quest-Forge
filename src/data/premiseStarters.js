/**
 * Curated campaign premise starters (wow audit 2026-09-09, W0 — "a start you
 * didn't have to write"). The hero reveal is engine proof; the very next screen
 * was one blank 8,000-char textarea the whole campaign depends on (the opening
 * scene, the front director, canon). A tap fills the EDITABLE textarea — the
 * premise stays player-authored and explicitly captured (PRODUCT.md pillar 3);
 * the blank manual start is untouched (DECISIONS.md 2026-06-14 not reversed).
 *
 * Each starter follows the normal-life-first idiom (DECISIONS.md 2026-07-14):
 * a named home place, one or two named people who matter, one ordinary concern
 * of the hero's own, and pressure only as distant atmosphere. Two or three
 * proper nouns per starter give `frontDirector` and the location registry real
 * names to anchor on instead of "the starting region". None of the names below
 * appear on the stock-name list in `llm/nameGuidance.js`.
 *
 * `build(name)` interpolates the hero's name; the chosen id is stamped as
 * `session.premiseStarterId` (only while the text is unedited) so evals and
 * playtests can key on a reproducible fixed premise.
 */
export const PREMISE_STARTERS = [
    {
        id: 'saltmere-debt',
        title: 'The Debt at Saltmere',
        blurb: 'A grey fishing harbor, a boat you don\'t own yet, and a harbormaster who keeps every ledger.',
        build: name => `${name} has spent the last two winters in Saltmere, a grey fishing harbor where the tide-bell rings the hours and everyone owes someone. The boat ${name} works, the Kittiwake, belongs to Harbormaster Orsa Pellwyn, who keeps every debt in a brass-cornered ledger and forgives none of them. Old Tammo, the net-mender on the seaward pier, taught ${name} the knots and still saves a stool by his brazier. It is the last morning of the herring run: the catch must be counted, the ledger settled, and the Kittiwake hauled up before the autumn gales. Beyond the breakwater, the lighthouse on Gannet Rock has gone dark two nights running, and nobody wants to be the one to row out and ask why.`,
    },
    {
        id: 'kettle-inn-winter',
        title: 'Winter at the Kettle Inn',
        blurb: 'The last roof before the pass closes, a couple who took you in, and a storeroom to count.',
        build: name => `The Kettle Inn sits at the top of the Hollin Pass, the last roof before the snow closes the road for three months. ${name} has wintered here before, splitting wood and keeping the stable for Brannagh and Ide Fothergill, the couple who run it, in exchange for a bunk above the kitchen and a place at the long table. The first proper snow fell last night. There is ice to break on the trough, a late caravan of tin-merchants sleeping off the climb in the common room, and Ide wants ${name} to count the storeroom before the pass shuts. Down-valley, the village of Merrow has sent no letters this month, which the Fothergills call the weather and the tin-merchants call something else.`,
    },
    {
        id: 'brannocks-ford-homecoming',
        title: 'Homecoming to Brannock\'s Ford',
        blurb: 'Six years away, an aunt who kept your room, a friend who hasn\'t said whether he\'s glad.',
        build: name => `After six years away, ${name} has come back to Brannock's Ford, the river town where the ferry still runs on a rope and the mill still argues with the weir. ${name}'s aunt Hesper Coyle keeps the house on Tanner's Lane and has kept ${name}'s old room exactly as it was, which is its own kind of accusation. Dunstan Reeve, who was ${name}'s closest friend before the leaving, now runs the ferry and has not yet said whether he is glad. It is market day. There is a roof to mend, a grave to visit, and a town full of people who remember a different ${name}. Upriver, the old Aldwick estate has new owners nobody has met, and the price of flour has climbed twice since spring.`,
    },
    {
        id: 'varrowgate-courier',
        title: 'A Courier in Varrowgate',
        blurb: 'A river city of bridges and bell towers, your first route of your own, and a letter that shouldn\'t exist.',
        build: name => `${name} is the newest runner at the Tollmark Courier House in Varrowgate, a river city of bridges, bell towers, and slow bureaucracy, where a sealed letter is worth more than the coin that pays for it. Master Ludo Fenwright, who runs the house from a desk buried in wax and string, has finally trusted ${name} with a route of their own: the Coppergate district, its guildhalls, its tea-houses, its one notorious pawnbroker. Senna Vashti, the senior runner, shows ${name} the shortcuts and collects the favors owed for them. The Lantern Festival is nine days off, and the whole city is stringing lamps. Somewhere in the morning's satchel is a letter with a seal ${name} does not recognize and an address that does not exist.`,
    },
    {
        id: 'long-furrow-harvest',
        title: 'Harvest at Long Furrow',
        blurb: 'Eleven farms on one road, your mother\'s steading, barley to bring in, and wolves closer than the old people like.',
        build: name => `Long Furrow is a frontier village of eleven farms strung along a single road, with a palisade the elders built and the young people mock. ${name} grew up on the Halloran steading at the road's end, where ${name}'s mother Maud still runs the farm and ${name}'s younger brother Piet still cannot be trusted with the mule. It is the week of the barley harvest: every hand is needed in the fields, the reeve Cormac Dunbrody is counting sheaves for the tithe, and the harvest supper is three days off. Nights have been loud with wolves this year, closer than the old people like, and the trapper who usually brings word from the northern woods has not come down to trade.`,
    },
];

const FALLBACK_HERO_NAME = 'the hero';

/** The starter's premise text with the hero's name woven in. */
export function buildPremiseFromStarter(starter, heroName) {
    if (!starter || typeof starter.build !== 'function') return '';
    const name = typeof heroName === 'string' && heroName.trim() ? heroName.trim() : FALLBACK_HERO_NAME;
    return starter.build(name);
}

export function findPremiseStarter(id) {
    return PREMISE_STARTERS.find(starter => starter.id === id) || null;
}
