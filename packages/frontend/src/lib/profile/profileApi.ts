import type { ProfileImageKind, ProfileUpdateInput, UserProfile } from '@ubichill/shared';
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

/** 公開プロフィール（`GET /api/v1/users/:id`）。 */
export async function fetchUserProfile(userId: string): Promise<UserProfile> {
    return profileFrom(
        await fetch(`${API_BASE}/api/v1/users/${encodeURIComponent(userId)}`, {
            credentials: 'include',
            cache: 'no-store',
        }),
    );
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
