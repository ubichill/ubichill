import { useSocket } from '@ubichill/react';
import { type ComponentInstance, ROOM_PORTAL, type RoomPortalData, roomPortalRemaining } from '@ubichill/shared';
import type React from 'react';
import { memo, useState } from 'react';
import { css } from '@/styled-system/css';
import { CloseIcon, LockIcon, PortalIcon } from './partIcons';
import { portal, portalImage, portalName, portalWindow } from './portalLook';
import { usePortalNavigation } from './portalNavigation';
import { surfacePlacement } from './surfacePlacement';
import { usePortalDestination } from './usePortalDestination';
import { useRoomPortalActions } from './useRoomPortalActions';

/**
 * 部屋で利用者が置いたポータル（`core:portal` の、行き先が部屋のもの）。行き先の部屋のワールドを丸い窓に出し、残り時間を
 * 窓の輪で、置いた人の名前を下に出す。押すとその部屋へ移る。見る人が入れない部屋は鍵を出して押せない。置いた人は閉じられる。
 */
export const CoreRoomPortal: React.FC<{ entity: ComponentInstance; data: RoomPortalData }> = ({ entity, data }) => {
    // 参加者の一覧はカーソルが動くたびに変わるので、ここでは自分のものかだけを見て、描くのは memo した方に任せる
    const mine = useSocket().currentUser?.id === entity.ownerId;
    const { close } = useRoomPortalActions();
    return <RoomPortalView entity={entity} data={data} onClose={mine ? close : undefined} />;
};

const RoomPortalView = memo(function RoomPortalView({
    entity,
    data,
    onClose,
}: {
    entity: ComponentInstance;
    data: RoomPortalData;
    onClose?: () => Promise<string | null>;
}) {
    const go = usePortalNavigation();
    const destination = usePortalDestination({ kind: 'room', room: data.room });
    const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
    // 輪は置いた時からの経過に合わせて途中から減らし始める（描き直しでは戻さない）
    const [elapsed] = useState(() => (1 - roomPortalRemaining(data.expiresAt, Date.now())) * ROOM_PORTAL.LIFETIME_MS);
    const gone = destination === null;
    const locked = gone || destination?.locked === true;
    const name = destination?.name ?? (gone ? '入れない部屋' : 'ポータル');
    const thumbnail =
        destination?.thumbnail && destination.thumbnail !== failedThumbnail ? destination.thumbnail : null;
    const look = destination ? { displayName: destination.name, thumbnail: destination.thumbnail } : undefined;

    return (
        <div data-portal={entity.id} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }} className={column}>
            <button
                type="button"
                className={portal}
                disabled={!go || destination === undefined || locked}
                title={locked ? 'この部屋には入れません' : undefined}
                onClick={() => void go?.({ kind: 'room', room: data.room }, name, look)}
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
                        <span className={lockShade}>
                            <LockIcon size="30%" />
                        </span>
                    )}
                    <svg aria-hidden="true" viewBox="0 0 100 100" className={ring}>
                        <circle
                            cx="50"
                            cy="50"
                            r="48"
                            pathLength={100}
                            className={ringArc}
                            style={{
                                animationDuration: `${ROOM_PORTAL.LIFETIME_MS}ms`,
                                animationDelay: `-${elapsed}ms`,
                            }}
                        />
                    </svg>
                </span>
            </button>
            <span className={footer}>
                <span className={owner}>{data.ownerName}が開いた</span>
                {onClose && (
                    <button
                        type="button"
                        aria-label="ポータルを閉じる"
                        className={closeButton}
                        onClick={() =>
                            void onClose().then((error) => {
                                if (error) console.warn('[RoomPortal] 閉じられませんでした:', error);
                            })
                        }
                    >
                        <CloseIcon size={12} strokeWidth={2.5} />
                    </button>
                )}
            </span>
        </div>
    );
});

const column = css({ display: 'flex', flexDirection: 'column', alignItems: 'center' });

// 名前は幅いっぱいまで出し、窓は少し小さくする（行き先の名前が切れにくいように）
const frame = css({ position: 'relative', w: '140px', maxW: 'full', display: 'block' });

const footer = css({ display: 'flex', alignItems: 'center', gap: '1', maxW: 'full', mt: '-1' });

// 窓の外側の輪（outline）の上に、残りの分だけ重ねる
const ring = css({
    position: 'absolute',
    inset: '-6px',
    w: 'calc(100% + 12px)',
    h: 'calc(100% + 12px)',
    transform: 'rotate(-90deg)',
    pointerEvents: 'none',
});

const ringArc = css({
    fill: 'none',
    stroke: 'primaryHighlight',
    strokeWidth: '4',
    strokeLinecap: 'round',
    strokeDasharray: '100',
    animationName: 'portalCountdown',
    animationTimingFunction: 'linear',
    animationFillMode: 'forwards',
    _motionReduce: { animationName: 'none' },
});

const lockShade = css({
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'full',
    bg: 'bannerShade',
    color: 'textOnPrimary',
});

const owner = css({
    maxW: 'full',
    fontSize: '12px',
    color: 'textMuted',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const closeButton = css({
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '22px',
    h: '22px',
    p: '0',
    bg: 'background',
    color: 'text',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: 'full',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover' },
    _focusVisible: { outline: '3px solid', outlineColor: 'primaryHighlight' },
});
