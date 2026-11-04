import { describe, expect, it, vi } from 'vitest';
import { asUnsignedRepositoryWorld, repositoryWorldOwner, repositoryWorldPolicy } from './worldRegistry';

vi.mock('@ubichill/db', () => ({ federationPeerRepository: {}, userRepository: {}, worldRepository: {} }));
vi.mock('./authorKeyStore', () => ({ isAuthorKey: vi.fn(), resolveAuthorDisplayName: vi.fn() }));

const account = (handle: string, domain: string) => ({ handle, domain });

describe('repositoryWorldPolicy（同梱ワールドを配るか）', () => {
    it('自サーバーの作者の署名は作者の鍵で確かめて配る', () => {
        expect(repositoryWorldPolicy(account('ubichill', 'ubichill.com'), 'ubichill.com', false)).toBe('verify-own');
        expect(repositoryWorldPolicy(account('ubichill', 'ubichill.com'), 'ubichill.com', true)).toBe('verify-own');
    });

    it('ほかのサーバーの作者の署名は既定では配らない（作者のサーバーへ問い合わせない）', () => {
        expect(repositoryWorldPolicy(account('ubichill', 'ubichill.com'), 'pr-250.ubichill.com', false)).toBe('skip');
    });

    it('ほかのサーバーの作者の署名でも、開発用の設定のときは署名を外して署名なしとして配る（dev は main のイメージ）', () => {
        expect(repositoryWorldPolicy(account('ubichill', 'ubichill.com'), 'dev.ubichill.com', true)).toBe(
            'serve-unsigned',
        );
        const hosted = {
            definition: { metadata: { name: 'default' } },
            lock: { a: 1 },
            signature: { author: '@ubichill@ubichill.com' },
        };
        const unsigned = asUnsignedRepositoryWorld(hosted as never);
        expect(unsigned.signature).toBeNull();
        expect(unsigned.lock).toEqual({ a: 1 });
        expect(hosted.signature).not.toBeNull();
        const plain = { definition: {}, lock: null, signature: null };
        expect(asUnsignedRepositoryWorld(plain as never)).toBe(plain);
    });

    it('署名なしは既定では配らず、開発・プレビューの設定のときだけ署名なしとして配る', () => {
        expect(repositoryWorldPolicy(null, 'ubichill.com', false)).toBe('skip');
        expect(repositoryWorldPolicy(null, 'pr-250.ubichill.com', true)).toBe('serve-unsigned');
    });

    it('配る名義（URL の handle）は ID で取るときと同じ規則。他サーバーの作者の handle では探せない', () => {
        expect(repositoryWorldOwner(account('alice', 'ubichill.com'), 'ubichill.com', false)).toBe('alice');
        expect(repositoryWorldOwner(account('alice', 'ubichill.com'), 'dev.ubichill.com', true)).toBe('ubichill');
        expect(repositoryWorldOwner(account('alice', 'ubichill.com'), 'dev.ubichill.com', false)).toBeUndefined();
        expect(repositoryWorldOwner(null, 'dev.ubichill.com', true)).toBe('ubichill');
        expect(repositoryWorldOwner(null, 'ubichill.com', false)).toBeUndefined();
    });
});
