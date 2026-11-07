#!/usr/bin/env node
/**
 * Repeat-judge eval (2026-11-01 night): the machinery Flash's verdict on the
 * one transaction question the engine's rules cannot settle — a same-value
 * twin from an EARLIER message: a new movement, or the earlier one retold?
 * Each case is built through the real reducer (so the card, the ledger and
 * the prompt are what play produces) and judged by the real lane
 * (llm/repeatJudge.js). A RETOLD case judged "new" is a double — the number
 * that matters most; a NEW case judged "same"/"unsure" leaves the player one
 * tap ("Record it again"). Since lane 11 (2026-11-08) the same card asks
 * about a same-value XP award, the same spell on the same people and a rest
 * of the same kind — the lanes that used to read the player's words.
 *
 *   node scripts/repeatJudgeEval.mjs [runsPerCase=2]
 *
 * Key: GEMINI_API_KEY from env / .env (never printed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameReducer } from '../src/state/gameReducer.js';
import { initialGameState } from '../src/state/initialState.js';
import { judgePendingRepeats } from '../src/llm/repeatJudge.js';
import { buildSpellSlots } from '../src/engine/spellcasting.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
try {
    const envText = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
} catch { /* explicit env vars only */ }
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.error('GEMINI_API_KEY is required.'); process.exit(2); }
const RUNS = Math.max(1, Number(process.argv[2] || 2));

const coinIn = (copper, party) => ({ type: 'ADD_COIN_GRANT', payload: { copper, _meta: { party } } });
const coinOut = (copper, party) => ({ type: 'APPLY_COIN_LOSS', payload: { copper, _meta: { party } } });
const sale = (name, priceCp, party) => ({ type: 'SELL_ITEM', payload: { name, quantity: 1, priceCp, _meta: { party } } });
const buy = (name, priceCp, party) => ({ type: 'PURCHASE_ITEM', payload: { name, quantity: 1, priceCp, _meta: { party } } });
const burn = (name) => ({ type: 'REMOVE_ITEM_BY_NAME', payload: { name, _meta: {} } });
const found = (name) => ({ type: 'ADD_ITEM', payload: { name, _meta: {} } });
// Lane 11 (2026-11-08): the three lanes that kept a phrase rule over the player's words.
const exp = (amount) => ({ type: 'ADD_EXP', payload: { amount, _meta: {} } });
const cast = (spell, target) => ({ type: 'CAST_SPELL', payload: { spell, target, _meta: {} } });
const rest = (kind) => ({ type: 'TAKE_REST', payload: kind, meta: { source: 'dm' } });

