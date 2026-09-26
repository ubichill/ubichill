import type { WorldSigningKey } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { signerFor } from './signer';

const key = (publicKey: string): WorldSigningKey => ({ publicKey, sign: async () => '' });

describe('signerFor', () => {
    it('鍵が無ければ署名しない', () => {
        expect(signerFor(null, { author: 'youkan@ubichill.com', signingPublicKey: 'K' })).toBeNull();
    });

    it('このブラウザの鍵がアカウントの登録鍵なら作者を名乗る', () => {
        expect(signerFor(key('K'), { author: 'youkan@ubichill.com', signingPublicKey: 'K' })).toMatchObject({
            author: 'youkan@ubichill.com',
        });
    });

    it('登録鍵と違う・未登録・ID 未設定なら作者を名乗らず鍵だけで署名する', () => {
        for (const account of [
            { author: 'youkan@ubichill.com', signingPublicKey: 'OTHER' },
            { author: 'youkan@ubichill.com', signingPublicKey: null },
            { author: null, signingPublicKey: 'K' },
            null,
        ]) {
            const signer = signerFor(key('K'), account);
            expect(signer).not.toBeNull();
            expect(signer).not.toHaveProperty('author');
        }
    });
});
