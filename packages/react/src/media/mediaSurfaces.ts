/**
 * `core:media` の描画面の登録簿（entityId → 面）。
 *
 * `core:media` は動画を描く場所だけを持つ組み込み Component（Unity の MeshRenderer に当たる）。
 * 再生の制御（URL の許可・同期・状態）は、参照フィールドでこの Entity を指した mod の Host が持ち、
 * その `<video>` をここに登録された要素へ portal で描く。
 */
import { useSyncExternalStore } from 'react';

export interface MediaSurface {
    element: HTMLElement;
    fit: 'contain' | 'cover';
}

/** 面の登録簿。テストでは個別に作る。 */
export function createMediaSurfaceRegistry() {
    const surfaces = new Map<string, MediaSurface>();
    const listeners = new Set<() => void>();
    const notify = (): void => {
        for (const listener of listeners) listener();
    };
    return {
        /**
         * 面を登録し、外す関数を返す。同じ Entity に 2 つ目の面が来ても先の面を残す
         * （1 つの Entity に core:media を 2 つ付けても動画は 1 か所に描く）。
         */
        register(entityId: string, surface: MediaSurface): () => void {
            if (surfaces.has(entityId)) return () => {};
            surfaces.set(entityId, surface);
            notify();
            return () => {
                if (surfaces.get(entityId) !== surface) return;
                surfaces.delete(entityId);
                notify();
            };
        },
        get: (entityId: string): MediaSurface | undefined => surfaces.get(entityId),
        subscribe(listener: () => void): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

export type MediaSurfaceRegistry = ReturnType<typeof createMediaSurfaceRegistry>;

export const mediaSurfaces: MediaSurfaceRegistry = createMediaSurfaceRegistry();

/** Entity の面。まだ描かれていなければ undefined（描かれたら再描画する）。 */
export function useMediaSurface(entityId: string | undefined): MediaSurface | undefined {
    return useSyncExternalStore(mediaSurfaces.subscribe, () =>
        entityId === undefined ? undefined : mediaSurfaces.get(entityId),
    );
}
