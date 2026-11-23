import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { useState } from 'react';
import { css } from '@/styled-system/css';
import { LockIcon, PortalIcon } from './partIcons';
import { portal, portalImage, portalLockShade, portalName, portalWindow } from './portalLook';
import { ScriptBadge } from './ScriptBadge';
import { surfacePlacement } from './surfacePlacement';
import { useEntityScript } from './useEntityScript';
import { usePortalDestination } from './usePortalDestination';

const DEFAULT_LABEL = 'ポータル';

/**
 * `core:portal`（ポータル）。行き先のワールドのサムネイルを丸い窓に出し、上に名前を出す。押すと、行き先のワールドの
 * パブリックの部屋へ移る（移り方は SNS の画面が決める。usePortalNavigation）。行き先が無い・移り方が渡されていない
 * （world.html・エディタ）ときは押せない。行き先がプライベートのワールドなら鍵を出して押せない。
 */
export const CorePortal: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const { script, onButton, ready, run } = useEntityScript(entity);
    const target = script?.kind === 'portal' ? script.target : null;
    const destination = usePortalDestination(target) ?? null;
    const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
    const entityId = entity.entityId ?? entity.id;
    const name = script?.label || destination?.name || DEFAULT_LABEL;
    const locked = destination?.locked === true;
    const thumbnail =
        destination?.thumbnail && destination.thumbnail !== failedThumbnail ? destination.thumbnail : null;
    if (onButton) return <ScriptBadge entity={entity} label={name} icon={<PortalIcon size={12} />} />;
    return (
        <div data-portal={entityId} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
            <button
                type="button"
                className={portal}
                disabled={!ready || locked}
                title={locked ? 'プライベートのワールドには、ポータルから入れません' : undefined}
                onClick={() => run(name)}
            >
                <span className={portalName}>{name}</span>
                <span className={frame}>
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
                            !locked && <PortalIcon size="40%" strokeWidth={1.6} />
                        )}
                    </span>
                    {locked && (
                        <span className={portalLockShade}>
                            <LockIcon size="30%" />
                        </span>
                    )}
                </span>
            </button>
        </div>
    );
};

const frame = css({ position: 'relative', display: 'block', w: 'full' });