const CASES = [
    // ── retold: "new" here is a DOUBLE ──
    { id: 'wage-recap', expect: 'same',
        earlier: ['I shoulder the crate and hold out my hand.', 'Varro slaps a river-dull silver piece into your palm.', coinIn(10, 'Hesk Varro')],
        now: ['I look around the slipway for Tuva.', 'Varro\'s silver is still warm in your fist as you climb the slipway. "Twenty-nine more down in that bilge," he calls after you.', coinIn(10, 'Hesk Varro')] },
    { id: 'purse-count', expect: 'same',
        earlier: ['"One at a time, Maud." I put the pelt down.', 'Maud pitches five clipped silver coins onto the counter.', coinIn(50, 'Old Maud')],
        now: ['On the skiff I tip my purse out and count it.', 'You tally it on the wet thwart: Maud\'s five clipped silver, the dockmaster\'s dull coin, a few coppers worn smooth.', coinIn(50, 'Old Maud')] },
    { id: 'quest-recap', expect: 'same',
        earlier: ['"The caravan is through the pass. Pay up."', 'Hollin counts twenty gold crowns into your hand, one by one.', coinIn(2000, 'Hollin')],
        now: ['I find Hollin at the guildhall and report that the wagons reached Greyfell.', 'Hollin nods slowly. "You\'ve had your twenty gold, and you earned every crown of it. The guild remembers."', coinIn(2000, 'Hollin')] },
    { id: 'sale-recap', expect: 'same',
        earlier: ['I lay a wolf pelt on her counter.', 'Maud slides five silver across and drops the pelt in her salt bin.', sale('Wolf pelts', 50, 'Old Maud')],
        now: ['"What will you make of that pelt?"', 'Maud strokes the grey fur you sold her. "A collar for the reeve\'s wife, if the moths stay off it."', sale('Wolf pelts', 50, 'Old Maud')] },
    { id: 'dispute', expect: 'same',
        earlier: ['I put five silver down for the room.', 'The innkeeper sweeps the five silver into his apron and hands you an iron key.', coinOut(50, 'the innkeeper')],
        now: ['"Wait — I already paid you for the room, didn\'t I?"', 'The innkeeper squints at his slate. "Aye, so you did. Five silver, paid at dusk. Key\'s in your hand, isn\'t it?"', coinOut(50, 'the innkeeper')] },
    { id: 'purchase-recap', expect: 'same',
        earlier: ['I buy the coil of hemp rope.', 'Garrick takes your gold and hands over fifty feet of hemp rope.', buy('Hempen rope', 100, 'Garrick')],
        now: ['I tie the rope round the oak and lower myself down the bank.', 'The hemp rope you bought from Garrick creaks but holds as you go down hand over hand.', buy('Hempen rope', 100, 'Garrick')] },
    { id: 'typo-recap', expect: 'same',
        earlier: ['I hand Oskari two copper and step aboard.', 'Oskari pockets the two coppers and poles off.', coinOut(2, 'Oskari')],
        now: ['did i pay oskari aready?? dont wanna get chased', 'Oskari grunts without turning. "Two coppers, paid when you stepped on. We\'re square, guard."', coinOut(2, 'Oskari')] },
    { id: 'quoted-offer', expect: 'same',
        earlier: ['Four copper on the bar for an ale.', 'The keeper sweeps up the four coppers and pours.', coinOut(4, 'the keeper')],
        now: ['I eye the tap.', '"Another\'s four copper," the keeper says, holding out his palm, the jug still on its hook.', coinOut(4, 'the keeper')] },
    // ── genuinely new: "same"/"unsure" leaves the player one tap ──
    { id: 'crate-typo', expect: 'new',
        earlier: ['I shoulder the crate and hold out my hand.', 'Varro slaps a river-dull silver piece into your palm.', coinIn(10, 'Hesk Varro')],
        now: ['nxet one. hand out', 'The second crate thumps onto the stack and Varro presses a coin into your hand without looking up.', coinIn(10, 'Hesk Varro')] },
    { id: 'grey-fur', expect: 'new',
        earlier: ['I lay a wolf pelt on her counter.', 'Maud slides five silver across and drops the pelt in her salt bin.', sale('Wolf pelts', 50, 'Old Maud')],
        now: ['I dig the roll of grey fur out from under the bedroll.', 'Maud thumps five clipped silver bits onto the greased pine and takes it.', sale('Wolf pelts', 50, 'Old Maud')] },
    { id: 'same-again', expect: 'new',
        earlier: ['Four copper on the bar for an ale.', 'The keeper sweeps up the four coppers and pours.', coinOut(4, 'the keeper')],
        now: ['I slide the empty back. "Same again."', 'The keeper refills the mug and rakes your coppers off the wood.', coinOut(4, 'the keeper')] },
    { id: 'return-toll', expect: 'new',
        earlier: ['I hand Oskari two copper and step aboard.', 'Oskari pockets the two coppers and poles off.', coinOut(2, 'Oskari')],
        now: ['Back to the ferry. Pay him for the trip home.', 'Oskari takes his fare for the return and leans on the pole.', coinOut(2, 'Oskari')] },
    { id: 'second-loss', expect: 'new',
        earlier: ['One silver on the table. Deal.', 'Velka flips the third knave and rakes in your silver.', coinOut(10, 'Velka')],
        now: ['Again. I\'m due.', 'The knave of chains falls wrong for you a second time; Velka drags the silver across with one finger.', coinOut(10, 'Velka')] },
    { id: 'second-torch', expect: 'new',
        earlier: ['I light a torch and go down the stairs.', 'Your torch spits and catches, throwing orange light down the steps.', burn('Torch')],
        now: ['The torch gutters, so I light another.', 'The old torch dies in a hiss; the fresh one catches from its embers.', burn('Torch')] },
    { id: 'counted-in-prose', expect: 'new',
        earlier: ['I haul the first sack up the hill.', 'Mirja thumbs three coppers into your hand.', coinIn(3, 'Mirja')],
        now: ['I keep working.', 'By noon your shoulders burn; after the last sack Mirja flicks three more coppers across the table.', coinIn(3, 'Mirja')] },
    { id: 'pay-up-front', expect: 'new',
        earlier: ['I hand Velka a silver for the hand.', 'Velka takes your silver and deals.', coinOut(10, 'Velka')],
        now: ['i pay her for nother hand', 'She takes the coin, shuffles, and deals the three placards face down.', coinOut(10, 'Velka')] },
    // ── two roster ids (2026-11-07): one man forked in the record, or two people ──
    { id: 'fork-retold', expect: 'same',
        earlier: ['I pay Tuomas for the winter fur.', 'Tuomas counts your five gold and hands the fur across the counter.', coinOut(500, 'Tuomas')],
        now: ['What did that fur cost me again?', 'Tuomas the furrier scratches his beard. "Five gold, same as I told you, and you paid it."', coinOut(500, 'Tuomas the furrier')] },
    { id: 'fork-receipt', expect: 'same',
        earlier: ['I settle up with Tuomas.', 'You count out five gold and Tuomas sweeps it into his apron.', coinOut(500, 'Tuomas')],
        now: ['I head for the door.', 'Tuomas the furrier nods you out. Your five gold is already in his till and the debt is square.', coinOut(500, 'Tuomas the furrier')] },
    { id: 'two-people-pay', expect: 'new',
        earlier: ['I pay Jethro his two silver for the mending.', 'Jethro bites the silver and nods.', coinOut(20, 'Jethro')],
        now: ['Now I pay Marta for the room.', 'Marta Vell holds out her palm; you count two silver into it and she hands you the key.', coinOut(20, 'Marta Vell')] },
    { id: 'two-people-wage', expect: 'new',
        earlier: ['I collect from Jethro for the crates.', 'Jethro flips you a silver for the morning\'s work.', coinIn(10, 'Jethro')],
        now: ['I carry Marta\'s barrels too.', 'Marta Vell pays you a silver of her own once the last barrel is racked.', coinIn(10, 'Marta Vell')] },
    { id: 'two-people-buy', expect: 'new',
        earlier: ['I buy a rope from Jethro.', 'Jethro takes your silver and coils a length of rope into your arms.', buy('Hemp rope', 100, 'Jethro')],
        now: ['Marta sells rope too, I buy another for the climb.', 'Marta Vell sells you a second length of rope from her own stock.', buy('Hemp rope', 100, 'Marta Vell')] },
    // ── XP, casts, rests (lane 11, 2026-11-08): the player's words no longer decide ──
    { id: 'xp-recap', expect: 'same',
        earlier: ['I report the cleared cellar to the reeve.', 'The reeve nods slowly. "The rats are done, then. Good work, and I\'ll say so to the council." It settles into you as the kind of thing you have learned to do.', exp(50)],
        now: ['I ask the reeve what else needs doing.', '"You did well with those rats," the reeve says again, already peering at his ledger. "I said so and I meant it. Now — the mill."', exp(50)] },
    { id: 'xp-second-deed', expect: 'new',
        earlier: ['I talk the drunk guard down before he draws.', 'The guard lowers his hand from the hilt, grumbling. A deft bit of talking, and nobody bleeds.', exp(25)],
        now: ['I point out to the ferryman the holed hull he hasn\'t noticed, and suggest he owes us a free crossing for the warning.', 'The ferryman pales at the hole, then barks a laugh and waves you aboard without a copper. Sharp eyes and a sharper tongue, twice in one day.', exp(25)] },
    { id: 'spell-aftermath', expect: 'same',
        earlier: ['I cast Cure Wounds on Mika.', 'Warmth spreads from your palm; Mika\'s gash closes to a pink seam and she breathes easier.', cast('Cure Wounds', 'Mika')] ,
        now: ['How is Mika doing now?', 'Mika flexes the shoulder where your Cure Wounds knitted the gash shut an hour ago. "Good as new. Better, maybe."', cast('Cure Wounds', 'Mika')] },
    { id: 'spell-second-cast', expect: 'new',
        earlier: ['I cast Cure Wounds on Mika.', 'Warmth spreads from your palm; Mika\'s gash closes to a pink seam and she breathes easier.', cast('Cure Wounds', 'Mika')],
        now: ['Mika\'s still pale. I lay hands on her and cast Cure Wounds once more.', 'You call the light a second time. It pours into Mika and the last grey leaves her face.', cast('Cure Wounds', 'Mika')] },
    { id: 'spell-typo-again', expect: 'new',
        earlier: ['I cast Cure Wounds on Mika.', 'Warmth spreads from your palm; Mika\'s gash closes to a pink seam and she breathes easier.', cast('Cure Wounds', 'Mika')],
        now: ['cure wonds on mika agian, shes bleeding thru the bandage', 'You press your palm to the seeping bandage and the prayer takes a second time; the bleeding stops.', cast('Cure Wounds', 'Mika')] },
    { id: 'rest-recap', expect: 'same',
        earlier: ['We make camp and take a long rest.', 'The night passes without alarm. You wake stiff but whole, the fire down to embers.', rest('long')],
        now: ['I pack up the camp and check the road.', 'You kick the embers of last night\'s camp apart and shoulder your pack. Well rested, you take the north road.', rest('long')] },
    { id: 'rest-second-night', expect: 'new',
        earlier: ['We make camp and take a long rest.', 'The night passes without alarm. You wake stiff but whole, the fire down to embers.', rest('long')],
        now: ['Another day\'s march done. We camp again and sleep.', 'A second night under the pines. The fire burns down; dawn finds you rested and the road still long.', rest('long')] },

    // ── one reply, two names (2026-11-07): the words ask, the judge reads ──
    { id: 'same-reply-one-rope', expect: 'same',
        reply: ['I buy a coil of rope.', 'Jethro takes your silver and hands you a coil of hempen rope.', [found('hempen rope coil'), buy('Hempen rope', 100, 'Jethro')]] },
    { id: 'same-reply-one-lantern', expect: 'same',
        reply: ['I buy the lantern.', 'You pay Marta and she passes you the old tin lantern from the shelf.', [found('old tin lantern'), buy('Tin lantern', 500, 'Marta Vell')]] },
    { id: 'same-reply-two-ropes', expect: 'new',
        reply: ['I buy a rope and search the crate.', 'Jethro sells you a coil of hempen rope. In the crate behind him you turn up a second, older hempen rope coil of your own.', [found('hempen rope coil'), buy('Hempen rope', 100, 'Jethro')]] },
];

