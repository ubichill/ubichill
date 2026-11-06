/**
 * ビルドの失敗を端末向けの文にする。esbuild の失敗はファイルの位置とコードの抜き出し付き（esbuild の formatMessages）、
 * それ以外はメッセージだけ。
 */
import { messageOf } from '@ubichill/terminal';
import * as esbuild from 'esbuild';

/** esbuild の BuildFailure（`errors` に Message を持つ）か。 */
export function esbuildErrorsOf(error: unknown): esbuild.Message[] | undefined {
    if (!(error instanceof Error)) return undefined;
    const { errors } = error as { errors?: unknown };
    if (!Array.isArray(errors) || errors.length === 0) return undefined;
    const valid = errors.every(
        (message) => typeof message === 'object' && message !== null && typeof message.text === 'string',
    );
    return valid ? (errors as esbuild.Message[]) : undefined;
}

export async function describeBuildFailure(error: unknown, options: { readonly color: boolean }): Promise<string> {
    const errors = esbuildErrorsOf(error);
    if (!errors) return messageOf(error);
    const formatted = await esbuild.formatMessages(errors, { kind: 'error', color: options.color });
    return formatted.join('').replace(/\s+$/, '');
}
