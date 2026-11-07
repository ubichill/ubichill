import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userRepository } from './userRepository';
import { userSettingsRepository } from './userSettingsRepository';

/**
 * ホームの設定と、ユーザーごとのロックの DB 統合テスト。DATABASE_URL がある時だけ走る。
 */

const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const ids = { a: `home-a-${stamp}`, b: `home-b-${stamp}` };
const URL_A = 'https://ubichill.example/api/v1/worlds/cafe';

describe.skipIf(!RUN)('userSettingsRepository: ホーム (DB統合)', () => {
    beforeAll(async () => {
        for (const id of Object.values(ids)) {
            await userRepository.create({ id, name: id, email: `${id}@example.com`, handle: id.replaceAll('-', '_') });
        }
    });

    afterAll(async () => {
        for (const id of Object.values(ids)) await userRepository.deleteById(id);
    });

    it('設定の行が無ければ既定（ワールド未設定・招待のみ）', async () => {
        expect(await userSettingsRepository.getHome(ids.a)).toEqual({ worldRef: null, accessType: 'invite_only' });
    });

    it('お気に入りの公開範囲を先に作った行でも、ホームの列は既定から始まる', async () => {
        await userSettingsRepository.setFavoritesVisibility(ids.b, 'public');
        expect(await userSettingsRepository.getHome(ids.b)).toEqual({ worldRef: null, accessType: 'invite_only' });
    });

    it('置き換えて読み戻せ、null で既定に戻せる。ほかの設定は消さない', async () => {
        await userSettingsRepository.setHome(ids.b, { worldRef: URL_A, accessType: 'friend_plus' });
        expect(await userSettingsRepository.getHome(ids.b)).toEqual({ worldRef: URL_A, accessType: 'friend_plus' });
        await userSettingsRepository.setHome(ids.b, { worldRef: null, accessType: 'public' });
        expect(await userSettingsRepository.getHome(ids.b)).toEqual({ worldRef: null, accessType: 'public' });
        expect(await userSettingsRepository.getFavoritesVisibility(ids.b)).toBe('public');
    });

    it('同じユーザーのロックは 1 つずつ、別のユーザーは待たない', async () => {
        const order: string[] = [];
        const slow = (label: string, ms: number) => async () => {
            order.push(`${label}:start`);
            await new Promise((resolve) => setTimeout(resolve, ms));
            order.push(`${label}:end`);
            return label;
        };
        const results = await Promise.all([
            userSettingsRepository.withHomeLock(ids.a, slow('a1', 150)),
            userSettingsRepository.withHomeLock(ids.a, slow('a2', 10)),
        ]);
        expect(results).toEqual(['a1', 'a2']);
        // 片方が終わるまでもう片方は始まらない
        expect(
            order.indexOf('a2:start') > order.indexOf('a1:end') || order.indexOf('a1:start') > order.indexOf('a2:end'),
        ).toBe(true);

        const other: string[] = [];
        await Promise.all([
            userSettingsRepository.withHomeLock(ids.a, async () => {
                other.push('a:start');
                await new Promise((resolve) => setTimeout(resolve, 150));
                other.push('a:end');
            }),
            userSettingsRepository.withHomeLock(ids.b, async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
                other.push('b:done');
            }),
        ]);
        expect(other.indexOf('b:done')).toBeLessThan(other.indexOf('a:end'));
    });

    it('中で例外が起きてもロックを放す（次の呼び出しが詰まらない）', async () => {
        await expect(
            userSettingsRepository.withHomeLock(ids.a, async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');
        expect(await userSettingsRepository.withHomeLock(ids.a, async () => 'ok')).toBe('ok');
    });
});
