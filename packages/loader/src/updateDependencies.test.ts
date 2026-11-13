/**
 * runUpdate（`ubichill update`）: pin 済み mod のバージョンを最新に上げて
 * world.yaml を書き換え、lock を再生成することを検証する。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ModLock, PROTOCOL_VERSION } from '@ubichill/shared';
import { recordingLogger, silentLogger } from '@ubichill/terminal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { runUpdate } from './updateDependencies';

function sri(text: string): string {
    return `sha256-${createHash('sha256').update(text).digest('base64')}`;
}

function lockEntryJson(id: string, version: string) {
    return JSON.stringify({ id, version, manifestIntegrity: sri(`${id}@${version}`), components: {} });
}

function writeWorld(worldPath: string, pinnedVersion: string): void {
    writeFileSync(
        worldPath,
        [
            'apiVersion: ubichill.com/v1alpha1',
            'kind: World',
            'metadata:',
            '  name: test-world',
            '  version: 1.0.0',
            'spec:',
            '  displayName: test # コメントは保持されるべき',
            '  dependencies:',
            '    - name: pen',
            '      source:',
            '        type: local',
            `        version: ${pinnedVersion}`,
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
}

describe('runUpdate', () => {
    let dir: string;
    let modsDir: string;
    let worldPath: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'ubichill-update-'));
        modsDir = join(dir, 'mods');
        mkdirSync(join(modsDir, 'pen', 'v1.0.0'), { recursive: true });
        mkdirSync(join(modsDir, 'pen', 'v2.0.0'), { recursive: true });
        writeFileSync(join(modsDir, 'pen', 'mod.json'), JSON.stringify({ id: 'pen', version: '2.0.0' }));
        writeFileSync(join(modsDir, 'pen', 'v1.0.0', 'lock.json'), lockEntryJson('pen', '1.0.0'));
        writeFileSync(join(modsDir, 'pen', 'v2.0.0', 'lock.json'), lockEntryJson('pen', '2.0.0'));

        worldPath = join(dir, 'world.yaml');
        writeWorld(worldPath, '1.0.0');
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('pin 済みバージョンが古ければ world.yaml を最新へ書き換え、コメント/フォーマットを保持する', async () => {
        const { logger, entries } = recordingLogger();
        await runUpdate([worldPath, `--mods-dir=${modsDir}`], logger);
        expect(entries[0]).toEqual({ level: 'success', message: '1 個の mod の版を上げました\n  pen: 1.0.0 → 2.0.0' });

        const rewritten = readFileSync(worldPath, 'utf-8');
        expect(rewritten).toMatch(/version: 2\.0\.0/);
        expect(rewritten).toMatch(/displayName: test # コメントは保持されるべき/);
    });

    it('版を上げても、版の行のほかは元の文字列のまま（フロー形式の整形も変えない）', async () => {
        const before = readFileSync(worldPath, 'utf-8');
        await runUpdate([worldPath, `--mods-dir=${modsDir}`], silentLogger);
        expect(readFileSync(worldPath, 'utf-8')).toBe(
            before
                .replace('version: 1.0.0\n  initialEntities', 'version: 2.0.0\n  initialEntities')
                .replace('  initialEntities:', `  requires:\n    protocol: ${PROTOCOL_VERSION}\n  initialEntities:`),
        );
    });

    it('書き換え後にロックも再生成され、新バージョンが反映される', async () => {
        const outPath = worldPath.replace(/\.ya?ml$/i, '.lock.json');
        await runUpdate([worldPath, `--mods-dir=${modsDir}`], silentLogger);

        const lock = JSON.parse(readFileSync(outPath, 'utf-8')) as ModLock;
        expect(lock.mods.pen.version).toBe('2.0.0');
    });

    it('既に最新版が pin されていて ubichill の版もあれば world.yaml を書き換えない', async () => {
        writeWorld(worldPath, '2.0.0');
        writeFileSync(
            worldPath,
            readFileSync(worldPath, 'utf-8').replace(
                '  initialEntities:',
                '  requires:\n    protocol: 7\n  initialEntities:',
            ),
        );
        const before = readFileSync(worldPath, 'utf-8');

        await runUpdate([worldPath, `--mods-dir=${modsDir}`], silentLogger);

        expect(readFileSync(worldPath, 'utf-8')).toBe(before);
    });

    it('ubichill の版が無ければ今の版で固定する（版は上げない）', async () => {
        writeWorld(worldPath, '2.0.0');

        await runUpdate([worldPath, `--mods-dir=${modsDir}`], silentLogger);

        const rewritten = readFileSync(worldPath, 'utf-8');
        expect(yaml.parse(rewritten).spec.requires).toEqual({ protocol: PROTOCOL_VERSION });
        expect(yaml.parse(rewritten).spec.dependencies[0].source.version).toBe('2.0.0');
        expect(rewritten).toContain('# コメントは保持されるべき');
    });

    it("source.version: 'latest' は最新版で lock を作り、その版を world.yaml に書いて固定する", async () => {
        writeWorld(worldPath, 'latest');

        await runUpdate([worldPath, `--mods-dir=${modsDir}`], silentLogger);

        expect(yaml.parse(readFileSync(worldPath, 'utf-8')).spec.dependencies[0].source.version).toBe('2.0.0');
    });

    it('--mods-dir が world.yaml より前に置かれても、lock 再生成に引き継がれる', async () => {
        const outPath = worldPath.replace(/\.ya?ml$/i, '.lock.json');
        // 引数の順序を入れ替える（フラグが先）。runUpdate→runInstall の引き継ぎで
        // 落ちていないか（--mods-dir が失われて既定の process.cwd()/mods を見に行き
        // pen が見つからなくならないか）を確認する。
        await runUpdate([`--mods-dir=${modsDir}`, worldPath], silentLogger);

        const lock = JSON.parse(readFileSync(outPath, 'utf-8')) as ModLock;
        expect(lock.mods.pen.version).toBe('2.0.0');
    });

    it('modName を指定すると、そのmod以外は更新対象にしない', async () => {
        // pen 以外の未 pin 依存を追加しても pen だけが対象になることを、対象外指定で確認する
        await expect(runUpdate([worldPath, 'other-mod', `--mods-dir=${modsDir}`], silentLogger)).rejects.toThrow(
            '依存にありません',
        );

        const rewritten = readFileSync(worldPath, 'utf-8');
        expect(rewritten).toMatch(/version: 1\.0\.0/); // pen は対象外なので書き換わらない
    });
});
