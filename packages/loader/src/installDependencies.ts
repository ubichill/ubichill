/**
 * 依存解決＋ロック生成ロジック（Node 専用）。ワールド YAML から mod 完全性ロックを生成し、
 * 兄弟ファイル `<world>.lock.json` に書き出す（分離方針＝YAML には埋めない）。
 *
 * 直接実行の入口は持たない（純粋なライブラリ関数）。CLI としての実行は
 * `packages/sdk/cli`（`ubichill install` サブコマンド）に一本化されている。
 *
 * getLockEntry の transport（mod 毎に切り替わる、`createDependencyAwareLockEntryGetter` が振り分け）:
 *   - world YAML の `dependencies[].source` に `url` がある mod → その `url` から HTTP 取得
 *     （`ModLockEntry.baseUrl` に焼き込み、実行時 acquireMod がその mod だけ別ホストから読む）。
 *   - `dependencies[].source.version` が pin されている mod              → 最新ポインタを経由せず
 *     そのバージョンを直接取得する。
 *   - `--base-url` 指定時、上記以外の mod                                → その URL から HTTP 取得。
 *   - それ以外（既定 / `--mods-dir`）                                    → ローカルの mods ディレクトリ
 *     （`ubichill build` 出力）から fs 読取。
 *
 * 外部配布する world は dependency ごとに `source.url` を書くのが標準。これにより
 * `ubichill install world.yaml` だけで、別レジストリの mod を混在させた portable な lock を作れる。
 * `--base-url` / `--mods-dir` は URL 未指定 dependency の fallback（単一レジストリやHostモノレポ用）。
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
 * 使い方: `<world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>] [--check]`。
 * `dependencies[].source.version` が pin されていればそのバージョンを固定して取得する。
 * `--mods-dir` 既定は `process.cwd()` 直下の `mods`。ただし外部 world の標準フローでは
 * `dependencies[].source.url` が優先されるため、この暗黙値は参照されない。
 *
 * `--check`: ファイルを書き換えず、現在の mod ビルドから再計算したロックと既存ファイルを
 * 比較するだけ（CI 用の drift 検出）。不一致 or ファイル不在なら `process.exitCode = 1` にして返す
 * （throw すると CLI 側の `❌` プレフィックス付きスタックトレースになり、CI ログとしては
 * ノイズになるため、意図した「検証失敗」はここで exitCode だけ立てて素直に終える）。
 */
export async function runInstall(argv: string[]): Promise<void> {
    const worldPath = argv.find((a) => !a.startsWith('--'));
    if (!worldPath) {
        throw new Error(
            'usage: ubichill install <world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>] [--check]',
        );
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
    const nextJson = `${JSON.stringify(lock, null, 2)}\n`;
    const outPath = argValue(argv, 'out') ?? worldPath.replace(/\.ya?ml$/i, '.lock.json');

    const lockedIds = Object.keys(lock.mods);
    const missing = modIds.filter((id) => !lockedIds.includes(id));

    // 不完全な lock は外部 provenance で実行時拒否されるうえ、コミットされると原因が分かりにくい。
    // 成功扱いで部分 lock を書かず、dependency.source.url または明示 fallback を要求する。
    if (missing.length > 0) {
        const fallbackHint = baseUrl
            ? `--base-url=${baseUrl}`
            : argv.some((a) => a.startsWith('--mods-dir='))
              ? `--mods-dir=${modsDir}`
              : '既定の ./mods';
        console.error(
            `❌ lock を取得できない mod: ${missing.join(', ')}。` +
                `外部 mod は world.yaml の dependencies[].source.url を指定してください` +
                `（現在の fallback: ${fallbackHint}）。`,
        );
        process.exitCode = 1;
        return;
    }

    if (argv.includes('--check')) {
        const current = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : null;
        if (current !== nextJson) {
            console.error(
                `❌ ${outPath} が現在の mod ビルドと一致しません（陳腐化 or 未生成）。` +
                    `\`node packages/sdk/cli/index.ts install ${worldPath} --mods-dir=${modsDir}\` で再生成してください。`,
            );
            process.exitCode = 1;
            return;
        }
        console.log(`✅ ${outPath} は現在の mod ビルドと一致しています (${lockedIds.length}/${modIds.length} mods)`);
        return;
    }

    writeFileSync(outPath, nextJson, 'utf-8');
    console.log(`🔒 ${outPath} (${lockedIds.length}/${modIds.length} mods)`);
}
