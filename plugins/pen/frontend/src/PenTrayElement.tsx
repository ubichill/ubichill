'use client';

import { Z_INDEX } from '@ubichill/sdk/react';
import type { UbiInstanceContext } from '@ubichill/sdk/ui';
import { UbiSingleton } from '@ubichill/sdk/ui';
import { useCallback } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { DEFAULT_PENS, PEN_CONFIG } from './config';
import type { PenData, PenEntity } from './types';

const PenTrayContent = ({ ctx }: { ctx: UbiInstanceContext }) => {
    const { currentUser, isConnected, entities, patchEntity } = ctx;

    const handleTrayClick = useCallback(() => {
        if (!currentUser?.id || !isConnected) return;

        const myLockedPens = Array.from(entities.values()).filter(
            (e): e is PenEntity => e.type === 'pen:pen' && e.lockedBy === currentUser.id,
        );

        for (const pen of myLockedPens) {
            const pData = pen.data as unknown as PenData;
            const config = DEFAULT_PENS.find((c) => c.color === pData.color);
            const offsetX = config ? config.x : PEN_CONFIG.OFFSETS.BLACK;

            patchEntity(pen.id, {
                lockedBy: null,
                transform: {
                    ...pen.transform,
                    x: PEN_CONFIG.TRAY_X_BASE + offsetX,
                    y: PEN_CONFIG.DEFAULT_Y,
                    rotation: 0,
                },
                data: { ...pen.data, isHeld: false },
            });
        }
    }, [currentUser?.id, isConnected, entities, patchEntity]);

    if (!currentUser) return null;

    return (
        <div
            onClick={handleTrayClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleTrayClick();
            }}
            role="button"
            tabIndex={0}
            style={{
                position: 'fixed',
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

// ============================================
// Custom Element
// ============================================

export class PenTrayElement extends UbiSingleton {
    #root: Root | null = null;

    connectedCallback() {
        this.#root = createRoot(this);
    }

    protected onUpdate(ctx: UbiInstanceContext) {
        this.#root?.render(<PenTrayContent ctx={ctx} />);
    }

    disconnectedCallback() {
        const root = this.#root;
        this.#root = null;
        setTimeout(() => root?.unmount(), 0);
    }
}
