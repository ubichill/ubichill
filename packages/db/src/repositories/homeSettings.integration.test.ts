import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userRepository } from './userRepository';
import { userSettingsRepository } from './userSettingsRepository';

/**
 * ホームの設定の DB 統合テスト。DATABASE_URL がある時だけ走る。
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

    it('渡した項目だけ変えて読み戻せ、null で既定に戻せる。ほかの設定は消さない', async () => {
        expect(await userSettingsRepository.updateHome(ids.b, { worldRef: URL_A, accessType: 'friend_plus' })).toEqual({
            worldRef: URL_A,
            accessType: 'friend_plus',
        });
        expect(await userSettingsRepository.updateHome(ids.b, { accessType: 'public' })).toEqual({
            worldRef: URL_A,
            accessType: 'public',
        });
        await userSettingsRepository.updateHome(ids.b, { worldRef: null });
        expect(await userSettingsRepository.getHome(ids.b)).toEqual({ worldRef: null, accessType: 'public' });
        expect(await userSettingsRepository.getFavoritesVisibility(ids.b)).toBe('public');
    });

    it('行が無いユーザーの片方だけの変更は、もう片方を既定で作る', async () => {
        expect(await userSettingsRepository.updateHome(ids.a, { worldRef: URL_A })).toEqual({
            worldRef: URL_A,
            accessType: 'invite_only',
        });
    });
});
