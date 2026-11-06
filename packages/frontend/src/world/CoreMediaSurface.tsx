import { MediaDataSchema } from '@ubichill/core-components';
import { mediaSurfaces } from '@ubichill/react';
import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { surfacePlacement } from './surfacePlacement';
import { useConflictedMediaSurfaces } from './useConflictedMediaSurfaces';

/**
 * `core:media` の面。動画を描く場所だけを用意し、参照でこの Entity を指した mod の `<video>` を受け入れる。
 * 何も再生していない間は空（mod が `Ubi.media.setVisible` で見せるまで動画は出ない）。
 * 出力が 2 つ以上向いている・この Entity に core:media が 2 つ以上あるときは、面を登録せず誰の動画も描かない。
 */
export const CoreMediaSurface: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const ref = useRef<HTMLDivElement>(null);
    const parsed = MediaDataSchema.safeParse(entity.data ?? {});
    const fit = parsed.success ? parsed.data.fit : 'contain';
    const entityId = entity.entityId ?? entity.id;
    const conflicted = useConflictedMediaSurfaces().has(entityId);

    useEffect(() => {
        const element = ref.current;
        if (!element || conflicted) return;
        return mediaSurfaces.register(entityId, { element, fit });
    }, [entityId, fit, conflicted]);

    return (
        <div
            ref={ref}
            data-media-surface={entityId}
            data-media-conflict={conflicted ? 'true' : undefined}
            style={surfacePlacement(entity)}
        />
    );
};
