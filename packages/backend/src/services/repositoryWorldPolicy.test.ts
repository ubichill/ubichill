import { describe, expect, it, vi } from 'vitest';
import { repositoryWorldPolicy } from './worldRegistry';

vi.mock('@ubichill/db', () => ({ federationPeerRepository: {}, userRepository: {}, worldRepository: {} }));
vi.mock('./authorKeyStore', () => ({ isAuthorKey: vi.fn(), resolveAuthorDisplayName: vi.fn() }));

const account = (handle: string, domain: string) => ({ handle, domain });

describe('repositoryWorldPolicy（同梱ワールドを配るか）', () => {
    it('自サーバーの作者の署名は作者の鍵で確かめて配る', () => {
        expect(repositoryWorldPolicy(account('ubichill', 'ubichill.com'), 'ubichill.com', false)).toBe('verify-own');
        expect(repositoryWorldPolicy(account('ubichill', 'ubichill.com'), 'ubichill.com', true)).toBe('verify-own');
    });

    it('ほかのサーバーの作者の署名は、開発用の設定があっても配らない（作者のサーバーへ問い合わせない）', () => {
        expect(repositoryWorldPolicy(account('ubichill', 'ubichill.com'), 'pr-250.ubichill.com', false)).toBe('skip');
        expect(repositoryWorldPolicy(account('ubichill', 'ubichill.com'), 'pr-250.ubichill.com', true)).toBe('skip');
    });

    it('署名なしは既定では配らず、開発・プレビューの設定のときだけ署名なしとして配る', () => {
        expect(repositoryWorldPolicy(null, 'ubichill.com', false)).toBe('skip');
        expect(repositoryWorldPolicy(null, 'pr-250.ubichill.com', true)).toBe('serve-unsigned');
    });
});
