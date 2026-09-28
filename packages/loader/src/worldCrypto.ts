import type { WorldCrypto, WorldSigningKey } from '@ubichill/shared';

/**
 * WebCrypto による ed25519 / sha256。browser と Node の双方で動く（`globalThis.crypto.subtle`）。
 * 鍵・署名は base64url、秘密鍵の保存形式は PKCS8(DER) の標準 base64。
 */
const utf8 = new TextEncoder();
const ED25519 = { name: 'Ed25519' } as const;

const toBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const toBase64Url = (bytes: Uint8Array): string =>
    toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
    fromBase64(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));

export const webWorldCrypto: WorldCrypto = {
    sha256Base64: async (text) =>
        toBase64(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', utf8.encode(text)))),
    verifyEd25519: async (publicKey, message, signature) => {
        try {
            const key = await globalThis.crypto.subtle.importKey('raw', fromBase64Url(publicKey), ED25519, false, [
                'verify',
            ]);
            return await globalThis.crypto.subtle.verify(ED25519, key, fromBase64Url(signature), utf8.encode(message));
        } catch {
            return false;
        }
    },
};

/**
 * PKCS8 から公開鍵を導出し、秘密鍵は**取り出し不可**の CryptoKey として取り込む。
 * 取り出し不可の鍵は IndexedDB に保存でき、XSS があっても鍵そのものは持ち出せない。
 */
export async function importSigningKeyPair(pkcs8Base64: string): Promise<{ publicKey: string; privateKey: CryptoKey }> {
    const bytes = fromBase64(pkcs8Base64.trim());
    const exportable = await globalThis.crypto.subtle.importKey('pkcs8', bytes, ED25519, true, ['sign']);
    const { x } = await globalThis.crypto.subtle.exportKey('jwk', exportable);
    if (!x) throw new Error('公開鍵を導出できません');
    const privateKey = await globalThis.crypto.subtle.importKey('pkcs8', bytes, ED25519, false, ['sign']);
    return { publicKey: x, privateKey };
}

export function signingKeyFrom(publicKey: string, privateKey: CryptoKey): WorldSigningKey {
    return {
        publicKey,
        sign: async (message) =>
            toBase64Url(new Uint8Array(await globalThis.crypto.subtle.sign(ED25519, privateKey, utf8.encode(message)))),
    };
}

export async function importSigningKey(pkcs8Base64: string): Promise<WorldSigningKey> {
    const { publicKey, privateKey } = await importSigningKeyPair(pkcs8Base64);
    return signingKeyFrom(publicKey, privateKey);
}

/** 新しい ed25519 秘密鍵を PKCS8 base64 で返す。 */
export async function generateSigningKeyPkcs8(): Promise<string> {
    const pair = (await globalThis.crypto.subtle.generateKey(ED25519, true, ['sign', 'verify'])) as CryptoKeyPair;
    return toBase64(new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey)));
}
