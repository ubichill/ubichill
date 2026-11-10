import { useEffect, useState } from 'react';
import { type EmojiGroup, emojiGroupsOf, recentEmojisOf, withRecentEmoji } from '@/lib/emoji/emojiCatalog';
import { SETTINGS_KEYS, useSetting } from '@/lib/settings';

// 一覧は初めて開いたときに読む（本体の束に入れない）。読んだものはアプリの間ずっと使い回す
const cache: { groups?: Promise<EmojiGroup[]> } = {};
const loadGroups = (): Promise<EmojiGroup[]> => {
    const groups = cache.groups ?? import('@/lib/emoji/emojiData.json').then((m) => emojiGroupsOf(m.default));
    cache.groups = groups;
    // 読めなかったら次に開いたときに読み直す
    groups.catch(() => {
        if (cache.groups === groups) cache.groups = undefined;
    });
    return groups;
};

/** 絵文字の一覧（読み込み中は null）と、最近使ったもの。 */
export function useEmojiCatalog() {
    const [groups, setGroups] = useState<EmojiGroup[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [stored, setStored] = useSetting<unknown>(SETTINGS_KEYS.recentEmojis, []);
    const recent = recentEmojisOf(stored);

    useEffect(() => {
        const ctrl = { cancelled: false };
        loadGroups()
            .then((g) => !ctrl.cancelled && setGroups(g))
            .catch(() => !ctrl.cancelled && setFailed(true));
        return () => {
            ctrl.cancelled = true;
        };
    }, []);

    const remember = (emoji: string) => setStored((prev: unknown) => withRecentEmoji(recentEmojisOf(prev), emoji));
    return { groups, failed, recent, remember };
}
