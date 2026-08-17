/**
 * buildWorldLock — ワールドが参照する mod の完全性ロックを組み立てる（env非依存）。
 *
 * 各 mod がビルド時に出力した `v<ver>/lock.json`（ModLockEntry）を集めて {@link ModLock} を作る。
 * 取得の transport（HTTP / fs）は `getLockEntry` 注入で分離する。frontend は HTTP、CLI は fs。
 */
import { type Dependency, type ModLock, type ModLockEntry, ModLockEntrySchema } from '@ubichill/shared';
import type { FetchLike } from './types.ts';

// modId 収集ロジックは shared に一本化（backend collectMods と共有）。利便のため再エクスポート。
export { collectModIds } from '@ubichill/shared';

/**
 * modId → その mod の lock.json 断片（ModLockEntry）。取得不能なら null。
 * `pinnedVersion` を渡すと最新ポインタ（mod.json）を経由せずそのバージョンを直接取得する。
 */
export type LockEntryGetter = (modId: string, pinnedVersion?: string) => Promise<ModLockEntry | null>;

/**
 * modId 群から mod 完全性ロックを構築する。取得できなかった mod は除外する
 * （＝外部公開時、そのワールドを読む側で lock-missing 拒否になる）。
 */
export async function buildWorldLock(modIds: string[], getLockEntry: LockEntryGetter): Promise<ModLock> {
    const entries = await Promise.all(modIds.map(async (id) => [id, await getLockEntry(id)] as const));
    const mods = Object.fromEntries(entries.filter((e): e is [string, ModLockEntry] => e[1] !== null));
    return { lockVersion: 1, mods };
}

/**
 * HTTP 経由の {@link LockEntryGetter}。`pinnedVersion` が無ければ `<baseUrl>/<mod>/mod.json` で
 * 最新 version を引き、`<baseUrl>/<mod>/v<ver>/lock.json` を取得・検証する。frontend/CLI(--base-url) 用。
 */
export function createHttpLockEntryGetter(baseUrl: string, fetchImpl?: FetchLike): LockEntryGetter {
    const f: FetchLike =
        fetchImpl ?? ((input, init) => fetch(input, init as RequestInit) as unknown as ReturnType<FetchLike>);
    return async (modId, pinnedVersion) => {
        try {
            const version = pinnedVersion ?? (await resolveLatestVersion(baseUrl, modId, f));
            if (!version) return null;
            const res = await f(`${baseUrl}/${modId}/v${version}/lock.json`, { cache: 'no-store' });
            if (!res.ok) return null;
            const parsed = ModLockEntrySchema.safeParse(await res.json());
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    };
}

/** `<baseUrl>/<mod>/mod.json`（最新ポインタ）から現行最新 version を引く。取得不能なら null。 */
export async function resolveLatestVersion(
    baseUrl: string,
    modId: string,
    fetchImpl?: FetchLike,
): Promise<string | null> {
    const f: FetchLike =
        fetchImpl ?? ((input, init) => fetch(input, init as RequestInit) as unknown as ReturnType<FetchLike>);
    try {
        const res = await f(`${baseUrl}/${modId}/mod.json`, { cache: 'no-store' });
        if (!res.ok) return null;
        const { version } = (await res.json()) as { version?: string };
        return version ?? null;
    } catch {
        return null;
    }
}

/**
 * world の `dependencies[].source` を尊重する {@link LockEntryGetter} ラッパー。
 *  - `source.url` がある mod はその URL から個別に取得し `baseUrl` を焼き込む。
 *  - `source.version` が具体的な値（'latest' 以外）で pin されていればそのバージョンを直接取得する
 *    （最新ポインタを経由しない）。'latest'（省略時の既定）は pin なしとして扱う。
 *  - それ以外は `fallbackGetter`（既定の transport）にそのまま委譲する。
 *
 * CLI(`installDependencies.ts`) と frontend(`buildWorldLock.ts`) の重複していたロジックを一本化。
 */
export function createDependencyAwareLockEntryGetter(
    dependencies: Dependency[] | undefined,
    fallbackGetter: LockEntryGetter,
    fetchImpl?: FetchLike,
): LockEntryGetter {
    const byModId = new Map((dependencies ?? []).map((d) => [d.name, d.source]));
    return async (modId, pinnedVersionOverride) => {
        const source = byModId.get(modId);
        const pinnedVersion =
            pinnedVersionOverride ?? (source && source.version !== 'latest' ? source.version : undefined);
        if (source?.url) {
            const entry = await createHttpLockEntryGetter(source.url, fetchImpl)(modId, pinnedVersion);
            return entry ? { ...entry, baseUrl: source.url } : null;
        }
        return fallbackGetter(modId, pinnedVersion);
    };
}
