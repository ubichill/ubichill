/**
 * mod に同梱したアセットを読み、manifest の integrity と照合してから渡す。
 *
 * manifest は lock の manifestIntegrity で固定済みなので、ここで照合すればアセットの中身も lock に連なって固定される。
 * パスは manifest のキーと完全一致した相対パスだけを受け付ける（`..`・絶対 URL・クエリでの抜け道を作らない）。
 */
import { FETCH_LIMITS, UbiError, UbiErrorCode } from '@ubichill/shared';
import { readBodyWithLimit, resolveModAssetUrl } from './fetchHandler';

export interface ModAssetSource {
    modBase: string | undefined;
    /** アセットの相対パス → SRI（`sha256-<base64>`）。manifest の assetIntegrity。 */
    integrity: Readonly<Record<string, string>> | undefined;
}

export interface LoadModAssetOptions {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
}

const SRI_ALGORITHMS: Readonly<Record<string, string>> = {
    sha256: 'SHA-256',
    sha384: 'SHA-384',
    sha512: 'SHA-512',
};

/**
 * manifest のキーとして妥当な相対パスか（区切りは `/` のみ、`.`・`..`・空のセグメントを含まない）。
 * `%` も拒む（`%2e%2e` は URL 解決で `..` に化ける）。
 */
export function isValidAssetPath(path: string): boolean {
    if (path.length === 0 || /[\\?#:%]/.test(path) || path.startsWith('/')) return false;
    return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function toBase64(bytes: ArrayBuffer): string {
    return btoa(Array.from(new Uint8Array(bytes), (b) => String.fromCharCode(b)).join(''));
}

/** SRI 文字列とバイト列が一致するか。未知のアルゴリズムは不一致として扱う。 */
export async function matchesIntegrity(bytes: ArrayBuffer, integrity: string): Promise<boolean> {
    const separator = integrity.indexOf('-');
    const algorithm = SRI_ALGORITHMS[integrity.slice(0, separator)];
    if (separator <= 0 || !algorithm) return false;
    const digest = await crypto.subtle.digest(algorithm, bytes);
    return toBase64(digest) === integrity.slice(separator + 1);
}

export async function loadModAsset(
    rawPath: string,
    source: ModAssetSource,
    options: LoadModAssetOptions = {},
): Promise<ArrayBuffer> {
    const path = rawPath.replace(/^\.\//, '');
    if (!isValidAssetPath(path)) {
        throw new UbiError(UbiErrorCode.ASSET_INVALID_PATH, `アセットのパスが不正です: ${rawPath}`);
    }
    if (!source.integrity) {
        throw new UbiError(
            UbiErrorCode.ASSET_NOT_DECLARED,
            'manifest に assetIntegrity がありません。新しい ubichill CLI で mod をビルドし直してください',
        );
    }
    const expected = Object.hasOwn(source.integrity, path) ? source.integrity[path] : undefined;
    if (!expected) {
        throw new UbiError(UbiErrorCode.ASSET_NOT_DECLARED, `manifest に無いアセットです: ${path}`);
    }
    const url = resolveModAssetUrl(path, source.modBase);
    if (!url) {
        throw new UbiError(UbiErrorCode.ASSET_INVALID_PATH, `mod の配布元の外を指しています: ${path}`);
    }

    const response = await (options.fetchImpl ?? fetch)(url, {
        signal: options.signal,
        credentials: 'same-origin',
    }).catch((error: unknown) => {
        throw new UbiError(
            UbiErrorCode.ASSET_FETCH_FAILED,
            `アセットを取得できませんでした: ${path} (${error instanceof Error ? error.message : String(error)})`,
        );
    });
    if (!response.ok) {
        await response.body?.cancel();
        throw new UbiError(
            UbiErrorCode.ASSET_FETCH_FAILED,
            `アセットを取得できませんでした: ${path} (${response.status})`,
        );
    }
    const bytes = await readBodyWithLimit(response, FETCH_LIMITS.maxBytes);
    if (bytes === 'too-large') {
        throw new UbiError(
            UbiErrorCode.FETCH_RESPONSE_TOO_LARGE,
            `アセットが上限 (${FETCH_LIMITS.maxBytes} byte) を超えました: ${path}`,
        );
    }
    if (!(await matchesIntegrity(bytes, expected))) {
        throw new UbiError(UbiErrorCode.ASSET_INTEGRITY_MISMATCH, `アセットの内容が manifest と一致しません: ${path}`);
    }
    return bytes;
}
