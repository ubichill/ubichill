import { readCoreData, WarpDataSchema } from '@ubichill/core-components';
import { useWorld } from '@ubichill/react';
import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { PartHitArea } from './PartHitArea';
import { WarpIcon } from './partIcons';
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
    const press = () => {
        if (target) scrollWorldTo(target, environment.worldSize);
    };
    if (parsed.success && parsed.data.look === 'none')
        return (
            <PartHitArea
                entity={entity}
                label={label}
                icon={<WarpIcon size={12} />}
                disabled={!target}
                onPress={press}
            />
        );
    return (
        <div data-warp={entity.entityId ?? entity.id} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
            <button type="button" className={partButton} disabled={!target} onClick={press}>
                <WarpIcon size={20} />
                <span className={partButtonLabel}>{label}</span>
            </button>
        </div>
    );
};
