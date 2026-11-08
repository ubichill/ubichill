import { isSandboxWorkerScriptPath, SANDBOX_WORKER_CSP } from '@ubichill/shared';

/**
 * 静的ファイルに付けるヘッダー（パスは `/` 区切り）。
 * - Sandbox Worker のスクリプト: Worker 専用の CSP（Worker の CSP はページではなくこのレスポンスで決まる）。
 * - /mods 配下: no-cache。ハッシュ付きファイル: immutable。
 * - フロントの version.json: no-store（更新の有無の確認に使う）。
 */
export function staticAssetHeaders(filePath: string): Record<string, string> {
    const csp: Record<string, string> = isSandboxWorkerScriptPath(filePath)
        ? { 'Content-Security-Policy': SANDBOX_WORKER_CSP }
        : {};
    if (filePath.endsWith('/version.json')) return { ...csp, 'Cache-Control': 'no-store' };
    if (filePath.includes('/mods/')) return { ...csp, 'Cache-Control': 'public, no-cache' };
    if (/\.[0-9a-f]{8,}\.\w+$/i.test(filePath)) {
        return { ...csp, 'Cache-Control': 'public, max-age=31536000, immutable' };
    }
    return csp;
}
