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
    if (visibility === 'public') {
        return '外部のワールドの URL も、あなたのお気に入りとして見えるようになります。いちばん新しいお気に入りは、フェディバースのプロフィールに固定ノートとして出ます。';
    }
    return null;
}