function buildCase(spec) {
    let state = {
        ...initialGameState,
        settings: { ...initialGameState.settings, llmProvider: 'gemini', apiKey: GEMINI_KEY, geminiApiKey: GEMINI_KEY },
        // A level-5 cleric with slots, so the spell cases can cast (lane 11).
        character: {
            ...initialGameState.character, name: 'Saila', race: 'human', class: 'cleric', level: 5, gold: 50, silver: 0, copper: 0,
            currentHP: 20, maxHP: 30, armorClass: 14, conditions: [],
            abilityScores: { strength: 10, dexterity: 10, constitution: 12, intelligence: 10, wisdom: 16, charisma: 10 },
            hitDice: { total: 5, remaining: 5, die: 8 }, spellSlots: buildSpellSlots(5), sustainedSpell: null, classResources: {},
        },
        party: [{ id: 'c-mika', name: 'Mika', status: 'healthy', hp: 4, maxHp: 10, ac: 12, weapon: 'Dagger' }],
        npcs: [
            { id: 'npc-tuomas', name: 'Tuomas', rosterTier: 'character', kind: 'character' },
            { id: 'npc-tuomas-2', name: 'Tuomas the furrier', rosterTier: 'character', kind: 'character' },
            { id: 'npc-jethro', name: 'Jethro', rosterTier: 'character', kind: 'character' },
            { id: 'npc-marta', name: 'Marta Vell', rosterTier: 'character', kind: 'character' },
        ],
        inventory: [
            { id: 'p1', name: 'Wolf pelts', quantity: 4, valueCp: 100 },
            { id: 't1', name: 'Torch', itemKey: 'torch', quantity: 3 },
        ],
        messages: [],
    };
    const turn = (n, [player, dm, action]) => {
        state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { id: `u${n}`, role: 'user', content: player } });
        state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { id: `msg-${n}`, role: 'assistant', content: dm } });
        for (const one of Array.isArray(action) ? action : [action]) {
            if (one.meta) {
                // TAKE_REST carries its lane on action.meta, not the payload.
                state = gameReducer(state, { ...one, meta: { ...one.meta, sourceId: `msg-${n}`, playerMessage: player } });
                continue;
            }
            const meta = { ...one.payload._meta, sourceId: `msg-${n}`, playerMessage: player };
            state = gameReducer(state, { ...one, payload: { ...one.payload, _meta: meta } });
        }
    };
    if (spec.reply) {
        turn(1, spec.reply);
        return state;
    }
    turn(1, spec.earlier);
    // One ordinary turn in between, as play usually has.
    state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { id: 'u2', role: 'user', content: 'I look around.' } });
    state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { id: 'msg-2', role: 'assistant', content: 'Nothing much changes; the day goes on.' } });
    turn(3, spec.now);
    return state;
}

