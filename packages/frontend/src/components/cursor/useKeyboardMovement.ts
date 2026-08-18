import { ridingSyncRef } from '@ubichill/react';
import type { CursorPosition, EntityTransform } from '@ubichill/shared';
import { useEffect, useRef } from 'react';
import { computeCameraScroll } from './useCameraFollow';

const SPEED = 220; // px/秒
const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/** 乗り物Entityの左上座標から、ユーザー/カメラが追従する中心座標を求める。 */
export function riddenTransformPosition(transform: EntityTransform): CursorPosition {
    return { x: transform.x + transform.w / 2, y: transform.y + transform.h / 2 };
}

/**
 * 押下中キーの集合から次の position を積分する純関数。`worldSize` の範囲に clamp する。
 * 入力が無ければ(移動キー未押下)`current` をそのまま返す。
 */
export function integrateKeyboardMovement(
    current: CursorPosition,
    pressed: ReadonlySet<string>,
    worldSize: { width: number; height: number },
    deltaSec: number,
    speed: number = SPEED,
): CursorPosition {
    let dx = 0;
    let dy = 0;
    if (pressed.has('ArrowLeft')) dx -= 1;
    if (pressed.has('ArrowRight')) dx += 1;
    if (pressed.has('ArrowUp')) dy -= 1;
    if (pressed.has('ArrowDown')) dy += 1;
    if (dx === 0 && dy === 0) return current;

    const len = Math.hypot(dx, dy) || 1;
    return {
        x: Math.min(Math.max(current.x + (dx / len) * speed * deltaSec, 0), worldSize.width),
        y: Math.min(Math.max(current.y + (dy / len) * speed * deltaSec, 0), worldSize.height),
    };
}

/**
 * 「乗って」いる間(`ridingSyncRef` が non-null)だけ、自分のpositionとカメラを
 * 乗り物Entityの中心へ追従させる。移動そのものは矢印入力を受け取る乗り物Workerが担う。
 *
 * `ridingSyncRef` は `RideProvider`(router 内層)を跨いで読む必要があるため、
 * React state/props ではなくモジュールレベルの値を毎フレーム直接ポーリングする
 * (`useBroadcastCursor` が `heldEntitySyncRef` を読むのと同じ設計)。
 *
 * これにより、Colliderで止まった乗り物とユーザー座標が別々に積分されてずれることがない。
 */
export function useKeyboardMovement(
    scrollEl: HTMLElement | null,
    worldSize: { width: number; height: number },
    getRiddenPosition: (componentInstanceId: string) => CursorPosition | undefined,
    updatePosition: (position: CursorPosition, heldEntityId?: string | null) => void,
): void {
    const scrollElRef = useRef(scrollEl);
    useEffect(() => {
        scrollElRef.current = scrollEl;
    }, [scrollEl]);

    const worldSizeRef = useRef(worldSize);
    useEffect(() => {
        worldSizeRef.current = worldSize;
    }, [worldSize]);

    const getRiddenPositionRef = useRef(getRiddenPosition);
    const updatePositionRef = useRef(updatePosition);
    useEffect(() => {
        getRiddenPositionRef.current = getRiddenPosition;
        updatePositionRef.current = updatePosition;
    });

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!MOVE_KEYS.has(e.key)) return;
            if (!ridingSyncRef.get()) return; // 乗車中でなければ矢印キーは素通し(ページスクロール等)
            e.preventDefault();
        };
        window.addEventListener('keydown', onKeyDown);

        let rafId = 0;
        let lastSent: CursorPosition | null = null;
        let lastRideId: string | null = null;
        const tick = () => {
            rafId = requestAnimationFrame(tick);
            const ride = ridingSyncRef.get();
            if (!ride) {
                lastRideId = null;
                lastSent = null;
                return;
            }
            if (lastRideId !== ride.entityId) {
                lastRideId = ride.entityId;
                lastSent = null;
            }
            const position = getRiddenPositionRef.current(ride.entityId);
            if (!position) return;

            if (!lastSent || lastSent.x !== position.x || lastSent.y !== position.y) {
                lastSent = position;
                updatePositionRef.current(position);
            }

            // mount直後や停止中も、viewport変更へ追従できるよう毎フレーム計算する。
            const scrollEl = scrollElRef.current;
            if (scrollEl) {
                const { scrollLeft, scrollTop } = computeCameraScroll(position, worldSizeRef.current, {
                    width: scrollEl.clientWidth,
                    height: scrollEl.clientHeight,
                });
                scrollEl.scrollLeft = scrollLeft;
                scrollEl.scrollTop = scrollTop;
            }
        };
        rafId = requestAnimationFrame(tick);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            cancelAnimationFrame(rafId);
        };
    }, []);
}
