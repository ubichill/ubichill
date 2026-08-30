/**
 * pen:tray Worker — ペン置き場 (= 置ける場所 + 戻し場所)。
 *
 * **責務:**
 *  - 背景パネルを描画してペンを「置ける場所」だと視覚的に伝える
 *  - tray の空き領域をクリックされたら「持ってるペンを離して**その位置に**置け」と通知
 *    → 各 pen.worker が自分が isMine なら release する
 *  - ペンの状態 (color / strokeWidth / 選択) は一切持たない
 */

import type { ComponentConfig, UiPointerActionDetail } from 'ubichill';
import { PenEvents } from './events';
import { dropPointInTray } from './trayDrop';

export const config: ComponentConfig = {
    defaultTransform: { x: 20, y: 20, z: 1000, w: 60, h: 240 },
    capabilities: ['event:emit', 'scene:read', 'ui:render'],
};

const THICKNESS_OPTIONS = [2, 4, 8, 12];

/** クリックした場所にペンを置くための、トレイ内ローカル座標 (pointerdown で記録)。 */
let lastPressed: { x: number; y: number; width: number; height: number } | null = null;

export default function TrayView() {
    return (
        <div style={{ position: 'absolute', inset: '0', pointerEvents: 'none' }}>
            <button
                type="button"
                onUbiClick={async () => {
                    if (!Ubi.componentInstanceId) return;
                    const tray = await Ubi.entity.get(Ubi.componentInstanceId);
                    if (!tray) return;
                    const pressed = lastPressed;
                    // トレイのどこを押したかは pointerdown で受け取ったローカル座標で分かる。
                    // 取れなかった場合だけトレイ原点にフォールバックする。
                    const drop = pressed
                        ? dropPointInTray(
                              {
                                  x: tray.transform.x,
                                  y: tray.transform.y,
                                  w: pressed.width || tray.transform.w,
                                  h: pressed.height || tray.transform.h,
                              },
                              pressed,
                          )
                        : { x: tray.transform.x, y: tray.transform.y };
                    // ローカルの pen.worker に対して「押した位置にペンを置け」と通知
                    PenEvents.emit('pen:tray:release', drop, { scope: 'world', targetType: 'pen:pen' });
                }}
                onUbiPointerDown={(detail: UiPointerActionDetail) => {
                    lastPressed = { x: detail.x, y: detail.y, width: detail.width, height: detail.height };
                }}
                style={{
                    position: 'absolute',
                    inset: '0',
                    padding: 0,
                    backgroundColor: 'rgba(245,245,247,0.92)',
                    borderRadius: '12px',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)',
                    border: '1px solid rgba(0,0,0,0.08)',
                    userSelect: 'none',
                    pointerEvents: 'auto',
                    cursor: 'pointer',
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
                        onUbiPointerDown={() => {}}
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
    );
}