const results = [];
for (const spec of CASES) {
    for (let run = 0; run < RUNS; run += 1) {
        const state = buildCase(spec);
        const card = state.messages.findLast(m => m.kind === 'recovery' && m.recovery?.status === 'judging');
        if (!card) { results.push({ id: spec.id, expect: spec.expect, verdict: 'NO-CARD' }); continue; }
        const dispatched = [];
        await judgePendingRepeats({ state, dispatch: a => dispatched.push(a) });
        const verdict = dispatched[0]?.payload?.verdict || 'none';
        results.push({ id: spec.id, expect: spec.expect, verdict, reason: dispatched[0]?.payload?.reason || '' });
        console.log(`${spec.expect === verdict ? 'ok  ' : (spec.expect === 'same' && verdict === 'new' ? 'DOUBLE' : 'miss')} ${spec.id.padEnd(18)} expect=${spec.expect} got=${verdict} — ${dispatched[0]?.payload?.reason || ''}`);
    }
}
const retold = results.filter(r => r.expect === 'same');
const fresh = results.filter(r => r.expect === 'new');
const summary = {
    model: 'machinery (repeatJudge.js)',
    runsPerCase: RUNS,
    retold: { total: retold.length, keptOnce: retold.filter(r => r.verdict !== 'new').length, doubles: retold.filter(r => r.verdict === 'new').length },
    genuine: { total: fresh.length, booked: fresh.filter(r => r.verdict === 'new').length, leftToPlayer: fresh.filter(r => r.verdict !== 'new').length },
    noCard: results.filter(r => r.verdict === 'NO-CARD').map(r => r.id),
};
console.log(JSON.stringify(summary, null, 2));
const out = path.join(repoRoot, 'test-results', 'repeat-judge-eval.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
