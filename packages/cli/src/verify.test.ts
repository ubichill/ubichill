import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyAllModLocks } from './verify.ts';

describe('verifyAllModLocks', () => {
    const roots: string[] = [];
    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    /** 相対パス → 中身でファイルを置いた一時ディレクトリを作る。 */
    function outputOf(files: Record<string, string>): string {
        const root = mkdtempSync(join(tmpdir(), 'ubichill-verify-'));
        roots.push(root);
        for (const [path, text] of Object.entries(files)) {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), text);
        }
        return root;
    }

    it('lock.json の無い版のディレクトリは不合格（build は常に lock.json を書く）', () => {
        const root = outputOf({ 'pen/v1.0.0/canvas/index.js': 'export {}' });
        expect(verifyAllModLocks(root)).toEqual([expect.stringContaining('pen/v1.0.0: lock.json が無い')]);
    });

    it('単体 mod の出力でも、lock.json の無い版は不合格', () => {
        const root = outputOf({ 'mod.json': '{}', 'v1.0.0/manifest.json': '{}' });
        expect(verifyAllModLocks(root)).toEqual([expect.stringContaining('v1.0.0: lock.json が無い')]);
    });

    it('lock.json の有る版と無い版が混ざっていれば、無い版だけを挙げる', () => {
        const root = outputOf({
            'pen/v1.0.0/canvas/index.js': 'export {}',
            'pen/v1.1.0/lock.json': 'null',
        });
        const errors = verifyAllModLocks(root);
        expect(errors).toContainEqual(expect.stringContaining('pen/v1.0.0: lock.json が無い'));
        expect(errors).toContainEqual(expect.stringContaining('pen/v1.1.0: lock.json がスキーマ不正'));
    });

    it('版のディレクトリが 1 つも無ければ不合格（--dist-dir の指定ミスに気付けるように）', () => {
        expect(verifyAllModLocks(outputOf({}))).toEqual([expect.stringContaining('版のディレクトリがありません')]);
        expect(verifyAllModLocks(outputOf({ 'mod.json': '{}', 'index.json': '{}' }))).toEqual([
            expect.stringContaining('版のディレクトリがありません'),
        ]);
    });

    it('v で始まる mod の ID だけがあり、その下に版が無ければ不合格', () => {
        const root = outputOf({ 'video-player/mod.json': '{}' });
        expect(verifyAllModLocks(root)).toEqual([expect.stringContaining('版のディレクトリがありません')]);
    });

    it('出力のディレクトリが無ければ不合格', () => {
        expect(verifyAllModLocks(join(tmpdir(), 'ubichill-verify-missing', 'nope'))).toEqual([
            expect.stringContaining('が存在しません'),
        ]);
    });
});
