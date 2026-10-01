import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { userFriends } from '../schema';
import { userFriendRepository } from './userFriendRepository';
import { userRepository } from './userRepository';
import { userSettingsRepository } from './userSettingsRepository';

/**
 * お気に入りの公開範囲とフレンド判定の DB 統合テスト。DATABASE_URL がある時だけ走る。
 */

const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const ids = { a: `vis-a-${stamp}`, b: `vis-b-${stamp}`, c: `vis-c-${stamp}` };

describe.skipIf(!RUN)('userSettingsRepository / userFriendRepository (DB統合)', () => {
    beforeAll(async () => {
        for (const id of Object.values(ids)) {
            await userRepository.create({ id, name: id, email: `${id}@example.com` });
        }
    });

    afterAll(async () => {
        for (const id of Object.values(ids)) await userRepository.deleteById(id);
    });

    it('設定の行が無いユーザーの公開範囲は private（初期値）', async () => {
        expect(await userSettingsRepository.getFavoritesVisibility(ids.a)).toBe('private');
    });

    it('公開範囲を設定でき、続けて変えても行は 1 つのまま更新される', async () => {
        await userSettingsRepository.setFavoritesVisibility(ids.a, 'public');
        expect(await userSettingsRepository.getFavoritesVisibility(ids.a)).toBe('public');
        await userSettingsRepository.setFavoritesVisibility(ids.a, 'friends');
        expect(await userSettingsRepository.getFavoritesVisibility(ids.a)).toBe('friends');
        expect(await userSettingsRepository.getFavoritesVisibility(ids.b)).toBe('private'); // 他人には影響しない
    });

    it('フレンドは承認済み（accepted）だけで、申請中・無関係・自分自身は違う。申請の向きは問わない', async () => {
        await db.insert(userFriends).values({ userId: ids.a, friendId: ids.b, status: 'pending' });
        expect(await userFriendRepository.areFriends(ids.a, ids.b)).toBe(false);

        await db.insert(userFriends).values({ userId: ids.c, friendId: ids.a, status: 'accepted' });
        expect(await userFriendRepository.areFriends(ids.a, ids.c)).toBe(true);
        expect(await userFriendRepository.areFriends(ids.c, ids.a)).toBe(true);
        expect(await userFriendRepository.areFriends(ids.b, ids.c)).toBe(false);
        expect(await userFriendRepository.areFriends(ids.a, ids.a)).toBe(false);
    });
});
