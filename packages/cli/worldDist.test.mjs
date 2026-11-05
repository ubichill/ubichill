import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isWorldDistFile, worldDistFiles } from './worldDist.mjs';

describe('worldDist', () => {
    const dist = mkdtempSync(join(tmpdir(), 'ubichill-dist-world-'));
    mkdirSync(join(dist, 'assets'));
    for (const file of ['world.html', 'icon.png', 'assets/world-a.js', 'assets/sandbox.worker-b.js', 'assets/world-c.css']) {
        writeFileSync(join(dist, file), '');
    }
    afterAll(() => rmSync(dist, { recursive: true, force: true }));

    it('出力の中の全ファイルを POSIX の相対パスで返す（Worker の chunk も含む）', () => {
        expect(worldDistFiles(dist)).toEqual([
            'assets/sandbox.worker-b.js',
            'assets/world-a.js',
            'assets/world-c.css',
            'icon.png',
            'world.html',
        ]);
    });

    it('world.html が無ければビルドを案内する', () => {
        const empty = mkdtempSync(join(tmpdir(), 'ubichill-dist-empty-'));
        expect(() => worldDistFiles(empty)).toThrow('build:world');
        rmSync(empty, { recursive: true, force: true });
    });

    it('置いてよいのは HTML・アイコン・assets だけ（public の mod や画像は入れない）', () => {
        expect(['world.html', 'icon.png', 'assets/x.js'].every(isWorldDistFile)).toBe(true);
        expect(['mods/pen/mod.json', 'avatar-content/a.png', 'index.html', '50x.html'].some(isWorldDistFile)).toBe(false);
    });
});
