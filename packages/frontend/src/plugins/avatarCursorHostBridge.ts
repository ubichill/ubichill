/**
 * avatarCursorHostBridge — avatar:cursor Worker から届くフレーム要求のホスト側ハンドラ。
 *
 * cursor Worker はアニメーションフレームを直接持たない。
 * 代わりに avatar:settings ホストが loadImage() でキャッシュ済みのフレームを
 * getCachedImage() 経由で取得し、Worker へ返す。
 * キャッシュ未存在の場合は loadImage() で新規取得する。
 */

import type { WorkerPluginDefinition } from '@ubichill/sdk/react';
import { getCachedImage, loadImage } from '@/lib/imageLoader';

export function attachAvatarCursorHostBridge(def: WorkerPluginDefinition): WorkerPluginDefinition {
    if (def.id !== 'avatar:cursor') return def;
    return {
        ...def,
        onHostMessage: (type, payload, { sendToWorker }) => {
            if (type === 'avatar:requestFrames') {
                const { sourceUrls } = payload as { sourceUrls: Array<{ state: string; sourceUrl: string }> };
                void Promise.all(
                    sourceUrls.map(async ({ state, sourceUrl }) => {
                        const decoded = await (getCachedImage(sourceUrl) ?? loadImage(sourceUrl));
                        return [state, decoded.frames] as const;
                    }),
                )
                    .then((entries) => {
                        const framesMap = Object.fromEntries(entries.filter(([, frames]) => frames.length > 0));
                        sendToWorker('avatar:localFrames', { framesMap });
                    })
                    .catch((err: unknown) => {
                        console.error('[avatar:cursor] フレーム読み込みエラー', err);
                    });
            }
        },
    };
}
