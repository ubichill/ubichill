import { describe, expect, it } from 'vitest';
import { colorEnabled, debugFromEnv, unicodeEnabled } from './env.ts';

describe('colorEnabled', () => {
    it('TTY なら色を付け、パイプ・ファイル（TTY でない）なら付けない', () => {
        expect(colorEnabled({ isTTY: true, env: {} })).toBe(true);
        expect(colorEnabled({ isTTY: false, env: {} })).toBe(false);
        expect(colorEnabled({ isTTY: undefined, env: {} })).toBe(false);
    });

    it('NO_COLOR は値があれば TTY でも消す。空の NO_COLOR は指定なしと同じ（no-color.org）', () => {
        expect(colorEnabled({ isTTY: true, env: { NO_COLOR: '1' } })).toBe(false);
        expect(colorEnabled({ isTTY: true, env: { NO_COLOR: '0' } })).toBe(false);
        expect(colorEnabled({ isTTY: true, env: { NO_COLOR: '' } })).toBe(true);
        expect(colorEnabled({ isTTY: true, env: { NODE_DISABLE_COLORS: '1' } })).toBe(false);
    });

    it('FORCE_COLOR は NO_COLOR より強く、TTY でなくても色を付ける（Node と同じ優先順）', () => {
        expect(colorEnabled({ isTTY: false, env: { FORCE_COLOR: '1' } })).toBe(true);
        expect(colorEnabled({ isTTY: false, env: { FORCE_COLOR: '' } })).toBe(true);
        expect(colorEnabled({ isTTY: false, env: { FORCE_COLOR: '3', NO_COLOR: '1' } })).toBe(true);
    });

    it('FORCE_COLOR=0 / false は TTY でも消す（大文字・空白も同じ）', () => {
        expect(colorEnabled({ isTTY: true, env: { FORCE_COLOR: '0' } })).toBe(false);
        expect(colorEnabled({ isTTY: true, env: { FORCE_COLOR: ' FALSE ' } })).toBe(false);
    });

    it('TERM=dumb は TTY でも色を付けない', () => {
        expect(colorEnabled({ isTTY: true, env: { TERM: 'dumb' } })).toBe(false);
    });
});

describe('unicodeEnabled', () => {
    it('macOS・Linux の端末は描ける。Linux のカーネルのコンソール（TERM=linux）は描けない', () => {
        expect(unicodeEnabled({ platform: 'darwin', env: {} })).toBe(true);
        expect(unicodeEnabled({ platform: 'linux', env: { TERM: 'xterm-256color' } })).toBe(true);
        expect(unicodeEnabled({ platform: 'linux', env: { TERM: 'linux' } })).toBe(false);
    });

    it('Windows は Windows Terminal・VS Code・CI でだけ描ける（conhost は描けない）', () => {
        expect(unicodeEnabled({ platform: 'win32', env: {} })).toBe(false);
        expect(unicodeEnabled({ platform: 'win32', env: { WT_SESSION: 'abc' } })).toBe(true);
        expect(unicodeEnabled({ platform: 'win32', env: { TERM_PROGRAM: 'vscode' } })).toBe(true);
        expect(unicodeEnabled({ platform: 'win32', env: { CI: 'true' } })).toBe(true);
    });
});

describe('debugFromEnv', () => {
    it.each(['1', 'true', 'TRUE', ' yes ', 'on', 'anything'])('UBICHILL_DEBUG=%j は有効', (value) => {
        expect(debugFromEnv({ UBICHILL_DEBUG: value })).toBe(true);
    });

    it.each(['', '0', 'false', 'False', 'no', 'off', ' 0 '])('UBICHILL_DEBUG=%j は無効', (value) => {
        expect(debugFromEnv({ UBICHILL_DEBUG: value })).toBe(false);
    });

    it('未設定なら無効（ほかの DEBUG には反応しない）', () => {
        expect(debugFromEnv({ DEBUG: '1' })).toBe(false);
    });
});
