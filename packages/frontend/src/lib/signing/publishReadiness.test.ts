import type { WorldSigningKey } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { publishReadiness } from './publishReadiness';

const key: WorldSigningKey = { publicKey: 'K', sign: async () => '' };
const account = { author: 'youkan@ubichill.com', signingPublicKey: 'K' };

describe('publishReadiness', () => {
    it('鍵があり全 mod が固定済みならそのまま公開できる（登録鍵なら作者付き）', () => {
        expect(publishReadiness(key, account, [])).toMatchObject({
            kind: 'ready',
            signer: { author: 'youkan@ubichill.com' },
        });
    });

    it('鍵が無ければ用意が必要', () => {
        expect(publishReadiness(null, account, [])).toEqual({ kind: 'needs-key' });
    });

    it('固定できない mod があれば鍵があっても公開できない（鍵の用意より先に伝える）', () => {
        expect(publishReadiness(key, account, ['danmaku'])).toEqual({ kind: 'unpinned', mods: ['danmaku'] });
        expect(publishReadiness(null, null, ['danmaku'])).toEqual({ kind: 'unpinned', mods: ['danmaku'] });
    });

    it('アカウント情報が取れなくても鍵があれば鍵だけで署名して公開できる', () => {
        const readiness = publishReadiness(key, null, []);
        expect(readiness.kind).toBe('ready');
        expect(readiness.kind === 'ready' && readiness.signer).not.toHaveProperty('author');
    });
});
