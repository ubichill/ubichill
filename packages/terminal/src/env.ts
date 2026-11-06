/**
 * 端末の能力の判定。値（TTY か・環境変数・OS）は呼び出し側が渡す純粋関数にして、テストで組み合わせを試せるようにする。
 */

/** 環境変数の表（`process.env` と同じ形）。 */
export type EnvTable = Readonly<Record<string, string | undefined>>;

/** `--debug` と同じ意味の環境変数。 */
export const DEBUG_ENV = 'UBICHILL_DEBUG';

const OFF_VALUES = new Set(['', '0', 'false', 'no', 'off']);

/**
 * 色を付けるか。優先順は Node の `util.styleText` と同じ: FORCE_COLOR（`0`・`false` 以外なら空でも有効）、
 * NO_COLOR / NODE_DISABLE_COLORS（空でない値で無効。no-color.org）、TERM=dumb、最後にストリームが TTY か。
 */
export function colorEnabled(input: { readonly isTTY: boolean | undefined; readonly env: EnvTable }): boolean {
    const { env } = input;
    if (env.FORCE_COLOR !== undefined) return !['0', 'false'].includes(env.FORCE_COLOR.trim().toLowerCase());
    if (env.NO_COLOR || env.NODE_DISABLE_COLORS) return false;
    if (env.TERM === 'dumb') return false;
    return input.isTTY === true;
}

/**
 * ✓ ✗ ➜ を描けるか。Windows の古いコンソール（conhost）と Linux のカーネルのコンソールは描けないので代わりの記号にする
 * （判定は is-unicode-supported と同じ）。
 */
export function unicodeEnabled(input: { readonly platform: string; readonly env: EnvTable }): boolean {
    const { env } = input;
    if (input.platform !== 'win32') return env.TERM !== 'linux';
    return Boolean(
        env.CI ||
            env.WT_SESSION ||
            env.TERMINUS_SUBLIME ||
            env.ConEmuTask === '{cmd::Cmder}' ||
            env.TERM_PROGRAM === 'vscode' ||
            env.TERM === 'xterm-256color' ||
            env.TERM === 'alacritty' ||
            env.TERMINAL_EMULATOR === 'JetBrains-JediTerm',
    );
}

/** `UBICHILL_DEBUG` が有効か（`1`・`true` など。`0`・`false`・`off`・空は無効）。 */
export function debugFromEnv(env: EnvTable): boolean {
    const value = env[DEBUG_ENV];
    return value !== undefined && !OFF_VALUES.has(value.trim().toLowerCase());
}
