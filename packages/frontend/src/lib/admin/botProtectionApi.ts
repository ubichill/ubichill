import type { BotProtectionSettings, BotProtectionUpdate } from '@ubichill/shared';
import { recheckIfForbidden } from '../account/adminStatus';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';

const ENDPOINT = `${API_BASE}/api/v1/admin/bot-protection`;

/** ボット対策（コントロールパネルの「認証」）。変えると変えた後の設定を返す。 */
async function request(init: RequestInit = {}): Promise<BotProtectionSettings> {
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
    return (await res.json()) as BotProtectionSettings;
}

export const fetchBotProtectionSettings = (): Promise<BotProtectionSettings> => request();

export const updateBotProtection = (update: BotProtectionUpdate): Promise<BotProtectionSettings> =>
    request({ method: 'PUT', body: JSON.stringify(update) });
