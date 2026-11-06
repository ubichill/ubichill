import { useEffect } from 'react';
import { canDrawOnSurface, useMediaSurface } from '../media/mediaSurfaces';

interface MediaSurfacePortalProps {
    /** この mod の Component のインスタンス。面が決めた出力と照らす。 */
    componentInstanceId: string;
    /** 参照フィールドの名前。mod はこれを `Ubi.media.*` の targetId に使う。 */
    targetId: string;
    /** 参照先の Entity（`core:media` を持つ）。未設定なら何も描かない。 */
    entityId: string | undefined;
    /** メディアの runtime の ref（targetId ごとに同じ関数）。 */
    videoRef: (el: HTMLVideoElement | null) => void;
}

/**
 * 参照で指した `core:media` の面に、この mod の `<video>` を付ける。面がまだ無い・面がこの出力を選んでいない
 * （部屋の中で作られた Component・競合）ときは付けない（メディアの runtime は `<video>` が付くまで指示を保留する）。
 * 面が作り直されたら付け直す。
 */
export function MediaSurfacePortal({ componentInstanceId, targetId, entityId, videoRef }: MediaSurfacePortalProps) {
    const found = useMediaSurface(entityId);
    const surface = canDrawOnSurface(found, componentInstanceId, targetId) ? found : undefined;
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
