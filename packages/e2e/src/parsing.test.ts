import { describe, expect, it } from 'vitest';
import { type ConsoleEntry, fatalConsoleEntries } from './browser/consoleRules.ts';
import { cookieHeader } from './http.ts';
import { parseFrame } from './instanceSocket.ts';
import { firstFailureOfPlaywright, summarize } from './report.ts';

describe('cookieHeader', () => {
    it('Set-Cookie の属性を捨てて名前=値だけを並べる', () => {
        expect(
            cookieHeader([
                'better-auth.session_token=abc.def; Path=/; HttpOnly; SameSite=Lax',
                '__Secure-x=1=2; Secure',
            ]),
        ).toBe('better-auth.session_token=abc.def; __Secure-x=1=2');
    });

    it('値の無い行・空は捨てる', () => {
        expect(cookieHeader(['', 'broken; Path=/'])).toBe('');
    });
});

describe('parseFrame', () => {
    it('応答（replyTo）とイベントを読む', () => {
        expect(parseFrame('{"replyTo":"1","data":{"success":true}}')).toEqual({
            event: undefined,
            data: { success: true },
            id: undefined,
            replyTo: '1',
        });
        expect(parseFrame('{"event":"cursor:moved","data":{"userId":"u"}}')?.event).toBe('cursor:moved');
    });

    it.each(['not json', '[1,2]', 'null', '42'])('フレームでないもの（%s）は無視する', (raw) => {
        expect(parseFrame(raw)).toBeNull();
    });

    it('バイナリは無視する', () => {
        expect(parseFrame(new ArrayBuffer(4))).toBeNull();
    });

    it('型の違う event・replyTo は無かったことにする', () => {
        expect(parseFrame('{"event":1,"replyTo":{"x":1}}')).toMatchObject({ event: undefined, replyTo: undefined });
    });
});

describe('fatalConsoleEntries', () => {
    const entry = (type: string, text: string, source: ConsoleEntry['source'] = 'page'): ConsoleEntry => ({
        source,
        type,
        text,
    });

    it('mod の検証・Worker の失敗は落とす', () => {
        const fatal = [
            entry('warning', '[ModRegistry] component "pen:pen" は検証に失敗 (manifest-mismatch)。実行を拒否します。'),
            entry('error', '[Sandbox:pen:pen] 初期化失敗: x'),
            entry('error', '[ModHost] Worker エラー: x'),
            entry('error', 'author signature mismatch'),
        ];
        expect(fatalConsoleEntries(fatal)).toEqual(fatal);
    });

    it('捕まえられなかった例外は文言に関わらず落とす', () => {
        const uncaught = entry('error', 'TypeError: x is undefined', 'pageerror');
        expect(fatalConsoleEntries([uncaught])).toEqual([uncaught]);
    });

    it('ほかの error・同じ文言の log は落とさない（ログに残すだけ）', () => {
        expect(
            fatalConsoleEntries([
                entry('error', 'WebSocket connection failed, retrying'),
                entry('log', '[Sandbox:pen:pen] 初期化失敗 の扱いについて'),
                entry('log', '[Sandbox:pen:pen] 初期化完了'),
            ]),
        ).toEqual([]);
    });
});

describe('firstFailureOfPlaywright', () => {
    const report = (steps: unknown[], errors: unknown[] = []) =>
        JSON.stringify({
            suites: [{ suites: [{ specs: [{ tests: [{ results: [{ steps, errors }] }] }] }] }],
            errors: [],
        });

    it('最初に落ちた段の名前と理由の 1 行目（色の制御文字は除く）', () => {
        const json = report([
            { title: '登録' },
            {
                title: 'ログイン',
                error: { message: '\u001b[31mError: expect(page).toHaveURL failed\u001b[39m\n\nExpected: /' },
            },
            { title: '入室', error: { message: 'later' } },
        ]);
        expect(firstFailureOfPlaywright(json)).toBe('ログイン: Error: expect(page).toHaveURL failed');
    });

    it('段の外で落ちたら結果のエラーを使う', () => {
        expect(firstFailureOfPlaywright(report([], [{ message: '\n\nSMOKE_ORIGIN がありません' }]))).toBe(
            'SMOKE_ORIGIN がありません',
        );
    });

    it('テストが走る前の失敗（設定の誤りなど）も拾う', () => {
        expect(firstFailureOfPlaywright(JSON.stringify({ suites: [], errors: [{ message: 'No tests found' }] }))).toBe(
            'No tests found',
        );
    });

    it('落ちていなければ undefined', () => {
        expect(firstFailureOfPlaywright(report([{ title: '登録' }]))).toBeUndefined();
    });
});

describe('summarize', () => {
    it('1 つでも落ちたら全体は失敗', () => {
        const summary = summarize([
            { suite: 'api', status: 'passed', ms: 1 },
            { suite: 'browser', status: 'failed', ms: 2, failedStep: 'x' },
        ]);
        expect(summary.passed).toBe(false);
        expect(summary.suites.browser?.failedStep).toBe('x');
    });

    it('走らせなかった段は載せない', () => {
        expect(summarize([{ suite: 'api', status: 'passed', ms: 1 }])).toEqual({
            passed: true,
            suites: { api: { suite: 'api', status: 'passed', ms: 1 } },
        });
    });
});
