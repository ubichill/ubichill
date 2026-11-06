import type { ReactNode } from 'react';
import { css } from '@/styled-system/css';

const frame = css({
    position: 'relative',
    flexShrink: 0,
    width: { base: '96px', md: '120px' },
    height: { base: '96px', md: '120px' },
    borderRadius: 'full',
    border: '4px solid',
    borderColor: 'surface',
    bg: 'primary',
    color: 'textOnPrimary',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: { base: '3xl', md: '4xl' },
    fontWeight: '700',
    boxShadow: 'card',
});
const image = css({ width: 'full', height: 'full', objectFit: 'cover', borderRadius: 'full', display: 'block' });

/** 丸いアイコン（バナーの下端に重ねる）。無ければ表示名の頭文字。`children` は編集の操作を重ねる。 */
export function ProfileAvatar({ src, name, children }: { src: string | null; name: string; children?: ReactNode }) {
    return (
        <div className={frame}>
            {src ? (
                <img src={src} alt={name} className={image} />
            ) : (
                <span aria-hidden>{Array.from(name)[0] ?? '?'}</span>
            )}
            {children}
        </div>
    );
}
