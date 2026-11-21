import { WORLD_ASSET_QUOTA } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { JobGateFullError } from '../../utils/jobGate';
import type { ProcessImageResult } from '../profiles/images/processImage';
import { createWorldAssets, type WorldAssetBlob, type WorldAssetDeps } from './worldAssets';

const HASH = 'a'.repeat(43);

function setup(process: WorldAssetDeps['process'] = async () => processed(HASH)) {
    const rows = new Map<string, WorldAssetBlob & { ownerId: string; createdAt: Date }>();
    const key = (ownerId: string, hash: string) => `${ownerId}:${hash}`;
    const service = createWorldAssets({
        repository: {
            add: async (ownerId, image, quota) => {
                if (rows.has(key(ownerId, image.hash))) return 'exists';
                const own = [...rows.values()].filter((row) => row.ownerId === ownerId);
                if (own.length + 1 > quota.count) return 'over-quota';
                rows.set(key(ownerId, image.hash), { ...image, ownerId, createdAt: new Date('2026-11-21T00:00:00Z') });
                return 'added';
            },
            find: async (ownerId, hash) => {
                const row = rows.get(key(ownerId, hash));
                return row && { ...row, byteSize: row.bytes.byteLength };
            },
            findByHash: async (hash) => [...rows.values()].find((row) => row.hash === hash),
            listByOwner: async (ownerId) =>
                [...rows.values()]
                    .filter((row) => row.ownerId === ownerId)
                    .map((row) => ({ ...row, byteSize: row.bytes.byteLength })),
            remove: async (ownerId, hash) => rows.delete(key(ownerId, hash)),
        },
        process,
        publicBaseUrl: 'https://ubi.example',
    });
    return { service, rows };
}

const processed = (hash: string): ProcessImageResult => ({
    ok: true,
    image: { hash, contentType: 'image/webp', bytes: new Uint8Array(100), width: 800, height: 600 },
});

describe('createWorldAssets', () => {
    it('作り直した画像を置き、ハッシュ入りの URL を返す。長い辺を縮める指定で作り直す', async () => {
        const targets: unknown[] = [];
        const { service } = setup(async (_input, target) => {
            targets.push(target);
            return processed(HASH);
        });
        const outcome = await service.upload('alice', new Uint8Array([1, 2, 3]));
        expect(outcome).toEqual({
            ok: true,
            value: {
                hash: HASH,
                url: `https://ubi.example/api/v1/assets/${HASH}.webp`,
                width: 800,
                height: 600,
                bytes: 100,
                createdAt: '2026-11-21T00:00:00.000Z',
            },
        });
        expect(targets).toEqual([{ width: 2048, height: 2048, fit: 'inside' }]);
        // 同じ画像を上げ直しても増えない
        await service.upload('alice', new Uint8Array([1, 2, 3]));
        expect((await service.list('alice')).usage).toEqual({ count: 1, bytes: 100 });
    });

    it('画像として受け付けられないものは理由を返す', async () => {
        const { service } = setup(async () => ({ ok: false, code: 'unsupported', message: '形式が違います' }));
        expect(await service.upload('alice', new Uint8Array([1]))).toEqual({
            ok: false,
            status: 415,
            code: 'unsupported',
            error: '形式が違います',
        });
    });

    it('混んでいれば 503、上限を越えれば 409', async () => {
        const busy = setup(async () => {
            throw new JobGateFullError();
        });
        expect(await busy.service.upload('alice', new Uint8Array([1]))).toMatchObject({ status: 503, code: 'busy' });

        const counter = { n: 0 };
        const full = setup(async () => processed(String(counter.n++).padStart(43, 'x')));
        for (const _ of Array.from({ length: WORLD_ASSET_QUOTA.count })) {
            expect((await full.service.upload('alice', new Uint8Array([1]))).ok).toBe(true);
        }
        expect(await full.service.upload('alice', new Uint8Array([1]))).toMatchObject({
            ok: false,
            status: 409,
            code: 'quota-exceeded',
        });
        // ほかの人の分は別に数える
        expect((await full.service.upload('bob', new Uint8Array([1]))).ok).toBe(true);
    });

    it('消せるのは自分が上げた画像だけ', async () => {
        const { service } = setup();
        await service.upload('alice', new Uint8Array([1]));
        expect(await service.remove('bob', HASH)).toMatchObject({ ok: false, status: 404 });
        expect(await service.remove('alice', HASH)).toEqual({ ok: true, value: null });
        expect(await service.image(HASH)).toBeUndefined();
    });
});
