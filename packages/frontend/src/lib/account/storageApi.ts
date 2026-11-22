import { type StorageOverview, type StorageSettings, type StoredFile, worldAssetPath } from '@ubichill/shared';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';

const ENDPOINT = `${API_BASE}/api/v1/users/me/storage`;

/** 種類ごとに消す API（種類を足したら、ここに無いと型で落ちる） */
const DELETE_PATH: Record<StoredFile['kind'], (id: string) => string> = { 'world-image': worldAssetPath };

export async function fetchMyStorage(): Promise<StorageOverview> {
    const res = await fetch(ENDPOINT, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as StorageOverview;
}

export async function updateMyStorageSettings(settings: StorageSettings): Promise<StorageSettings> {
    const res = await fetch(`${ENDPOINT}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as StorageSettings;
}

/** 種類ごとの API で消す。もう無ければ（ほかの端末で消した）消せたことにする。 */
export async function deleteStoredFile(file: StoredFile): Promise<void> {
    const res = await fetch(`${API_BASE}${DELETE_PATH[file.kind](file.id)}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    if (!res.ok && res.status !== 404) throw new Error(await errorMessage(res));
}
