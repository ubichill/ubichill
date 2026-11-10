/**
 * modLoader — Host 側の薄いアダプタ。
 *
 * 取得・integrity・lock 照合の中核は @ubichill/loader（env非依存）に分離済み。
 * ここは Host 固有の 2 点だけ担う:
 *  - 作者署名をブラウザで確かめる verifier を渡し、開発用の Host かどうかを伝える。
 *  - 中立 `LoadedMod` を Host の `WorkerModDefinition`（React 型）にマップする。
 */
import { type AcquireResult, acquireMod, type LoadedMod } from '@ubichill/loader';
import type { WorkerModDefinition } from '@ubichill/react';
import type { ModLock } from '@ubichill/shared';
import { blockedAuthorRejection } from './modRejection';
import { browserSignatureVerifier, isUnsignedModAllowed } from './modSignature';
import type { ModSource } from './modSource';

/** loader の {@link AcquireResult} と同形（Host 側でも分岐に使う）。 */
export type LoadResult = WorkerModDefinition | 'data-only' | 'undeclared' | 'not-found' | { rejected: string };

/** 中立 LoadedMod を Host の WorkerModDefinition にマップする。 */
function toWorkerModDefinition(m: LoadedMod): WorkerModDefinition {
    return {
        id: m.id,
        name: m.name,
        workerCode: m.workerCode,
        capabilities: m.capabilities,
        author: m.author,
        authorProof: m.authorProof,
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
    source: ModSource;
    /** ブロックした人の作者アカウント（突き合わせる形）。作者がここにある mod は実行しない */
    blockedAuthors?: ReadonlySet<string>;
}

/** Component 型から検証済み WorkerModDefinition を構築する（loader へ委譲）。 */
export async function loadVerifiedMod(entityType: string, opts: LoadModOptions): Promise<LoadResult> {
    const result: AcquireResult = await acquireMod(entityType, {
        baseUrl: opts.source.baseUrl,
        lock: opts.lock,
        verifySignature: browserSignatureVerifier(opts.source.devHost),
        allowUnsigned: (baseUrl) =>
            isUnsignedModAllowed({ devHost: opts.source.devHost, baseUrl, origin: window.location.origin }),
    });
    if (typeof result === 'object' && 'workerCode' in result) {
        return blockedAuthorRejection(result.author, opts.blockedAuthors ?? new Set()) ?? toWorkerModDefinition(result);
    }
    return result;
}
