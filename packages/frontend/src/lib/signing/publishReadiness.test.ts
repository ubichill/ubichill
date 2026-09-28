import type { WorldSigningKey } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { publishReadiness } from './publishReadiness';

const key: WorldSigningKey = { publicKey: 'K', sign: async () => '' };
const account = { handle: 'youkan', author: 'youkan@ubichill.com', signingPublicKey: 'K' };

describe('publishReadiness（公開には作者アカウントでの署名が要る）', () => {
    it('ID があり、このブラウザの鍵がアカウントの登録鍵ならそのまま作者付きで公開できる', () => {
        expect(publishReadiness(key, account, [])).toMatchObject({
            kind: 'ready',
            signer: { author: 'youkan@ubichill.com' },
        });
    });

    it('鍵だけでは公開できない（ID 未設定・未登録・別の鍵）＝足りないものを示す', () => {
        expect(publishReadiness(key, { handle: null, author: null, signingPublicKey: null }, [])).toEqual({
            kind: 'needs-setup',
            missingHandle: true,
            missingKey: false,
            keyUnregistered: true,
        });
        expect(publishReadiness(key, { ...account, signingPublicKey: 'OTHER' }, [])).toMatchObject({
            kind: 'needs-setup',
            keyUnregistered: true,
        });
        expect(publishReadiness(null, account, [])).toMatchObject({ kind: 'needs-setup', missingKey: true });
    });

    it('固定できない mod があれば何より先に伝える', () => {
        expect(publishReadiness(key, account, ['danmaku'])).toEqual({ kind: 'unpinned', mods: ['danmaku'] });
    });

    it('アカウント情報が取れなければ公開できない（鍵だけで公開しない）', () => {
        expect(publishReadiness(key, null, [])).toEqual({ kind: 'no-account' });
    });
});
