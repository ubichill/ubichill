'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useWorld } from '@/contexts/WorldContext';
import { PenWidget, type PenData } from '@/widgets/PenWidget';
import type { WorldEntity } from '@ubichill/shared';

export const UbichillOverlay: React.FC = () => {
    const { isConnected, currentUser, socket } = useSocket();
    // entitiesはWorldContextから取得するが、型アノテーションを明示的に行う
    const { entities, patchEntity } = useWorld();
    // ツール選択ハンドラ
    const handleTrayClick = useCallback(() => {
        // 自分がロックしているペンがあれば解放する
        const myLockedPens = Array.from(entities.values()).filter(
            (e) => e.type === 'pen' && (e as any).lockedBy === currentUser?.id // Changed to currentUser?.id
        );

        myLockedPens.forEach((pen: any) => {
            // ペンをトレイの初期位置に戻す（色に基づいて位置決定）
            // 簡易的に色ごとのオフセットを定義
            let offsetX = 0;
            if (pen.data.color === '#FF0000') offsetX = -50;
            else if (pen.data.color === '#0000FF') offsetX = 50;
            else if (pen.data.color === '#00FF00') offsetX = 150;
            else offsetX = -150; // 黒

            const targetX = 600 + offsetX;
            const targetY = 40; // Top位置（トレイ内）に戻す

            console.log(`[UbichillOverlay] Releasing pen: ${pen.id}`);

            // パッチ送信: ロック解除と位置リセット
            if (isConnected) {
                const patch = {
                    lockedBy: null,
                    transform: {
                        ...pen.transform,
                        x: targetX,
                        y: targetY,
                        rotation: 0,
                    },
                    data: {
                        ...pen.data,
                        isHeld: false,
                    }
                };
                patchEntity(pen.id, patch);
            }
        });
    }, [entities, isConnected, currentUser?.id, patchEntity]);

    // 全てのペンウィジェットを表示（自分のも他人のも）
    const allPens = Array.from(entities.values())
        .filter((e) => e.type === 'pen') as unknown as WorldEntity<PenData>[];

    // console.log('[UbichillOverlay] Rendering pens:', allPens.length, allPens.map(p => p.id));

    if (!isConnected) {
        // console.log('[UbichillOverlay] Not connected, returning null');
        return null;
    }

    return (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
            {/* ウィジェットレイヤー */}
            {allPens.map((pen) => (
                <PenWidget key={pen.id} entityId={pen.id} initialEntity={pen} />
            ))}

            {/* ペントレイ（クリックで返却） */}
            <div
                onClick={handleTrayClick}
                style={{
                    position: 'absolute',
                    top: 20, // Topに配置
                    left: 600, // サーバー側のペン初期位置(600)に合わせる（レスポンシブだとズレるため固定）
                    transform: 'translateX(-50%)',
                    width: 400,
                    height: 80,
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    borderRadius: 10,
                    boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'auto', // トレイはクリック可能
                    backdropFilter: 'blur(5px)',
                    border: '1px solid rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                }}
            >
                <div style={{ opacity: 0.5, fontSize: 14, userSelect: 'none' }}>
                    ペン置き場 (クリックで返却)
                </div>
            </div>
        </div>
    );
};
