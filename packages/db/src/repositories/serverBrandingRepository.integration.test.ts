import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { serverBranding, serverImages, users } from '../schema';
import { serverBrandingRepository } from './serverBrandingRepository';
import { userRepository } from './userRepository';
import { userSettingsRepository } from './userSettingsRepository';

/** サーバーのブランディングと、検索に出してよい人の一覧の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;

const ICON_VARIANTS = ['favicon', 'apple-touch-icon', 'icon-192', 'icon-512'] as const;

const image = (variant: string, hash: string) => ({
    variant,
    hash,
    contentType: 'image/png',
    bytes: Uint8Array.from([1, 2, 3, hash.length]),
    width: 32,
    height: 32,
});

const iconSet = (tag: string) => ICON_VARIANTS.map((variant) => image(variant, `${tag}-${variant}`));

describe.skipIf(!RUN)('serverBrandingRepository (DB統合)', () => {
    afterAll(async () => {
        await db.delete(serverBranding);
        await db.delete(serverImages);
    });

    it('略称と色は 1 行のまま置き換わり、2 行目は置けない', async () => {
        await db.delete(serverBranding);
        expect(await serverBrandingRepository.get()).toBeNull();
        await serverBrandingRepository.put({ shortName: 'ゆ', themeColor: '#1b2a44' });
        await Promise.all([
            serverBrandingRepository.put({ shortName: null, themeColor: '#2f6f4f' }),
            serverBrandingRepository.put({ shortName: null, themeColor: '#2f6f4f' }),
        ]);
        expect(await serverBrandingRepository.get()).toEqual({ shortName: null, themeColor: '#2f6f4f' });
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(serverBranding);
        expect(count).toBe(1);
        await expect(db.insert(serverBranding).values({ id: 'other' })).rejects.toThrow();
    });

    it('同じ種類の画像はまとめて入れ替わり、前のハッシュでは読めず、ほかの種類は残る', async () => {
        await db.delete(serverImages);
        await serverBrandingRepository.replaceImages('banner', [image('banner', 'b1')]);
        await serverBrandingRepository.replaceImages('icon', iconSet('one'));
        await serverBrandingRepository.replaceImages('icon', iconSet('two'));

        const listed = await serverBrandingRepository.images();
        expect(listed).toHaveLength(5);
        expect(listed.filter((row) => row.hash.startsWith('two-'))).toHaveLength(4);
        expect(await serverBrandingRepository.image('favicon', 'one-favicon')).toBeUndefined();
        expect(await serverBrandingRepository.image('favicon', 'two-favicon')).toMatchObject({
            contentType: 'image/png',
            bytes: Buffer.from([1, 2, 3, 'two-favicon'.length]),
        });
        // 種類を取り違えたハッシュでは返さない
        expect(await serverBrandingRepository.image('icon-512', 'two-favicon')).toBeUndefined();
        expect(await serverBrandingRepository.image('banner', 'b1')).toBeDefined();
    });

    it('同時に入れ替えても、アイコンの組が 2 つの画像で混ざらない', async () => {
        await db.delete(serverImages);
        await Promise.all(
            ['a', 'b', 'c', 'd'].map((tag) => serverBrandingRepository.replaceImages('icon', iconSet(tag))),
        );
        const tags = new Set((await serverBrandingRepository.images()).map((row) => row.hash.split('-')[0]));
        expect(tags.size).toBe(1);
        expect(await serverBrandingRepository.images()).toHaveLength(4);
    });

    it('消すと、消したものがあったかを返す（ほかの種類は消さない）', async () => {
        await db.delete(serverImages);
        await serverBrandingRepository.replaceImages('icon', iconSet('x'));
        await serverBrandingRepository.replaceImages('banner', [image('banner', 'b2')]);
        expect(await serverBrandingRepository.removeImages('icon')).toBe(true);
        expect(await serverBrandingRepository.removeImages('icon')).toBe(false);
        expect((await serverBrandingRepository.images()).map((row) => row.variant)).toEqual(['banner']);
    });

    it('知らない種類（kind）は入れられない', async () => {
        await expect(
            db.insert(serverImages).values({ ...image('x', 'h'), kind: 'avatar', bytes: Buffer.from([1]) }),
        ).rejects.toThrow();
    });
});

describe.skipIf(!RUN)('検索に出してよい人（DB統合）', () => {
    const stamp = Date.now().toString(36);
    // ほかのテストが作ったユーザーより前に並ぶよう、0 で始める（ID の順に並ぶ）
    const handles = { open: `0sm_a_${stamp}`, noRow: `0sm_b_${stamp}`, hidden: `0sm_c_${stamp}` };
    const idOf = (handle: string) => `id-${handle}`;

    beforeAll(async () => {
        for (const handle of Object.values(handles)) {
            await userRepository.create({ id: idOf(handle), name: handle, email: `${handle}@example.com`, handle });
        }
        await userSettingsRepository.updateFediverse(idOf(handles.open), { discoverable: true });
        await userSettingsRepository.updateFediverse(idOf(handles.hidden), { discoverable: false });
    });

    afterAll(async () => {
        await db.delete(users).where(inArray(users.handle, Object.values(handles)));
    });

    it('「検索に出す」をオフにした人は出さず、設定の行が無い人は出す。ID の順', async () => {
        const listed = await userRepository.listDiscoverableHandles(10_000);
        expect(listed).toContain(handles.open);
        expect(listed).toContain(handles.noRow);
        expect(listed).not.toContain(handles.hidden);
        expect(listed).not.toContain('system');
        expect(listed.indexOf(handles.open)).toBeLessThan(listed.indexOf(handles.noRow));
    });

    it('上限の数までしか返さない', async () => {
        expect(await userRepository.listDiscoverableHandles(1)).toEqual([handles.open]);
    });

    it('プロフィールにも「検索に出す」が付く（設定の行が無ければオン）', async () => {
        expect((await userRepository.findProfileByHandle(handles.open))?.discoverable).toBe(true);
        expect((await userRepository.findProfileByHandle(handles.noRow))?.discoverable).toBe(true);
        expect((await userRepository.findProfileById(idOf(handles.hidden)))?.discoverable).toBe(false);
    });
});
