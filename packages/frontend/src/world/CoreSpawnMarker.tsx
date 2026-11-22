import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { css } from '@/styled-system/css';
import { useEditorPreview } from './editorPreview';
import { surfacePlacement } from './surfacePlacement';

/** `core:spawn` の印。部屋では描かず、エディタでだけ置いた場所を見せる。 */
export const CoreSpawnMarker: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const editing = useEditorPreview();
    if (!editing) return null;
    return (
        <div style={surfacePlacement(entity)}>
            <div className={marker}>
                <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                </svg>
                スポーン
            </div>
        </div>
    );
};

const marker = css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1.5',
    w: 'full',
    h: 'full',
    minW: '120px',
    minH: '40px',
    border: '2px dashed',
    borderColor: 'primary',
    borderRadius: '12px',
    color: 'primary',
    fontSize: '13px',
    fontWeight: 'bold',
});
