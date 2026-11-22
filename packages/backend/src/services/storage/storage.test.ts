import { DEFAULT_STORAGE_SETTINGS, STORED_FILE_PAGE_SIZE, type StorageSettings } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createStorage, decodeStorageCursor, encodeStorageCursor, type StorageDeps } from './storage';

const MB = 1024 * 1024;
const hash = (n: number) => `h${String(n).padStart(42, '0')}`;

type Row = Awaited<ReturnType<StorageDeps['worldAssets']['listPageByOwner']>>['rows'][number] & { ownerId: string };

/** 新しい順・同じ時刻はハッシュの逆順に並べ、続きの位置より後ろを返す（repository と同じ並び） */
function setup(rows: Row[] = []) {
    const owned = { rows: [...rows] };
    const saved = new Map<string, StorageSettings>();
    const quota = { bytes: 200 * MB };
    const micros = (row: Row) => row.createdAt.getTime() * 1000;
    const before = (row: Row, cursor: { createdAtMicros: number; hash: string }) =>
        micros(row) < cursor.createdAtMicros || (micros(row) === cursor.createdAtMicros && row.hash < cursor.hash);
    const storage = createStorage({
        worldAssets: {
            listPageByOwner: async (ownerId, page) => {
                const sorted = owned.rows
                    .filter((row) => row.ownerId === ownerId && (!page.after || before(row, page.after)))
                    .sort((a, b) => micros(b) - micros(a) || (a.hash < b.hash ? 1 : -1));
                const shown = sorted.slice(0, page.limit);
                const last = shown.at(-1);
                return {
                    rows: shown,
                    next:
                        sorted.length > page.limit && last ? { createdAtMicros: micros(last), hash: last.hash } : null,
                };
            },
            usageOf: async (ownerId) => {
                const mine = owned.rows.filter((row) => row.ownerId === ownerId);
                return { bytes: mine.reduce((sum, row) => sum + row.byteSize, 0), count: mine.length };
            },
            removeMany: async (ownerId, hashes) => {
                const removed = owned.rows.filter((row) => row.ownerId === ownerId && hashes.includes(row.hash));
                owned.rows = owned.rows.filter((row) => !removed.includes(row));
                return removed.map((row) => row.hash);
            },
        },
        settings: {
            getStorage: async (userId) => saved.get(userId) ?? DEFAULT_STORAGE_SETTINGS,
            setStorage: async (userId, settings) => {
                saved.set(userId, settings);
                return settings;
            },
        },
        quotaBytes: async () => quota.bytes,
        publicBaseUrl: 'https://ubi.example',
    });
    return { storage, saved, quota, owned };
}

const row = (n: number, overrides: Partial<Row> = {}): Row => ({
    ownerId: 'alice',
    hash: hash(n),
    width: 64,
    height: 64,
    byteSize: 1000,
    createdAt: new Date(Date.UTC(2026, 10, 1) + n * 1000),
    usedBy: [],
    ...overrides,
});

