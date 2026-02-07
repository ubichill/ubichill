import type { WorldEntity } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import type { WidgetDefinition } from '@ubichill/sdk';
import defaultCursor from './assets/default_cursor.png';
import type { CursorData } from './types';

const CursorWidget: React.FC<{
    entity: WorldEntity<CursorData>;
    update: (patch: Partial<WorldEntity<CursorData>>) => void;
}> = ({ entity, update }) => {
    const [position, setPosition] = useState({ x: 0, y: 0 });
    // 初期表示で左上に一瞬出るのを防ぐためのフラグ
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // 画像URLがある場合のみ適用（デフォルトカーソルは除外）
        const hasCustomCursor = !!entity.data.url && entity.data.url !== defaultCursor.src;
        if (hasCustomCursor) {
            document.body.style.cursor = 'none';
        }

        const handleMouseMove = (e: MouseEvent) => {
            setPosition({ x: e.clientX, y: e.clientY });
            if (!isVisible) setIsVisible(true);
        };

        window.addEventListener('mousemove', handleMouseMove);

        // クリーンアップ
        return () => {
            document.body.style.cursor = 'auto';
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, [entity.data.url, isVisible]);

    const cursorUrl = entity.data.url || defaultCursor.src;
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
                <h3 style={{ margin: 0, fontSize: '14px' }}>Cursor Settings</h3>

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

                <div style={{ fontSize: '12px', color: '#666' }}>
                    Current: {entity.data.url === defaultCursor.src ? 'Default' : 'Custom'}
                </div>
            </div>

            {/* カーソル画像 (DOMオーバーレイ) */}
            {cursorUrl && (
                <img
                    src={cursorUrl}
                    alt="cursor"
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

export const cursorWidgetDefinition: WidgetDefinition<CursorData> = {
    id: 'cursor',
    name: 'Cursor',
    icon: <span>🖱️</span>,
    defaultSize: { w: 200, h: 100 },
    defaultData: {
        url: defaultCursor.src,
        hotspot: { x: 0, y: 0 },
    },
    Component: CursorWidget,
};
