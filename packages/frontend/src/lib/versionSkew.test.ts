import { describe, expect, it, vi } from 'vitest';
import { fetchServerCommit, isVersionSkewed, skewAction } from './versionSkew';

describe('isVersionSkewed', () => {
    it('フロントと backend の版が違えばずれている', () => {
        expect(isVersionSkewed('abc1234', 'def5678')).toBe(true);
        expect(isVersionSkewed('abc1234', 'abc1234')).toBe(false);
    });

    it.each([
        [undefined, 'def5678'],
        ['unknown', 'def5678'],
        ['abc1234', 'unknown'],
        ['abc1234', undefined],
        ['abc1234', ''],
        ['abc1234', 42],
    ])(
        'どちらかが分からない（%s / %s）ときは、ずれていないとみなす（開発・取得失敗で読み込み直し続けない）',
        (front, server) => {
            expect(isVersionSkewed(front, server)).toBe(false);
        },
    );
});

describe('skewAction', () => {
    it('インスタンスの中では知らせるだけ、外ではすぐ読み込み直す', () => {
        expect(skewAction('/instance/abc')).toBe('prompt');
        expect(skewAction('/')).toBe('reload');
        expect(skewAction('/@youkan')).toBe('reload');
        expect(skewAction('/world/abc')).toBe('reload');
    });
});

describe('fetchServerCommit', () => {
    it('取得できなければ undefined（ずれていないとみなされる）', async () => {
        const failing = vi.fn(async () => {
            throw new Error('offline');
        }) as unknown as typeof fetch;
        expect(await fetchServerCommit('https://api.example', failing)).toBeUndefined();
        const notOk = vi.fn(async () => new Response('', { status: 502 })) as unknown as typeof fetch;
        expect(await fetchServerCommit('https://api.example', notOk)).toBeUndefined();
    });

    it('backend の版を読む（キャッシュさせない）', async () => {
        const ok = vi.fn(async () => Response.json({ commitHash: 'def5678' })) as unknown as typeof fetch;
        expect(await fetchServerCommit('https://api.example', ok)).toBe('def5678');
        expect(ok).toHaveBeenCalledWith('https://api.example/api/version', { cache: 'no-store' });
    });
});
