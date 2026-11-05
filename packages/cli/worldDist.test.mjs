import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { reachableChunks, worldDistFiles, workerScripts } from './worldDist.mjs';

const manifest = {
    '_shared-a.js': { file: 'assets/shared-a.js', imports: ['_runtime.js'], css: ['assets/shared.css'] },
    '_runtime.js': { file: 'assets/runtime.js' },
    'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_runtime.js', '_shared-a.js'] },
    'world.html': { file: 'assets/world.js', isEntry: true, imports: ['_runtime.js', '_shared-a.js'], dynamicImports: ['_lazy.js'] },
    '_lazy.js': { file: 'assets/lazy.js' },
};

describe('worldDist', () => {
    const dist = mkdtempSync(join(tmpdir(), 'ubichill-dist-'));
    mkdirSync(join(dist, '.vite'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, '.vite', 'manifest.json'), JSON.stringify(manifest));
    for (const name of ['sandbox.worker-AbC123.js', 'index-x.js', 'other.worker-x.js']) writeFileSync(join(dist, 'assets', name), '');
    afterAll(() => rmSync(dist, { recursive: true, force: true }));

    it('world.html から import・dynamicImport で辿れる chunk だけ（index.html のものは入れない）', () => {
        expect(reachableChunks(manifest, 'world.html').sort()).toEqual(['_lazy.js', '_runtime.js', '_shared-a.js', 'world.html']);
    });

    it('manifest に出ない Sandbox Worker の chunk は assets の名前で拾う', () => {
        expect(workerScripts(dist)).toEqual(['assets/sandbox.worker-AbC123.js']);
    });

    it('公開物は HTML・アイコン・辿れる JS・Worker・CSS', () => {
        expect(worldDistFiles(dist)).toEqual([
            'world.html',
            'icon.png',
            'assets/world.js',
            'assets/runtime.js',
            'assets/shared-a.js',
            'assets/lazy.js',
            'assets/sandbox.worker-AbC123.js',
            'assets/shared.css',
        ]);
    });
});