describe('createStorage', () => {
    it('最初のページ（使っているワールド付き）と、全部の合計・容量・自動で消すか（初期値はオン）を返す', async () => {
        const { storage, quota } = setup([
            row(1, { byteSize: 3 * MB, width: 1280, height: 720, usedBy: [{ worldId: 'w1', worldName: 'forest' }] }),
            row(2, { byteSize: 512 }),
        ]);
        quota.bytes = 1024 * MB;
        expect(await storage.overview('alice')).toEqual({
            autoCleanup: true,
            usage: { bytes: 3 * MB + 512, count: 2 },
            quotaBytes: 1024 * MB,
            files: {
                items: [
                    expect.objectContaining({ id: hash(2), bytes: 512, usedBy: [] }),
                    {
                        kind: 'world-image',
                        id: hash(1),
                        url: `https://ubi.example/api/v1/assets/${hash(1)}.webp`,
                        bytes: 3 * MB,
                        width: 1280,
                        height: 720,
                        createdAt: '2026-11-01T00:00:01.000Z',
                        usedBy: [{ worldId: 'w1', worldName: 'forest' }],
                    },
                ],
                next: null,
            },
        });
    });

    it('多ければページに分け、続きの位置で最後まで重ならず抜けずに読める（同じ時刻の画像も）', async () => {
        const total = STORED_FILE_PAGE_SIZE * 2 + 7;
        // 3 個ずつ同じ時刻にする
        const rows = Array.from({ length: total }, (_, n) =>
            row(n, { createdAt: new Date(Date.UTC(2026, 10, 1) + Math.floor(n / 3) * 1000) }),
        );
        const { storage } = setup(rows);
        const first = await storage.overview('alice');
        expect(first.usage.count).toBe(total);
        expect(first.files.items).toHaveLength(STORED_FILE_PAGE_SIZE);
        const readAll = async (cursor: string | null, seen: string[]): Promise<string[]> => {
            if (!cursor) return seen;
            const page = await storage.files('alice', cursor);
            if (!page.ok) throw new Error(page.error);
            return readAll(page.value.next, [...seen, ...page.value.items.map((f) => f.id)]);
        };
        const ids = await readAll(
            first.files.next,
            first.files.items.map((f) => f.id),
        );
        expect(ids).toHaveLength(total);
        expect(new Set(ids).size).toBe(total);
    });

    it('続きの位置が壊れていれば 400', async () => {
        const { storage } = setup();
        for (const cursor of [undefined, '', 'abc', '1.', `${'9'.repeat(18)}.x`, ['1.a'], '1.a/b']) {
            expect(await storage.files('alice', cursor)).toMatchObject({ ok: false, status: 400 });
        }
    });

    it('まとめて消す: 自分のものだけ消し、消せたものを返す。同じものを 2 回書いても 1 回', async () => {
        const { storage, owned } = setup([row(1), row(2), row(3, { ownerId: 'bob' })]);
        expect(
            await storage.removeFiles('alice', {
                files: [
                    { kind: 'world-image', id: hash(1) },
                    { kind: 'world-image', id: hash(1) },
                    { kind: 'world-image', id: hash(3) },
                    { kind: 'world-image', id: hash(9) },
                ],
            }),
        ).toEqual({ ok: true, value: { removed: [{ kind: 'world-image', id: hash(1) }] } });
        expect(owned.rows.map((r) => r.hash)).toEqual([hash(2), hash(3)]);
    });

    it('まとめて消す: 空・101 個・知らない種類・余計な項目は 400 で何も消さない', async () => {
        const { storage, owned } = setup([row(1)]);
        const many = Array.from({ length: 101 }, (_, n) => ({ kind: 'world-image', id: hash(n) }));
        for (const body of [
            { files: [] },
            { files: many },
            { files: [{ kind: 'video', id: hash(1) }] },
            { files: [{ kind: 'world-image', id: hash(1), owner: 'bob' }] },
            null,
        ]) {
            expect(await storage.removeFiles('alice', body)).toMatchObject({ ok: false, status: 400 });
        }
        expect(owned.rows).toHaveLength(1);
    });

    it('自動で消すかを変える。形の違う入力は 400 で何も変えない', async () => {
        const { storage, saved } = setup();
        expect(await storage.updateSettings('alice', { autoCleanup: false })).toEqual({
            ok: true,
            value: { autoCleanup: false },
        });
        expect((await storage.overview('alice')).autoCleanup).toBe(false);
        for (const body of [{ autoCleanup: 'false' }, {}, null, { autoCleanup: false, extra: 1 }]) {
            expect(await storage.updateSettings('bob', body)).toMatchObject({ ok: false, status: 400 });
        }
        expect(saved.has('bob')).toBe(false);
    });
});

describe('続きの位置', () => {
    it('マイクロ秒とハッシュを行き来できる', () => {
        const cursor = { createdAtMicros: 1795375596327123, hash: hash(1) };
        expect(decodeStorageCursor(encodeStorageCursor(cursor))).toEqual(cursor);
    });
});
