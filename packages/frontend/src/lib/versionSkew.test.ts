import { describe, expect, it, vi } from 'vitest';
import { fetchServerCommit, isVersionSkewed, reloadMemory, skewAction } from './versionSkew';

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
    const SERVER = 'def5678';

    it('失うものが無い画面（ロビー・ユーザーページ・ワールドの詳細）は、すぐ読み込み直す', () => {
        for (const path of ['/', '/@youkan', '/user/abc', '/world', '/world/abc', '/@youkan/chillwa']) {
            expect(skewAction(path, SERVER, null)).toBe('reload');
        }
    });

    it('作業中の画面（インスタンス・ワールドの新規作成と編集・ログイン・CLI の承認）は知らせるだけ', () => {
        for (const path of ['/instance/abc', '/worlds/new', '/world/abc/edit', '/auth', '/cli/authorize']) {
            expect(skewAction(path, SERVER, null)).toBe('prompt');
        }
    });

    it('知らない画面（今後増える画面）は、消えて困らないと分かるまで知らせるだけ', () => {
        expect(skewAction('/something/new', SERVER, null)).toBe('prompt');
        expect(skewAction('/world/abc/settings', SERVER, null)).toBe('prompt');
    });

    it('同じ backend の版のために一度読み込み直したタブは、もう自動では読み込み直さない（デプロイの途中で繰り返さない）', () => {
        expect(skewAction('/', SERVER, SERVER)).toBe('prompt');
        // backend がさらに新しくなったら、もう一度だけ読み込み直してよい
        expect(skewAction('/', 'newer99', SERVER)).toBe('reload');
    });
});

describe('reloadMemory', () => {
    it('読み込み直した版を覚え、読み込み直しても（sessionStorage）思い出せる', () => {
        const data = new Map<string, string>();
        const storage = {
            getItem: (k: string) => data.get(k) ?? null,
            setItem: (k: string, v: string) => void data.set(k, v),
        };
        const memory = reloadMemory(() => storage);
        expect(memory.reloadedFor('def5678')).toBeNull();
        memory.remember('def5678');
        expect(reloadMemory(() => storage).reloadedFor('def5678')).toBe('def5678');
    });

    it('保存できない環境では「もう読み込み直した」とみなし、自動の読み込み直しを繰り返さない', () => {
        const broken = () => {
            throw new DOMException('denied', 'SecurityError');
        };
        const memory = reloadMemory(broken);
        expect(() => memory.remember('def5678')).not.toThrow();
        expect(skewAction('/', 'def5678', memory.reloadedFor('def5678'))).toBe('prompt');
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
