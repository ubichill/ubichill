import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profileImageRepository } from './profileImageRepository';
import { userRepository } from './userRepository';

/** プロフィールの項目と画像の置き場所の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const ids = { a: `prof-a-${stamp}`, b: `prof-b-${stamp}` };

const blob = (hash: string, bytes: number[]) => ({
    hash,
    contentType: 'image/webp',
    bytes: Uint8Array.from(bytes),
    width: 512,
    height: 512,
});

describe.skipIf(!RUN)('userRepository のプロフィール / profileImageRepository（DB統合）', () => {
    beforeAll(async () => {
        for (const id of Object.values(ids)) {
            await userRepository.create({ id, name: id, email: `${id}@example.com`, handle: id.replaceAll('-', '_') });
        }
    });

    afterAll(async () => {
        for (const id of Object.values(ids)) await userRepository.deleteById(id);
    });

    it('一度も編集していないユーザーは、ひとこと・バナーなし、リンク・言語は空', async () => {
        expect(await userRepository.findProfileById(ids.b)).toMatchObject({
            id: ids.b,
            status: null,
            bannerImage: null,
            links: [],
            languages: [],
        });
        expect(await userRepository.findProfileByHandle(ids.b.replaceAll('-', '_'))).toMatchObject({ id: ids.b });
        expect(await userRepository.findProfileById('missing')).toBeUndefined();
    });

    it('プロフィールの項目を置き換え（2 回目は上書き）、jsonb の配列として読み戻せる。自己紹介は users に入る', async () => {
        await userRepository.setProfile(ids.a, {
            status: 'x',
            bio: 'x',
            links: ['https://x.example/'],
            languages: ['en'],
        });
        const updated = await userRepository.setProfile(ids.a, {
            status: '制作中',
            bio: 'よろしく',
            links: ['https://github.com/a'],
            languages: ['ja', 'en'],
        });
        expect(updated).toMatchObject({
            status: '制作中',
            bio: 'よろしく',
            links: ['https://github.com/a'],
            languages: ['ja', 'en'],
        });
        expect((await userRepository.findById(ids.a))?.bio).toBe('よろしく');
        expect((await userRepository.findProfileById(ids.b))?.links).toEqual([]);
    });

    it('いないユーザーのプロフィールは作らない', async () => {
        expect(
            await userRepository.setProfile('missing', { status: null, bio: null, links: [], languages: [] }),
        ).toBeUndefined();
    });

    it('アイコンとバナーの URL を別々に変え・外せる（プロフィールの項目は消えない）', async () => {
        await userRepository.setProfileImageUrl(ids.a, 'avatar', 'https://x/avatar.webp');
        await userRepository.setProfileImageUrl(ids.a, 'banner', 'https://x/banner.webp');
        expect(await userRepository.findProfileById(ids.a)).toMatchObject({
            image: 'https://x/avatar.webp',
            bannerImage: 'https://x/banner.webp',
            status: '制作中',
        });
        await userRepository.setProfileImageUrl(ids.a, 'avatar', null);
        expect(await userRepository.findProfileById(ids.a)).toMatchObject({
            image: null,
            bannerImage: 'https://x/banner.webp',
        });
        // まだ編集していないユーザーにもバナーだけを付けられる
        expect(await userRepository.setProfileImageUrl(ids.b, 'banner', 'https://x/b.webp')).toMatchObject({
            bannerImage: 'https://x/b.webp',
            links: [],
        });
        expect(await userRepository.setProfileImageUrl('missing', 'banner', null)).toBeUndefined();
    });

    it('画像は置き換えると前のハッシュでは取れず、中身はバイト列のまま戻る', async () => {
        await profileImageRepository.put(ids.a, 'avatar', blob('h1', [1, 2, 3]));
        await profileImageRepository.put(ids.a, 'avatar', blob('h2', [4, 5, 0, 255]));
        expect(await profileImageRepository.get(ids.a, 'avatar', 'h1')).toBeUndefined();
        const current = await profileImageRepository.get(ids.a, 'avatar', 'h2');
        expect(current && [...current.bytes]).toEqual([4, 5, 0, 255]);
        expect(current).toMatchObject({ contentType: 'image/webp', width: 512, height: 512 });
        // ほかの人・ほかの種類では取れない
        expect(await profileImageRepository.get(ids.b, 'avatar', 'h2')).toBeUndefined();
        expect(await profileImageRepository.get(ids.a, 'banner', 'h2')).toBeUndefined();
    });

    it('Uint8Array の一部（ほかのバッファの切り出し）でも、その範囲だけを保存する', async () => {
        const backing = Uint8Array.from([9, 9, 7, 8, 9, 9]);
        await profileImageRepository.put(ids.b, 'banner', { ...blob('h3', []), bytes: backing.subarray(2, 4) });
        const stored = await profileImageRepository.get(ids.b, 'banner', 'h3');
        expect(stored && [...stored.bytes]).toEqual([7, 8]);
    });

    it('消すと取れなくなり、無いものを消しても失敗しない', async () => {
        expect(await profileImageRepository.remove(ids.a, 'avatar')).toBe(true);
        expect(await profileImageRepository.get(ids.a, 'avatar', 'h2')).toBeUndefined();
        expect(await profileImageRepository.remove(ids.a, 'avatar')).toBe(false);
    });
});
