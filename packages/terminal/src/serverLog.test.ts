import { describe, expect, it } from 'vitest';
import { ansiPaint, plainPaint, stripAnsi } from './paint.ts';
import { createServerLogger, formatLogRecord, toSingleLine } from './serverLog.ts';

const time = new Date(Date.UTC(2026, 10, 6, 3, 1, 3, 123));
const production = { paint: plainPaint, tty: false };

describe('formatLogRecord（本番: TTY ではない）', () => {
    it('ISO の時刻・5 桁に揃えた level・範囲・本文を 1 行にする', () => {
        expect(formatLogRecord({ time, level: 'info', scope: 'config', args: ['ポート=3001'] }, production)).toBe(
            '2026-11-06T03:01:03.123Z INFO  [config] ポート=3001',
        );
        expect(formatLogRecord({ time, level: 'error', args: ['x'] }, production)).toBe(
            '2026-11-06T03:01:03.123Z ERROR x',
        );
    });

    it('Error のスタックを含めても 1 行に保つ（改行は \\n と書く）', () => {
        const error = new Error('boom');
        error.stack = 'Error: boom\n    at f (a.js:1:1)\r\n    at g (b.js:2:2)';
        const line = formatLogRecord({ time, level: 'error', args: ['取得エラー:', error] }, production);
        expect(line.split('\n')).toHaveLength(1);
        expect(line).toContain('取得エラー: Error: boom\\n    at f (a.js:1:1)\\n    at g (b.js:2:2)');
    });

    it('本文の改行も 1 行にし、ライブラリが付けた色は消す', () => {
        const line = formatLogRecord({ time, level: 'warn', args: [`a\nb ${ansiPaint('red', 'c')}`] }, production);
        expect(line).toBe('2026-11-06T03:01:03.123Z WARN  a\\nb c');
    });

    it('オブジェクトは console.log と同じく inspect するが、折り返さない', () => {
        const nested = { a: { b: { c: [1, 2, 3] } }, long: 'x'.repeat(100) };
        expect(formatLogRecord({ time, level: 'info', args: ['ctx', nested] }, production).split('\n')).toHaveLength(1);
    });

    it('引数が無くても頭だけで投げない。不正な時刻でも投げない', () => {
        expect(formatLogRecord({ time: new Date(Number.NaN), level: 'debug', args: [] }, production)).toBe('- DEBUG ');
    });
});

describe('formatLogRecord（手元の端末）', () => {
    it('時刻を短くし、色を付け、スタックは字下げした複数行のまま', () => {
        const local = new Date(2026, 10, 6, 12, 1, 3);
        const error = new Error('boom');
        error.stack = 'Error: boom\n    at f (a.js:1:1)';
        const text = formatLogRecord({ time: local, level: 'error', args: [error] }, { paint: ansiPaint, tty: true });
        expect(stripAnsi(text).split('\n')).toEqual(['12:01:03 ERROR Error: boom', '        at f (a.js:1:1)']);
        expect(text).toContain('\u001b[31m');
    });
});

describe('toSingleLine', () => {
    it('CR・LF・CRLF をどれも \\n の 2 文字にする', () => {
        expect(toSingleLine('a\rb\nc\r\nd')).toBe('a\\nb\\nc\\nd');
    });
});

describe('createServerLogger', () => {
    const capture = () => {
        const out: string[] = [];
        const err: string[] = [];
        return { out, err, sink: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
    };

    it('debug・info は out、warn・error は err に書く', () => {
        const { out, err, sink } = capture();
        const logger = createServerLogger({ sink, tty: false, now: () => time, debug: () => true });
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e');
        expect(out).toEqual(['2026-11-06T03:01:03.123Z DEBUG d', '2026-11-06T03:01:03.123Z INFO  i']);
        expect(err).toEqual(['2026-11-06T03:01:03.123Z WARN  w', '2026-11-06T03:01:03.123Z ERROR e']);
    });

    it('debug は呼ぶたびに設定を読む（設定より先に作ったロガーも後から有効にできる）', () => {
        const { out, sink } = capture();
        const flag = { on: false };
        const logger = createServerLogger({ sink, tty: false, now: () => time, debug: () => flag.on });
        logger.debug('隠れる');
        flag.on = true;
        logger.debug('出る');
        expect(out).toEqual(['2026-11-06T03:01:03.123Z DEBUG 出る']);
    });

    it('child は範囲を繋ぐ', () => {
        const { out, sink } = capture();
        createServerLogger({ sink, tty: false, now: () => time, scope: 'auth' })
            .child('otp')
            .info('x');
        expect(out).toEqual(['2026-11-06T03:01:03.123Z INFO  [auth:otp] x']);
    });

    it('TTY でなければ NO_COLOR が無くても色を付けない（本番のログに制御符号を混ぜない）', () => {
        const { err, sink } = capture();
        createServerLogger({ sink, tty: false, env: {}, now: () => time }).error('x');
        expect(err[0]).toBe(stripAnsi(err[0] ?? ''));
    });
});
