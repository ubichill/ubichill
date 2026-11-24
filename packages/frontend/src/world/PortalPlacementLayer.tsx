import { useWorld } from '@ubichill/react';
import { ROOM_PORTAL } from '@ubichill/shared';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { css, cva, cx } from '@/styled-system/css';
import { useScrollWorldEl } from './cursor/useScrollWorldEl';
import { PortalIcon } from './partIcons';
import { portal, portalImage, portalName, portalWindow, roomPortalColumn, roomPortalFrame } from './portalLook';
import {
    initialPlacement,
    isTap,
    movedByKey,
    type Point,
    placementAt,
    pointerToWorld,
    revealScroll,
    type WorldViewport,
    worldToScreen,
} from './portalPlacement';

/** 置く場所を選ぶ間に出す、行き先の見た目。 */
export interface PortalPlacementLook {
    name: string;
    thumbnail?: string;
}

function readViewport(el: HTMLElement): WorldViewport {
    const rect = el.getBoundingClientRect();
    return {
        left: rect.left,
        top: rect.top,
        width: el.clientWidth,
        height: el.clientHeight,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        scale: el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1,
    };
}

const clientOf = (e: { clientX: number; clientY: number }): Point => ({ x: e.clientX, y: e.clientY });

/** 選んでいる間に横取りするキー（mod や Esc のランチパッドに渡さない）。 */
const PLACEMENT_KEYS = new Set(['Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/**
 * 部屋へのポータルを置く場所を選ぶ。行き先の見た目のゴーストをワールドの上に出し、ポインターに付いて動かす。
 * クリック・タップでその場所に置く。ドラッグで動かして「ここに置く」でも置ける。矢印キーで動かし（Shift で大きく）、
 * Enter で置く。Esc か「やめる」でやめる。選んでいる間の押す・キーは mod に渡さない（ペンで描く・自機に乗るなどをしない）。
 * ホイールはワールドのスクロールに回す。
 */
export function PortalPlacementLayer({
    look,
    onPlace,
    onCancel,
}: {
    look: PortalPlacementLook;
    /** 置く場所を決めた（ワールドの座標のポータルの真ん中）。終わるまで選び直せない */
    onPlace: (at: Point) => Promise<void>;
    onCancel: () => void;
}) {
    const world = useWorld().environment.worldSize;
    const scrollEl = useScrollWorldEl();
    const [view, setView] = useState<WorldViewport | null>(null);
    const [at, setAt] = useState<Point | null>(null);
    const [placing, setPlacing] = useState(false);
    const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
    const placingRef = useRef(false);
    const pressed = useRef<{ pointerId: number; client: Point } | null>(null);
    // マウスの最後の位置。スクロールしても、ゴーストをマウスの下に保つ（キーで動かしたら離す）
    const hovering = useRef<Point | null>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);

    const commit = (point: Point) => {
        if (placingRef.current) return;
        placingRef.current = true;
        setAt(point);
        setPlacing(true);
        void onPlace(point).finally(() => {
            placingRef.current = false;
            setPlacing(false);
        });
    };
    const latest = useRef({ at, view, world, scrollEl, commit, onCancel });
    latest.current = { at, view, world, scrollEl, commit, onCancel };

    useEffect(() => {
        if (!scrollEl) return;
        const sync = () => {
            const next = readViewport(scrollEl);
            setView(next);
            const hover = hovering.current;
            if (hover && !placingRef.current) setAt(placementAt(pointerToWorld(hover, next), world));
        };
        const first = readViewport(scrollEl);
        setView(first);
        setAt((current) => current ?? initialPlacement(first, world));
        scrollEl.addEventListener('scroll', sync, { passive: true });
        window.addEventListener('resize', sync);
        return () => {
            scrollEl.removeEventListener('scroll', sync);
            window.removeEventListener('resize', sync);
        };
    }, [scrollEl, world]);

    useEffect(() => {
        confirmRef.current?.focus();
    }, []);

    useEffect(() => {
        const swallow = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (!PLACEMENT_KEYS.has(e.key) || e.isComposing || e.keyCode === 229) return;
            const { at: current, view: v, world: w, scrollEl: el } = latest.current;
            // 「やめる」「ここに置く」にフォーカスがあれば、Enter はそのボタンを押す
            const onButton = e.target instanceof Element && !!layerRef.current?.contains(e.target.closest('button'));
            if (e.key === 'Enter' && onButton) return;
            swallow(e);
            if (placingRef.current) return;
            if (e.key === 'Escape') return latest.current.onCancel();
            if (!current) return;
            if (e.key === 'Enter') return latest.current.commit(current);
            const moved = movedByKey(current, e.key, e.shiftKey, w);
            if (!moved) return;
            hovering.current = null;
            setAt(moved);
            const scroll = v && revealScroll(moved, v);
            if (scroll && el) el.scrollTo(scroll.left, scroll.top);
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (PLACEMENT_KEYS.has(e.key)) e.stopImmediatePropagation();
        };
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('keyup', onKeyUp, true);
        };
    }, []);

    const follow = (client: Point) => {
        if (view && !placingRef.current) setAt(placementAt(pointerToWorld(client, view), world));
    };
    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (e.button !== 0 || placingRef.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pressed.current = { pointerId: e.pointerId, client: clientOf(e) };
        follow(clientOf(e));
    };
    const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== 'touch') hovering.current = clientOf(e);
        // 指は触れている間だけ動かす（マウス・ペンは浮かせていても付いてくる）
        if (e.pointerType === 'touch' && pressed.current?.pointerId !== e.pointerId) return;
        follow(clientOf(e));
    };
    const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
        e.stopPropagation();
        const down = pressed.current;
        pressed.current = null;
        if (!down || down.pointerId !== e.pointerId || !view) return;
        if (isTap(down.client, clientOf(e))) commit(placementAt(pointerToWorld(clientOf(e), view), world));
    };

    const screen = at && view ? worldToScreen(at, view) : null;
    const scale = view?.scale ?? 1;
    const thumbnail = look.thumbnail && look.thumbnail !== failedThumbnail ? look.thumbnail : null;

    return (
        <div
            ref={layerRef}
            role="dialog"
            aria-modal="true"
            aria-label="ポータルを置く場所"
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter Escape"
            className={layer}
        >
            <div
                data-portal-placement-surface
                className={surface}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                    pressed.current = null;
                }}
                onWheel={(e) => {
                    // Firefox はホイールを行の数で送る
                    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (scrollEl?.clientHeight ?? 1) : 1;
                    scrollEl?.scrollBy({ left: e.deltaX * unit, top: e.deltaY * unit });
                }}
            />
            {screen && (
                <div
                    data-portal-ghost
                    aria-hidden="true"
                    className={cx(roomPortalColumn, ghost({ placing }))}
                    style={{
                        left: screen.x - (ROOM_PORTAL.WIDTH * scale) / 2,
                        top: screen.y - (ROOM_PORTAL.HEIGHT * scale) / 2,
                        width: ROOM_PORTAL.WIDTH,
                        height: ROOM_PORTAL.HEIGHT,
                        transform: `scale(${scale})`,
                    }}
                >
                    <div className={portal}>
                        <span className={portalName}>{look.name}</span>
                        <span className={roomPortalFrame}>
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
                        </span>
                    </div>
                </div>
            )}
            <div className={bar}>
                <p className={hint}>{placing ? '置いています...' : '押した所に置きます'}</p>
                <button
                    type="button"
                    className={barButton({ intent: 'secondary' })}
                    disabled={placing}
                    onClick={onCancel}
                >
                    やめる
                </button>
                <button
                    ref={confirmRef}
                    type="button"
                    className={barButton({ intent: 'primary' })}
                    disabled={placing || !at}
                    onClick={() => at && commit(at)}
                >
                    <PortalIcon size={16} />
                    ここに置く
                </button>
            </div>
        </div>
    );
}

