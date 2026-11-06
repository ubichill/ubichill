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
    /**
     * この面に描いてよい唯一の出力（Component のインスタンス × 参照フィールド）。ワールド定義の配線から決める
     * （`findMediaConflicts` の owners）。ほかの出力が同じ面を指しても描かせない。
     */
    output: { componentInstanceId: string; field: string };
}

/** この面に、その Component のそのフィールドの `<video>` を付けてよいか。 */
export function canDrawOnSurface(
    surface: MediaSurface | undefined,
    componentInstanceId: string,
    field: string,
): surface is MediaSurface {
    return surface?.output.componentInstanceId === componentInstanceId && surface.output.field === field;
}

/**
 * 面の登録簿。テストでは個別に作る。
 * 同じ Entity に面が 2 つ以上あるあいだは、どちらも使わない（読み込みの順で決めると、ブラウザごとに結果が変わる）。
 * 1 つに戻れば、残った面を使う。
 */
export function createMediaSurfaceRegistry() {
    const surfaces = new Map<string, readonly MediaSurface[]>();
    const listeners = new Set<() => void>();
    const notify = (): void => {
        for (const listener of listeners) listener();
    };
    return {
        /** 面を登録し、外す関数を返す（2 回呼んでも 1 回だけ外す）。 */
        register(entityId: string, surface: MediaSurface): () => void {
            surfaces.set(entityId, [...(surfaces.get(entityId) ?? []), surface]);
            notify();
            return () => {
                const rest = (surfaces.get(entityId) ?? []).filter((s) => s !== surface);
                if (rest.length === surfaces.get(entityId)?.length) return;
                if (rest.length === 0) surfaces.delete(entityId);
                else surfaces.set(entityId, rest);
                notify();
            };
        },
        /** Entity の面。無い・2 つ以上あるときは undefined。 */
        get: (entityId: string): MediaSurface | undefined => {
            const list = surfaces.get(entityId);
            return list?.length === 1 ? list[0] : undefined;
        },
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
