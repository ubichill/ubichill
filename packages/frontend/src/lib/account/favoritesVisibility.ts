import type { FavoritesVisibility } from '@ubichill/shared';

export interface FavoritesVisibilityOption {
    value: FavoritesVisibility;
    label: string;
    description: string;
}

/** 公開範囲の選択肢（表示順）。 */
export const FAVORITES_VISIBILITY_OPTIONS: readonly FavoritesVisibilityOption[] = [
    { value: 'private', label: 'Private', description: '自分だけが見られます。' },
    { value: 'friends', label: 'Friends', description: '承認済みのフレンドが見られます。' },
    { value: 'public', label: 'Public', description: 'だれでも見られます（ログインしていない人にも公開されます）。' },
];

/** 選んだ公開範囲についての補足（なければ null）。 */
export function favoritesVisibilityNote(visibility: FavoritesVisibility): string | null {
    if (visibility === 'friends') {
        return 'フレンド機能は準備中のため、いまはフレンドを作れず、自分だけが見られる状態と同じです。';
    }
    if (visibility === 'public') {
        return '外部のワールドの URL も、あなたのお気に入りとして見えるようになります。';
    }
    return null;
}
