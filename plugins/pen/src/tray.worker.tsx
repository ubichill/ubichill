/**
 * pen:tray Worker — ペン置き場 (= 置ける場所 + 戻し場所)。
 *
 * **責務:**
 *  - 背景パネルを描画してペンを「置ける場所」だと視覚的に伝える
 *  - tray の空き領域をクリックされたら「持ってるペンを離して戻して」とブロードキャスト
 *    → 各 pen.worker が自分が isMine なら release する
 *  - ペンの状態 (color / strokeWidth / 選択) は一切持たない
 */

import { PenEvents } from './events';

const THICKNESS_OPTIONS = [2, 4, 8, 12];

Ubi.ui.render(
    () => (
        <div style={{ position: 'absolute', inset: '0', pointerEvents: 'none' }}>
            <div
                style={{
                    position: 'absolute',
                    inset: '0',
                    backgroundColor: 'rgba(245,245,247,0.92)',
                    borderRadius: '12px',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)',
                    border: '1px solid rgba(0,0,0,0.08)',
                    userSelect: 'none',
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    top: '0',
                    left: '100%',
                    marginLeft: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    pointerEvents: 'none',
                }}
            >
                {THICKNESS_OPTIONS.map((thickness) => (
                    <button
                        type="button"
                        onUbiClick={() => {
                            PenEvents.emit(
                                'pen:tray:change_thickness',
                                { thickness },
                                { scope: 'world', targetType: 'pen:pen' },
                            );
                        }}
                        style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            border: '1px solid rgba(0,0,0,0.1)',
                            backgroundColor: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            pointerEvents: 'auto',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                        }}
                    >
                        <div
                            style={{
                                width: thickness,
                                height: thickness,
                                borderRadius: '50%',
                                backgroundColor: '#1a1a1a',
                            }}
                        />
                    </button>
                ))}
            </div>
        </div>
    ),
    'pen-tray',
);
