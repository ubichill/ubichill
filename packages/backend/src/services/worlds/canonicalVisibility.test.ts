import { describe, expect, it, vi } from 'vitest';
import { type CanonicalVisibilityDeps, createCanonicalVisibility } from './canonicalVisibility';

const URL = 'https://author.example/api/v1/authors/aya/worlds/garden.yaml';

function setup(overrides: Partial<CanonicalVisibilityDeps> = {}) {
    const clock = { t: 0 };
    const head = vi.fn<CanonicalVisibilityDeps['head']>(async () => ({ status: 200, visibility: 'private' }));
    const tryAcquire = vi.fn(() => true);
    const canonical = createCanonicalVisibility({
        head,
        tryAcquire,
        ttlMs: 1000,
        max: 10,
        now: () => clock.t,
        ...overrides,
    });
    return { canonical, head, tryAcquire, clock };
}

describe('createCanonicalVisibility', () => {
    it('ヘッダーのとおり。無い・知らない値はパブリック', async () => {
        const { canonical, head } = setup();
        expect(await canonical.of(URL, 'author.example')).toBe('private');
        head.mockResolvedValue({ status: 200, visibility: undefined });
        expect(await canonical.of(`${URL}?2`, 'author.example')).toBe('public');
    });

    it('404・410 はパブリック（消した・名前を変えた）', async () => {
        const { canonical, head } = setup();
        head.mockResolvedValue({ status: 404, visibility: undefined });
        expect(await canonical.of(URL, 'author.example')).toBe('public');
        head.mockResolvedValue({ status: 410, visibility: undefined });
        expect(await canonical.of(`${URL}?2`, 'author.example')).toBe('public');
    });

    it('429・5xx・通信の失敗・ドメインの上限で、前の結果が無ければ unknown（パブリックにしない）', async () => {
        for (const failing of [
            { head: vi.fn(async () => ({ status: 429, visibility: undefined })) },
            { head: vi.fn(async () => ({ status: 503, visibility: undefined })) },
            { head: vi.fn(async () => Promise.reject(new Error('timeout'))) },
            { tryAcquire: () => false },
        ] as Array<Partial<CanonicalVisibilityDeps>>) {
            expect(await setup(failing).canonical.of(URL, 'author.example')).toBe('unknown');
        }
    });

    it('決められない間、前の private は期限を過ぎても使う（閉じる側）', async () => {
        const { canonical, head, clock } = setup();
        expect(await canonical.of(URL, 'author.example')).toBe('private');
        head.mockRejectedValue(new Error('down'));
        clock.t = 5000;
        expect(await canonical.of(URL, 'author.example')).toBe('private');
    });

    it('期限を過ぎた public は、決められなければ使わない（上限を使い切らせても、古い public で開かない）', async () => {
        const allow = { ok: true };
        const { canonical, head, clock } = setup({ tryAcquire: () => allow.ok });
        head.mockResolvedValue({ status: 200, visibility: 'public' });
        expect(await canonical.of(URL, 'author.example')).toBe('public');
        clock.t = 999;
        expect(await canonical.of(URL, 'author.example')).toBe('public');
        allow.ok = false;
        clock.t = 1000;
        expect(await canonical.of(URL, 'author.example')).toBe('unknown');
        allow.ok = true;
        head.mockRejectedValue(new Error('429'));
        expect(await canonical.of(URL, 'author.example')).toBe('unknown');
    });

    it('期限の内は問い合わせず、同時の問い合わせは 1 回にまとめ、期限を過ぎたら取り直す', async () => {
        const { canonical, head, clock } = setup();
        await Promise.all([canonical.of(URL, 'author.example'), canonical.of(URL, 'author.example')]);
        await canonical.of(URL, 'author.example');
        expect(head).toHaveBeenCalledTimes(1);
        head.mockResolvedValue({ status: 200, visibility: 'public' });
        clock.t = 1000;
        expect(await canonical.of(URL, 'author.example')).toBe('public');
        expect(head).toHaveBeenCalledTimes(2);
    });
});
