import type { StorageQuotaInput, StorageQuotaSettings } from '@ubichill/shared';
import { recheckIfForbidden } from '../account/adminStatus';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';

const ENDPOINT = `${API_BASE}/api/v1/admin/storage`;

/** 1 人あたりの容量（コントロールパネルの「全般」）。変えると変えた後の設定を返す。 */
async function request(init: RequestInit = {}): Promise<StorageQuotaSettings> {
    const res = await fetch(ENDPOINT, {
        credentials: 'include',
        cache: 'no-store',
        ...init,
        headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    if (!res.ok) {
        recheckIfForbidden(res);
        throw new Error(await errorMessage(res));
    }
    return (await res.json()) as StorageQuotaSettings;
}

export const fetchStorageQuota = (): Promise<StorageQuotaSettings> => request();

export const updateStorageQuota = (input: StorageQuotaInput): Promise<StorageQuotaSettings> =>
    request({ method: 'PUT', body: JSON.stringify(input) });
