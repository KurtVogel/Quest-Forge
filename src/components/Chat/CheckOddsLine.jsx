/**
 * The odds line on the roleplay-check card (WOW 2026-09-16): the engine's
 * modifier and success chance shown before any dice exist. Text lives in
 * `checkOdds.js` (pure, testable); this is the element.
 */
import { formatCheckOddsLine } from './checkOdds.js';

export default function CheckOddsLine({ character, inventory, roll }) {
    const line = formatCheckOddsLine(character, inventory, roll);
    if (!line) return null;
    return <div className="roleplay-check-odds" title="Your modifier and the chance to meet the DC, computed by the engine">{line}</div>;
}
