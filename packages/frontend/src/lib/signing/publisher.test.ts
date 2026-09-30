import type { WorldSigningKey } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { ensureAuthorSigner, type KeyRegistrationResult } from './publisher';

const key = (publicKey: string): WorldSigningKey => ({ publicKey, sign: async () => '' });
const account = { id: 'u1', author: 'youkan@ubichill.com', signingKeys: [] as string[] };

function fakeDeps(state: { local?: string; revoked?: string[]; taken?: string[]; failRegister?: boolean }) {
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
                if (state.taken?.includes(k.publicKey)) return 'taken';
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

    it('別のアカウントが登録している鍵（同じブラウザでアカウントを切り替えた・鍵ファイルの使い回し）でも作り直す', async () => {
        const { deps, log } = fakeDeps({ local: 'K', taken: ['K'] });
        const signer = await ensureAuthorSigner(account, deps);
        expect(signer.key.publicKey).toBe('N1');
        expect(log).toEqual(['register:K', 'remove', 'create:N1', 'register:N1']);
    });

    it('鍵の読み書きはアカウントごと（別のアカウントの鍵を読まない・消さない）', async () => {
        const seen: string[] = [];
        const { deps } = fakeDeps({ local: 'K', revoked: ['K'] });
        const record = <T>(name: string, run: () => Promise<T>) => {
            return async (id: string) => {
                seen.push(`${name}:${id}`);
                return run();
            };
        };
        await ensureAuthorSigner(account, {
            ...deps,
            loadKey: record('load', deps.loadKey),
            createKey: record('create', deps.createKey),
            removeKey: record('remove', deps.removeKey),
        });
        expect(seen).toEqual(['load:u1', 'remove:u1', 'create:u1']);
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
