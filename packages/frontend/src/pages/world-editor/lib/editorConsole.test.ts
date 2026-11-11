import { describe, expect, it } from 'vitest';
import {
    addedMessages,
    appendConsole,
    CONSOLE_LIMIT,
    type ConsoleEntry,
    consoleCounts,
    formatConsole,
    formatConsoleEntry,
} from './editorConsole';

const err = { level: 'error', source: 'ビルド', message: 'mod を取得できません' } as const;
const at = new Date(2026, 10, 11, 9, 5, 3).getTime();

describe('appendConsole', () => {
    it('直前と同じ内容は回数だけ増やして時刻を更新する', () => {
        const once = appendConsole([], err, 1);
        const twice = appendConsole(once, err, 2);
        expect(twice).toHaveLength(1);
        expect(twice[0]).toMatchObject({ id: 1, count: 2, at: 2 });
    });

    it('間に別の内容があれば同じ文でも別の行にする', () => {
        const entries = [err, { ...err, source: '公開' }, err].reduce<ConsoleEntry[]>(
            (acc, input, i) => appendConsole(acc, input, i),
            [],
        );
        expect(entries.map((e) => e.count)).toEqual([1, 1, 1]);
    });

    it('level だけ違うものはまとめない', () => {
        const entries = appendConsole(appendConsole([], err, 1), { ...err, level: 'warning' }, 2);
        expect(entries).toHaveLength(2);
    });

    it('上限を超えたら古いものから捨て、ID は振り直さない', () => {
        const entries = Array.from({ length: CONSOLE_LIMIT + 5 }, (_, i) => i).reduce<ConsoleEntry[]>(
            (acc, i) => appendConsole(acc, { ...err, message: `m${i}` }, i),
            [],
        );
        expect(entries).toHaveLength(CONSOLE_LIMIT);
        expect(entries[0]).toMatchObject({ id: 6, message: 'm5' });
        expect(entries.at(-1)?.id).toBe(CONSOLE_LIMIT + 5);
    });
});

describe('consoleCounts', () => {
    it('まとめた回数も数える', () => {
        const entries = appendConsole(appendConsole(appendConsole([], err, 1), err, 2), { ...err, level: 'info' }, 3);
        expect(consoleCounts(entries)).toEqual({ error: 2, warning: 0, info: 1 });
    });
});

describe('formatConsole', () => {
    it('時刻・種類・出どころ・回数を 1 行にする', () => {
        const entry = appendConsole(appendConsole([], err, at), err, at)[0];
        expect(formatConsoleEntry(entry)).toBe('[09:05:03] ERROR ビルド: mod を取得できません (x2)');
    });

    it('改行を含むメッセージもそのまま貼れる', () => {
        const entries = appendConsole(
            appendConsole([], { ...err, message: 'a\nb' }, at),
            { ...err, level: 'info' },
            at,
        );
        expect(formatConsole(entries)).toBe(
            '[09:05:03] ERROR ビルド: a\nb\n[09:05:03] INFO ビルド: mod を取得できません',
        );
    });
});

describe('addedMessages', () => {
    it('前から出ているものは除き、同じ文の重複も 1 つにする', () => {
        expect(addedMessages(['a', 'b'], ['b', 'c', 'c', 'd'])).toEqual(['c', 'd']);
    });

    it('一度消えて出直したものは新しく出たとみなす（prev は直前の状態だけ）', () => {
        expect(addedMessages([], ['a'])).toEqual(['a']);
    });
});
