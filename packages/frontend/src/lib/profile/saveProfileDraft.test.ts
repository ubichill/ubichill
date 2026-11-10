import type { UserProfile } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import type { DraftChanges } from './profileDraft';
import { type ProfileSaveApi, saveProfileDraft } from './saveProfileDraft';

const profile: UserProfile = {
    id: 'u1',
    name: 'ようかん',
    handle: 'youkan',
    author: 'youkan@ubichill.example',
    image: null,
    bio: null,
    status: null,
    bannerImage: null,
    links: [],
    languages: [],
    roles: [],
};
const file = new Blob(['x'], { type: 'image/png' });
const noChanges: DraftChanges = { name: null, fields: null, images: [] };

function fakeApi(fail: Partial<Record<keyof ProfileSaveApi, string>> = {}) {
    const calls: string[] = [];
    const step =
        <A extends unknown[]>(name: keyof ProfileSaveApi, result: (...args: A) => Partial<UserProfile>) =>
        async (...args: A) => {
            calls.push(name);
            if (fail[name]) throw new Error(fail[name]);
            return { ...profile, ...result(...args) };
        };
    const api: ProfileSaveApi = {
        setDisplayName: step('setDisplayName', (name: string) => ({ name })),
        uploadImage: step('uploadImage', (kind) =>
            kind === 'avatar' ? { image: 'https://new/avatar' } : { bannerImage: 'https://new/banner' },
        ),
        deleteImage: step('deleteImage', (kind) => (kind === 'avatar' ? { image: null } : { bannerImage: null })),
        saveProfile: step('saveProfile', () => ({ status: '保存済み' })),
    };
    return { api, calls };
}

describe('saveProfileDraft', () => {
    it('変更が無ければ何も呼ばずに今のプロフィールを返す', async () => {
        const { api, calls } = fakeApi();
        expect(await saveProfileDraft(profile, noChanges, api)).toEqual({ ok: true, profile });
        expect(calls).toEqual([]);
    });

    it('表示名 → 画像 → プロフィールの項目の順に送る', async () => {
        const { api, calls } = fakeApi();
        const result = await saveProfileDraft(
            profile,
            {
                name: '新しい名前',
                fields: { status: 'x', bio: '', links: [], languages: [] },
                images: [
                    { kind: 'avatar', image: { action: 'replace', file, previewUrl: 'blob:a' } },
                    { kind: 'banner', image: { action: 'remove' } },
                ],
            },
            api,
        );
        expect(calls).toEqual(['setDisplayName', 'uploadImage', 'deleteImage', 'saveProfile']);
        expect(result.ok).toBe(true);
    });

    it('表示名が断られたら（重複・期間中）、画像もほかの項目も送らない', async () => {
        const { api, calls } = fakeApi({ setDisplayName: 'この表示名は既に使用されています' });
        const result = await saveProfileDraft(
            profile,
            {
                name: '取られた名前',
                fields: { status: 'x', bio: '', links: [], languages: [] },
                images: [{ kind: 'avatar', image: { action: 'replace', file, previewUrl: 'blob:a' } }],
            },
            api,
        );
        expect(calls).toEqual(['setDisplayName']);
        expect(result).toEqual({
            ok: false,
            profile,
            error: '表示名を保存できませんでした: この表示名は既に使用されています',
        });
    });

    it('途中で失敗したら、そこまでに保存できた内容を返す（画面の元の値をそれに合わせる）', async () => {
        const { api, calls } = fakeApi({ saveProfile: 'links.0: https の URL だけ使えます' });
        const result = await saveProfileDraft(
            profile,
            {
                name: null,
                fields: { status: 'x', bio: '', links: ['http://a'], languages: [] },
                images: [{ kind: 'avatar', image: { action: 'replace', file, previewUrl: 'blob:a' } }],
            },
            api,
        );
        expect(calls).toEqual(['uploadImage', 'saveProfile']);
        expect(result.ok).toBe(false);
        expect(result.profile.image).toBe('https://new/avatar');
        if (!result.ok) expect(result.error).toMatch(/^プロフィールを保存できませんでした/);
    });

    it('画像の送信を 1 つずつ待つ（同時に送ってサーバーの作り直しの枠を埋めない）', async () => {
        const order: string[] = [];
        const { api } = fakeApi();
        const slow = vi.fn(async (kind: 'avatar' | 'banner') => {
            order.push(`start:${kind}`);
            await new Promise((r) => setTimeout(r, 5));
            order.push(`end:${kind}`);
            return profile;
        });
        await saveProfileDraft(
            profile,
            {
                ...noChanges,
                images: [
                    { kind: 'avatar', image: { action: 'replace', file, previewUrl: 'blob:a' } },
                    { kind: 'banner', image: { action: 'replace', file, previewUrl: 'blob:b' } },
                ],
            },
            { ...api, uploadImage: slow },
        );
        expect(order).toEqual(['start:avatar', 'end:avatar', 'start:banner', 'end:banner']);
    });

    it('Error 以外で失敗しても理由を付けて返す', async () => {
        const { api } = fakeApi();
        const result = await saveProfileDraft(
            profile,
            { ...noChanges, images: [{ kind: 'banner', image: { action: 'remove' } }] },
            { ...api, deleteImage: () => Promise.reject('boom') },
        );
        expect(result).toMatchObject({ ok: false, error: 'バナーを保存できませんでした: 保存できませんでした' });
    });
});
