import { recordingLogger } from '@ubichill/terminal';
import { describe, expect, it } from 'vitest';
import { formatAttrs, goArgs, goLevelOf, parseGoLogLine, reportGoLine, shouldShowGoLine } from './goLog.ts';

describe('parseGoLogLine', () => {
    it('slog の JSON の行を level・本文・属性に分ける（time は使わない）', () => {
        expect(
            parseGoLogLine('{"time":"2026-11-06T12:01:03.1+09:00","level":"WARN","msg":"slow","room":"r1","n":3}'),
        ).toEqual({ kind: 'record', level: 'warn', message: 'slow', attrs: 'room=r1 n=3' });
    });

    it('JSON でない行（panic・古いバイナリ）はそのまま。末尾の空白と CR は落とす', () => {
        expect(parseGoLogLine('panic: runtime error\r')).toEqual({ kind: 'raw', text: 'panic: runtime error' });
        expect(parseGoLogLine('2026/11/06 12:01:03 listening on 127.0.0.1:1')).toEqual({
            kind: 'raw',
            text: '2026/11/06 12:01:03 listening on 127.0.0.1:1',
        });
    });

    it('JSON に見えて壊れている・msg が無い・配列は、そのまま出す（捨てない）', () => {
        expect(parseGoLogLine('{"level":"INFO","msg":')).toEqual({ kind: 'raw', text: '{"level":"INFO","msg":' });
        expect(parseGoLogLine('{"level":"INFO"}')).toEqual({ kind: 'raw', text: '{"level":"INFO"}' });
        expect(parseGoLogLine('[1,2]')).toEqual({ kind: 'raw', text: '[1,2]' });
        expect(parseGoLogLine('{"msg":42}')).toEqual({ kind: 'raw', text: '{"msg":42}' });
    });

    it('空行・空白だけの行は null', () => {
        expect(parseGoLogLine('')).toBeNull();
        expect(parseGoLogLine('   \t')).toBeNull();
    });

    it('level が無い・知らない JSON の行は info として扱う', () => {
        expect(parseGoLogLine('{"msg":"x"}')).toMatchObject({ kind: 'record', level: 'info' });
        expect(parseGoLogLine('{"msg":"x","level":"TRACE"}')).toMatchObject({ level: 'info' });
    });
});

describe('goLevelOf', () => {
    it.each([
        ['DEBUG', 'debug'],
        ['DEBUG-4', 'debug'],
        ['INFO', 'info'],
        ['INFO+2', 'info'],
        ['WARN', 'warn'],
        ['warn', 'warn'],
        ['ERROR', 'error'],
        ['ERROR+4', 'error'],
        [8, 'info'],
        [undefined, 'info'],
    ] as const)('%j → %s', (value, level) => {
        expect(goLevelOf(value)).toBe(level);
    });
});

describe('formatAttrs', () => {
    it('空白・引用符・= を含む値と空文字は JSON の文字列にする', () => {
        expect(formatAttrs({ a: 'x y', b: 'say "hi"', c: 'k=v', d: '', e: 'plain' })).toBe(
            'a="x y" b="say \\"hi\\"" c="k=v" d="" e=plain',
        );
    });

    it('slog のグループ（入れ子）は group.key に開き、配列・null・真偽値は JSON のまま', () => {
        expect(formatAttrs({ req: { id: 7, peer: { addr: '1.2.3.4' } }, tags: ['a', 'b'], x: null, ok: true })).toBe(
            'req.id=7 req.peer.addr=1.2.3.4 tags=["a","b"] x=null ok=true',
        );
    });

    it('空のグループは何も出さない', () => {
        expect(formatAttrs({ empty: {}, a: 1 })).toBe('a=1');
    });
});

describe('shouldShowGoLine / reportGoLine', () => {
    const record = (level: 'debug' | 'info' | 'warn' | 'error') =>
        ({ kind: 'record', level, message: 'm', attrs: '' }) as const;

    it('ふだんは warn・error と JSON でない行だけ、--debug では全部', () => {
        expect(['debug', 'info', 'warn', 'error'].map((l) => shouldShowGoLine(record(l as 'info'), false))).toEqual([
            false,
            false,
            true,
            true,
        ]);
        expect(shouldShowGoLine({ kind: 'raw', text: 'panic' }, false)).toBe(true);
        expect(shouldShowGoLine(record('debug'), true)).toBe(true);
    });

    it('属性は補足に、属性が無ければ補足なし。JSON でない行は info', () => {
        const { logger, entries } = recordingLogger();
        reportGoLine({ kind: 'record', level: 'error', message: 'x', attrs: 'a=1' }, logger);
        reportGoLine(record('warn'), logger);
        reportGoLine({ kind: 'raw', text: 'panic' }, logger);
        expect(entries).toEqual([
            { level: 'error', message: 'x', detail: 'a=1' },
            { level: 'warn', message: 'm' },
            { level: 'info', message: 'panic' },
        ]);
    });
});

describe('goArgs', () => {
    it('JSON のログで起動し、--debug でなければ warn より上だけを書かせる', () => {
        expect(
            goArgs({ port: 4000, origins: ['http://localhost:3333', 'http://127.0.0.1:3333'], debug: false }),
        ).toEqual([
            '--guests',
            '--listen=127.0.0.1:4000',
            '--origins=http://localhost:3333,http://127.0.0.1:3333',
            '--log-format=json',
            '--log-level=warn',
        ]);
        expect(goArgs({ port: 4000, origins: [], debug: true })).toContain('--log-level=debug');
    });
});
