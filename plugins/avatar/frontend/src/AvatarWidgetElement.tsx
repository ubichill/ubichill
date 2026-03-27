import type { UbiEntityContext } from '@ubichill/sdk/ui';
import { UbiWidget } from '@ubichill/sdk/ui';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import type { AvatarData } from './types';

// ============================================
// React コンテンツ（context を props で受け取る）
// ============================================

const AvatarWidgetContent: React.FC<{ ctx: UbiEntityContext<AvatarData> }> = ({ ctx }) => {
    const { entity, patchEntity } = ctx;
    const hotX = entity.data.hotspot?.x ?? 0;
    const hotY = entity.data.hotspot?.y ?? 0;

    return (
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
                    onChange={(e) => patchEntity({ data: { ...entity.data, url: e.target.value } })}
                    style={{
                        padding: '4px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 'normal',
                    }}
                />
            </label>

            <div style={{ display: 'flex', gap: '8px' }}>
                <label
                    style={{
                        fontSize: '12px',
                        fontWeight: 'bold',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        flex: 1,
                    }}
                >
                    Hotspot X
                    <input
                        type="number"
                        value={hotX}
                        onChange={(e) =>
                            patchEntity({
                                data: {
                                    ...entity.data,
                                    hotspot: { x: Number(e.target.value), y: hotY },
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
                <label
                    style={{
                        fontSize: '12px',
                        fontWeight: 'bold',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        flex: 1,
                    }}
                >
                    Hotspot Y
                    <input
                        type="number"
                        value={hotY}
                        onChange={(e) =>
                            patchEntity({
                                data: {
                                    ...entity.data,
                                    hotspot: { x: hotX, y: Number(e.target.value) },
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

            <div style={{ fontSize: '12px', color: '#666' }}>Current: {entity.data.url ? 'Custom' : 'Default'}</div>
        </div>
    );
};

// ============================================
// Custom Element
// ============================================

export class AvatarWidgetElement extends UbiWidget<AvatarData> {
    #root: Root | null = null;

    connectedCallback() {
        this.#root = createRoot(this);
    }

    protected onUpdate(ctx: UbiEntityContext<AvatarData>) {
        this.#root?.render(<AvatarWidgetContent ctx={ctx} />);
    }

    disconnectedCallback() {
        const root = this.#root;
        this.#root = null;
        setTimeout(() => root?.unmount(), 0);
    }
}
