import { useWorld } from '@ubichill/react';
import { ROOM_PORTAL } from '@ubichill/shared';
import { type PointerEvent as ReactPointerEvent, type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { css, cva, cx } from '@/styled-system/css';
import { useScrollWorldEl } from './cursor/useScrollWorldEl';
import { PortalIcon } from './partIcons';
import { placementFocus } from './placementFocus';
import { portal, portalImage, portalName, portalWindow, roomPortalColumn, roomPortalFrame } from './portalLook';
import {
    initialPlacement,
    isTap,
    movedByKey,
    nextFocusIndex,
    type Point,
    placementAt,
    placementKeyAction,
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

/** 置く画面の上の押す操作は、下のワールド・mod（window で聞いている）に渡さない。 */
const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * 部屋へのポータルを置く場所を選ぶ。行き先の見た目のゴーストをワールドの上に出し、ポインターに付いて動かす。
 * クリック・タップでその場所に置く。ドラッグで動かして「ここに置く」でも置ける。矢印キーで動かし（Shift で大きく）、
 * Enter で置く。Esc か「やめる」でやめる（置いている途中でも）。ホイールはワールドのスクロールに回す。
 * モーダルとしてフォーカスを中に閉じ込め（トーストなどへ出たら取り返す）、押す操作とキーを mod に渡さない（ペンで描く・
 * 自機に乗る・撃つなどをしない）。Ctrl・Alt・Meta との組み合わせはブラウザ・OS のショートカットに任せる。確認・権限の
 * ダイアログが上に出ている間は、フォーカスもキーもそちらに譲る。キーを離したこと（keyup）は渡す（押したまま始めたキーが
 * mod で押されっぱなしにならない）。
 */
export function PortalPlacementLayer({
    look,
    onPlace,
    onCancel,
    cancellable = true,
}: {
    look: PortalPlacementLook;
    /** 置く場所を決めた（ワールドの座標のポータルの真ん中）。終わるまで選び直せない */
    onPlace: (at: Point) => Promise<void>;
    /** やめる。置いている途中なら取りやめる */
    onCancel: () => void;
    /** やめられるか（インスタンスに置くよう送ったあとは、返事が来るまでやめられない） */
    cancellable?: boolean;
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

    const commit = (point: Point) => {
        if (placingRef.current) return;
        placingRef.current = true;
        // 押したボタンが押せなくなってもフォーカスを外に落とさない（Esc で取りやめられるように）
        layerRef.current?.focus();
        setAt(point);
        setPlacing(true);
        void onPlace(point).finally(() => {
            placingRef.current = false;
            setPlacing(false);
        });
    };

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

    const onKey = (e: KeyboardEvent) => {
        const layerEl = layerRef.current;
        if (!layerEl || e.isComposing) return;
        const where = placementFocus(layerEl, document);
        if (where === 'dialog') return;
        e.stopImmediatePropagation();
        if (where === 'reclaim') layerEl.focus();
        const button = e.target instanceof HTMLButtonElement && layerEl.contains(e.target) ? e.target : null;
        const action = placementKeyAction(e, button !== null);
        if (action === 'pass' || action === 'swallow') return;
        e.preventDefault();
        if (action === 'button') return button?.click();
        if (action === 'cancel') return cancellable ? onCancel() : undefined;
        if (action === 'focus-next' || action === 'focus-previous') {
            const items = [...layerEl.querySelectorAll<HTMLButtonElement>('button:enabled')];
            const active = document.activeElement;
            const current = active instanceof HTMLButtonElement ? items.indexOf(active) : -1;
            const next = items[nextFocusIndex(current, items.length, action === 'focus-previous')];
            return (next ?? layerEl).focus();
        }
        if (!at || placingRef.current) return;
        if (action === 'place') return commit(at);
        const moved = movedByKey(at, e.key, e.shiftKey, world);
        if (!moved) return;
        hovering.current = null;
        setAt(moved);
        const scroll = view && revealScroll(moved, view);
        if (scroll && scrollEl) scrollEl.scrollTo(scroll.left, scroll.top);
    };
    const onKeyRef = useRef(onKey);
    onKeyRef.current = onKey;

    // キーは window の capture で先に受ける（フォーカスがトースト・body に出ても mod に渡さない）。フォーカスが外に出たら取り返す
    useEffect(() => {
        const layerEl = layerRef.current;
        if (!layerEl) return;
        layerEl.focus();
        const onKeyDown = (e: KeyboardEvent) => onKeyRef.current(e);
        const reclaim = () =>
            setTimeout(() => {
                if (layerEl.isConnected && placementFocus(layerEl, document) === 'reclaim') layerEl.focus();
            }, 0);
        window.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('focusin', reclaim);
        document.addEventListener('focusout', reclaim);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('focusin', reclaim);
            document.removeEventListener('focusout', reclaim);
        };
    }, []);

    const follow = (client: Point) => {
        if (view && !placingRef.current) setAt(placementAt(pointerToWorld(client, view), world));
    };
    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
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
            tabIndex={-1}
            className={layer}
            onPointerDown={stop}
            onPointerUp={stop}
            onMouseDown={stop}
            onMouseUp={stop}
            onContextMenu={stop}
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
                    disabled={!cancellable}
                    onClick={onCancel}
                >
                    やめる
                </button>
                <button
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
const layer = css({ position: 'fixed', inset: 0, zIndex: 10005, outline: 'none' });

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
