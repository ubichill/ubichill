import { describe, expect, it } from 'vitest';
import { HintedError } from './error.ts';
import { recordingLogger, remapLevels, silentLogger } from './logger.ts';
import { stripAnsi } from './paint.ts';
import { createTerminal, type TerminalIO } from './terminal.ts';

const fakeIO = (options: { tty?: boolean; env?: Record<string, string>; platform?: string } = {}) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io: TerminalIO = {
        stdout: { write: (chunk: string) => stdout.push(chunk), isTTY: options.tty ?? false },
        stderr: { write: (chunk: string) => stderr.push(chunk), isTTY: options.tty ?? false },
        env: options.env ?? {},
        platform: options.platform ?? 'darwin',
        now: () => new Date(2026, 10, 6, 12, 1, 3),
    };
    return { io, stdout, stderr };
};

describe('createTerminal', () => {
    it('info・success は stdout、warn・error は stderr（stdout に結果を出すコマンドを汚さない）', () => {
        const { io, stdout, stderr } = fakeIO();
        const term = createTerminal(io, { debug: false });
        term.info('i');
        term.success('s');
        term.warn('w');
        term.error('e');
        expect(stdout).toEqual(['i\n', '✓ s\n']);
        expect(stderr).toEqual(['! w\n', '✗ e\n']);
    });

    it('debug は --debug のときだけ出す', () => {
        const quiet = fakeIO();
        createTerminal(quiet.io, { debug: false }).debug('x');
        expect(quiet.stdout).toEqual([]);
        const loud = fakeIO();
        createTerminal(loud.io, { debug: true }).debug('x');
        expect(loud.stdout).toEqual(['x\n']);
    });

    it('scope は時刻と [範囲] を付け、clock: false なら時刻を付けない', () => {
        const { io, stdout } = fakeIO();
        const term = createTerminal(io, { debug: false });
        term.scope('dev').success('ready');
        term.scope('build', { clock: false }).info('x');
        expect(stdout).toEqual(['12:01:03 [dev] ✓ ready\n', '[build] x\n']);
    });

    it('TTY なら色を付け、TTY でも NO_COLOR なら付けない', () => {
        const tty = fakeIO({ tty: true });
        createTerminal(tty.io, { debug: false }).success('x');
        expect(tty.stdout[0]).not.toBe(stripAnsi(tty.stdout[0] ?? ''));
        const noColor = fakeIO({ tty: true, env: { NO_COLOR: '1' } });
        createTerminal(noColor.io, { debug: false }).success('x');
        expect(noColor.stdout).toEqual(['✓ x\n']);
    });

    it('色はストリームごとに決める（stdout だけリダイレクトしても stderr は色付き）', () => {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const term = createTerminal(
            {
                stdout: { write: (c: string) => stdout.push(c), isTTY: false },
                stderr: { write: (c: string) => stderr.push(c), isTTY: true },
                env: {},
                platform: 'linux',
                now: () => new Date(),
            },
            { debug: false },
        );
        term.success('out');
        term.error('err');
        expect(stdout).toEqual(['✓ out\n']);
        expect(stderr[0]).toContain('\u001b[31m');
    });

    it('Windows の古いコンソールでは代わりの記号', () => {
        const { io, stdout } = fakeIO({ platform: 'win32' });
        createTerminal(io, { debug: false }).success('x');
        expect(stdout).toEqual(['√ x\n']);
    });

    it('failure は stderr に出し、debug でなければスタックを出さない', () => {
        const { io, stderr } = fakeIO();
        createTerminal(io, { debug: false }).failure(new HintedError('壊れた', 'こう直す'));
        expect(stderr).toEqual(['✗ 壊れた\n  ➜ こう直す\n']);
    });

    it('next は矢印を付けて字下げし、stdout へ', () => {
        const { io, stdout } = fakeIO();
        createTerminal(io, { debug: false }).next('ubichill publish で公開できます');
        expect(stdout).toEqual(['  ➜ ubichill publish で公開できます\n']);
    });

    it('print は書式を付けずに stdout へ（空なら空行）', () => {
        const { io, stdout } = fakeIO({ tty: true });
        const term = createTerminal(io, { debug: false });
        term.print('{"a":1}');
        term.print();
        expect(stdout).toEqual(['{"a":1}\n', '\n']);
    });
});

describe('recordingLogger / remapLevels', () => {
    it('受けた level・本文・補足を順に残す', () => {
        const { logger, entries } = recordingLogger();
        logger.success('a', '1 ms');
        logger.error('b');
        expect(entries).toEqual([
            { level: 'success', message: 'a', detail: '1 ms' },
            { level: 'error', message: 'b' },
        ]);
    });

    it('remapLevels は指定した level だけ付け替え、ほかはそのまま通す', () => {
        const { logger, entries } = recordingLogger();
        const quiet = remapLevels(logger, { info: 'debug', success: 'debug' });
        quiet.info('i');
        quiet.success('s');
        quiet.warn('w');
        expect(entries.map((e) => e.level)).toEqual(['debug', 'debug', 'warn']);
    });

    it('silentLogger は何もしない', () => {
        expect(() => silentLogger.error('x')).not.toThrow();
    });
});
