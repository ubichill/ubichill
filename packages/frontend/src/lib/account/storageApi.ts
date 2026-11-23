import {
    STORED_FILE_DELETE_MAX,
    type StorageOverview,
    type StorageSettings,
    type StoredFilePage,
    type StoredFileRef,
} from '@ubichill/shared';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';
import { deleteInChunks } from './storage';

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

/**
 * まとめて消す（1 回 100 個ずつ順に）。done は送れた分（もう無かったものも含む）。途中で失敗したら error に文を入れて止める。
 */
export const deleteStoredFiles = (
    files: readonly StoredFileRef[],
): Promise<{ done: StoredFileRef[]; error: string | null }> =>
    deleteInChunks(
        files.map(({ kind, id }) => ({ kind, id })),
        STORED_FILE_DELETE_MAX,
        async (chunk) => {
            const res = await fetch(`${ENDPOINT}/files/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ files: chunk }),
            });
            await json<{ removed: StoredFileRef[] }>(res);
        },
    );
