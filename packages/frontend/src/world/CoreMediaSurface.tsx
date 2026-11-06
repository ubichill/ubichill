import { MediaDataSchema } from '@ubichill/core-components';
import { mediaSurfaces } from '@ubichill/react';
import { type ComponentInstance, resolveOverlayMode } from '@ubichill/shared';
import type React from 'react';
import { useEffect, useRef } from 'react';

/** Entity の置き場所（overlay の角を含む）。掴む・持つは無い（core:media はクライアントから動かせない）。 */
export function surfacePlacement(entity: Pick<ComponentInstance, 'transform' | 'overlay'>): React.CSSProperties {
    const { x, y, z, w, h, scale, rotation } = entity.transform;
    const overlayMode = resolveOverlayMode(entity.overlay);
    // fill は画面全体、角の指定はその角からの距離、無ければワールド座標
    if (overlayMode === 'fill') return { position: 'absolute', inset: 0, zIndex: z || undefined };
    return {
        position: 'absolute',
        ...(overlayMode?.endsWith('right') ? { right: x } : { left: x }),
        ...(overlayMode?.startsWith('bottom') ? { bottom: y } : { top: y }),
        zIndex: z || undefined,
        width: w > 0 ? w : undefined,
        height: h > 0 ? h : undefined,
        transform: `scale(${scale ?? 1}) rotate(${rotation ?? 0}deg)`,
        transformOrigin: '0 0',
        pointerEvents: 'none',
        overflow: 'hidden',
    };
}

/**
 * `core:media` の面。動画を描く場所だけを用意し、参照でこの Entity を指した mod の `<video>` を受け入れる。
 * 何も再生していない間は空（mod が `Ubi.media.setVisible` で見せるまで動画は出ない）。
 */
export const CoreMediaSurface: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const ref = useRef<HTMLDivElement>(null);
    const parsed = MediaDataSchema.safeParse(entity.data ?? {});
    const fit = parsed.success ? parsed.data.fit : 'contain';
    const entityId = entity.entityId ?? entity.id;

    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        return mediaSurfaces.register(entityId, { element, fit });
    }, [entityId, fit]);

    return <div ref={ref} data-media-surface={entityId} style={surfacePlacement(entity)} />;
};
