/**
 * DB に置く秘密の値を AES-256-GCM で暗号化する。鍵はサーバーの秘密から用途ごとに HKDF で作り、どの秘密で作ったかを
 * 値に残す（秘密を入れ替えても、古い秘密が残っている間は開ける。lib/serverKeys.ts）。
 * `context`（ユーザー ID など）を追加の認証データに入れ、行を別のユーザーへ写しても開けないようにする。
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { ServerKey, ServerKeys } from './serverKeys';

export interface SecretBox {
    seal(plain: Uint8Array, context: string): string;
    /** 開けなければ（壊れた・知らない秘密・別の用途・別の context）null */
    open(sealed: string, context: string): Uint8Array | null;
}

const VERSION = 'v1';
const TAG_LENGTH = 16;

export function createSecretBox(keys: ServerKeys, purpose: string): SecretBox {
    const derive = (key: ServerKey) => Buffer.from(hkdfSync('sha256', key.secret, '', `ubichill/${purpose}`, 32));
    return {
        seal(plain, context) {
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', derive(keys.current), iv, { authTagLength: TAG_LENGTH });
            cipher.setAAD(Buffer.from(context));
            const body = Buffer.concat([cipher.update(plain), cipher.final()]);
            return [
                VERSION,
                keys.current.id,
                ...[iv, body, cipher.getAuthTag()].map((b) => b.toString('base64url')),
            ].join('.');
        },
        open(sealed, context) {
            const [version, keyId, iv, body, tag, ...rest] = sealed.split('.');
            const key = keyId ? keys.find(keyId) : undefined;
            if (version !== VERSION || !key || !iv || body === undefined || !tag || rest.length > 0) return null;
            try {
                const decipher = createDecipheriv('aes-256-gcm', derive(key), Buffer.from(iv, 'base64url'), {
                    authTagLength: TAG_LENGTH,
                });
                decipher.setAAD(Buffer.from(context));
                decipher.setAuthTag(Buffer.from(tag, 'base64url'));
                return new Uint8Array(
                    Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]),
                );
            } catch {
                return null;
            }
        },
    };
}
