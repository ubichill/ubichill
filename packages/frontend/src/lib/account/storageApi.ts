import {
    STORED_FILE_DELETE_MAX,
    type StorageOverview,
    type StorageSettings,
    type StoredFilePage,
    type StoredFileRef,
} from '@ubichill/shared';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';
import { chunksOf } from './storage';

const ENDPOINT = `${API_BASE}/api/v1/users/me/storage`;

async function json<T>(res: Response): Promise<T> {
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as T;
}

export const fetchMyStorage = async (): Promise<StorageOverview> =>
    json(await fetch(ENDPOINT, { credentials: 'include', cache: 'no-store' }));

export const fetchMyStoredFiles = async (cursor: string): Promise<StoredFilePage> =>
    json(
        await fetch(`${ENDPOINT}/files?cursor=${encodeURIComponent(cursor)}`, {
            credentials: 'include',
            cache: 'no-store',
        }),
    );

export const updateMyStorageSettings = async (settings: StorageSettings): Promise<StorageSettings> =>
    json(
        await fetch(`${ENDPOINT}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(settings),
        }),
    );

/** まとめて消す（1 回 100 個ずつ順に）。消せたもの（もう無かったものは入らない）を返す。途中で失敗したら投げる。 */
export async function deleteStoredFiles(files: readonly StoredFileRef[]): Promise<StoredFileRef[]> {
    return chunksOf(
        files.map(({ kind, id }) => ({ kind, id })),
        STORED_FILE_DELETE_MAX,
    ).reduce<Promise<StoredFileRef[]>>(async (done, chunk) => {
        const removed = await done;
        const res = await fetch(`${ENDPOINT}/files/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ files: chunk }),
        });
        return [...removed, ...(await json<{ removed: StoredFileRef[] }>(res)).removed];
    }, Promise.resolve([]));
}
