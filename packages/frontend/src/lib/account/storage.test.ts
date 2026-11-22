import type { StorageOverview, StoredFile } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    autoLoads,
    chunksOf,
    deleteConfirmation,
    deleteInChunks,
    INITIAL_MORE_LOAD,
    type MoreLoadState,
    moreLoadAfter,
    usageRatio,
    usageTone,
    withoutFiles,
    withPage,
} from './storage';

const MB = 1024 * 1024;

const file = (id: string, bytes: number, worlds: Array<[string, string]> = []): StoredFile => ({
    kind: 'world-image',
    id,
    url: `https://ubi.example/api/v1/assets/${id}.webp`,
    bytes,
    width: 10,
    height: 10,
    createdAt: '2026-11-22T00:00:00.000Z',
    usedBy: worlds.map(([worldId, worldName]) => ({ worldId, worldName })),
});

const overview = (files: StoredFile[], count = files.length): StorageOverview => ({
    autoCleanup: true,
    usage: { bytes: files.reduce((sum, f) => sum + f.bytes, 0), count },
    quotaBytes: 200 * MB,
    files: { items: files, next: 'cursor-1' },
});

describe('usageRatio・usageTone', () => {
    it.each([
        [0, 200, 0, 'normal'],
        [179, 200, 0.895, 'normal'],
        [180, 200, 0.9, 'near'],
        [200, 200, 1, 'full'],
        // 管理者が容量を下げて越えたままでも、メーターは 1 で止める
        [500, 200, 1, 'full'],
    ] as const)('%d MB / %d MB は %d・%s', (used, quota, ratio, tone) => {
        expect(usageRatio({ bytes: used * MB }, quota * MB)).toBeCloseTo(ratio);
        expect(usageTone({ bytes: used * MB }, quota * MB)).toBe(tone);
    });

    it('容量が 0 でも割らない', () => {
        expect(usageRatio({ bytes: 0 }, 0)).toBe(1);
    });
});

describe('deleteConfirmation', () => {
    it('自分のワールドで使っているものが無ければ確かめない', () => {
        expect(deleteConfirmation([file('a', 1)])).toBeNull();
        expect(deleteConfirmation([file('a', 1), file('b', 1)])).toBeNull();
    });

    it('1 個: 使っているワールドの名前と、ほかの人のワールドへの一言', () => {
        expect(deleteConfirmation([file('a', 1, [['w1', '森の家']])])).toBe(
            '「森の家」で使っています。消すと、そこで画像が出なくなります（このサーバーのほかの人のワールドも同じ）。消しますか？',
        );
    });

    it('まとめて: 使っている数と、ワールドを重ねずに 3 つまで出す', () => {
        expect(
            deleteConfirmation([
                file('a', 1, [
                    ['w1', 'a'],
                    ['w2', 'b'],
                ]),
                file('b', 1, [
                    ['w2', 'b'],
                    ['w3', 'c'],
                    ['w4', 'd'],
                ]),
                file('c', 1),
            ]),
        ).toBe(
            '選んだ 3 個のうち 2 個を「a」「b」「c」ほか 1 個のワールドで使っています。消すと、そこで画像が出なくなります（このサーバーのほかの人のワールドも同じ）。消しますか？',
        );
    });
});

describe('withPage', () => {
    it('続きを後ろに足し、重なったものは足さない', () => {
        const next = withPage(overview([file('a', 1), file('b', 1)]), {
            items: [file('b', 1), file('c', 1)],
            next: null,
        });
        expect(next.files).toEqual({ items: [file('a', 1), file('b', 1), file('c', 1)], next: null });
    });
});

describe('withoutFiles', () => {
    it('消した分だけ量と数を減らす（読んでいないページの分の数は残す）', () => {
        const before = overview([file('a', MB), file('b', 2 * MB), file('c', MB)], 120);
        expect(
            withoutFiles(before, [
                { kind: 'world-image', id: 'a' },
                { kind: 'world-image', id: 'c' },
            ]),
        ).toMatchObject({
            usage: { bytes: 2 * MB, count: 118 },
            files: { items: [expect.objectContaining({ id: 'b' })], next: 'cursor-1' },
        });
    });

    it('一覧に無いもの（2 回押した・ほかの端末で消した）は何も変えない', () => {
        const once = withoutFiles(overview([file('a', MB)]), [{ kind: 'world-image', id: 'a' }]);
        expect(withoutFiles(once, [{ kind: 'world-image', id: 'a' }])).toBe(once);
    });
});

describe('chunksOf', () => {
    it('100 個ずつに分ける', () => {
        expect(chunksOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunksOf([], 100)).toEqual([]);
        expect(
            chunksOf(
                Array.from({ length: 250 }, (_, n) => n),
                100,
            ).map((c) => c.length),
        ).toEqual([100, 100, 50]);
    });
});

describe('続きの自動の読み込み', () => {
    const run = (events: Array<'start' | 'success' | 'failure'>): MoreLoadState =>
        events.reduce(moreLoadAfter, INITIAL_MORE_LOAD);

    it('初めは自動で読む。読んでいる間は読まない', () => {
        expect(autoLoads(INITIAL_MORE_LOAD, 'c1')).toBe(true);
        expect(autoLoads(run(['start']), 'c1')).toBe(false);
    });

    it('失敗したら、見えたままでも自動では読まない（押すまで繰り返さない）', () => {
        const failed = run(['start', 'failure']);
        expect(failed).toEqual({ loading: false, auto: false });
        expect(autoLoads(failed, 'c1')).toBe(false);
        // 何度「見えた」と知らされても、状態は変わらない（自動の読み込みは起きない）
        expect(autoLoads(run(['start', 'failure', 'failure']), 'c1')).toBe(false);
    });

    it('押して読み直し、成功したらまた自動で読む。もう続きが無ければ読まない', () => {
        const retried = run(['start', 'failure', 'start', 'success']);
        expect(autoLoads(retried, 'c2')).toBe(true);
        expect(autoLoads(retried, null)).toBe(false);
        expect(autoLoads(run(['start', 'failure', 'start']), 'c2')).toBe(false);
    });
});

describe('deleteInChunks', () => {
    it('100 個ずつ順に送り、全部送れたら全部を返す', async () => {
        const sent: number[][] = [];
        const files = Array.from({ length: 250 }, (_, n) => n);
        expect(
            await deleteInChunks(files, 100, async (chunk) => {
                sent.push(chunk);
            }),
        ).toEqual({ done: files, error: null });
        expect(sent.map((c) => c.length)).toEqual([100, 100, 50]);
    });

    it('途中で失敗したら、そこまでに送れた分と失敗の文を返し、残りは送らない', async () => {
        const sent: number[][] = [];
        const files = Array.from({ length: 250 }, (_, n) => n);
        const outcome = await deleteInChunks(files, 100, async (chunk) => {
            sent.push(chunk);
            if (sent.length === 2) throw new Error('画像を消す操作が多すぎます');
        });
        expect(outcome).toEqual({ done: files.slice(0, 100), error: '画像を消す操作が多すぎます' });
        expect(sent).toHaveLength(2);
    });

    it('送れた分だけ一覧と量から除ける', async () => {
        const before = overview([file('a', MB), file('b', MB)], 2);
        const { done } = await deleteInChunks(
            [
                { kind: 'world-image' as const, id: 'a' },
                { kind: 'world-image' as const, id: 'b' },
            ],
            1,
            async (chunk) => {
                if (chunk[0]?.id === 'b') throw new Error('x');
            },
        );
        expect(withoutFiles(before, done).usage).toEqual({ bytes: MB, count: 1 });
    });
});
