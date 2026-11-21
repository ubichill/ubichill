import { WORLD_ASSET_MAX_BYTES, type WorldAsset } from '@ubichill/shared';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';

const MB = 1024 * 1024;

/** 送る前に分かる誤り（形式・大きさ）。問題なければ null */
export function worldAssetFileProblem(file: { type: string; size: number }): string | null {
    if (!file.type.startsWith('image/')) return '画像のファイルを選んでください';
    if (file.size > WORLD_ASSET_MAX_BYTES) return `画像は ${WORLD_ASSET_MAX_BYTES / MB} MB までです`;
    return null;
}

/** ワールドの画像を上げる。サーバーが作り直した画像（ハッシュ入りの URL）を返す。 */
export async function uploadWorldAsset(file: File): Promise<WorldAsset> {
    const problem = worldAssetFileProblem(file);
    if (problem) throw new Error(problem);
    const res = await fetch(`${API_BASE}/api/v1/assets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': file.type },
        body: file,
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as WorldAsset;
}
