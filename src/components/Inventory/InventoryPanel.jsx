import { useState } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import './Inventory.css';

export default function InventoryPanel() {
    const { state, dispatch } = useGame();
    const [showAddItem, setShowAddItem] = useState(false);
    const [newItemName, setNewItemName] = useState('');

    const equippedItems = state.inventory.filter(i => i.equipped);
    const carriedItems = state.inventory.filter(i => !i.equipped);
    const totalWeight = state.inventory.reduce((sum, i) => sum + (i.weight || 0) * (i.quantity || 1), 0);

    const handleAddItem = () => {
        if (!newItemName.trim()) return;
        dispatch({
            type: 'ADD_ITEM',
            payload: { name: newItemName.trim(), type: 'gear', weight: 1 },
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

    return (
        <div className="inventory-panel">
            <div className="inv-header">
                <h3 className="inv-title">🎒 Inventory</h3>
                <button className="inv-add-btn" onClick={() => setShowAddItem(!showAddItem)} title="Add item">
                    +
                </button>
            </div>

            <div className="inv-stats-row">
                <span className="inv-wealth">
                    <span className="inv-gold" title="Gold Pieces">🪙 {state.character?.gold || 0} gp</span>
                    <span className="inv-silver" title="Silver Pieces">⚪ {state.character?.silver || 0} sp</span>
                    <span className="inv-copper" title="Copper Pieces">🟤 {state.character?.copper || 0} cp</span>
                </span>
                <span className="inv-weight">⚖️ {totalWeight.toFixed(1)} lbs</span>
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
                                onToggleEquip={handleToggleEquip}
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
                                onToggleEquip={handleToggleEquip}
                                onRemove={handleRemove}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function InventoryItem({ item, onToggleEquip, onRemove }) {
    return (
        <div className={`inv-item ${item.equipped ? 'equipped' : ''}`}>
            <div className="inv-item-info">
                <span className="inv-item-name">{item.name}</span>
                {item.quantity > 1 && <span className="inv-item-qty">x{item.quantity}</span>}
                {item.damage && <span className="inv-item-detail">{item.damage}</span>}
                {item.baseAC && !item.isShield && <span className="inv-item-detail">AC {item.baseAC}</span>}
                {(item.type === 'shield' || item.isShield) && <span className="inv-item-detail">+2 AC</span>}
            </div>
            <div className="inv-item-actions">
                {(item.type === 'weapon' || item.type === 'armor' || item.type === 'shield') && (
                    <button
                        className={`inv-equip-btn ${item.equipped ? 'unequip' : ''}`}
                        onClick={() => onToggleEquip(item)}
                        title={item.equipped ? 'Unequip' : 'Equip'}
                    >
                        {item.equipped ? '✓' : '⬡'}
                    </button>
                )}
                <button
                    className="inv-remove-btn"
                    onClick={() => onRemove(item.id)}
                    title="Remove"
                >
                    ✕
                </button>
            </div>
        </div>
    );
}
