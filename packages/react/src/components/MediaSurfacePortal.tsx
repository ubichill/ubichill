import { useEffect } from 'react';
import { useMediaSurface } from '../media/mediaSurfaces';

interface MediaSurfacePortalProps {
    /** 参照フィールドの名前。mod はこれを `Ubi.media.*` の targetId に使う。 */
    targetId: string;
    /** 参照先の Entity（`core:media` を持つ）。未設定なら何も描かない。 */
    entityId: string | undefined;
    /** メディアの runtime の ref（targetId ごとに同じ関数）。 */
    videoRef: (el: HTMLVideoElement | null) => void;
}

/**
 * 参照で指した `core:media` の面に、この mod の `<video>` を付ける。面がまだ無ければ付けない
 * （メディアの runtime は `<video>` が付くまで指示を保留する）。面が作り直されたら付け直す。
 */
export function MediaSurfacePortal({ targetId, entityId, videoRef }: MediaSurfacePortalProps) {
    const surface = useMediaSurface(entityId);
    useEffect(() => {
        if (!surface) return;
        const video = document.createElement('video');
        video.dataset.mediaTarget = targetId;
        video.preload = 'auto';
        video.playsInline = true;
        Object.assign(video.style, {
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            objectFit: surface.fit,
            backgroundColor: '#000',
            display: 'none',
            pointerEvents: 'none',
        });
        surface.element.appendChild(video);
        videoRef(video);
        return () => {
            videoRef(null);
            video.remove();
        };
    }, [surface, targetId, videoRef]);
    return null;
}
