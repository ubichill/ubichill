import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { WarpIcon } from './partIcons';
import { partButton, partButtonLabel } from './partStyles';
import { ScriptBadge } from './ScriptBadge';
import { surfacePlacement } from './surfacePlacement';
import { useEntityScript } from './useEntityScript';

const DEFAULT_LABEL = 'ワープ';

/**
 * `core:warp`。押すと、行き先の Entity が画面の中心に来るようにスクロールする（本人だけ）。同じ Entity に UI のボタンがあれば
 * それで動き、自分では描かない。無ければ標準のボタンを出す。
 */
export const CoreWarp: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const { script, onButton, ready, run } = useEntityScript(entity);
    const label = script?.label || DEFAULT_LABEL;
    if (onButton) return <ScriptBadge entity={entity} label={label} icon={<WarpIcon size={12} />} />;
    return (
        <div data-warp={entity.entityId ?? entity.id} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
            <button type="button" className={partButton} disabled={!ready} onClick={() => run(label)}>
                <WarpIcon size={20} />
                <span className={partButtonLabel}>{label}</span>
            </button>
        </div>
    );
};
