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
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MOD_SIGNATURE_FILE, ModLockEntrySchema, verifyModSignature } from '@ubichill/shared';
import { webWorldCrypto } from '@ubichill/loader';
import { listDirsOnDisk, type ModVersionDir, modVersionDirs } from './modLayout.ts';

function sriOf(buffer: Buffer): string {
    return `sha256-${createHash('sha256').update(buffer).digest('base64')}`;
}

/** manifest の assetIntegrity が実ファイルと一致するか（アセットは manifest 経由で lock に固定される）。 */
function verifyAssets(versionDir: string, label: string, manifestBytes: Buffer): string[] {
    const manifest = JSON.parse(manifestBytes.toString('utf-8')) as { assetIntegrity?: Record<string, string> };
    return Object.entries(manifest.assetIntegrity ?? {}).flatMap(([path, expected]) => {
        const assetPath = join(versionDir, path);
        if (!existsSync(assetPath)) return [`${label}: アセットが無い (${path})`];
        const actual = sriOf(readFileSync(assetPath));
        return actual === expected ? [] : [`${label}: アセットの integrity 不一致 (${path}, manifest=${expected}, 実測=${actual})`];
    });
}

/** 1 つの版のディレクトリを検証する。問題があれば文字列配列で返す（空なら OK）。 */
function verifyVersionDir({ dir: versionDir, label }: ModVersionDir): string[] {
    const lockPath = join(versionDir, 'lock.json');
    if (!existsSync(lockPath)) return []; // data-only mod 等、lock.json が無い場合はスキップ

    // lock.json は ModLockEntry 単体（buildWorker が mod 単位で出す形）。スキーマ違反も検出する。
    const parsed = ModLockEntrySchema.safeParse(JSON.parse(readFileSync(lockPath, 'utf-8')));
    if (!parsed.success) return [`${label}: lock.json がスキーマ不正 (${parsed.error.issues[0]?.message})`];
    const rawLock = parsed.data;

    const manifestPath = join(versionDir, 'manifest.json');
    if (!existsSync(manifestPath)) return [`${label}: manifest.json が無い`];
    const manifestBytes = readFileSync(manifestPath);
    const manifestIntegrity = sriOf(manifestBytes);
    const manifestErrors =
        manifestIntegrity === rawLock.manifestIntegrity
            ? []
            : [`${label}: manifestIntegrity 不一致 (lock=${rawLock.manifestIntegrity}, 実測=${manifestIntegrity})`];

    const workerErrors = Object.entries(rawLock.components ?? {}).flatMap(([componentType, comp]) => {
        const workerPath = join(versionDir, comp.workerUrl.replace(/^\.\//, ''));
        if (!existsSync(workerPath)) {
            return [`${label}/${componentType}: workerUrl が指すファイルが無い (${comp.workerUrl})`];
        }
        const workerIntegrity = sriOf(readFileSync(workerPath));
        return workerIntegrity === comp.integrity
            ? []
            : [`${label}/${componentType}: integrity 不一致 (lock=${comp.integrity}, 実測=${workerIntegrity})`];
    });
    // manifest が lock と違うなら、中の assetIntegrity は信用できないので照合しない
    const assetErrors = manifestErrors.length > 0 ? [] : verifyAssets(versionDir, label, manifestBytes);
    return [...manifestErrors, ...assetErrors, ...workerErrors];
}

/** `distDir` 配下の全 mod の lock.json を検証し、エラー一覧を返す（空なら OK）。 */
export function verifyAllModLocks(distDir: string): string[] {
    if (!existsSync(distDir)) {
        return [`${distDir} が存在しません（先に ubichill build を実行してください）`];
    }
    return modVersionDirs(distDir, listDirsOnDisk).flatMap(verifyVersionDir);
}

/**
 * `distDir` 配下の全 mod の作者署名（`lock.sig.json`）が、今の lock に対して有効かを調べる。
 * 署名があるのに合わないものは常にエラー。`requireSignatures` なら署名の無い mod もエラー（公開前の確認用）。
 * ここでは鍵を扱わない。作者アカウントが本当にその鍵の持ち主かは、Host のサーバーが確かめる。
 */
export async function verifyAllModSignatures(distDir: string, requireSignatures: boolean): Promise<string[]> {
    if (!existsSync(distDir)) return [];
    const versionDirs = modVersionDirs(distDir, listDirsOnDisk).filter(({ dir }) => existsSync(join(dir, 'lock.json')));
    const results = await Promise.all(
        versionDirs.map(async ({ label, dir }): Promise<string[]> => {
            const sigPath = join(dir, MOD_SIGNATURE_FILE);
            if (!existsSync(sigPath)) return requireSignatures ? [`${label}: 署名がありません（ubichill publish で署名してください）`] : [];
            const entry = ModLockEntrySchema.safeParse(JSON.parse(readFileSync(join(dir, 'lock.json'), 'utf-8')));
            if (!entry.success) return [`${label}: lock.json がスキーマ不正`];
            const signature = (() => {
                try {
                    return JSON.parse(readFileSync(sigPath, 'utf-8')) as unknown;
                } catch {
                    return {};
                }
            })();
            const verdict = await verifyModSignature(entry.data, signature, webWorldCrypto, async () => ({
                status: 'confirmed',
            }));
            return verdict.status === 'verified' ? [] : [`${label}: 署名が無効です (${verdict.reason})。ubichill publish で署名し直してください`];
        }),
    );
    return results.flat();
}

/**
 * `argv`（サブコマンド名を除いた残り引数）から検証を実行する。
 * `--dist-dir=` 既定は `<cwd>/dist/mods`。`--require-signatures` で署名の無い mod も不合格にする。
 * エラーがあれば throw（fail-closed）。
 */
export async function runVerify(argv: string[]): Promise<void> {
    const distDirArg = argv.find((a) => a.startsWith('--dist-dir='))?.slice('--dist-dir='.length);
    const distDir = distDirArg ? resolve(distDirArg) : join(process.cwd(), 'dist', 'mods');

    const requireSignatures = argv.includes('--require-signatures');
    const errors = [...verifyAllModLocks(distDir), ...(await verifyAllModSignatures(distDir, requireSignatures))];
    if (errors.length > 0) {
        throw new Error(`mod lock 検証失敗 (${errors.length} 件):\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    }
    console.log(`✅ mod lock 検証OK (${distDir}${requireSignatures ? '、署名あり' : ''})`);
}
