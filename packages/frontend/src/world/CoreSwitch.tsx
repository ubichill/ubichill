import { readCoreData, SwitchDataSchema } from '@ubichill/core-components';
import { useWorld } from '@ubichill/react';
import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { partButton, partButtonLabel } from './partStyles';
import { surfacePlacement } from './surfacePlacement';

const DEFAULT_LABEL = 'スイッチ';

/** `core:switch` のボタン。押すと、対象の見える・見えないを部屋の全員で切り替える（切り替えるのはインスタンス）。 */
export const CoreSwitch: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const { pressSwitch } = useWorld();
    const parsed = readCoreData(SwitchDataSchema, entity.data ?? {});
    const label = (parsed.success && parsed.data.label.trim()) || DEFAULT_LABEL;
    const ready = parsed.success && parsed.data.targets.length > 0;
    return (
        <div data-switch={entity.entityId ?? entity.id} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
            <button type="button" className={partButton} disabled={!ready} onClick={() => pressSwitch(entity.id)}>
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
                    <rect x="2" y="6" width="20" height="12" rx="6" />
                    <circle cx="16" cy="12" r="3" />
                </svg>
                <span className={partButtonLabel}>{label}</span>
            </button>
        </div>
    );
};
