import { PROFILE_IMAGE_MAX_BYTES } from '@ubichill/shared';

/** 選ばせる形式（サーバーが受け付けるもの）。 */
export const PROFILE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif';

/** 選んだファイルを送る前に断る理由（送ってから断られるのを待たせない）。中身の確認はサーバーが行う。 */
export function imageFileProblem(file: { size: number; type: string }): string | null {
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml')
        return '画像ファイル（JPEG・PNG・WebP・GIF・AVIF）を選んでください';
    if (file.size === 0) return '空のファイルです';
    if (file.size > PROFILE_IMAGE_MAX_BYTES) return `画像は ${PROFILE_IMAGE_MAX_BYTES / 1024 / 1024} MB までです`;
    return null;
}
