import { type RefObject, useEffect, useRef, useState } from 'react';
import { HudIcon, type HudIconName } from '@/components/hud/HudIcon';
import { type EmojiEntry, recentEntries, searchEmojis } from '@/lib/emoji/emojiCatalog';
import { css, cva, cx } from '@/styled-system/css';
import { useEmojiCatalog } from './useEmojiCatalog';

const RECENT = 'recent';

const GROUP_ICONS: Record<string, HudIconName> = {
    [RECENT]: 'clock',
    'smileys-emotion': 'smile',
    'people-body': 'hand',
    'animals-nature': 'leaf',
    'food-drink': 'coffee',
    'travel-places': 'car',
    activities: 'ball',
    objects: 'lightbulb',
    symbols: 'heart',
    flags: 'flag',
};

/**
 * 絵文字を選ぶ画面（分類のタブ・検索・最近使ったもの）。選ぶと onSelect を呼んで閉じる。
 * 外を押す・Esc で閉じる。anchor（開いたボタン）を押したときは、そのボタンの開閉に任せる。
 */
export function EmojiPicker({
    onSelect,
    onClose,
    anchor,
    className,
}: {
    onSelect: (emoji: string) => void;
    onClose: () => void;
    anchor?: RefObject<HTMLElement | null>;
    /** 置く位置（呼ぶ側のレイアウト） */
    className?: string;
}) {
    const { groups, failed, recent, remember } = useEmojiCatalog();
    const [query, setQuery] = useState('');
    const [tab, setTab] = useState<string | null>(null);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Node;
            if (root.current?.contains(target) || anchor?.current?.contains(target)) return;
            onClose();
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [anchor, onClose]);

    const current = tab ?? (recent.length > 0 ? RECENT : (groups?.[0]?.key ?? RECENT));
    const tabs = [{ key: RECENT, label: '最近使ったもの' }, ...(groups ?? [])];
    const searching = query.trim() !== '';
    const entries: readonly EmojiEntry[] = !groups
        ? []
        : searching
          ? searchEmojis(groups, query)
          : current === RECENT
            ? recentEntries(groups, recent)
            : (groups.find((g) => g.key === current)?.emojis ?? []);

    const choose = (emoji: string) => {
        remember(emoji);
        onSelect(emoji);
        onClose();
    };

    return (
        <div
            ref={root}
            role="dialog"
            aria-label="絵文字"
            className={cx(panel, className)}
            onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                // HUD の Esc（ランチパッドを閉じる）まで届けない
                e.stopPropagation();
                onClose();
                anchor?.current?.focus();
            }}
        >
            <label className={searchBox}>
                <HudIcon name="search" size={15} />
                <input
                    // biome-ignore lint/a11y/noAutofocus: 開いたらすぐ探せるように
                    autoFocus
                    type="search"
                    value={query}
                    aria-label="絵文字を検索"
                    className={searchInput}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        const first = entries[0];
                        if (e.key === 'Enter' && searching && first && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            choose(first.emoji);
                        }
                    }}
                />
            </label>

            {!searching && (
                <div role="tablist" aria-label="分類" className={tabRow}>
                    {tabs.map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            role="tab"
                            aria-selected={current === t.key}
                            aria-label={t.label}
                            title={t.label}
                            className={tabButton({ active: current === t.key })}
                            onClick={() => setTab(t.key)}
                        >
                            <HudIcon name={GROUP_ICONS[t.key] ?? 'smile'} size={16} />
                        </button>
                    ))}
                </div>
            )}

            <div className={grid}>
                {entries.map((e) => (
                    <button
                        key={e.emoji}
                        type="button"
                        title={e.name}
                        aria-label={e.name}
                        className={emojiButton}
                        onClick={() => choose(e.emoji)}
                    >
                        {e.emoji}
                    </button>
                ))}
            </div>
            {failed && <p className={note}>読み込めませんでした</p>}
            {groups && entries.length === 0 && (
                <p className={note}>{searching ? '見つかりません' : 'まだありません'}</p>
            )}
        </div>
    );
}

const panel = css({
    w: '320px',
    maxW: 'calc(100vw - 24px)',
    h: '340px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2',
    p: '2.5',
    bg: 'background',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '14px',
    boxShadow: 'modal',
    zIndex: 10,
});

const searchBox = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    px: '2.5',
    py: '1.5',
    borderRadius: '10px',
    bg: 'surface',
    color: 'textMuted',
    _focusWithin: { outline: '2px solid', outlineColor: 'primaryHighlight' },
});

const searchInput = css({
    flex: 1,
    minW: 0,
    bg: 'transparent',
    border: 'none',
    color: 'text',
    fontSize: '13px',
    _focus: { outline: 'none' },
});

const tabRow = css({ display: 'flex', justifyContent: 'space-between', flexShrink: 0 });

const tabButton = cva({
    base: {
        w: '28px',
        h: '28px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: '8px',
        bg: 'transparent',
        cursor: 'pointer',
        _hover: { bg: 'surfaceHover', color: 'text' },
    },
    variants: {
        active: { true: { bg: 'surfaceAccent', color: 'text' }, false: { color: 'textMuted' } },
    },
});

const grid = css({
    flex: 1,
    minH: 0,
    overflowY: 'auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))',
    alignContent: 'start',
    gap: '0.5',
});

const emojiButton = css({
    h: '36px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '8px',
    bg: 'transparent',
    fontSize: '22px',
    lineHeight: 1,
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover' },
    _focusVisible: { outline: '2px solid', outlineColor: 'primaryHighlight' },
});

const note = css({ fontSize: '12px', color: 'textMuted', textAlign: 'center', py: '2' });
