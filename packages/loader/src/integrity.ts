import { formatIntegrity } from '@ubichill/shared';

/**
 * ArrayBuffer を Subresource Integrity 文字列 `sha256-<base64>` に変換する。
 *
 * build 側（`Buffer.from(code,'utf-8')` の sha256 base64）と同一バイト列・同一規約で
 * 照合できるよう、必ず fetch した生バイト列を渡すこと。
 *
 * `globalThis.crypto.subtle` を使うため browser と Node20+ の双方で動く。
 */
export async function sriOf(bytes: ArrayBuffer): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    // spread は大きな bundle で stack を溢れさせるため Array.from(mapper) で 1 バイトずつ。
    const binary = Array.from(new Uint8Array(digest), (b) => String.fromCharCode(b)).join('');
    return formatIntegrity(btoa(binary));
}
