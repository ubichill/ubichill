import type { ServerInfoInput, ServerInfoSettings } from '@ubichill/shared';
import { recheckIfForbidden } from '../account/adminStatus';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';

const ENDPOINT = `${API_BASE}/api/v1/admin/server-info`;

/** サーバーの情報（コントロールパネルの「全般」）。変えると変えた後の設定を返す。 */
async function request(init: RequestInit = {}): Promise<ServerInfoSettings> {
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
    return (await res.json()) as ServerInfoSettings;
}

export const fetchServerInfoSettings = (): Promise<ServerInfoSettings> => request();

export const updateServerInfo = (input: ServerInfoInput): Promise<ServerInfoSettings> =>
    request({ method: 'PUT', body: JSON.stringify(input) });
