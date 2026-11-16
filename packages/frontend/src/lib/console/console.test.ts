import { describe, expect, it } from 'vitest';
import {
    addedMessages,
    appendConsole,
    CONSOLE_LIMIT,
    type ConsoleEntry,
    type ConsoleInput,
    collapseConsole,
    consoleCounts,
    DEFAULT_CONSOLE_VIEW,
    formatConsole,
    formatConsoleCount,
    formatConsoleEntry,
    latestProblem,
    visibleConsole,
} from './console';

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

    it('クリアしたあとも ID を使い回さない', () => {
        expect(appendConsole([], err, 1, 41)[0]?.id).toBe(42);
        // 残っている行のほうが新しければそちらに続ける
        expect(appendConsole(appendConsole([], err, 1, 41), { ...err, message: 'x' }, 2, 3).at(-1)?.id).toBe(43);
    });

    it('補足が違えば別の行。同じ行にまとめたときは新しい操作に替える', () => {
        const first = { label: '再試行', run: () => {} };
        const second = { label: '再試行', run: () => {} };
        const merged = appendConsole(appendConsole([], { ...err, action: first }, 1), { ...err, action: second }, 2);
        expect(merged).toHaveLength(1);
        expect(merged[0]?.action).toBe(second);
        expect(appendConsole(merged, { ...err, detail: '理由: x' }, 3)).toHaveLength(2);
    });
});

const logAll = (inputs: readonly ConsoleInput[]) =>
    inputs.reduce<ConsoleEntry[]>((acc, input, i) => appendConsole(acc, input, i + 1), []);

describe('collapseConsole', () => {
    it('離れて出た同じ内容を最初の位置にまとめ、回数を足し、時刻は最後のものにする', () => {
        const info = { level: 'info', source: '公開', message: '公開しました' } as const;
        const entries = logAll([err, err, info, err]);
        const collapsed = collapseConsole(entries);
        expect(collapsed.map((e) => [e.message, e.count, e.at])).toEqual([
            ['mod を取得できません', 3, 4],
            ['公開しました', 1, 3],
        ]);
        expect(collapsed[0]?.id).toBe(entries[0]?.id);
    });

    it('元の行は変えない', () => {
        const entries = logAll([err, { ...err, level: 'info' }, err]);
        collapseConsole(entries);
        expect(entries.map((e) => e.count)).toEqual([1, 1, 1]);
    });
});

describe('visibleConsole', () => {
    const entries = logAll([
        err,
        { level: 'warning', source: 'pen', message: '作者を確認できません', detail: '理由: author-pending' },
        { level: 'info', source: 'Pen', message: '読み込みました' },
    ]);

    it('切った種類は出さない', () => {
        const view = { ...DEFAULT_CONSOLE_VIEW, levels: { error: false, warning: true, info: false } };
        expect(visibleConsole(entries, view).map((e) => e.level)).toEqual(['warning']);
    });

    it('検索は文・出どころ・補足を、大文字小文字を区別せず前後の空白を無視して探す', () => {
        const search = (query: string) =>
            visibleConsole(entries, { ...DEFAULT_CONSOLE_VIEW, query }).map((e) => e.message);
        expect(search('  PEN ')).toEqual(['作者を確認できません', '読み込みました']);
        expect(search('author-pending')).toEqual(['作者を確認できません']);
        expect(search('見つからない')).toEqual([]);
    });

    it('まとめる・種類・検索を一緒に使える', () => {
        const repeated = logAll([err, { ...err, level: 'info' }, err]);
        const view = { levels: { error: true, warning: true, info: false }, collapse: true, query: '取得' };
        expect(visibleConsole(repeated, view).map((e) => [e.level, e.count])).toEqual([['error', 2]]);
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

describe('formatConsoleEntry の補足', () => {
    it('補足は字下げして続ける', () => {
        const entry = appendConsole([], { ...err, detail: '理由: lock-missing\n作者に伝えてください' }, at)[0];
        if (!entry) throw new Error('no entry');
        expect(formatConsoleEntry(entry)).toBe(
            '[09:05:03] ERROR ビルド: mod を取得できません\n    理由: lock-missing\n    作者に伝えてください',
        );
    });
});

describe('latestProblem', () => {
    it('最後のエラーか警告を返し、そのあとの情報は飛ばす', () => {
        const entries = logAll([
            err,
            { level: 'warning', source: 'pen', message: 'w' },
            { level: 'info', source: 'pen', message: 'i' },
        ]);
        expect(latestProblem(entries)?.message).toBe('w');
    });

    it('情報だけなら無い', () => {
        expect(latestProblem(logAll([{ level: 'info', source: 'pen', message: 'i' }]))).toBeUndefined();
        expect(latestProblem([])).toBeUndefined();
    });
});

describe('formatConsoleCount', () => {
    it('999 を超えたら 999+ にする', () => {
        expect([0, 999, 1000].map(formatConsoleCount)).toEqual(['0', '999', '999+']);
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
