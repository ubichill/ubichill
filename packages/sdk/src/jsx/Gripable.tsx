/** @jsxImportSource @ubichill/sdk */
/**
 * Gripable — Ubi.grip と JSX を繋ぐ宣言的ラッパー。
 *
 * プラグイン開発者は「自分が表示するもの」(中身) と「持てる」宣言 (grip) を
 * 渡すだけで、以下が SDK 側で自動になる:
 *  - クリックで acquire / release (grip.toggle)
 *  - hover カーソル形状 (grab / grabbing)
 *  - hover 時の outline / scale (CSS :hover で本物のホバー)
 *  - 自分が持ってる時の opacity (= トレイ上で「持ち上げた」表現)
 *  - 他人が持ってる時の opacity + disabled
 *
 * **scale の仕組み**:
 *  Worker の JSX には React state が無いので `onMouseEnter/Leave` で hover を
 *  追えない。代わりに `data-ubi-gripable` 属性 + ホスト側グローバル CSS
 *  (`button[data-ubi-gripable]:hover { transform: scale(var(--ubi-gripable-scale)) }`)
 *  で OS / ブラウザに hover 検出を任せる。スケール値は CSS 変数で各インスタンスに渡す。
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

    const stateOpacity = isBlocked ? (opts.blockedByOther?.opacity ?? 0.35) : isMine ? (opts.held?.opacity ?? 0.5) : 1;
    const cursor = isBlocked
        ? 'not-allowed'
        : isMine
          ? (opts.hover?.heldCursor ?? 'grabbing')
          : (opts.hover?.cursor ?? 'grab');

    // hover.scale を CSS 変数で渡す (本物の :hover 検出はホスト側のグローバル CSS)。
    // 自分が掴んでいる or 他人が掴んでいる時は scale を無効化 (= 1) して
    // 「掴まれているもの」が更にデカくなる挙動を回避する。
    const hoverScaleValue = !isMine && !isBlocked ? (opts.hover?.scale ?? 1) : 1;

    // CSS variable は TS の CSSProperties が認識しないので Record で受ける。
    // undefined を含まないことを保証するため厳密型に cast する。
    const inlineStyle: Record<string, string | number> = {
        ...(style ? Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)) : {}),
        cursor,
        opacity: stateOpacity,
        background: 'transparent',
        border: opts.hover?.outline ?? 'none',
        padding: 0,
        pointerEvents: 'auto',
        transition: 'opacity 0.12s ease, transform 0.12s ease, outline-color 0.12s ease',
        '--ubi-gripable-scale': String(hoverScaleValue),
    } as Record<string, string | number>;

    return (
        <button
            type="button"
            data-ubi-gripable
            disabled={isBlocked}
            onUbiClick={() => grip.toggle()}
            style={inlineStyle}
        >
            {children}
        </button>
    );
}
