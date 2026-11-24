import type { ServerBranding, ServerBrandingUpdateInput, ServerImageKind } from '@ubichill/shared';
import { recheckIfForbidden } from '../account/adminStatus';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';

const ENDPOINT = `${API_BASE}/api/v1/admin/branding`;

/** ブランディング（コントロールパネルの「ブランディング」）。変えると変えた後のブランディングを返す。読むのは `GET /api/v1/server`。 */
async function request(path: string, init: RequestInit): Promise<ServerBranding> {
    const res = await fetch(`${ENDPOINT}${path}`, { credentials: 'include', cache: 'no-store', ...init });
    if (!res.ok) {
        recheckIfForbidden(res);
        throw new Error(await errorMessage(res));
    }
    return (await res.json()) as ServerBranding;
}

export const updateBranding = (input: ServerBrandingUpdateInput): Promise<ServerBranding> =>
    request('', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });

/** 画像を送る（サーバーが作り直して置き換える）。 */
export const uploadBrandingImage = (kind: ServerImageKind, file: Blob): Promise<ServerBranding> =>
    request(`/images/${kind}`, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
    });

export const removeBrandingImage = (kind: ServerImageKind): Promise<ServerBranding> =>
    request(`/images/${kind}`, { method: 'DELETE' });
