/**
 * buildWorldLock — ワールド保存時に mod 完全性ロックを組み立てる。
 *
 * 各 mod がビルド時に出力した `v<ver>/lock.json`（ModLockEntry）を取得し、
 * ワールドが参照する mod だけを集めて {@link ModLock} を作る。これを spec.lock に
 * 焼き込むことで、以降このワールドを読むクライアントは lock と hash 照合できる。
 *
 * 「誰が lock を書いたか」は信頼不要 — 安全性はロード時照合（modLoader）が担保する。
 * ここは保存時に「今の bytes を固定する」だけの取得層。
 */
import type { InitialEntity, ModLock, ModLockEntry, WorldDefinition } from '@ubichill/shared';
import { ModLockEntrySchema } from '@ubichill/shared';
import { MOD_BASE_URL } from './modLoader';

/** initialEntities ツリーを辿り、使用 mod の modId を重複なく集める純関数。 */
function collectModIds(entities: InitialEntity[]): string[] {
    const ids = new Set<string>();
    const walk = (e: InitialEntity): void => {
        for (const c of e.components) {
            const modId = c.type.split(':')[0];
            if (modId) ids.add(modId);
        }
        for (const child of e.children ?? []) walk(child);
    };
    for (const e of entities) walk(e);
    return [...ids];
}

/** 1 mod の lock.json（ModLockEntry）を取得・検証する。取得不能なら null。 */
async function fetchModLockEntry(modId: string): Promise<ModLockEntry | null> {
    try {
        const index = await fetch(`${MOD_BASE_URL}/${modId}/mod.json`, { cache: 'no-store' });
        if (!index.ok) return null;
        const { version } = (await index.json()) as { version?: string };
        if (!version) return null;

        const res = await fetch(`${MOD_BASE_URL}/${modId}/v${version}/lock.json`, { cache: 'no-store' });
        if (!res.ok) return null;
        const parsed = ModLockEntrySchema.safeParse(await res.json());
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/**
 * ワールド定義から mod 完全性ロックを構築する。
 * 取得できなかった mod は lock から除外する（＝外部公開時、そのワールドを読む側で
 * lock-missing 拒否になる。UI 側で欠落 mod を警告するのが望ましい）。
 */
export async function buildWorldLock(definition: WorldDefinition): Promise<ModLock> {
    const modIds = collectModIds(definition.spec.initialEntities);
    const entries = await Promise.all(modIds.map(async (id) => [id, await fetchModLockEntry(id)] as const));
    const mods = Object.fromEntries(entries.filter((e): e is [string, ModLockEntry] => e[1] !== null));
    return { lockVersion: 1, mods };
}
