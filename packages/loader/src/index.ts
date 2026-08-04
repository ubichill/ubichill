/**
 * @ubichill/loader — mod の取得・完全性検証・ロック構築。
 *
 * browser+Node 両対応・React/DOM 非依存。frontend（取得+検証）と CLI（ロック生成）が共有する。
 * 知識（スキーマ / resolveLockedMod）は @ubichill/shared、隔離実行は @ubichill/sandbox。
 */
export { type AcquireModOptions, acquireMod, resetAcquireCaches } from './acquireMod.ts';
export { buildWorldLock, collectModIds, createHttpLockEntryGetter, type LockEntryGetter } from './buildWorldLock.ts';
export { sriOf } from './integrity.ts';
export type { AcquireResult, FetchLike, FetchLikeResponse, LoadedMod } from './types.ts';
