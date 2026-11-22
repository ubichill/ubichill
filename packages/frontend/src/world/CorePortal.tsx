import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { useState } from 'react';
import { PortalIcon } from './partIcons';
import { portal, portalImage, portalName, portalWindow } from './portalLook';
import { ScriptBadge } from './ScriptBadge';
import { surfacePlacement } from './surfacePlacement';
import { useEntityScript } from './useEntityScript';
import { usePortalDestination } from './usePortalDestination';

const DEFAULT_LABEL = 'ポータル';

/**
 * `core:portal`（ポータル）。行き先のワールドのサムネイルを丸い窓に出し、上に名前を出す。押すと、行き先のワールドへ移る
 * （移り方は SNS の画面が決める。usePortalNavigation）。行き先が無い・移り方が渡されていない（world.html・エディタ）ときは押せない。
 */
export const CorePortal: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const { script, onButton, ready, run } = useEntityScript(entity);
    const target = script?.kind === 'portal' ? script.target : null;
    const destination = usePortalDestination(target) ?? null;
    const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
    const entityId = entity.entityId ?? entity.id;
    const name = script?.label || destination?.name || DEFAULT_LABEL;
    const thumbnail =
        destination?.thumbnail && destination.thumbnail !== failedThumbnail ? destination.thumbnail : null;
    if (onButton) return <ScriptBadge entity={entity} label={name} icon={<PortalIcon size={12} />} />;
    return (
        <div data-portal={entityId} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
            <button type="button" className={portal} disabled={!ready} onClick={() => run(name)}>
                <span className={portalName}>{name}</span>
                <span className={portalWindow}>
                    {thumbnail ? (
                        <img
                            src={thumbnail}
                            alt=""
                            draggable={false}
                            referrerPolicy="no-referrer"
                            onError={() => setFailedThumbnail(thumbnail)}
                            className={portalImage}
                        />
                    ) : (
                        <PortalIcon size="40%" strokeWidth={1.6} />
                    )}
                </span>
            </button>
        </div>
    );
};
