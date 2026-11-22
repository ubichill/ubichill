import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { SwitchIcon } from './partIcons';
import { partButton, partButtonLabel } from './partStyles';
import { ScriptBadge } from './ScriptBadge';
import { surfacePlacement } from './surfacePlacement';
import { useEntityScript } from './useEntityScript';

const DEFAULT_LABEL = 'スイッチ';

/**
 * `core:switch`。押すと、対象の見える・見えないを部屋の全員で切り替える（切り替えるのはインスタンス）。同じ Entity に
 * UI のボタンがあればそれで動き、自分では描かない。無ければ標準のボタンを出す。
 */
export const CoreSwitch: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const { script, onButton, ready, run } = useEntityScript(entity);
    const label = script?.label || DEFAULT_LABEL;
    if (onButton) return <ScriptBadge entity={entity} label={label} icon={<SwitchIcon size={12} />} />;
    return (
        <div data-switch={entity.entityId ?? entity.id} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
            <button type="button" className={partButton} disabled={!ready} onClick={() => run(label)}>
                <SwitchIcon size={20} />
                <span className={partButtonLabel}>{label}</span>
            </button>
        </div>
    );
};
