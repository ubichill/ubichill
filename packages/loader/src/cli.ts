/**
 * ロック生成 CLI（Node 専用）。ワールド YAML から mod 完全性ロックを生成し、
 * 兄弟ファイル `<world>.lock.json` に書き出す（分離方針＝YAML には埋めない）。
 *
 * 使い方:
 *   tsx packages/loader/src/cli.ts <world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>]
 *   （root script: `pnpm gen:lock worlds/default.yaml`）
 *
 * getLockEntry の transport:
 *   - 既定/`--mods-dir`: ローカルの mods ディレクトリ（build-workers 出力）から fs 読取。
 *   - `--base-url`     : HTTP 取得（外部 CDN 上の mod を固定する場合）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ModLockEntry, ModLockEntrySchema, WorldDefinitionSchema } from '@ubichill/shared';
import yaml from 'yaml';
import { buildWorldLock, collectModIds, createHttpLockEntryGetter, type LockEntryGetter } from './buildWorldLock';

function argValue(argv: string[], name: string): string | undefined {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
}

/** mods ディレクトリ（build-workers 出力）から lock.json 断片を fs で読む getter。 */
function createFsLockEntryGetter(modsDir: string): LockEntryGetter {
    return async (modId) => {
        const indexPath = join(modsDir, modId, 'mod.json');
        if (!existsSync(indexPath)) return null;
        const { version } = JSON.parse(readFileSync(indexPath, 'utf-8')) as { version?: string };
        if (!version) return null;
        const lockPath = join(modsDir, modId, `v${version}`, 'lock.json');
        if (!existsSync(lockPath)) return null;
        const parsed = ModLockEntrySchema.safeParse(JSON.parse(readFileSync(lockPath, 'utf-8')));
        return parsed.success ? (parsed.data as ModLockEntry) : null;
    };
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const worldPath = argv.find((a) => !a.startsWith('--'));
    if (!worldPath) {
        console.error('usage: gen:lock <world.yaml> [--mods-dir=<dir>] [--base-url=<url>] [--out=<path>]');
        process.exit(1);
    }

    const def = WorldDefinitionSchema.parse(yaml.parse(readFileSync(worldPath, 'utf-8')));
    const modIds = collectModIds(def.spec.initialEntities);

    const baseUrl = argValue(argv, 'base-url');
    const modsDir = argValue(argv, 'mods-dir') ?? 'packages/frontend/public/mods';
    const getLockEntry = baseUrl ? createHttpLockEntryGetter(baseUrl) : createFsLockEntryGetter(modsDir);

    const lock = await buildWorldLock(modIds, getLockEntry);

    const outPath = argValue(argv, 'out') ?? worldPath.replace(/\.ya?ml$/i, '.lock.json');
    writeFileSync(outPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf-8');

    const lockedIds = Object.keys(lock.mods);
    const missing = modIds.filter((id) => !lockedIds.includes(id));
    console.log(`🔒 ${outPath} (${lockedIds.length}/${modIds.length} mods)`);
    if (missing.length > 0) console.warn(`⚠️  lock 断片が見つからない mod: ${missing.join(', ')}（除外）`);
}

main().catch((err) => {
    console.error('❌ ロック生成失敗:', err instanceof Error ? err.message : err);
    process.exit(1);
});
