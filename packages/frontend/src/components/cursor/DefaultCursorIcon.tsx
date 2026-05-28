/**
 * カーソル画像のデフォルト SVG (古典的な矢印形状)。
 *
 * `user.cursorUrl` が未設定でも常に何かは表示するためのフォールバック。
 * `(0, 0)` が hotspot (先端) になるよう設計してある。
 */

export function DefaultCursorIcon({ size = 24, color = '#fff' }: { size?: number; color?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
            <path
                d="M3 3 L3 19 L7.5 14.5 L10.5 21 L13 19.8 L10 13.5 L17 13 Z"
                fill={color}
                stroke="rgba(0,0,0,0.85)"
                strokeWidth="1.4"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
}
