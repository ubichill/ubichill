import type { ReactNode } from 'react';
import { css } from '@/styled-system/css';

const frame = css({
    position: 'relative',
    width: 'full',
    aspectRatio: '3 / 1',
    overflow: 'hidden',
    bg: 'secondary',
});
const image = css({ width: 'full', height: 'full', objectFit: 'cover', display: 'block' });

/** バナー（3:1。サーバーが切り抜くのと同じ比）。無ければ地の色。`children` は編集の操作を重ねる。 */
export function ProfileBanner({ src, children }: { src: string | null; children?: ReactNode }) {
    return (
        <div className={frame}>
            {src && <img src={src} alt="" className={image} />}
            {children}
        </div>
    );
}
