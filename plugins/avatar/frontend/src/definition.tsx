import type { WidgetDefinition } from '@ubichill/sdk';
import type { WorldEntity } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import type { AvatarData } from './types';

const AvatarWidget: React.FC<{
    entity: WorldEntity<AvatarData>;
    update: (patch: Partial<WorldEntity<AvatarData>>) => void;
}> = ({ entity, update }) => {
    const [position, setPosition] = useState({ x: 0, y: 0 });
    // 初期表示で左上に一瞬出るのを防ぐためのフラグ
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            setPosition({ x: e.clientX, y: e.clientY });
            if (!isVisible) setIsVisible(true);
        };

        window.addEventListener('mousemove', handleMouseMove);

        // クリーンアップ
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, [isVisible]);

    const avatarUrl = entity.data.url;
    const hotX = entity.data.hotspot?.x ?? 0;
    const hotY = entity.data.hotspot?.y ?? 0;

    return (
        <>
            {/* 設定パネル */}
            <div
                style={{
                    padding: '8px',
                    color: '#333',
                    background: 'white',
                    borderRadius: '4px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    width: '200px',
                }}
            >
                <h3 style={{ margin: 0, fontSize: '14px' }}>Avatar Settings</h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label
                        style={{
                            fontSize: '12px',
                            fontWeight: 'bold',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                        }}
                    >
                        Image URL
                        <input
                            type="text"
                            value={entity.data.url}
                            placeholder="https://..."
                            onChange={(e) => update({ data: { ...entity.data, url: e.target.value } })}
                            style={{
                                padding: '4px',
                                border: '1px solid #ccc',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: 'normal',
                            }}
                        />
                    </label>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                        <label
                            style={{
                                fontSize: '12px',
                                fontWeight: 'bold',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                            }}
                        >
                            Hotspot X
                            <input
                                type="number"
                                value={hotX}
                                onChange={(e) =>
                                    update({
                                        data: {
                                            ...entity.data,
                                            hotspot: { ...entity.data.hotspot, x: Number(e.target.value), y: hotY },
                                        },
                                    })
                                }
                                style={{
                                    padding: '4px',
                                    border: '1px solid #ccc',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    fontWeight: 'normal',
                                }}
                            />
                        </label>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                        <label
                            style={{
                                fontSize: '12px',
                                fontWeight: 'bold',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                            }}
                        >
                            Hotspot Y
                            <input
                                type="number"
                                value={hotY}
                                onChange={(e) =>
                                    update({
                                        data: {
                                            ...entity.data,
                                            hotspot: { ...entity.data.hotspot, x: hotX, y: Number(e.target.value) },
                                        },
                                    })
                                }
                                style={{
                                    padding: '4px',
                                    border: '1px solid #ccc',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    fontWeight: 'normal',
                                }}
                            />
                        </label>
                    </div>
                </div>

                <div style={{ fontSize: '12px', color: '#666' }}>Current: {entity.data.url ? 'Custom' : 'Default'}</div>
            </div>

            {/* アバター画像 (DOMオーバーレイ) */}
            {avatarUrl && (
                <img
                    src={avatarUrl}
                    alt="avatar"
                    style={{
                        position: 'fixed',
                        left: position.x - hotX,
                        top: position.y - hotY,
                        pointerEvents: 'none',
                        zIndex: 9999,
                        opacity: isVisible ? 1 : 0,
                    }}
                />
            )}
        </>
    );
};

export const avatarWidgetDefinition: WidgetDefinition<AvatarData> = {
    id: 'avatar',
    name: 'Avatar',
    icon: <span>👤</span>,
    defaultSize: { w: 200, h: 100 },
    defaultData: {
        url: '',
        hotspot: { x: 0, y: 0 },
    },
    Component: AvatarWidget,
};
