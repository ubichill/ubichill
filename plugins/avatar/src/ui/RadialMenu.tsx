import { activeSubmenuId, setActiveSubmenuId, setRadialMenuPos } from '../state';
import { changeStatus, sendEmoji } from '../systems/AvatarMainSystem';
import type { RadialMenuItem, UserStatus } from '../types';

export interface RadialMenuProps {
    pos: { x: number; y: number };
}

export const RadialMenu = ({ pos }: RadialMenuProps) => {
    const items: RadialMenuItem[] = [
        {
            id: 'emoji',
            label: '絵文字',
            icon: '😊',
            submenu: [
                { id: 'emoji-thumbsup', label: 'いいね', icon: '👍', action: () => sendEmoji('👍') },
                { id: 'emoji-heart', label: 'ハート', icon: '❤️', action: () => sendEmoji('❤️') },
                { id: 'emoji-laugh', label: '笑い', icon: '😂', action: () => sendEmoji('😂') },
                { id: 'emoji-clap', label: '拍手', icon: '👏', action: () => sendEmoji('👏') },
                { id: 'emoji-fire', label: '炎', icon: '🔥', action: () => sendEmoji('🔥') },
                { id: 'emoji-thinking', label: '考え中', icon: '🤔', action: () => sendEmoji('🤔') },
            ],
        },
        {
            id: 'status',
            label: 'ステータス',
            icon: '🟢',
            submenu: [
                {
                    id: 'status-online',
                    label: 'オンライン',
                    icon: '🟢',
                    action: () => changeStatus('online' as UserStatus),
                },
                { id: 'status-busy', label: '作業中', icon: '🔴', action: () => changeStatus('busy' as UserStatus) },
                {
                    id: 'status-dnd',
                    label: '起こさないで',
                    icon: '🔕',
                    action: () => changeStatus('dnd' as UserStatus),
                },
            ],
        },
    ];

    const RADIUS = 80;
    const ITEM_SIZE = 48;
    const activeItem = activeSubmenuId ? items.find((i) => i.id === activeSubmenuId) : null;
    const displayItems = activeItem?.submenu ?? items;
    const count = displayItems.length;

    return (
        <div
            style={{
                position: 'fixed',
                left: pos.x,
                top: pos.y,
                width: 0,
                height: 0,
                pointerEvents: 'auto',
                zIndex: 10001,
            }}
        >
            <div
                style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: -1 }}
                onUbiClick={() => {
                    setRadialMenuPos(null);
                    setActiveSubmenuId(null);
                    Ubi.network.sendToHost('user:update', { isMenuOpen: false });
                }}
            />
            {displayItems.map((item, i) => {
                const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
                const x = Math.cos(angle) * RADIUS - ITEM_SIZE / 2;
                const y = Math.sin(angle) * RADIUS - ITEM_SIZE / 2;
                return (
                    <div
                        key={item.id}
                        style={{
                            position: 'absolute',
                            left: x,
                            top: y,
                            width: ITEM_SIZE,
                            height: ITEM_SIZE,
                            borderRadius: '50%',
                            background: 'white',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            fontSize: '20px',
                            gap: '2px',
                        }}
                        onUbiClick={() => {
                            if (item.action) {
                                item.action();
                            } else if (item.submenu) {
                                setActiveSubmenuId(activeSubmenuId === item.id ? null : item.id);
                            }
                        }}
                    >
                        {item.icon}
                        <span style={{ fontSize: '8px', color: '#666' }}>{item.label}</span>
                    </div>
                );
            })}
        </div>
    );
};
