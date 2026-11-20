/**
 * サーバーの秘密（BETTER_AUTH_SECRET）から用途ごとの鍵を作り、DB に置く秘密の値を AES-256-GCM で暗号化する。
 * `context`（ユーザー ID など）を追加の認証データに入れ、行を別のユーザーへ写しても開けないようにする。
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export interface SecretBox {
    seal(plain: Uint8Array, context: string): string;
    /** 開けなければ（壊れた・別の鍵・別の context）null */
    open(sealed: string, context: string): Uint8Array | null;
}

const VERSION = 'v1';

export function createSecretBox(serverSecret: string, purpose: string): SecretBox {
    const key = Buffer.from(hkdfSync('sha256', serverSecret, '', `ubichill/${purpose}`, 32));
    return {
        seal(plain, context) {
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(Buffer.from(context));
            const body = Buffer.concat([cipher.update(plain), cipher.final()]);
            return [VERSION, iv, body, cipher.getAuthTag()]
                .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
                .join('.');
        },
        open(sealed, context) {
            const [version, iv, body, tag] = sealed.split('.');
            if (version !== VERSION || !iv || body === undefined || !tag) return null;
            try {
                const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
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
