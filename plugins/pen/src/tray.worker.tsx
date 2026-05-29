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

Ubi.ui.render(
    () => (
        <div
            onUbiClick={async () => {
                if (!Ubi.componentInstanceId) return;
                const tray = await Ubi.entity.get(Ubi.componentInstanceId);
                if (!tray) return;
                // ローカルの pen.worker に対して「トレイ座標にペンを置け」と通知
                PenEvents.emit(
                    'pen:tray:release',
                    { x: tray.transform.x, y: tray.transform.y },
                    { scope: 'world', targetType: 'pen:pen' },
                );
            }}
            style={{
                position: 'absolute',
                inset: '0',
                backgroundColor: 'rgba(245,245,247,0.92)',
                borderRadius: '12px',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)',
                border: '1px solid rgba(0,0,0,0.08)',
                userSelect: 'none',
                // ペンが乗っているスロット以外の領域でクリックを受け取りたいので auto。
                // 個々の pen はその上に position:absolute で乗っており、ペンクリックは
                // ペン側で stopPropagation 相当に拾うので tray のクリックには伝わらない。
                pointerEvents: 'auto',
                cursor: 'pointer',
            }}
        />
    ),
    'pen-tray',
);
