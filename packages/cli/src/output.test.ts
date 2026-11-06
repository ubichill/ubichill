import { plainPaint, stripAnsi } from '@ubichill/terminal';
import { describe, expect, it } from 'vitest';
import { COMMANDS, formatHelp } from './help.ts';
import { createCliTerminal, findPackageVersion, isLikelyBug, splitGlobalFlags } from './output.ts';

describe('splitGlobalFlags', () => {
    it('--debug はサブコマンドの前でも後ろでも効き、サブコマンドには渡さない', () => {
        expect(splitGlobalFlags(['--debug', 'build', '--mods-dir=mods'])).toEqual({
            debug: true,
            args: ['build', '--mods-dir=mods'],
        });
        expect(splitGlobalFlags(['dev', 'world.yaml', '--debug'])).toEqual({
            debug: true,
            args: ['dev', 'world.yaml'],
        });
    });

    it('似た名前のフラグ（--debug=1・--debugger）は取り除かない', () => {
        expect(splitGlobalFlags(['dev', '--debug=1', '--debugger'])).toEqual({
            debug: false,
            args: ['dev', '--debug=1', '--debugger'],
        });
    });
});

describe('createCliTerminal', () => {
    const io = (env: Record<string, string>) => {
        const out: string[] = [];
        return {
            out,
            io: {
                stdout: { write: (c: string) => out.push(c) },
                stderr: { write: () => true },
                env,
                platform: 'linux',
                now: () => new Date(),
            },
        };
    };

    it('--debug か UBICHILL_DEBUG=1 で debug を出す', () => {
        const flag = io({});
        createCliTerminal(true, flag.io).debug('x');
        const env = io({ UBICHILL_DEBUG: '1' });
        createCliTerminal(false, env.io).debug('x');
        const off = io({ UBICHILL_DEBUG: '0' });
        createCliTerminal(false, off.io).debug('x');
        expect([flag.out, env.out, off.out]).toEqual([['x\n'], ['x\n'], []]);
    });
});

describe('isLikelyBug', () => {
    it('型の誤り・未定義の参照・範囲外は CLI の不具合として --debug を案内する。使い方の誤りは案内しない', () => {
        expect(isLikelyBug(new TypeError('x'))).toBe(true);
        expect(isLikelyBug(new ReferenceError('x'))).toBe(true);
        expect(isLikelyBug(new Error('package.json が見つかりません'))).toBe(false);
        expect(isLikelyBug('string')).toBe(false);
    });
});

describe('findPackageVersion', () => {
    const files: Record<string, string> = {
        '/repo/package.json': JSON.stringify({ name: 'ubichill', version: '0.0.0' }),
        '/repo/packages/cli/package.json': JSON.stringify({ name: '@ubichill/cli', version: '1.0.2' }),
        '/broken/package.json': '{ not json',
    };
    const read = (path: string) => files[path];

    it('ソース（src/）からもバンドル（dist-npm/）からも、上へ辿って自分の package.json を見つける', () => {
        expect(findPackageVersion('/repo/packages/cli/src/dev', '@ubichill/cli', read)).toBe('1.0.2');
        expect(findPackageVersion('/repo/packages/cli', '@ubichill/cli', read)).toBe('1.0.2');
    });

    it('別の名前の package.json・壊れた package.json は飛ばし、根まで無ければ undefined', () => {
        expect(findPackageVersion('/repo/other', '@ubichill/cli', read)).toBeUndefined();
        expect(findPackageVersion('/broken/x', '@ubichill/cli', read)).toBeUndefined();
    });
});

describe('formatHelp', () => {
    it('全部のコマンドと --debug を案内する', () => {
        const help = stripAnsi(formatHelp('1.0.2', plainPaint));
        expect(help.split('\n')[0]).toBe('ubichill  v1.0.2');
        for (const [usage] of COMMANDS) expect(help).toContain(usage);
        expect(help).toContain('--debug');
    });

    it('版が分からなくても出せる', () => {
        expect(formatHelp(undefined, plainPaint).split('\n')[0]).toBe('ubichill');
    });
});
