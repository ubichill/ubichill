import { useMemo } from 'react';
import { qrCodePath } from '@/lib/account/qrCode';
import { css } from '@/styled-system/css';

/** QR コード（読み取りやすいよう、白地に濃い色で描く）。 */
export function QrCode({ text, label }: { text: string; label: string }) {
    const { size, path } = useMemo(() => qrCodePath(text), [text]);
    return (
        <svg
            className={frame}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={label}
            shapeRendering="crispEdges"
        >
            <title>{label}</title>
            <path d={path} className={css({ fill: 'primary' })} />
        </svg>
    );
}

const frame = css({
    w: '200px',
    h: '200px',
    bg: 'white',
    borderRadius: '8px',
    border: '1px solid',
    borderColor: 'border',
    alignSelf: 'center',
});
