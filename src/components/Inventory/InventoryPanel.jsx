import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { formatCurrency } from '../../engine/currency.js';
import { isProficientWithWeapon } from '../../engine/rules.js';
import './Inventory.css';

export default function InventoryPanel() {
    const { state, dispatch } = useGame();
    const [showAddItem, setShowAddItem] = useState(false);
    const [newItemName, setNewItemName] = useState('');

    const equippedItems = state.inventory.filter(i => i.equipped);
    const carriedItems = state.inventory.filter(i => !i.equipped);
    const totalWeight = state.inventory.reduce((sum, i) => sum + (i.weight || 0) * (i.quantity || 1), 0);
    const currentTurn = state.combat?.turnOrder?.[state.combat?.currentTurn];
    const isPlayerCombatTurn = !!state.combat?.active && currentTurn?.type === 'player';
    const bonusActionUsed = !!state.combat?.active && !!state.combat?.bonusActionUsed;

    const handleAddItem = () => {
        if (!newItemName.trim()) return;
        dispatch({
            // Omit type/weight so normalizeItem can recognize catalog items by name
            // (e.g. "Potion of Healing" → a usable consumable). Falls back to gear/1.
            type: 'ADD_ITEM',
            payload: { name: newItemName.trim() },
        });
        setNewItemName('');
        setShowAddItem(false);
    };

    const handleRemove = (itemId) => {
        dispatch({ type: 'REMOVE_ITEM', payload: itemId });
    };

    const handleToggleEquip = (item) => {
        dispatch({
            type: item.equipped ? 'UNEQUIP_ITEM' : 'EQUIP_ITEM',
            payload: item.id,
        });
    };

    const handleUse = (item) => {
        dispatch({ type: 'USE_ITEM', payload: item.id });
    };

    return (
        <div className="inventory-panel">
            <div className="inv-header">
                <h3 className="inv-title">Inventory</h3>
                <button className="inv-add-btn" onClick={() => setShowAddItem(!showAddItem)} title="Add item">
                    +
                </button>
            </div>

            <div className="inv-stats-row">
                <span className="inv-wealth">
                    <span className="inv-gold" title="Gold Pieces">{state.character?.gold || 0} gp</span>
                    <span className="inv-silver" title="Silver Pieces">{state.character?.silver || 0} sp</span>
                    <span className="inv-copper" title="Copper Pieces">{state.character?.copper || 0} cp</span>
                </span>
                <span className="inv-weight">{totalWeight.toFixed(1)} lbs</span>
            </div>

            {showAddItem && (
                <div className="inv-add-form">
                    <input
                        type="text"
                        className="inv-add-input"
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        placeholder="Item name..."
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
                    />
                    <button className="btn btn-primary btn-sm" onClick={handleAddItem}>Add</button>
                </div>
            )}

            <div className="inv-sections">
                {equippedItems.length > 0 && (
                    <div className="inv-section">
                        <h4 className="inv-section-title">Equipped</h4>
                        {equippedItems.map(item => (
                            <InventoryItem
                                key={item.id}
                                item={item}
                                nonProficient={item.type === 'weapon' && !isProficientWithWeapon(state.character, item)}
                                character={state.character}
                                combatActive={!!state.combat?.active}
                                isPlayerCombatTurn={isPlayerCombatTurn}
                                bonusActionUsed={bonusActionUsed}
                                onToggleEquip={handleToggleEquip}
                                onUse={handleUse}
                                onRemove={handleRemove}
                            />
                        ))}
                    </div>
                )}

                <div className="inv-section">
                    <h4 className="inv-section-title">Carried</h4>
                    {carriedItems.length === 0 ? (
                        <div className="inv-empty">No items</div>
                    ) : (
                        carriedItems.map(item => (
                            <InventoryItem
                                key={item.id}
                                item={item}
                                nonProficient={item.type === 'weapon' && !isProficientWithWeapon(state.character, item)}
                                character={state.character}
                                combatActive={!!state.combat?.active}
                                isPlayerCombatTurn={isPlayerCombatTurn}
                                bonusActionUsed={bonusActionUsed}
                                onToggleEquip={handleToggleEquip}
                                onUse={handleUse}
                                onRemove={handleRemove}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function InventoryItem({ item, nonProficient, character, combatActive, isPlayerCombatTurn, bonusActionUsed, onToggleEquip, onUse, onRemove }) {
    const isHealingPotion = item.consumableType === 'healing' && item.healing;
    const usesBonusAction = item.actionType === 'bonus' || isHealingPotion;
    const atFullHealth = isHealingPotion && character?.currentHP >= character?.maxHP;
    const isDead = isHealingPotion && character?.isDead;
    const bonusBlocked = usesBonusAction && combatActive && (!isPlayerCombatTurn || bonusActionUsed);
    const useDisabled = !!(isDead || atFullHealth || bonusBlocked);
    const useTitle = isDead
        ? 'Cannot heal the dead'
        : atFullHealth
            ? 'Already at full health'
            : bonusBlocked
                ? (!isPlayerCombatTurn ? 'Bonus action consumables are used on your turn' : 'Bonus action already used this turn')
                : isHealingPotion
                    ? `Drink as a bonus action and heal ${item.healing}`
                    : 'Use';

    return (
        <div className={`inv-item ${item.equipped ? 'equipped' : ''}`}>
            <div className="inv-item-info">
                <span className="inv-item-name">{item.name}</span>
                {item.quantity > 1 && <span className="inv-item-qty">x{item.quantity}</span>}
                {isHealingPotion && <span className="inv-item-detail">{item.healing} heal</span>}
                {usesBonusAction && <span className="inv-item-detail">bonus</span>}
                {item.damage && <span className="inv-item-detail">{item.damage}</span>}
                {item.attackBonus > 0 && <span className="inv-item-detail">+{item.attackBonus} hit</span>}
                {item.damageBonus > 0 && <span className="inv-item-detail">+{item.damageBonus} dmg</span>}
                {item.baseAC && !item.isShield && <span className="inv-item-detail">AC {item.baseAC + (item.acBonus || 0)}</span>}
                {(item.type === 'shield' || item.isShield) && <span className="inv-item-detail">+{(item.shieldAC || 2) + (item.acBonus || 0)} AC</span>}
                {Number.isFinite(item.valueCp) && <span className="inv-item-detail">{formatCurrency(item.valueCp)}</span>}
                {nonProficient && (
                    <span className="inv-item-warn" title="Your class is not proficient with this weapon — attacks don't gain your proficiency bonus.">
                        not proficient
                    </span>
                )}
            </div>
            <div className="inv-item-actions">
                {item.type === 'consumable' && (
                    <button
                        className="inv-use-btn"
                        onClick={() => onUse(item)}
                        disabled={useDisabled}
                        title={useTitle}
                    >
                        {isHealingPotion ? 'Drink' : 'Use'}
                    </button>
                )}
                {(item.type === 'weapon' || item.type === 'armor' || item.type === 'shield') && (
                    <button
                        className={`inv-equip-btn ${item.equipped ? 'unequip' : ''}`}
                        onClick={() => onToggleEquip(item)}
                        title={item.type === 'weapon'
                            ? (item.equipped ? 'Active weapon (click to sheathe)' : 'Set as active weapon')
                            : (item.equipped ? 'Unequip' : 'Equip')}
                    >
                        {item.equipped ? 'On' : 'Set'}
                    </button>
                )}
                <button
                    className="inv-remove-btn"
                    onClick={() => onRemove(item.id)}
                    title="Remove"
                >
                    Remove
                </button>
            </div>
        </div>
    );
}
