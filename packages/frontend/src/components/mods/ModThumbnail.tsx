import type { PreviewImageSource } from '@/lib/mods/previewImage';
import { css, cx } from '@/styled-system/css';
import { PreviewImage } from './PreviewImage';

const thumbBox = css({
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: '4px',
    bg: 'surface',
    color: 'textSubtle',
});
const sizes = {
    32: css({ width: '32px', height: '32px' }),
    40: css({ width: '40px', height: '40px' }),
    64: css({ width: '64px', height: '64px' }),
} as const;

/** mod のサムネイル（useModPreview で hash を確かめた画像）。無ければ印を出す。 */
export function ModThumbnail({
    image,
    size = 32,
}: {
    image: PreviewImageSource | undefined;
    size?: keyof typeof sizes;
}) {
    return (
        <span className={cx(thumbBox, sizes[size])}>
            <PreviewImage source={image} alt="" fallback={<ModGlyph />} />
        </span>
    );
}

function ModGlyph() {
    return (
        <svg
            width="60%"
            height="60%"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
        >
            <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
            <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
    );
}
