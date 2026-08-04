/**
 * buildWorldLock — ワールドが参照する mod の完全性ロックを組み立てる（env非依存）。
 *
 * 各 mod がビルド時に出力した `v<ver>/lock.json`（ModLockEntry）を集めて {@link ModLock} を作る。
 * 取得の transport（HTTP / fs）は `getLockEntry` 注入で分離する。frontend は HTTP、CLI は fs。
 */
import { type ModLock, type ModLockEntry, ModLockEntrySchema } from '@ubichill/shared';
import type { FetchLike } from './types.ts';

// modId 収集ロジックは shared に一本化（backend collectMods と共有）。利便のため再エクスポート。
export { collectModIds } from '@ubichill/shared';

/** modId → その mod の lock.json 断片（ModLockEntry）。取得不能なら null。 */
export type LockEntryGetter = (modId: string) => Promise<ModLockEntry | null>;

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
 * HTTP 経由の {@link LockEntryGetter}。`<baseUrl>/<mod>/mod.json` で version を引き、
 * `<baseUrl>/<mod>/v<ver>/lock.json` を取得・検証する。frontend/CLI(--base-url) 用。
 */
export function createHttpLockEntryGetter(baseUrl: string, fetchImpl?: FetchLike): LockEntryGetter {
    const f: FetchLike =
        fetchImpl ?? ((input, init) => fetch(input, init as RequestInit) as unknown as ReturnType<FetchLike>);
    return async (modId) => {
        try {
            const index = await f(`${baseUrl}/${modId}/mod.json`, { cache: 'no-store' });
            if (!index.ok) return null;
            const { version } = (await index.json()) as { version?: string };
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
