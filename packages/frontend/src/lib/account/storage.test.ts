import type { StorageOverview, StoredFile } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { chunksOf, deleteConfirmation, usageRatio, usageTone, withoutFiles, withPage } from './storage';

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
