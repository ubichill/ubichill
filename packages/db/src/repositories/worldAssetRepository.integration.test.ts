import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { users } from '../schema';
import { userRepository } from './userRepository';
import { worldAssetRepository } from './worldAssetRepository';

/** ワールドの画像の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const alice = `wa-${stamp}-alice`;
const bob = `wa-${stamp}-bob`;

const image = (hash: string, size = 10) => ({ hash, bytes: new Uint8Array(size).fill(7), width: 4, height: 3 });

describe.skipIf(!RUN)('worldAssetRepository (DB統合)', () => {
    beforeAll(async () => {
        for (const [id, handle] of [
            [alice, `wa_${stamp}_a`],
            [bob, `wa_${stamp}_b`],
        ]) {
            await userRepository.create({ id, name: id, email: `${id}@example.com`, handle, emailVerified: true });
        }
    });
    afterAll(async () => {
        // 持ち主を消すと画像も消える（cascade）
        await db.delete(users).where(like(users.id, `wa-${stamp}%`));
    });

    it('足す・同じ画像は数えない・中身はハッシュで引ける', async () => {
        const quota = { count: 5, bytes: 1000 };
        expect(await worldAssetRepository.add(alice, image(`${stamp}-1`), quota)).toBe('added');
        expect(await worldAssetRepository.add(alice, image(`${stamp}-1`), quota)).toBe('exists');
        expect(await worldAssetRepository.add(bob, image(`${stamp}-1`), quota)).toBe('added');
        expect(await worldAssetRepository.findByHash(`${stamp}-1`)).toMatchObject({ width: 4, height: 3 });
        expect((await worldAssetRepository.findByHash(`${stamp}-1`))?.bytes).toEqual(new Uint8Array(10).fill(7));
        expect(await worldAssetRepository.listByOwner(alice)).toHaveLength(1);
    });

    it('同時に上げても上限を越えない', async () => {
        const quota = { count: 3, bytes: 10_000 };
        const outcomes = await Promise.all(
            Array.from({ length: 6 }, (_, n) => worldAssetRepository.add(bob, image(`${stamp}-c${n}`), quota)),
        );
        // bob は前の試験で 1 枚持っているので、足せるのは 2 枚
        expect(outcomes.filter((o) => o === 'added')).toHaveLength(2);
        expect(outcomes.filter((o) => o === 'over-quota')).toHaveLength(4);
        expect(await worldAssetRepository.add(bob, image(`${stamp}-big`, 20_000), { count: 100, bytes: 10_000 })).toBe(
            'over-quota',
        );
    });

    it('消せるのは自分の分だけで、ほかの人が上げた同じ画像は残る', async () => {
        expect(await worldAssetRepository.remove(alice, `${stamp}-1`)).toBe(true);
        expect(await worldAssetRepository.remove(alice, `${stamp}-1`)).toBe(false);
        expect(await worldAssetRepository.findByHash(`${stamp}-1`)).toBeDefined();
    });
});
