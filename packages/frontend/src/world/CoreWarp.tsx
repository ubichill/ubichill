import { readCoreData, WarpDataSchema } from '@ubichill/core-components';
import { useWorld } from '@ubichill/react';
import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { partButton, partButtonLabel } from './partStyles';
import { scrollWorldTo } from './scrollWorld';
import { surfacePlacement } from './surfacePlacement';
import { entityCenter } from './worldPlaces';

const DEFAULT_LABEL = 'ワープ';

/** `core:warp` のボタン。押すと、行き先の Entity が画面の中心に来るようにスクロールする（本人だけ）。 */
export const CoreWarp: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const { entities, environment } = useWorld();
    const parsed = readCoreData(WarpDataSchema, entity.data ?? {});
    const label = (parsed.success && parsed.data.label.trim()) || DEFAULT_LABEL;
    const target = parsed.success && parsed.data.target ? entityCenter(entities.values(), parsed.data.target) : null;
    return (
        <div data-warp={entity.entityId ?? entity.id} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
            <button
                type="button"
                className={partButton}
                disabled={!target}
                onClick={() => {
                    if (target) scrollWorldTo(target, environment.worldSize);
                }}
            >
                <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                </svg>
                <span className={partButtonLabel}>{label}</span>
            </button>
        </div>
    );
};
