import { MediaDataSchema } from '@ubichill/core-components';
import { mediaSurfaces } from '@ubichill/react';
import { type ComponentInstance, conflictedMediaSurfaces } from '@ubichill/shared';
import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { surfacePlacement } from './surfacePlacement';
import { useMediaSurfaceOwners } from './useMediaSurfaceOwners';

/**
 * `core:media` の面。動画を描く場所だけを用意し、ワールド定義の配線でこの Entity を指した出力の `<video>` だけを受け入れる。
 * 何も再生していない間は空（mod が `Ubi.media.setVisible` で見せるまで動画は出ない）。
 * 出力が 2 つ以上向いている・この Entity に core:media が 2 つ以上ある・向いている出力が無いときは、面を登録せず誰の動画も描かない。
 */
export const CoreMediaSurface: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const ref = useRef<HTMLDivElement>(null);
    const parsed = MediaDataSchema.safeParse(entity.data ?? {});
    const fit = parsed.success ? parsed.data.fit : 'contain';
    const entityId = entity.entityId ?? entity.id;
    const media = useMediaSurfaceOwners();
    const conflicted = useMemo(() => conflictedMediaSurfaces(media).has(entityId), [media, entityId]);
    const owner = media.owners.get(entityId);
    const ownerKey = owner?.key;
    const ownerField = owner?.field;

    useEffect(() => {
        const element = ref.current;
        if (!element || !ownerKey || !ownerField) return;
        return mediaSurfaces.register(entityId, {
            element,
            fit,
            output: { componentInstanceId: ownerKey, field: ownerField },
        });
    }, [entityId, fit, ownerKey, ownerField]);

    return (
        <div
            ref={ref}
            data-media-surface={entityId}
            data-media-conflict={conflicted ? 'true' : undefined}
            style={surfacePlacement(entity)}
        />
    );
};
