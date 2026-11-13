import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeIndex, restorePlan } from './restore-published-mods.mjs';

/** パス → 中身。ディレクトリは中身の無いパスから作る。 */
const memoryFs = (files) => {
    const paths = Object.keys(files);
    const isDir = (dir) => paths.some((p) => p.startsWith(`${dir}/`));
    return {
        listDirs: (dir) => [
            ...new Set(
                paths
                    .filter((p) => p.startsWith(`${dir}/`))
                    .map((p) => p.slice(dir.length + 1).split('/'))
                    .filter((parts) => parts.length > 1)
                    .map((parts) => parts[0]),
            ),
        ],
        exists: (path) => path in files || isDir(path),
        readJson: (path) => JSON.parse(files[path]),
    };
};

const index = (id, versions) => JSON.stringify([{ id, version: versions[0], versions: versions.map((v) => ({ version: v, components: [] })) }]);

describe('restorePlan', () => {
    it('置き先に無い公開済みの版だけを戻す（今の版は build が書く）', () => {
        const fs = memoryFs({
            '/pub/pen/v2.0.0/lock.json': '{}',
            '/pub/pen/v2.0.0/lock.sig.json': '{}',
            '/pub/pen/v2.1.0/lock.json': '{}',
            '/pub/pen/mod.json': '{}',
            '/host/pen/v2.1.0/lock.json': '{}',
            '/host/pen/mod.json': '{}',
        });
        expect(restorePlan('/pub', '/host', fs).copies).toEqual([{ from: '/pub/pen/v2.0.0', to: '/host/pen/v2.0.0' }]);
    });

    it('リポジトリから外した mod は、全部の版と最新版へのポインタを戻す', () => {
        const fs = memoryFs({
            '/pub/video-player/v1.0.0/lock.json': '{}',
            '/pub/video-player/v2.1.0/lock.json': '{}',
            '/pub/video-player/mod.json': '{}',
        });
        expect(restorePlan('/pub', '/host', fs).copies.map((c) => c.to)).toEqual([
            '/host/video-player/v1.0.0',
            '/host/video-player/v2.1.0',
            '/host/video-player/mod.json',
        ]);
    });

    it('版の形でないディレクトリは戻さない', () => {
        const fs = memoryFs({
            '/pub/pen/v2.0.0/lock.json': '{}',
            '/pub/pen/v2/lock.json': '{}',
            '/pub/pen/assets/a.png': '',
            '/pub/pen/v2.0.0-beta/lock.json': '{}',
        });
        expect(restorePlan('/pub', '/host', fs).copies.map((c) => c.to)).toEqual(['/host/pen/v2.0.0']);
    });

    it('版の履歴は、置き先が無ければ公開済みのものを、あれば足し合わせたものを書く', () => {
        const fs = memoryFs({
            '/pub/pen/v2.0.0/lock.json': '{}',
            '/pub/pen/index.json': index('pen', ['2.0.0', '1.0.0']),
            '/pub/dm/v1.0.0/lock.json': '{}',
            '/pub/dm/index.json': index('dm', ['1.0.0']),
            '/host/pen/index.json': index('pen', ['2.1.0']),
        });
        const { indexes } = restorePlan('/pub', '/host', fs);
        const byPath = Object.fromEntries(indexes.map((i) => [i.path, i.entries]));
        expect(Object.keys(byPath).sort()).toEqual(['/host/dm/index.json', '/host/pen/index.json']);
        expect(byPath['/host/dm/index.json'][0].versions.map((v) => v.version)).toEqual(['1.0.0']);
        expect(byPath['/host/pen/index.json'][0].versions.map((v) => v.version)).toEqual(['2.1.0', '2.0.0', '1.0.0']);
    });

    it('公開済みの index.json の履歴から落ちた版も、配っていれば履歴に戻す（Component は lock から取る）', () => {
        const fs = memoryFs({
            '/pub/pen/v2.0.0/lock.json': JSON.stringify({ components: { 'pen:pen': {}, 'pen:tray': {} } }),
            '/pub/pen/v2.1.0/lock.json': JSON.stringify({ components: { 'pen:pen': {} } }),
            '/pub/pen/index.json': JSON.stringify([
                { id: 'pen', version: '2.1.0', versions: [{ version: '2.1.0', components: ['pen:pen', 'pen:x'] }] },
            ]),
        });
        const [{ entries }] = restorePlan('/pub', '/host', fs).indexes;
        expect(entries[0].version).toBe('2.1.0');
        expect(entries[0].versions).toEqual([
            { version: '2.1.0', components: ['pen:pen', 'pen:x'] },
            { version: '2.0.0', components: ['pen:pen', 'pen:tray'] },
        ]);
    });

    it('公開済みの mods が空なら何もしない', () => {
        expect(restorePlan('/pub', '/host', memoryFs({}))).toEqual({ copies: [], indexes: [] });
    });
});

describe('mergeIndex', () => {
    it('同じ版は置き先（今のビルド）を優先し、新しい順に並べる', () => {
        const published = [{ id: 'pen', versions: [{ version: '2.0.0', components: ['pen:old'] }, { version: '1.10.0', components: [] }] }];
        const target = [{ id: 'pen', version: '2.0.0', versions: [{ version: '2.0.0', components: ['pen:new'] }, { version: '1.9.0', components: [] }] }];
        const merged = mergeIndex(published, target);
        expect(merged[0].versions).toEqual([
            { version: '2.0.0', components: ['pen:new'] },
            { version: '1.10.0', components: [] },
            { version: '1.9.0', components: [] },
        ]);
        expect(merged[0].version).toBe('2.0.0');
    });

    it('versions の無い古い形の index.json も、その 1 件を履歴として扱う', () => {
        const merged = mergeIndex([{ id: 'pen', version: '1.0.0', components: ['pen:pen'] }], [
            { id: 'pen', version: '2.0.0', versions: [{ version: '2.0.0', components: [] }] },
        ]);
        expect(merged[0].versions.map((v) => v.version)).toEqual(['2.0.0', '1.0.0']);
    });
});

describe('コマンドとして実行する', () => {
    const dirs = [];
    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it('署名ごと版を戻し、今の版のファイルは上書きしない', () => {
        const root = mkdtempSync(join(tmpdir(), 'restore-mods-'));
        dirs.push(root);
        const write = (path, text) => {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), text);
        };
        write('pub/pen/v2.0.0/lock.json', '{"components":{}}');
        write('pub/pen/v2.0.0/lock.sig.json', 'sig');
        write('pub/pen/v2.1.0/lock.json', '{"published":true}');
        write('pub/pen/index.json', index('pen', ['2.1.0', '2.0.0']));
        write('host/pen/v2.1.0/lock.json', '{"built":true}');

        const script = fileURLToPath(new URL('./restore-published-mods.mjs', import.meta.url));
        execFileSync('node', [script, join(root, 'pub'), join(root, 'host')], { stdio: 'pipe' });

        expect(readFileSync(join(root, 'host/pen/v2.0.0/lock.sig.json'), 'utf8')).toBe('sig');
        expect(readFileSync(join(root, 'host/pen/v2.1.0/lock.json'), 'utf8')).toBe('{"built":true}');
        const restoredIndex = JSON.parse(readFileSync(join(root, 'host/pen/index.json'), 'utf8'));
        expect(restoredIndex[0].versions.map((v) => v.version)).toEqual(['2.1.0', '2.0.0']);
    });
});
