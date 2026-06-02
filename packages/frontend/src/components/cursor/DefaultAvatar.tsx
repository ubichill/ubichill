/**
 * テンプレート未選択時のデフォルトアバター SVG (人型シルエット)。
 * 32 × 32 viewport で、好きな色に染められる (fill="currentColor")。
 */
export function DefaultAvatar({ size = 24, color = '#5b8def' }: { size?: number; color?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', color }}>
            {/* 影 */}
            <ellipse cx="16" cy="28" rx="8" ry="1.5" fill="rgba(0,0,0,0.18)" />
            {/* 体 */}
            <path d="M16 14a9 9 0 0 0-9 9v2h18v-2a9 9 0 0 0-9-9z" fill="currentColor" />
            {/* 頭 */}
            <circle cx="16" cy="9" r="5" fill="currentColor" />
            {/* 顔のハイライト */}
            <circle cx="14" cy="8" r="1.5" fill="rgba(255,255,255,0.45)" />
        </svg>
    );
}
