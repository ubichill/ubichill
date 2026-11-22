import { DEFAULT_STORAGE_SETTINGS, type StorageSettings } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createStorage, type StorageDeps } from './storage';

const MB = 1024 * 1024;
const hash = (c: string) => c.repeat(43);

function setup(assets: Awaited<ReturnType<StorageDeps['worldAssets']['listByOwner']>> = []) {
    const saved = new Map<string, StorageSettings>();
    const quota = { bytes: 200 * MB };
    const storage = createStorage({
        worldAssets: { listByOwner: async (ownerId) => (ownerId === 'alice' ? assets : []) },
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
    return { storage, saved, quota };
}

describe('createStorage', () => {
    it('画像の一覧（使っているワールド付き）と合計・容量・自動で消すか（初期値はオン）を返す', async () => {
        const { storage, quota } = setup([
            {
                hash: hash('a'),
                width: 1280,
                height: 720,
                byteSize: 3 * MB,
                createdAt: new Date('2026-11-20T00:00:00Z'),
                usedBy: [{ worldId: 'w1', worldName: 'forest' }],
            },
            {
                hash: hash('b'),
                width: 64,
                height: 64,
                byteSize: 512,
                createdAt: new Date('2026-11-19T00:00:00Z'),
                usedBy: [],
            },
        ]);
        quota.bytes = 1024 * MB;
        expect(await storage.overview('alice')).toEqual({
            autoCleanup: true,
            usage: { bytes: 3 * MB + 512, count: 2 },
            quotaBytes: 1024 * MB,
            files: [
                {
                    kind: 'world-image',
                    id: hash('a'),
                    url: `https://ubi.example/api/v1/assets/${hash('a')}.webp`,
                    bytes: 3 * MB,
                    width: 1280,
                    height: 720,
                    createdAt: '2026-11-20T00:00:00.000Z',
                    usedBy: [{ worldId: 'w1', worldName: 'forest' }],
                },
                expect.objectContaining({ id: hash('b'), bytes: 512, usedBy: [] }),
            ],
        });
    });

    it('何も上げていなければ 0 で、容量は管理者の設定', async () => {
        const { storage } = setup();
        expect(await storage.overview('bob')).toEqual({
            autoCleanup: true,
            usage: { bytes: 0, count: 0 },
            quotaBytes: 200 * MB,
            files: [],
        });
    });

    it('自動で消すかを変える。形の違う入力は 400 で何も変えない', async () => {
        const { storage, saved } = setup();
        expect(await storage.updateSettings('alice', { autoCleanup: false })).toEqual({
            ok: true,
            value: { autoCleanup: false },
        });
        expect((await storage.overview('alice')).autoCleanup).toBe(false);
        for (const body of [{ autoCleanup: 'false' }, {}, null, { autoCleanup: false, extra: 1 }]) {
            expect(await storage.updateSettings('bob', body)).toEqual({
                ok: false,
                status: 400,
                error: 'autoCleanup は true か false です',
            });
        }
        expect(saved.has('bob')).toBe(false);
    });
});
