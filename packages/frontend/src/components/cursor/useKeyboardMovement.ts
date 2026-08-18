import { ridingSyncRef } from '@ubichill/react';
import type { CursorPosition } from '@ubichill/shared';
import { useEffect, useRef } from 'react';
import { computeCameraScroll } from './useCameraFollow';

const SPEED = 220; // px/秒
const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

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
 * 「乗って」いる間(`ridingSyncRef` が non-null)だけ、矢印キーの押下状態から自分の
 * position (アバター自身の世界内絶対座標) を毎フレーム積分して動かし、カメラ
 * (スクロール位置)をそこへ追従させる。
 *
 * `ridingSyncRef` は `RideProvider`(router 内層)を跨いで読む必要があるため、
 * React state/props ではなくモジュールレベルの値を毎フレーム直接ポーリングする
 * (`useBroadcastCursor` が `heldEntitySyncRef` を読むのと同じ設計)。
 *
 * - `useBroadcastCursor` と同じ「自己完結・React state を持たない」スタイル。
 *   move 判定は Set で持ち、位置更新は requestAnimationFrame ループのみで行う。
 * - 更新後の position は既存の `updatePosition`(= `cursor:move` socket イベント)で
 *   配信する。マウス経由かキーボード経由かはサーバー側は関知しない。
 * - `worldSize` の範囲に clamp する。乗車中のみ、これが `worldSize` の実質的な強制力になる。
 */
export function useKeyboardMovement(
    scrollEl: HTMLElement | null,
    worldSize: { width: number; height: number },
    getPosition: () => CursorPosition | undefined,
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

    const getPositionRef = useRef(getPosition);
    const updatePositionRef = useRef(updatePosition);
    useEffect(() => {
        getPositionRef.current = getPosition;
        updatePositionRef.current = updatePosition;
    });

    useEffect(() => {
        const pressed = new Set<string>();
        const onKeyDown = (e: KeyboardEvent) => {
            if (!MOVE_KEYS.has(e.key)) return;
            if (!ridingSyncRef.get()) return; // 乗車中でなければ矢印キーは素通し(ページスクロール等)
            pressed.add(e.key);
            e.preventDefault();
        };
        const onKeyUp = (e: KeyboardEvent) => {
            pressed.delete(e.key);
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        let rafId = 0;
        let lastTs = 0;
        const tick = (ts: number) => {
            rafId = requestAnimationFrame(tick);
            const deltaSec = lastTs ? (ts - lastTs) / 1000 : 0;
            lastTs = ts;
            if (!ridingSyncRef.get()) return;

            const current = getPositionRef.current();
            if (!current) return;

            if (pressed.size > 0) {
                const next = integrateKeyboardMovement(current, pressed, worldSizeRef.current, deltaSec);
                if (next !== current) updatePositionRef.current(next);
            }

            // 乗車中は毎フレーム、現在位置にカメラを追従させる(キー入力の有無に関わらず、
            // mount 直後にも一度アバターへ視点を合わせたいため)。
            const scrollEl = scrollElRef.current;
            if (scrollEl) {
                const latest = getPositionRef.current();
                if (latest) {
                    const { scrollLeft, scrollTop } = computeCameraScroll(latest, worldSizeRef.current, {
                        width: scrollEl.clientWidth,
                        height: scrollEl.clientHeight,
                    });
                    scrollEl.scrollLeft = scrollLeft;
                    scrollEl.scrollTop = scrollTop;
                }
            }
        };
        rafId = requestAnimationFrame(tick);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            cancelAnimationFrame(rafId);
        };
    }, []);
}
