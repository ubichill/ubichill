import type { ModFavoriteRef } from '@ubichill/shared';
import { HudIcon } from '@/components/hud/HudIcon';
import { modFavoriteKey, useModFavorites } from '@/lib/mods/modFavorites';
import { css, cx } from '@/styled-system/css';

const onStyle = css({ color: 'warning' });

/**
 * mod のお気に入りの切り替え。押したらすぐ反映し、どこで押しても同じ mod の印がそろう（共有ストア）。
 * 見た目は置き場所のボタンに合わせる（className）。labeled は文言も出す（作品ページ）。
 */
export function ModFavoriteButton({
    mod,
    name = mod.id,
    className,
    labeled = false,
    disabled = false,
}: {
    mod: ModFavoriteRef;
    /** 読み上げに使う名前（一覧で行を区別する） */
    name?: string;
    className: string;
    labeled?: boolean;
    disabled?: boolean;
}) {
    const { isFavorite, toggle } = useModFavorites();
    const key = modFavoriteKey(mod);
    const on = isFavorite(key);
    const label = on ? 'お気に入り済み' : 'お気に入りに追加';
    return (
        <button
            type="button"
            aria-pressed={on}
            aria-label={labeled ? undefined : `${name} を${on ? 'お気に入りから外す' : 'お気に入りに追加'}`}
            title={labeled ? undefined : label}
            disabled={disabled}
            onClick={() => void toggle(key)}
            className={cx(className, on && onStyle)}
        >
            <HudIcon name="star" size={16} filled={on} />
            {labeled && label}
        </button>
    );
}
