import { PortalDataSchema, type PortalTarget, parsePortalTarget, readCoreData } from '@ubichill/core-components';
import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { useEffect, useState } from 'react';
import { css } from '@/styled-system/css';
import { type PortalDestination, usePortalLookup, usePortalNavigation } from './portalNavigation';
import { surfacePlacement } from './surfacePlacement';

const DEFAULT_LABEL = '入口';

/** 行き先のワールドを引く（引けない・引く手段が無いときは null のまま）。 */
function usePortalDestination(target: PortalTarget | null): PortalDestination | null {
    const lookup = usePortalLookup();
    const key = target ? JSON.stringify(target) : '';
    const [found, setFound] = useState<{ key: string; destination: PortalDestination | null } | null>(null);
    // biome-ignore lint/correctness/useExhaustiveDependencies: 行き先は key（中身）で比べる（target は描くたびに作り直される）
    useEffect(() => {
        if (!lookup || !target) return;
        const cancelled = { current: false };
        void lookup(target).then((destination) => {
            if (!cancelled.current) setFound({ key, destination });
        });
        return () => {
            cancelled.current = true;
        };
    }, [lookup, key]);
    return found?.key === key ? found.destination : null;
}

/**
 * `core:portal` の入口。行き先のワールドのサムネイルを丸い窓に出し、上に名前を出す。押すと、行き先のワールドへ移る
 * （移り方は SNS の画面が決める。usePortalNavigation）。行き先が無い・移り方が渡されていない（world.html・エディタ）ときは押せない。
 */
export const CorePortal: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const go = usePortalNavigation();
    const parsed = readCoreData(PortalDataSchema, entity.data ?? {});
    const target = parsed.success ? parsePortalTarget(parsed.data.world) : null;
    const destination = usePortalDestination(target);
    const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
    const entityId = entity.entityId ?? entity.id;
    const name = (parsed.success && parsed.data.label.trim()) || destination?.name || DEFAULT_LABEL;
    const thumbnail =
        destination?.thumbnail && destination.thumbnail !== failedThumbnail ? destination.thumbnail : null;
    return (
        <div data-portal={entityId} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
            <button
                type="button"
                className={portal}
                disabled={!go || !target}
                onClick={() => {
                    if (go && target) go(target, name);
                }}
            >
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
                        <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            width="40%"
                            height="40%"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                            <path d="m10 17 5-5-5-5" />
                            <path d="M15 12H3" />
                        </svg>
                    )}
                </span>
            </button>
        </div>
    );
};

const portal = css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2',
    w: 'full',
    minW: '96px',
    // 窓の外側の輪（ホバーで太くなる）を、Entity の矩形の中に収める
    p: '3',
    bg: 'transparent',
    border: 'none',
    cursor: 'pointer',
    _disabled: { cursor: 'default' },
});

const portalName = css({
    maxW: 'full',
    px: '3',
    py: '1',
    bg: 'background',
    color: 'text',
    borderRadius: 'full',
    fontSize: '15px',
    fontWeight: 'bold',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const portalWindow = css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: 'full',
    aspectRatio: '1 / 1',
    borderRadius: 'full',
    overflow: 'hidden',
    bg: 'surface',
    color: 'primary',
    border: '4px solid',
    borderColor: 'primaryHighlight',
    outline: '6px solid',
    outlineColor: 'primarySubtle',
    transition: 'transform 0.2s ease, outline-width 0.2s ease',
    '[data-portal] button:enabled:hover &': { transform: 'scale(1.03)', outlineWidth: '8px' },
    '[data-portal] button:focus-visible &': { outlineColor: 'primaryHighlight' },
});

const portalImage = css({ w: 'full', h: 'full', objectFit: 'cover' });
