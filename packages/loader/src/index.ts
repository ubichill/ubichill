/**
 * @ubichill/loader — mod の取得・完全性検証・ロック構築。
 *
 * browser+Node 両対応・React/DOM 非依存。frontend（取得+検証）と CLI（ロック生成）が共有する。
 * 知識（スキーマ / resolveLockedMod）は @ubichill/shared、隔離実行は @ubichill/sandbox。
 */
export { type AcquireModOptions, acquireMod, resetAcquireCaches } from './acquireMod.ts';
export {
    buildWorldLock,
    collectModIds,
    createDependencyAwareLockEntryGetter,
    createHttpLockEntryGetter,
    type LockEntryGetter,
    resolveLatestVersion,
} from './buildWorldLock.ts';
export { sriOf } from './integrity.ts';
export type { AcquireResult, FetchLike, FetchLikeResponse, LoadedMod } from './types.ts';

// `runInstall`/`runUpdate`（Node専用: fs/path依存）はメインバーレルからは export しない
// （frontend が @ubichill/loader を import した際に node:fs がバンドルへ混入し、ブラウザで
// クラッシュするため。CLI からは `@ubichill/loader/install-dependencies` /
// `@ubichill/loader/update-dependencies` のサブパスで直接 import する）。
