import { describe, expect, it } from 'vitest';
import { JobGateFullError } from '../../utils/jobGate';
import type { ProcessImageResult } from '../profiles/images/processImage';
import { createWorldAssets, type WorldAssetBlob, type WorldAssetDeps } from './worldAssets';

const HASH = 'a'.repeat(43);
const MB = 1024 * 1024;

function setup(
    process: WorldAssetDeps['process'] = async () => processed(HASH),
    quota: { bytes: number } = { bytes: 200 * MB },
) {
    const rows = new Map<string, WorldAssetBlob & { ownerId: string; createdAt: Date }>();
    const key = (ownerId: string, hash: string) => `${ownerId}:${hash}`;
    const service = createWorldAssets({
        repository: {
            add: async (ownerId, image, quotaBytes) => {
                if (rows.has(key(ownerId, image.hash))) return { status: 'exists' };
                const usedBytes = [...rows.values()]
                    .filter((row) => row.ownerId === ownerId)
                    .reduce((sum, row) => sum + row.bytes.byteLength, 0);
                if (usedBytes + image.bytes.byteLength > quotaBytes) return { status: 'over-quota', usedBytes };
                rows.set(key(ownerId, image.hash), { ...image, ownerId, createdAt: new Date('2026-11-21T00:00:00Z') });
                return { status: 'added' };
            },
            find: async (ownerId, hash) => {
                const row = rows.get(key(ownerId, hash));
                return row && { ...row, byteSize: row.bytes.byteLength };
            },
            findByHash: async (hash) => [...rows.values()].find((row) => row.hash === hash),
            remove: async (ownerId, hash) => rows.delete(key(ownerId, hash)),
        },
        process,
        // 管理者がいつ変えても、次のアップロードから効く
        quotaBytes: async () => quota.bytes,
        publicBaseUrl: 'https://ubi.example',
    });
    return { service, rows };
}

const processed = (hash: string, size = 100): ProcessImageResult => ({
    ok: true,
    image: { hash, contentType: 'image/webp', bytes: new Uint8Array(size), width: 800, height: 600 },
});

describe('createWorldAssets', () => {
    it('作り直した画像を置き、ハッシュ入りの URL を返す。長い辺を縮める指定で作り直す', async () => {
        const targets: unknown[] = [];
        const { service, rows } = setup(async (_input, target) => {
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
        expect(rows.size).toBe(1);
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

    it('混んでいれば 503', async () => {
        const busy = setup(async () => {
            throw new JobGateFullError();
        });
        expect(await busy.service.upload('alice', new Uint8Array([1]))).toMatchObject({ status: 503, code: 'busy' });
    });

    it('合計が容量を越えるなら 409 で、容量・今の合計・この画像の大きさを伝える。数は数えない', async () => {
        const quota = { bytes: 3 * MB };
        const counter = { n: 0 };
        const full = setup(async () => processed(String(counter.n++).padStart(43, 'x'), MB), quota);
        for (const _ of Array.from({ length: 3 })) {
            expect((await full.service.upload('alice', new Uint8Array([1]))).ok).toBe(true);
        }
        expect(await full.service.upload('alice', new Uint8Array([1]))).toEqual({
            ok: false,
            status: 409,
            code: 'quota-exceeded',
            error: '画像は 1 人 3 MB まで置けます。今 3 MB 使っていて、この画像（1 MB）は入りません。設定の「ストレージ」で使っていない画像を消してから試してください',
        });
        // ほかの人の分は別に数える
        expect((await full.service.upload('bob', new Uint8Array([1]))).ok).toBe(true);
        // 管理者が容量を上げれば、次から置ける
        quota.bytes = 1024 * MB;
        expect((await full.service.upload('alice', new Uint8Array([1]))).ok).toBe(true);

        // 小さい画像なら 200 枚を越えても置ける
        const tiny = setup(async () => processed(String(counter.n++).padStart(43, 'y'), 1));
        for (const _ of Array.from({ length: 201 })) {
            expect((await tiny.service.upload('alice', new Uint8Array([1]))).ok).toBe(true);
        }
    });

    it('容量を下げて今の合計が越えていても、置いてある画像はそのまま。同じ画像の上げ直しは数えない', async () => {
        const quota = { bytes: 10 * MB };
        const { service, rows } = setup(async () => processed(HASH, 2 * MB), quota);
        expect((await service.upload('alice', new Uint8Array([1]))).ok).toBe(true);
        quota.bytes = MB;
        expect(rows.size).toBe(1);
        expect((await service.upload('alice', new Uint8Array([1]))).ok).toBe(true);
    });

    it('消せるのは自分が上げた画像だけ', async () => {
        const { service } = setup();
        await service.upload('alice', new Uint8Array([1]));
        expect(await service.remove('bob', HASH)).toMatchObject({ ok: false, status: 404 });
        expect(await service.remove('alice', HASH)).toEqual({ ok: true, value: null });
        expect(await service.image(HASH)).toBeUndefined();
    });
});
