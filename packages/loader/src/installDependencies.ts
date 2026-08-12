/**
 * 依存解決＋ロック生成ロジック（Node 専用）。ワールド YAML から mod 完全性ロックを生成し、
 * 兄弟ファイル `<world>.lock.json` に書き出す（分離方針＝YAML には埋めない）。
 *
 * 直接実行の入口は持たない（純粋なライブラリ関数）。CLI としての実行は
 * `packages/sdk/cli`（`ubichill install` サブコマンド）に一本化されている。
 *
 * getLockEntry の transport（mod 毎に切り替わる、`createDependencyAwareLockEntryGetter` が振り分け）:
 *   - world YAML の `dependencies[].source` が `type: url` の mod        → その `url` から HTTP 取得
 *     （`ModLockEntry.baseUrl` に焼き込み、実行時 acquireMod がその mod だけ別ホストから読む）。
 *   - `dependencies[].source.version` が pin されている mod              → 最新ポインタを経由せず
 *     そのバージョンを直接取得する。
 *   - `--base-url` 指定時、上記以外の mod                                → その URL から HTTP 取得。
 *   - それ以外（既定 / `--mods-dir`）                                    → ローカルの mods ディレクトリ
 *     （`ubichill build` 出力）から fs 読取。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type ModLockEntry, ModLockEntrySchema, WorldDefinitionSchema } from '@ubichill/shared';
import yaml from 'yaml';
import {
    buildWorldLock,
    collectModIds,
    createDependencyAwareLockEntryGetter,
    createHttpLockEntryGetter,
    type LockEntryGetter,
} from './buildWorldLock.ts';

function argValue(argv: string[], name: string): string | undefined {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
}

/**
 * mods ディレクトリ（`ubichill build` 出力）から lock.json 断片を fs で読む getter。
 * `pinnedVersion` が無ければ `mod.json`（最新ポインタ）から version を引く。
 */
function createFsLockEntryGetter(modsDir: string): LockEntryGetter {
    return async (modId, pinnedVersion) => {
        let version = pinnedVersion;
        if (!version) {
            const indexPath = join(modsDir, modId, 'mod.json');
            if (!existsSync(indexPath)) return null;
            version = (JSON.parse(readFileSync(indexPath, 'utf-8')) as { version?: string }).version;
        }
        if (!version) return null;
        const lockPath = join(modsDir, modId, `v${version}`, 'lock.json');
        if (!existsSync(lockPath)) return null;
        const parsed = ModLockEntrySchema.safeParse(JSON.parse(readFileSync(lockPath, 'utf-8')));
        return parsed.success ? (parsed.data as ModLockEntry) : null;
    };
}

/**
 * `argv`（サブコマンド名を除いた残り引数）から依存を解決しロックを生成する。
 * 使い方: `<world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>]`。
 * `dependencies[].source.version` が pin されていればそのバージョンを固定して取得する。
 * `--mods-dir` 既定は `process.cwd()` 直下の `mods`（Host固有パスをライブラリ既定にしない。
 * このリポジトリでの実運用パス `packages/frontend/public/mods` は呼び出し側が明示指定する）。
 */
export async function runInstall(argv: string[]): Promise<void> {
    const worldPath = argv.find((a) => !a.startsWith('--'));
    if (!worldPath) {
        throw new Error('usage: ubichill install <world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>]');
    }

    const def = WorldDefinitionSchema.parse(yaml.parse(readFileSync(worldPath, 'utf-8')));
    const modIds = collectModIds(def.spec.initialEntities);

    const baseUrl = argValue(argv, 'base-url');
    const modsDir = argValue(argv, 'mods-dir')
        ? resolve(argValue(argv, 'mods-dir') as string)
        : join(process.cwd(), 'mods');
    const fallbackGetter = baseUrl ? createHttpLockEntryGetter(baseUrl) : createFsLockEntryGetter(modsDir);
    const getLockEntry = createDependencyAwareLockEntryGetter(def.spec.dependencies, fallbackGetter);

    const lock = await buildWorldLock(modIds, getLockEntry);

    const outPath = argValue(argv, 'out') ?? worldPath.replace(/\.ya?ml$/i, '.lock.json');
    writeFileSync(outPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf-8');

    const lockedIds = Object.keys(lock.mods);
    const missing = modIds.filter((id) => !lockedIds.includes(id));
    console.log(`🔒 ${outPath} (${lockedIds.length}/${modIds.length} mods)`);
    if (missing.length > 0) console.warn(`⚠️  lock 断片が見つからない mod: ${missing.join(', ')}（除外）`);
}
