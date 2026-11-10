import type { ProfileImageKind, ProfileUpdateInput, UserProfile, WorldIdentity } from '@ubichill/shared';
import { setMyDisplayName } from '@/lib/account/me';
import { API_BASE } from '@/lib/api';
import type { ProfileSaveApi } from './saveProfileDraft';

async function errorMessage(res: Response): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
}

async function profileFrom(res: Response): Promise<UserProfile> {
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as UserProfile;
}

/** プロフィール・設定のワールド一覧の 1 件。 */
export interface OwnedWorld {
    id: string;
    displayName: string;
    description: string | null;
    thumbnail: string | null;
    version: string;
    capacity: { default: number; max: number };
    updatedAt?: string;
    /** 本人の一覧のみ。署名なしは非公開なので「署名して公開」を出す。 */
    identity?: WorldIdentity;
    /**
     * repository: リポジトリ（worlds/）で管理している公式ワールド。画面からは編集・削除できない（変更は PR で行う）。
     * external: 外部（GitHub Pages など）に置いたワールド。`url` で入る。
     */
    managedBy?: 'repository' | 'external';
    /** 外部のワールドの URL（開くとき・入るときに使う）。 */
    url?: string;
    /** 本人の一覧のみ。配信できない理由（署名が内容と一致しないなど）。編集して公開し直すと直る。 */
    problem?: string;
    /**
     * 本人の一覧のみ。署名を検証できなかった理由。`malformed` は署名の形式が古い（版 1）など、中身は変わっていないので
     * そのまま署名し直せば直る。
     */
    problemCode?: string;
}

/** その人が作ったワールド（`GET /api/v1/users/:id/worlds`）。 */
export async function fetchUserWorlds(userId: string): Promise<OwnedWorld[]> {
    const res = await fetch(`${API_BASE}/api/v1/users/${encodeURIComponent(userId)}/worlds`, {
        credentials: 'include',
    });
    if (!res.ok) throw new Error(`ワールド取得失敗 (${res.status})`);
    return ((await res.json()) as { worlds: OwnedWorld[] }).worlds;
}

/** ひとこと・自己紹介・リンク・言語を置き換える。 */
export async function saveMyProfile(fields: ProfileUpdateInput): Promise<UserProfile> {
    return profileFrom(
        await fetch(`${API_BASE}/api/v1/users/me/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(fields),
        }),
    );
}

/** 画像を送る（サーバーが作り直して置き換える）。 */
export async function uploadMyProfileImage(kind: ProfileImageKind, file: Blob): Promise<UserProfile> {
    return profileFrom(
        await fetch(`${API_BASE}/api/v1/users/me/images/${kind}`, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            credentials: 'include',
            body: file,
        }),
    );
}

export async function deleteMyProfileImage(kind: ProfileImageKind): Promise<UserProfile> {
    return profileFrom(
        await fetch(`${API_BASE}/api/v1/users/me/images/${kind}`, { method: 'DELETE', credentials: 'include' }),
    );
}

export const profileSaveApi: ProfileSaveApi = {
    setDisplayName: setMyDisplayName,
    saveProfile: saveMyProfile,
    uploadImage: uploadMyProfileImage,
    deleteImage: deleteMyProfileImage,
};
