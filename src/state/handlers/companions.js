/**
 * Party companions: join/leave, stat/gear updates with derivation and
 * announcements, and the engine-owned gear handoff.
 */
import { deriveGiftAC } from '../../engine/companionGear.js';
import { namesMatch } from '../../engine/npcRoster.js';
import { gameReducer } from '../gameReducer.js';
import { ensureCompanionRosterRecord, normalizeCompanion, systemMessage, withInventoryAndAC } from './shared.js';

const MAX_PARTY_SIZE = 4;

export const handlers = {
    ADD_COMPANION(state, action) {
        // Check if already in party
        const party = state.party || [];
        const name = String(action.payload?.name || '').toLowerCase();
        if (party.find(c => c.id === action.payload?.id || c.name?.toLowerCase() === name)) return state;
        if (party.length >= MAX_PARTY_SIZE) {
            return {
                ...state,
                messages: [...state.messages, systemMessage(`The party is full (${MAX_PARTY_SIZE}/${MAX_PARTY_SIZE}). Someone must leave before another companion can join.`)],
            };
        }
        const added = normalizeCompanion(action.payload);
        return {
            ...state,
            party: [...party, added],
            npcs: ensureCompanionRosterRecord(state.npcs, added),
        };
    },

    UPDATE_COMPANION(state, action) {
        let gearAnnouncement = null;
        const party = (state.party || []).map(companion => {
            if (companion.id !== action.payload.id && companion.name !== action.payload.name) return companion;
            const next = normalizeCompanion(action.payload, companion);
            // Gear changes announce themselves (D6) — silent state changes are a bug.
            // Pure hp/affinity/status updates stay quiet.
            const weaponChanged = next.weapon !== companion.weapon
                || next.damage !== companion.damage
                || (next.weaponBonus || 0) !== (companion.weaponBonus || 0);
            const acChanged = next.ac !== (companion.ac ?? next.ac);
            if (weaponChanged || acChanged) {
                const parts = [];
                if (weaponChanged) {
                    const bonus = next.weaponBonus ? `, +${next.weaponBonus} atk/dmg` : '';
                    parts.push(`now wields the ${next.weapon} (${next.damage}${bonus})`);
                }
                if (acChanged) parts.push(`AC ${companion.ac} → ${next.ac}`);
                gearAnnouncement = systemMessage(`⚔ ${next.name} ${parts.join('; ')}.`);
            }
            return next;
        });
        return {
            ...state,
            party,
            messages: gearAnnouncement ? [...state.messages, gearAnnouncement] : state.messages,
        };
    },

    REMOVE_COMPANION(state, action) {
        // The DM references a departing companion however the party block showed
        // them: by id, by their exact roster name, or by the short name it uses
        // in prose. The old strict `name !== payload.name && id !== payload.id`
        // filter matched none of those when only an id was given (payload.id was
        // undefined, so every live companion survived the filter) and broke on
        // any casing or name-form drift — the fiction wrote a companion out of
        // the party while the panel kept showing them (2026-08-25 player report).
        const party = state.party || [];
        const rawId = String(action.payload?.id || '').trim();
        const rawName = String(action.payload?.name || '').trim();
        if (party.length === 0 || (!rawId && !rawName)) return state;

        // A bare string entry is ambiguous (name or id), so both candidates are
        // checked against ids before any name matching runs.
        let target = party.find(c => c.id && (c.id === rawId || c.id === rawName));
        if (!target && rawName) {
            target = party.find(c => String(c.name || '').trim().toLowerCase() === rawName.toLowerCase());
        }
        if (!target && rawName) {
            // Fuzzy only when it names exactly ONE companion — "Garrick" for
            // "Garrick Stonehand" is unambiguous; an ambiguous hit removes nobody
            // rather than guessing which ally the fiction sent away.
            const matches = party.filter(c => namesMatch(c.name, rawName));
            if (matches.length === 1) [target] = matches;
        }
        if (!target) {
            console.warn(`[REMOVE_COMPANION] No party member matches "${rawName || rawId}" — nobody left the party.`);
            return state;
        }

        return {
            ...state,
            party: party.filter(c => c !== target),
            // Silent party changes are a bug (D6): the roster shrinking is a
            // mechanical fact the player must see, even when the narration was
            // vague about who actually left. The companion's roster NPC record
            // (bond, stance, shared history) deliberately stays behind.
            messages: [...state.messages, systemMessage(`👤 ${target.name} is no longer travelling with the party.`)],
        };
    },

    GIVE_GEAR_TO_COMPANION(state, action) {
        // Engine-owned mirror of the potion "→ Name" buttons: the player hands a
        // weapon, armor, or shield to a companion straight from the Inventory
        // panel, so the gear change never depends on the DM pairing
        // update_companions with items_lost. Out of combat only; the inner
        // UPDATE_COMPANION announces the change (D6) and derives all mechanics.
        if (state.combat?.active) return state;
        const { itemId, companionId } = action.payload || {};
        const item = (state.inventory || []).find(i => i.id === itemId);
        const companion = (state.party || []).find(c => c.id === companionId);
        if (!item || !companion || companion.status === 'dead' || companion.status === 'downed') return state;

        const isWeapon = item.type === 'weapon';
        const isShield = !isWeapon && (item.type === 'shield' || item.isShield);
        // Shield memory (2026-09-03 P2): `shieldBonus` is what the companion's
        // current shield contributes to `ac`. A gifted shield REPLACES it (never
        // stacks — three +1 shields used to walk a companion to the 21 cap), and
        // gifted armor is priced on top of the shield they keep carrying.
        const currentAc = companion.ac || 12;
        const currentShield = Math.max(0, Math.trunc(companion.shieldBonus || 0));
        const armorGift = isWeapon || isShield ? null : deriveGiftAC(item, currentAc);
        const giftAC = isWeapon
            ? null
            : isShield
                ? deriveGiftAC(item, currentAc - currentShield)
                : (armorGift === null ? null : armorGift + currentShield);
        if (!isWeapon && giftAC === null) return state;

        let gearPayload;
        if (isWeapon) {
            if (String(item.name || '').trim().toLowerCase() === String(companion.weapon || '').trim().toLowerCase()) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`${companion.name} already wields a ${companion.weapon} — the ${item.name} stays with you.`)],
                };
            }
            gearPayload = { id: companion.id, weapon: item.name };
        } else {
            const newAc = Math.min(21, giftAC);
            const shieldValue = isShield ? (item.shieldAC || 2) + (item.acBonus || 0) : null;
            if (isShield && currentShield > 0 && shieldValue <= currentShield) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`${companion.name} already carries a shield at least as good — the ${item.name} stays with you.`)],
                };
            }
            if (newAc <= currentAc) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`${companion.name}'s current protection is at least as good — the ${item.name} stays with you.`)],
                };
            }
            gearPayload = { id: companion.id, ac: newAc, ...(isShield ? { shieldBonus: shieldValue } : {}) };
        }

        const updated = gameReducer(state, { type: 'UPDATE_COMPANION', payload: gearPayload });
        // Exactly one unit leaves the hero's possession; AC recomputes in case
        // the hero handed over their own equipped protection.
        const remaining = (item.quantity || 1) > 1
            ? updated.inventory.map(i => (i.id === item.id ? { ...i, quantity: i.quantity - 1 } : i))
            : updated.inventory.filter(i => i.id !== item.id);
        return withInventoryAndAC(updated, remaining);
    },
};
