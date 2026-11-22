import type { StorageOverview, StoredFile } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { deleteConfirmation, usageRatio, usageTone, withoutFile } from './storage';

const MB = 1024 * 1024;

const file = (id: string, bytes: number, worlds: string[] = []): StoredFile => ({
    kind: 'world-image',
    id,
    url: `https://ubi.example/api/v1/assets/${id}.webp`,
    bytes,
    width: 10,
    height: 10,
    createdAt: '2026-11-22T00:00:00.000Z',
    usedBy: worlds.map((worldName, n) => ({ worldId: `w${n}`, worldName })),
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
    it('自分のワールドで使っていなければ確かめない', () => {
        expect(deleteConfirmation(file('a', 1))).toBeNull();
    });

    it('使っているワールドの名前を出す。4 つ以上はほかの数にまとめる', () => {
        expect(deleteConfirmation(file('a', 1, ['森の家']))).toBe(
            '「森の家」で使っています。消すと、そのワールドでこの画像が出なくなります。消しますか？',
        );
        expect(deleteConfirmation(file('a', 1, ['a', 'b', 'c', 'd', 'e']))).toBe(
            '「a」「b」「c」ほか 2 個のワールドで使っています。消すと、そのワールドでこの画像が出なくなります。消しますか？',
        );
    });
});

describe('withoutFile', () => {
    const overview: StorageOverview = {
        autoCleanup: true,
        usage: { bytes: 3 * MB, count: 2 },
        quotaBytes: 200 * MB,
        files: [file('a', MB), file('b', 2 * MB)],
    };

    it('消した分だけ量と数を減らす', () => {
        expect(withoutFile(overview, file('a', MB))).toMatchObject({
            usage: { bytes: 2 * MB, count: 1 },
            files: [expect.objectContaining({ id: 'b' })],
        });
    });

    it('一覧に無いもの（2 回押した・ほかの端末で消した）は何も変えない', () => {
        const once = withoutFile(overview, file('a', MB));
        expect(withoutFile(once, file('a', MB))).toBe(once);
    });
});
