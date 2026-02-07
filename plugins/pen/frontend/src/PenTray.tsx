'use client';

import { useSocket, useWorld, Z_INDEX } from '@ubichill/sdk';
import type React from 'react';
import { useCallback } from 'react';
import { DEFAULT_PENS, PEN_CONFIG } from './config';
import type { PenEntity } from './types';

export const PenTray: React.FC = () => {
    const { currentUser, isConnected } = useSocket();
    const { entities, patchEntity } = useWorld();

    const handleTrayClick = useCallback(() => {
        // 自分がロックしているペンがあれば解放する
        const myLockedPens = Array.from(entities.values()).filter(
            (e): e is PenEntity => e.type === 'pen:pen' && e.lockedBy === currentUser?.id,
        );

        myLockedPens.forEach((pen) => {
            // ペンをトレイの初期位置に戻す（色に基づいて位置決定）
            const pData = pen.data;
            const config = DEFAULT_PENS.find((c) => c.color === pData.color);
            // デフォルトは黒の位置へ
            const offsetX = config ? config.x : PEN_CONFIG.OFFSETS.BLACK;

            const targetX = PEN_CONFIG.TRAY_X_BASE + offsetX;
            const targetY = PEN_CONFIG.DEFAULT_Y; // Top位置（トレイ内）に戻す

            console.log(`[PenTray] Releasing pen: ${pen.id}`);
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
                    },
                };
                patchEntity(pen.id, patch);
            }
        });
    }, [entities, isConnected, currentUser?.id, patchEntity]);

    if (!currentUser) return null;

    return (
        <div
            onClick={handleTrayClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    handleTrayClick();
                }
            }}
            role="button"
            tabIndex={0}
            style={{
                position: 'fixed', // Overlay内での配置
                top: 20,
                left: 600,
                transform: 'translateX(-50%)',
                width: 400,
                height: 80,
                backgroundColor: 'rgba(255, 255, 255, 0.5)',
                borderRadius: 10,
                boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'auto',
                backdropFilter: 'blur(5px)',
                border: '1px solid rgba(0,0,0,0.1)',
                cursor: 'pointer',
                zIndex: Z_INDEX.UI_TRAY,
            }}
        >
            <div style={{ opacity: 0.5, fontSize: 14, userSelect: 'none' }}>ペン置き場 (クリックで返却)</div>
        </div>
    );
};
