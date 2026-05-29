/** @jsxImportSource @ubichill/sdk */
/**
 * Gripable — Ubi.grip と JSX を繋ぐ宣言的ラッパー。
 *
 * プラグイン開発者は「自分が表示するもの」(中身) と「持てる」宣言 (grip) を
 * 渡すだけで、以下が SDK 側で自動になる:
 *  - クリックで acquire / release (grip.toggle)
 *  - hover カーソル形状 (grab / grabbing)
 *  - hover 時の outline / scale
 *  - 自分が持ってる時の opacity (= トレイ上で「持ち上げた」表現)
 *  - 他人が持ってる時の opacity + disabled
 *
 * ```tsx
 * const grip = Ubi.grip.exclusive({
 *     mode: 'toggle',
 *     hover: { outline: '2px solid currentColor', scale: 1.05 },
 *     held: { opacity: 0.4 },
 * });
 *
 * Ubi.ui.render(() => (
 *     <Gripable grip={grip}>
 *         <PenSvg color={pen.local.color} />
 *     </Gripable>
 * ), 'pen-button');
 * ```
 */

import type { VNode, VNodeChild } from '@ubichill/shared';
import type { Grip } from '../ubi/grip';

interface GripableProps {
    grip: Grip;
    children?: VNodeChild | VNodeChild[];
    /** wrapper の追加 style (位置・サイズ等)。grip 由来のスタイルとマージされる */
    style?: Record<string, string | number | undefined>;
}

export function Gripable({ grip, children, style }: GripableProps): VNode {
    const opts = grip.options;
    const isMine = grip.isMine;
    const isBlocked = grip.isHeldByOther;

    const hoverOpacity = isBlocked ? (opts.blockedByOther?.opacity ?? 0.35) : isMine ? (opts.held?.opacity ?? 0.5) : 1;
    const cursor = isBlocked
        ? 'not-allowed'
        : isMine
          ? (opts.hover?.heldCursor ?? 'grabbing')
          : (opts.hover?.cursor ?? 'grab');

    return (
        <button
            type="button"
            disabled={isBlocked}
            onUbiClick={() => grip.toggle()}
            style={{
                ...style,
                cursor,
                opacity: hoverOpacity,
                background: 'transparent',
                border: opts.hover?.outline ?? 'none',
                padding: 0,
                pointerEvents: 'auto',
                transition: 'opacity 0.12s ease, transform 0.12s ease, outline-color 0.12s ease',
                // hover.scale は CSS :hover に流したいが現状 inline style では作れない。
                // SDK レベルで CSS class を吐ける仕組みになるまでは scale はノーオペ。
            }}
        >
            {children}
        </button>
    );
}
