/**
 * verify-mod-locks.mjs
 *
 * build-workers.mjs が出力した lock.json 群を「配布前」に検証する fail-closed ゲート。
 *
 * ここで検証するのは、build 側が生成した lock の integrity が「実際に配布されるバイト列」と
 * 一致しているか。build-workers.mjs 自身の hash 計算にバグがあっても単体テストはフェイク値を
 * 使うため気づけない。ここは実ファイルシステム上の生成物を独立に再ハッシュして突き合わせる、
 * 唯一の「実際に配布する物」に対するチェック。
 *
 * - GitHub Pages 公開ワークフロー（mods-pages.yml）が push 前に実行し、不一致なら公開を止める。
 * - 通常 CI（ci.yml）も build:workers 直後に実行し、PR 段階で壊れたビルドを検知する。
 *
 * 使い方: node scripts/verify-mod-locks.mjs [--dist-dir=dist/mods]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModLockEntrySchema } from '@ubichill/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const distDirArg = process.argv.slice(2).find((a) => a.startsWith('--dist-dir='));
const distModsDir = distDirArg ? join(root, distDirArg.split('=')[1]) : join(root, 'dist', 'mods');

function sriOf(buffer) {
    return `sha256-${createHash('sha256').update(buffer).digest('base64')}`;
}

/** 1 mod のディレクトリを検証する。問題があれば文字列配列で返す（空なら OK）。 */
function verifyModDir(modDir, modDirName) {
    const errors = [];
    for (const versionDirName of readdirSync(modDir).filter((n) => /^v/.test(n))) {
        const versionDir = join(modDir, versionDirName);
        const lockPath = join(versionDir, 'lock.json');
        if (!existsSync(lockPath)) continue; // data-only mod 等、lock.json が無い場合はスキップ

        // lock.json は ModLockEntry 単体（buildWorker が mod 単位で出す形）。スキーマ違反も検出する。
        const parsed = ModLockEntrySchema.safeParse(JSON.parse(readFileSync(lockPath, 'utf-8')));
        if (!parsed.success) {
            errors.push(`${modDirName}/${versionDirName}: lock.json がスキーマ不正 (${parsed.error.issues[0]?.message})`);
            continue;
        }
        const rawLock = parsed.data;

        const manifestPath = join(versionDir, 'manifest.json');
        if (!existsSync(manifestPath)) {
            errors.push(`${modDirName}/${versionDirName}: manifest.json が無い`);
            continue;
        }
        const manifestIntegrity = sriOf(readFileSync(manifestPath));
        if (manifestIntegrity !== rawLock.manifestIntegrity) {
            errors.push(
                `${modDirName}/${versionDirName}: manifestIntegrity 不一致 (lock=${rawLock.manifestIntegrity}, 実測=${manifestIntegrity})`,
            );
        }

        for (const [componentType, comp] of Object.entries(rawLock.components ?? {})) {
            const workerPath = join(versionDir, comp.workerUrl.replace(/^\.\//, ''));
            if (!existsSync(workerPath)) {
                errors.push(`${modDirName}/${versionDirName}/${componentType}: workerUrl が指すファイルが無い (${comp.workerUrl})`);
                continue;
            }
            const workerIntegrity = sriOf(readFileSync(workerPath));
            if (workerIntegrity !== comp.integrity) {
                errors.push(
                    `${modDirName}/${versionDirName}/${componentType}: integrity 不一致 (lock=${comp.integrity}, 実測=${workerIntegrity})`,
                );
            }
        }
    }
    return errors;
}

function main() {
    if (!existsSync(distModsDir)) {
        console.error(`❌ ${distModsDir} が存在しません（先に pnpm build:workers を実行してください）`);
        process.exit(1);
    }

    const modDirNames = readdirSync(distModsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

    const allErrors = modDirNames.flatMap((name) => verifyModDir(join(distModsDir, name), name));

    if (allErrors.length > 0) {
        console.error(`❌ mod lock 検証失敗 (${allErrors.length} 件):`);
        for (const e of allErrors) console.error(`  - ${e}`);
        process.exit(1);
    }
    console.log(`✅ mod lock 検証OK (${modDirNames.length} mods)`);
}

main();
