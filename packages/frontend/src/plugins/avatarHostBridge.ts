/**
 * avatarHostBridge — avatar:settings Worker から届くカスタムメッセージのホスト側ハンドラ。
 *
 * Worker は画像 URL を送るだけで、デコード（loadImage）はホスト側でのみ可能。
 * このモジュールが `WorkerPluginDefinition.onHostMessage` を埋めることで
 * InstanceRenderer / WorkerPluginHost は avatar を一切知らなくなる。
 *
 * ## フレームの扱い
 * アニメーションフレームはサーバー経由で送信しない（Socket.IO 上限に抵触するため）。
 * サーバーには url（最初のフレーム PNG）+ hotspot + sourceUrl（元ファイル URL）のみ送信する。
 * cursor worker が自分のホスト（avatarCursorHostBridge）に sourceUrl を渡してフレームを取得する。
 */

import type { WorkerPluginDefinition } from '@ubichill/sdk/react';
import { loadImage } from '@/lib/imageLoader';

export function attachAvatarHostBridge(def: WorkerPluginDefinition): WorkerPluginDefinition {
    if (def.id !== 'avatar:settings') return def;
    return {
        ...def,
        onHostMessage: (type, payload, { updateUser, sendToWorker }) => {
            if (type === 'avatar:applyTemplate') {
                const { files } = payload as { files: Array<{ state: string; url: string }> };
                void Promise.all(files.map(async ({ state, url }) => [state, url, await loadImage(url)] as const))
                    .then((entries) => {
                        const states = Object.fromEntries(
                            entries.map(([state, sourceUrl, frame]) => [
                                state,
                                // フレームは送信しない。sourceUrl で cursor worker が後からフレームを取得できる。
                                { url: frame.url, hotspot: frame.hotspot, sourceUrl },
                            ]),
                        );
                        updateUser({ avatar: { states } });
                    })
                    .catch((err: unknown) => {
                        console.error('[avatar] applyTemplate 画像読み込み失敗', err);
                    });
            } else if (type === 'avatar:resetTemplate') {
                updateUser({ avatar: { states: {} } });
            } else if (type === 'avatar:initThumbnails') {
                const { thumbnailFiles } = payload as { thumbnailFiles: Array<{ id: string; url: string }> };
                void Promise.all(
                    thumbnailFiles.map(async ({ id, url }) => {
                        try {
                            const frame = await loadImage(url);
                            return [id, frame.url] as const;
                        } catch (err) {
                            console.error(`[avatar] サムネイル読み込み失敗 id=${id}`, err);
                            return null;
                        }
                    }),
                )
                    .then((results) => {
                        const thumbnails = Object.fromEntries(results.filter((r) => r !== null));
                        sendToWorker('avatar:thumbnails', { thumbnails });
                    })
                    .catch((err: unknown) => {
                        console.error('[avatar] initThumbnails 処理中エラー', err);
                    });
            }
        },
    };
}
