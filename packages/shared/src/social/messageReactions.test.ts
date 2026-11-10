import { describe, expect, it } from 'vitest';
import {
    isSingleEmoji,
    REACTION_LIMITS,
    ReactRequestSchema,
    tallyReactions,
    toggledReaction,
    withReaction,
} from './messageReactions';

describe('isSingleEmoji', () => {
    it.each([
        ['普通の絵文字', '👍'],
        ['肌色つき', '👍🏽'],
        ['ZWJ の組（家族）', '👨‍👩‍👧‍👦'],
        ['ZWJ と肌色の組', '🧑🏻‍❤️‍💋‍🧑🏼'],
        ['国旗', '🇯🇵'],
        ['地域の旗（タグの並び）', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'],
        ['異体字セレクタ付き（文字が既定のもの）', '❤️'],
        ['キーキャップ', '1️⃣'],
        ['ZWJ と異体字セレクタ（虹の旗）', '🏳️‍🌈'],
    ])('%s は通す', (_, value) => {
        expect(isSingleEmoji(value)).toBe(true);
    });

    it.each([
        ['空', ''],
        ['普通の文字', 'a'],
        ['ひらがな', 'あ'],
        ['数字だけ（キーキャップでない）', '1'],
        ['2 つ並び', '👍👍'],
        ['違う 2 つ', '👍❤️'],
        ['絵文字と文字', '👍a'],
        ['前後の空白', ' 👍 '],
        ['異体字セレクタの無い ❤（2 通りの表記を作らない）', '❤'],
        ['肌色の部品だけ', '🏽'],
        ['髪型の部品だけ', '🦰'],
        ['ZWJ だけ', '‍'],
        ['地域指標 1 つだけ（国旗の片割れ）', '🇯'],
        ['異体字セレクタだけ', '️'],
        ['末尾に余分な ZWJ', '👍‍'],
        ['国旗 2 つ（地域指標 4 つ）', '🇯🇵🇺🇸'],
        ['テキスト表示の指定（U+FE0E）', '❤︎'],
        ['テンプレートの文字列', ':thumbsup:'],
        ['長すぎる（同じ絵文字の繰り返し）', '👍'.repeat(100)],
    ])('%s は断る', (_, value) => {
        expect(isSingleEmoji(value)).toBe(false);
    });

    it('上限より長いものは正規表現にかける前に断る', () => {
        expect(isSingleEmoji('a'.repeat(REACTION_LIMITS.EMOJI_MAX_UNITS + 1))).toBe(false);
    });
});

describe('ReactRequestSchema', () => {
    it('絵文字 1 つだけ', () => {
        expect(ReactRequestSchema.safeParse({ emoji: '🎉' }).success).toBe(true);
        expect(ReactRequestSchema.safeParse({ emoji: 'x' }).success).toBe(false);
        expect(ReactRequestSchema.safeParse({ emoji: 1 }).success).toBe(false);
        expect(ReactRequestSchema.safeParse({}).success).toBe(false);
    });

    it('余分な項目は断る（ほかの人の名義で付けさせない）', () => {
        expect(ReactRequestSchema.safeParse({ emoji: '🎉', userId: 'bob' }).success).toBe(false);
    });
});

describe('withReaction', () => {
    const base = [
        { userId: 'alice', emoji: '👍' },
        { userId: 'bob', emoji: '🎉' },
    ];

    it('付け直すと前のものを置き換え、末尾に回る（1 人 1 つ）', () => {
        expect(withReaction(base, 'alice', '😂')).toEqual([
            { userId: 'bob', emoji: '🎉' },
            { userId: 'alice', emoji: '😂' },
        ]);
    });

    it('null で外す。付けていなければ何も変えない', () => {
        expect(withReaction(base, 'alice', null)).toEqual([{ userId: 'bob', emoji: '🎉' }]);
        expect(withReaction(base, 'carol', null)).toEqual(base);
    });

    it('元の配列は変えない', () => {
        withReaction(base, 'alice', '😂');
        expect(base).toHaveLength(2);
        expect(base[0]).toEqual({ userId: 'alice', emoji: '👍' });
    });
});

describe('toggledReaction', () => {
    const base = [{ userId: 'alice', emoji: '👍' }];

    it('自分が付けた絵文字を押すと外す', () => {
        expect(toggledReaction(base, 'alice', '👍')).toBeNull();
    });

    it('相手が付けた絵文字を押すと自分もそれに付ける（前のものは置き換え）', () => {
        expect(toggledReaction(base, 'bob', '👍')).toBe('👍');
        expect(toggledReaction(base, 'alice', '🎉')).toBe('🎉');
    });
});

describe('tallyReactions', () => {
    it('絵文字ごとに数え、最初に付けられた順。自分が付けたかを持つ', () => {
        expect(
            tallyReactions(
                [
                    { userId: 'alice', emoji: '👍' },
                    { userId: 'bob', emoji: '🎉' },
                    { userId: 'carol', emoji: '👍' },
                ],
                'carol',
            ),
        ).toEqual([
            { emoji: '👍', count: 2, mine: true },
            { emoji: '🎉', count: 1, mine: false },
        ]);
    });

    it('肌色違いは別の絵文字として数える', () => {
        expect(
            tallyReactions(
                [
                    { userId: 'alice', emoji: '👍' },
                    { userId: 'bob', emoji: '👍🏽' },
                ],
                'alice',
            ).map((t) => t.count),
        ).toEqual([1, 1]);
    });

    it('ログインしていなければ自分のものは無い', () => {
        expect(tallyReactions([{ userId: 'alice', emoji: '👍' }], undefined)).toEqual([
            { emoji: '👍', count: 1, mine: false },
        ]);
    });

    it('空なら空', () => {
        expect(tallyReactions([], 'alice')).toEqual([]);
    });
});
