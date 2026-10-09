/**
 * modLoader — frontend 側の薄いアダプタ。
 *
 * 取得・integrity・lock 照合の中核は @ubichill/loader（env非依存）に分離済み。
 * ここは Host 固有の 3 点だけ担う:
 *  - `VITE_MOD_CDN_URL` env から baseUrl を解決する。
 *  - 作者署名の確認をサーバーへ依頼し、開発用の Host かどうかを伝える。
 *  - 中立 `LoadedMod` を Host の `WorkerModDefinition`（React 型）にマップする。
 */
import { type AcquireResult, acquireMod, type LoadedMod } from '@ubichill/loader';
import type { WorkerModDefinition } from '@ubichill/react';
import type { ModLock } from '@ubichill/shared';
import { isUnsignedModAllowed, verifyModSignatureViaApi } from './modSignature';

/**
 * mod のベース URL。
 * VITE_MOD_CDN_URL があれば外部 CDN / GitHub Pages、無ければ自ホストの /mods。
 */
export const MOD_BASE_URL: string = (() => {
    const envUrl = import.meta.env.VITE_MOD_CDN_URL;
    if (envUrl) return envUrl.replace(/\/$/, '');
    return '/mods';
})();

/**
 * 開発用の Host か（`pnpm dev`、または開発用としてビルドしたプレビュー）。
 * 本番としてビルドした Host・`VITE_ENVIRONMENT` を指定せずにビルドした Host は、未署名の mod を動かさない。
 */
const DEV_HOST: boolean = import.meta.env.DEV || import.meta.env.VITE_ENVIRONMENT === 'development';

/** loader の {@link AcquireResult} と同形（Host 側でも分岐に使う）。 */
export type LoadResult = WorkerModDefinition | 'data-only' | 'not-found' | { rejected: string };

/** 中立 LoadedMod を Host の WorkerModDefinition にマップする。 */
function toWorkerModDefinition(m: LoadedMod): WorkerModDefinition {
    return {
        id: m.id,
        name: m.name,
        workerCode: m.workerCode,
        capabilities: m.capabilities,
        author: m.author,
        singleton: m.singleton,
        canvasTargets: m.canvasTargets,
        watchEntityTypes: m.watchEntityTypes,
        watchScope: m.watchScope,
        thumbnail: m.thumbnail,
        mediaTargets: m.mediaTargets,
        modBase: m.modBase,
        assetIntegrity: m.assetIntegrity,
        dataFields: m.dataFields,
        overlay: m.overlay,
    };
}

export interface LoadModOptions {
    /** ワールドの lock。固定されていない mod は、置き場所に関係なく実行しない。 */
    lock?: ModLock;
}

/** Component 型から検証済み WorkerModDefinition を構築する（loader へ委譲）。 */
export async function loadVerifiedMod(entityType: string, opts: LoadModOptions): Promise<LoadResult> {
    const result: AcquireResult = await acquireMod(entityType, {
        baseUrl: MOD_BASE_URL,
        lock: opts.lock,
        verifySignature: verifyModSignatureViaApi,
        allowUnsigned: (baseUrl) =>
            isUnsignedModAllowed({ devHost: DEV_HOST, baseUrl, origin: window.location.origin }),
    });
    if (typeof result === 'object' && 'workerCode' in result) return toWorkerModDefinition(result);
    return result;
}