// ランチパッドを開くボタン（10000）より上、ランチパッド（10010）・確認（10020）・トースト（10040）より下
const layer = css({ position: 'fixed', inset: 0, zIndex: 10005 });

// 指のドラッグはスクロールでなくゴーストを動かす
const surface = css({ position: 'absolute', inset: 0, touchAction: 'none' });

const ghost = cva({
    base: {
        position: 'absolute',
        transformOrigin: '0 0',
        pointerEvents: 'none',
        opacity: 0.7,
        filter: 'drop-shadow(0 6px 16px rgba(0, 0, 0, 0.35))',
    },
    variants: {
        placing: { true: { opacity: 0.45 } },
    },
});

const bar = css({
    position: 'absolute',
    left: '50%',
    bottom: '4',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '3',
    maxW: 'calc(100vw - 32px)',
    px: '4',
    py: '2.5',
    bg: 'hudPanel',
    border: '1px solid',
    borderColor: 'hudBorder',
    borderRadius: '12px',
    boxShadow: 'toast',
    whiteSpace: 'nowrap',
});

const hint = css({ fontSize: '12px', color: 'hudTextMuted', overflow: 'hidden', textOverflow: 'ellipsis' });

const barButton = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '1.5',
        flexShrink: 0,
        px: '3.5',
        py: '2',
        fontSize: '13px',
        fontWeight: '600',
        borderRadius: '8px',
        border: '1px solid',
        cursor: 'pointer',
        _focusVisible: { outline: '3px solid', outlineColor: 'primaryHighlight', outlineOffset: '2px' },
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
    variants: {
        intent: {
            primary: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary', _hover: { bg: 'primaryHover' } },
            secondary: {
                bg: 'transparent',
                color: 'hudText',
                borderColor: 'hudBorder',
                _hover: { bg: 'hudActionHover' },
            },
        },
    },
});
