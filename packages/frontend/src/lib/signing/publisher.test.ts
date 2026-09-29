import type { WorldSigningKey } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { ensureAuthorSigner, type KeyRegistrationResult } from './publisher';

const key = (publicKey: string): WorldSigningKey => ({ publicKey, sign: async () => '' });
const account = { id: 'u1', author: 'youkan@ubichill.com', signingKeys: [] as string[] };

function fakeDeps(state: { local?: string; revoked?: string[]; failRegister?: boolean }) {
    const log: string[] = [];
    const store = { local: state.local ? key(state.local) : null };
    const created = { n: 0 };
    return {
        log,
        store,
        deps: {
            loadKey: async () => store.local,
            createKey: async () => {
                created.n += 1;
                log.push(`create:N${created.n}`);
                store.local = key(`N${created.n}`);
                return store.local;
            },
            removeKey: async () => {
                log.push('remove');
                store.local = null;
            },
            register: async (_userId: string, k: WorldSigningKey): Promise<KeyRegistrationResult> => {
                log.push(`register:${k.publicKey}`);
                if (state.failRegister) return 'revoked';
                return state.revoked?.includes(k.publicKey) ? 'revoked' : 'registered';
            },
        },
    };
}

describe('ensureAuthorSigner（このブラウザを公開環境にする）', () => {
    it('登録済みの鍵ならそのまま作者付きで署名する（サーバーに出ない）', async () => {
        const { deps, log } = fakeDeps({ local: 'K' });
        const signer = await ensureAuthorSigner({ ...account, signingKeys: ['K'] }, deps);
        expect(signer).toMatchObject({ author: 'youkan@ubichill.com', key: { publicKey: 'K' } });
        expect(log).toEqual([]);
    });

    it('鍵が無ければ作って登録する（確認もバックアップのダウンロードも出さない）', async () => {
        const { deps, log } = fakeDeps({});
        const signer = await ensureAuthorSigner(account, deps);
        expect(signer.key.publicKey).toBe('N1');
        expect(log).toEqual(['create:N1', 'register:N1']);
    });

    it('未登録の鍵は登録する（ほかの公開環境の鍵は置き換えない）', async () => {
        const { deps, log } = fakeDeps({ local: 'K' });
        await ensureAuthorSigner({ ...account, signingKeys: ['OTHER'] }, deps);
        expect(log).toEqual(['register:K']);
    });

    it('このブラウザの鍵が取り消し済みなら捨てて作り直す（取り消した鍵は復活させない）', async () => {
        const { deps, log, store } = fakeDeps({ local: 'K', revoked: ['K'] });
        const signer = await ensureAuthorSigner(account, deps);
        expect(signer.key.publicKey).toBe('N1');
        expect(store.local?.publicKey).toBe('N1');
        expect(log).toEqual(['register:K', 'remove', 'create:N1', 'register:N1']);
    });

    it('作り直しても登録できなければ失敗させる（作者なしで公開しない）', async () => {
        const { deps } = fakeDeps({ local: 'K', failRegister: true });
        await expect(ensureAuthorSigner(account, deps)).rejects.toThrow();
    });

    it('ID 未設定のアカウントでは鍵を作らない', async () => {
        const { deps, log } = fakeDeps({});
        await expect(ensureAuthorSigner({ ...account, author: null }, deps)).rejects.toThrow();
        expect(log).toEqual([]);
    });
});
