import { ImageDataSchema } from '@ubichill/core-components';
import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { css, cva } from '@/styled-system/css';
import { surfacePlacement } from './surfacePlacement';

/** `core:image` の面。ワールド作者が置いた画像を描く。画像がまだ無ければ枠だけ出す（置き忘れに気づけるように）。 */
export const CoreImageSurface: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const parsed = ImageDataSchema.safeParse(entity.data ?? {});
    const entityId = entity.entityId ?? entity.id;
    const data = parsed.success ? parsed.data : null;
    return (
        <div data-image-surface={entityId} style={surfacePlacement(entity)}>
            {data && data.src !== '' ? (
                <img
                    src={data.src}
                    alt={data.alt}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className={image({ fit: data.fit })}
                />
            ) : (
                <div className={placeholder}>画像</div>
            )}
        </div>
    );
};

const image = cva({
    base: { display: 'block', w: 'full', h: 'full', userSelect: 'none' },
    variants: {
        fit: { contain: { objectFit: 'contain' }, cover: { objectFit: 'cover' }, fill: { objectFit: 'fill' } },
    },
});

const placeholder = css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: 'full',
    h: 'full',
    minW: '80px',
    minH: '60px',
    border: '2px dashed',
    borderColor: 'borderStrong',
    borderRadius: '8px',
    color: 'textMuted',
    fontSize: '14px',
});
