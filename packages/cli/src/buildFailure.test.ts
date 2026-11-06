import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripAnsi } from '@ubichill/terminal';
import * as esbuild from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
import { describeBuildFailure, esbuildErrorsOf } from './buildFailure.ts';

const dir = mkdtempSync(join(tmpdir(), 'ubichill-build-failure-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** 本物の esbuild の失敗（解決できない import）。 */
async function realFailure(): Promise<unknown> {
    mkdirSync(join(dir, 'src'), { recursive: true });
    const entry = join(dir, 'src', 'pen.worker.ts');
    writeFileSync(entry, "import { nope } from './missing';\nexport const config = {};\nconsole.log(nope);\n");
    return esbuild.build({ entryPoints: [entry], bundle: true, write: false, logLevel: 'silent' }).then(
        () => undefined,
        (error: unknown) => error,
    );
}

describe('describeBuildFailure', () => {
    it('esbuild の失敗はファイルの位置とコードの抜き出しを付ける（色なし）', async () => {
        const text = await describeBuildFailure(await realFailure(), { color: false });
        expect(text).toContain('Could not resolve "./missing"');
        expect(text).toContain('src/pen.worker.ts:1:21');
        expect(text).toContain("import { nope } from './missing';");
        expect(text).toBe(stripAnsi(text));
        expect(text).toBe(text.trimEnd());
    });

    it('色ありでは esbuild の色が付く', async () => {
        const text = await describeBuildFailure(await realFailure(), { color: true });
        expect(text).not.toBe(stripAnsi(text));
    });

    it('esbuild でない失敗はメッセージだけ', async () => {
        expect(await describeBuildFailure(new Error('package.json に version が必要です'), { color: false })).toBe(
            'package.json に version が必要です',
        );
        expect(await describeBuildFailure('文字列', { color: false })).toBe('文字列');
    });
});

describe('esbuildErrorsOf', () => {
    it('errors を持っていても esbuild の Message の形でなければ esbuild の失敗とみなさない', () => {
        expect(esbuildErrorsOf(Object.assign(new Error('x'), { errors: ['a'] }))).toBeUndefined();
        expect(esbuildErrorsOf(Object.assign(new Error('x'), { errors: [] }))).toBeUndefined();
        expect(esbuildErrorsOf(new AggregateError([new Error('a')]))).toBeUndefined();
        expect(esbuildErrorsOf({ errors: [{ text: 'x' }] })).toBeUndefined();
    });
});
