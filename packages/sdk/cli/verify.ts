/**
 * `ubichill build` が出力した lock.json 群を「配布前」に検証する fail-closed ゲート
 * （`ubichill verify`）。
 *
 * ここで検証するのは、build 側が生成した lock の integrity が「実際に配布されるバイト列」と
 * 一致しているか。build 側の hash 計算にバグがあっても単体テストはフェイク値を使うため
 * 気づけない。ここは実ファイルシステム上の生成物を独立に再ハッシュして突き合わせる、
 * 唯一の「実際に配布する物」に対するチェック。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ModLockEntrySchema } from '@ubichill/shared';

function sriOf(buffer: Buffer): string {
    return `sha256-${createHash('sha256').update(buffer).digest('base64')}`;
}

/** 1 mod のディレクトリを検証する。問題があれば文字列配列で返す（空なら OK）。 */
function verifyModDir(modDir: string, modDirName: string): string[] {
    const errors: string[] = [];
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

/** `distDir` 配下の全 mod の lock.json を検証し、エラー一覧を返す（空なら OK）。 */
export function verifyAllModLocks(distDir: string): string[] {
    if (!existsSync(distDir)) {
        return [`${distDir} が存在しません（先に ubichill build を実行してください）`];
    }
    const modDirNames = readdirSync(distDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    return modDirNames.flatMap((name) => verifyModDir(join(distDir, name), name));
}

/**
 * `argv`（サブコマンド名を除いた残り引数）から検証を実行する。
 * `--dist-dir=` 既定は `<cwd>/dist/mods`。エラーがあれば throw（fail-closed）。
 */
export async function runVerify(argv: string[]): Promise<void> {
    const distDirArg = argv.find((a) => a.startsWith('--dist-dir='))?.slice('--dist-dir='.length);
    const distDir = distDirArg ? resolve(distDirArg) : join(process.cwd(), 'dist', 'mods');

    const errors = verifyAllModLocks(distDir);
    if (errors.length > 0) {
        throw new Error(`mod lock 検証失敗 (${errors.length} 件):\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    }
    console.log(`✅ mod lock 検証OK (${distDir})`);
}
