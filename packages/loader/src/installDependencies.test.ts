/**
 * runInstall（`ubichill install`）の per-mod ソース切り替えを検証する。
 *
 * dependencies[].source.type === 'url' の mod だけ、そのURLから個別取得し
 * ModLockEntry.baseUrl に焼き込まれる（他ホストに配布された mod を acquireMod が
 * 正しく見つけられるようにする）ことを確認する。それ以外の mod は従来通り
 * --mods-dir 配下の fs から読む。dependencies[].source.version が pin されている
 * mod は、最新ポインタ（mod.json）を経由せずそのバージョンを直接取得する。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModLock } from '@ubichill/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInstall } from './installDependencies';

const REMOTE_BASE = 'https://cdn.example.test/mods';

function sri(text: string): string {
    return `sha256-${createHash('sha256').update(text).digest('base64')}`;
}

function lockEntryJson(id: string, version: string) {
    return JSON.stringify({ id, version, manifestIntegrity: sri(`${id}@${version}`), components: {} });
}

describe('runInstall', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'ubichill-genlock-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        vi.unstubAllGlobals();
    });

    it('type: url の依存だけそのURLから取得し baseUrl を焼き込む。他は --mods-dir の fs から読む', async () => {
        // ローカル mod（pen）: --mods-dir 配下に配置
        const modsDir = join(dir, 'mods');
        mkdirSync(join(modsDir, 'pen', 'v1.0.0'), { recursive: true });
        writeFileSync(join(modsDir, 'pen', 'mod.json'), JSON.stringify({ id: 'pen', version: '1.0.0' }));
        writeFileSync(join(modsDir, 'pen', 'v1.0.0', 'lock.json'), lockEntryJson('pen', '1.0.0'));

        // リモート mod（video-player）: dependencies[].source.type = 'url' 経由で取得
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (url === `${REMOTE_BASE}/video-player/mod.json`) {
                    return { ok: true, json: async () => ({ id: 'video-player', version: '2.0.0' }) };
                }
                if (url === `${REMOTE_BASE}/video-player/v2.0.0/lock.json`) {
                    return { ok: true, json: async () => JSON.parse(lockEntryJson('video-player', '2.0.0')) };
                }
                return { ok: false, json: async () => null };
            }),
        );

        const worldPath = join(dir, 'world.yaml');
        writeFileSync(
            worldPath,
            [
                'apiVersion: ubichill.com/v1alpha1',
                'kind: World',
                'metadata:',
                '  name: test-world',
                '  version: 1.0.0',
                'spec:',
                '  displayName: test',
                '  dependencies:',
                '    - name: video-player',
                '      source:',
                `        type: url`,
                `        url: ${REMOTE_BASE}`,
                '    - name: pen',
                '      source:',
                '        type: repository',
                '        path: mods/pen',
                '  initialEntities:',
                '    - id: e1',
                '      tags: []',
                '      children: []',
                '      transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 }',
                '      components:',
                '        - data: {}',
                '          type: video-player:screen',
                '    - id: e2',
                '      tags: []',
                '      children: []',
                '      transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 }',
                '      components:',
                '        - data: {}',
                '          type: pen:pen',
            ].join('\n'),
            'utf-8',
        );

        const outPath = join(dir, 'world.lock.json');
        await runInstall([worldPath, `--mods-dir=${modsDir}`, `--out=${outPath}`]);

        const lock = JSON.parse(readFileSync(outPath, 'utf-8')) as ModLock;
        expect(Object.keys(lock.mods).sort()).toEqual(['pen', 'video-player']);
        expect(lock.mods['video-player'].baseUrl).toBe(REMOTE_BASE);
        expect(lock.mods.pen.baseUrl).toBeUndefined();
    });

    it('dependencies[].source.version が pin されていれば、mod.json の最新ではなく指定バージョンを lock する', async () => {
        const modsDir = join(dir, 'mods');
        mkdirSync(join(modsDir, 'pen', 'v1.0.0'), { recursive: true });
        mkdirSync(join(modsDir, 'pen', 'v2.0.0'), { recursive: true });
        // mod.json（最新ポインタ）は 2.0.0 を指すが、world 側は 1.0.0 に pin する
        writeFileSync(join(modsDir, 'pen', 'mod.json'), JSON.stringify({ id: 'pen', version: '2.0.0' }));
        writeFileSync(join(modsDir, 'pen', 'v1.0.0', 'lock.json'), lockEntryJson('pen', '1.0.0'));
        writeFileSync(join(modsDir, 'pen', 'v2.0.0', 'lock.json'), lockEntryJson('pen', '2.0.0'));

        const worldPath = join(dir, 'world.yaml');
        writeFileSync(
            worldPath,
            [
                'apiVersion: ubichill.com/v1alpha1',
                'kind: World',
                'metadata:',
                '  name: test-world',
                '  version: 1.0.0',
                'spec:',
                '  displayName: test',
                '  dependencies:',
                '    - name: pen',
                '      source:',
                '        type: local',
                '        version: 1.0.0',
                '  initialEntities:',
                '    - id: e1',
                '      tags: []',
                '      children: []',
                '      transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 }',
                '      components:',
                '        - data: {}',
                '          type: pen:pen',
            ].join('\n'),
            'utf-8',
        );

        const outPath = join(dir, 'world.lock.json');
        await runInstall([worldPath, `--mods-dir=${modsDir}`, `--out=${outPath}`]);

        const lock = JSON.parse(readFileSync(outPath, 'utf-8')) as ModLock;
        expect(lock.mods.pen.version).toBe('1.0.0');
    });
});
