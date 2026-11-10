import { isSingleEmoji } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    emojiGroupsOf,
    foldForSearch,
    insertAtSelection,
    type RawEmojiData,
    RECENT_EMOJI_MAX,
    recentEmojisOf,
    recentEntries,
    searchEmojis,
    withRecentEmoji,
} from './emojiCatalog';
import data from './emojiData.json';

const sample: RawEmojiData = {
    groups: [
        {
            key: 'smileys-emotion',
            label: 'スマイリーと感情',
            emojis: [
                ['😂', '嬉し泣き', '笑い 涙 顔', 'face with tears of joy laugh tear'],
                ['😺', 'にっこり笑う猫', 'ネコ 猫 顔', 'grinning cat face smile'],
            ],
        },
        {
            key: 'animals-nature',
            label: '動物と自然',
            emojis: [
                ['🐈', 'ネコ', '動物 猫', 'cat pet'],
                ['🐕', '犬', '動物 イヌ', 'dog pet'],
            ],
        },
    ],
};
const groups = emojiGroupsOf(sample);
const found = (q: string) => searchEmojis(groups, q).map((e) => e.emoji);

describe('emojiData.json（生成したデータ）', () => {
    const all = emojiGroupsOf(data).flatMap((g) => g.emojis);

    it('どれもリアクションで受け付ける絵文字 1 つ（選べるのに送ると断られるものを出さない）', () => {
        expect(all.filter((e) => !isSingleEmoji(e.emoji)).map((e) => e.emoji)).toEqual([]);
    });

    it('同じ絵文字を 2 度出さず、部品（肌色）の分類は無い', () => {
        expect(new Set(all.map((e) => e.emoji)).size).toBe(all.length);
        expect(data.groups.map((g) => g.key)).not.toContain('component');
    });

    it('日本語と英語の名前で引ける', () => {
        const real = emojiGroupsOf(data);
        expect(searchEmojis(real, 'ねこ').map((e) => e.emoji)).toContain('🐈');
        expect(searchEmojis(real, 'thumbs up')[0]?.emoji).toBe('👍');
    });
});

describe('foldForSearch', () => {
    it('カタカナはひらがな、全角英数は半角、大文字は小文字', () => {
        expect(foldForSearch('ネコ')).toBe('ねこ');
        expect(foldForSearch('ＣＡＴ')).toBe('cat');
        expect(foldForSearch('  Dog ')).toBe('dog');
    });

    it('長音と濁点はそのまま（「ー」で崩さない）', () => {
        expect(foldForSearch('ビール')).toBe('びーる');
    });
});

describe('searchEmojis', () => {
    it('カタカナ・ひらがなのどちらでも引ける', () => {
        expect(found('ねこ')).toEqual(found('ネコ'));
        expect(found('ねこ')).toContain('🐈');
    });

    it('名前と同じものを前に出す（同じ強さなら元の並び）', () => {
        expect(found('ねこ')).toEqual(['🐈', '😺']);
        expect(found('pet')).toEqual(['🐈', '🐕']);
    });

    it('空白で区切った語はどれも合うものだけ', () => {
        expect(found('cat smile')).toEqual(['😺']);
        expect(found('cat dog')).toEqual([]);
    });

    it('英語の名前の途中でも引ける', () => {
        expect(found('tear')).toEqual(['😂']);
        expect(found('joy')).toEqual(['😂']);
    });

    it('空・空白だけは何も返さない', () => {
        expect(found('')).toEqual([]);
        expect(found('   ')).toEqual([]);
    });

    it('絵文字そのもので引けばその絵文字だけ', () => {
        expect(found('🐕')).toEqual(['🐕']);
    });

    it('正規表現の記号を語として扱う（壊れない）', () => {
        expect(found('.*')).toEqual([]);
        expect(found('(')).toEqual([]);
    });

    it('上限で切る', () => {
        expect(searchEmojis(groups, 'a', 1)).toHaveLength(1);
    });
});

describe('withRecentEmoji', () => {
    it('頭に足し、前にあったものは重ねない', () => {
        expect(withRecentEmoji(['👍', '🎉'], '🎉')).toEqual(['🎉', '👍']);
    });

    it('上限で古いものから落とす', () => {
        const full = Array.from({ length: RECENT_EMOJI_MAX }, (_, i) => String.fromCodePoint(0x1f600 + i));
        const next = withRecentEmoji(full, '👍');
        expect(next).toHaveLength(RECENT_EMOJI_MAX);
        expect(next[0]).toBe('👍');
        expect(next).not.toContain(full.at(-1));
    });
});

describe('recentEmojisOf', () => {
    it('配列でないものは空', () => {
        expect(recentEmojisOf(null)).toEqual([]);
        expect(recentEmojisOf('👍')).toEqual([]);
        expect(recentEmojisOf({ 0: '👍' })).toEqual([]);
    });

    it('絵文字でないもの・重なり・上限を超えた分は捨てる（書き換えられた localStorage）', () => {
        expect(recentEmojisOf(['👍', 'a', 1, null, '👍', '👍👍', '<img>', '🎉'])).toEqual(['👍', '🎉']);
        expect(recentEmojisOf(['👍', '🎉', '😂'], 2)).toEqual(['👍', '🎉']);
    });
});

describe('recentEntries', () => {
    it('データの名前を付け、データに無いものは名前なしで残す', () => {
        expect(recentEntries(groups, ['🐕', '🫠']).map((e) => [e.emoji, e.name])).toEqual([
            ['🐕', '犬'],
            ['🫠', '🫠'],
        ]);
    });
});

describe('insertAtSelection', () => {
    it('カーソルの位置に入れ、カーソルを入れた後ろに置く', () => {
        expect(insertAtSelection('ab', { start: 1, end: 1 }, '👍')).toEqual({ value: 'a👍b', caret: 3 });
    });

    it('選んでいる範囲は置き換える', () => {
        expect(insertAtSelection('abcd', { start: 1, end: 3 }, '🎉')).toEqual({ value: 'a🎉d', caret: 3 });
    });

    it('範囲が無ければ末尾、外れていれば寄せる、逆向きは始まりに入れる', () => {
        expect(insertAtSelection('ab', null, '👍')).toEqual({ value: 'ab👍', caret: 4 });
        expect(insertAtSelection('ab', { start: 10, end: 20 }, '👍')).toEqual({ value: 'ab👍', caret: 4 });
        expect(insertAtSelection('ab', { start: -5, end: -1 }, '👍')).toEqual({ value: '👍ab', caret: 2 });
        expect(insertAtSelection('abc', { start: 2, end: 1 }, 'x')).toEqual({ value: 'abxc', caret: 3 });
    });

    it('サロゲートペアの間に落ちた位置では、絵文字を割らずに後ろへ入れる', () => {
        // '😂' は 2 単位。位置 1 はその真ん中
        expect(insertAtSelection('😂', { start: 1, end: 1 }, '👍')).toEqual({ value: '😂👍', caret: 4 });
    });

    it('NaN の位置は頭とみなす', () => {
        expect(insertAtSelection('ab', { start: Number.NaN, end: Number.NaN }, 'x')).toEqual({
            value: 'xab',
            caret: 1,
        });
    });
});
