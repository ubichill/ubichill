import { readCoreData, SwitchDataSchema } from '@ubichill/core-components';
import { useWorld } from '@ubichill/react';
import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { PartHitArea } from './PartHitArea';
import { SwitchIcon } from './partIcons';
import { partButton, partButtonLabel } from './partStyles';
import { surfacePlacement } from './surfacePlacement';

const DEFAULT_LABEL = 'スイッチ';

/** `core:switch` のボタン。押すと、対象の見える・見えないを部屋の全員で切り替える（切り替えるのはインスタンス）。 */
export const CoreSwitch: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const { pressSwitch } = useWorld();
    const parsed = readCoreData(SwitchDataSchema, entity.data ?? {});
    const label = (parsed.success && parsed.data.label.trim()) || DEFAULT_LABEL;
    const ready = parsed.success && parsed.data.targets.length > 0;
    const press = () => pressSwitch(entity.id);
    if (parsed.success && parsed.data.look === 'none')
        return (
            <PartHitArea
                entity={entity}
                label={label}
                icon={<SwitchIcon size={12} />}
                disabled={!ready}
                onPress={press}
            />
        );
    return (
        <div data-switch={entity.entityId ?? entity.id} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
            <button type="button" className={partButton} disabled={!ready} onClick={press}>
                <SwitchIcon size={20} />
                <span className={partButtonLabel}>{label}</span>
            </button>
        </div>
    );
};
