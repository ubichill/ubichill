import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInstall } from '@ubichill/loader/install-dependencies';
import { runUpdate } from '@ubichill/loader/update-dependencies';
import { writeWorldFiles } from '@ubichill/loader/world-files';
import { silentLogger } from '@ubichill/terminal';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { compileMod, runBuild } from './build';
import { synthesizeFromArtifacts } from './dev/pipeline';
import { initProject } from './packages';
import { runPrefab } from './prefab';
import { assertReleaseUnchanged, checkPublicRelease } from './release';

const cwd = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'ubichill-package-workflow-'));
afterEach(() => {
    process.chdir(cwd);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('package development workflow', () => {
    it('標準 Component だけの package をビルド・固定・複数配置・Unpack できる', async () => {
        process.chdir(dir);
        initProject(['world', 'my-world'], silentLogger);
        process.chdir(join(dir, 'my-world'));
        mkdirSync('prefabs');
        writeFileSync(
            'prefabs/welcome.json',
            JSON.stringify({
                name: 'Welcome',
                entities: [
                    {
                        id: 'label',
                        transform: { x: 0, y: 0 },
                        components: [{ type: 'core:ui', data: { markup: '<div>Hello</div>' } }],
                    },
                ],
            }),
        );
        await runBuild([], silentLogger);
        const entry = JSON.parse(readFileSync('dist/my-world/v1.0.0/lock.json', 'utf8'));
        expect(entry.components).toEqual({});
        const artifact = await compileMod(process.cwd());
        const preview = synthesizeFromArtifacts(new Map([[artifact.id, artifact]]));
        expect(JSON.stringify(preview)).toContain('core:ui');
        const world = yaml.parse(readFileSync('world.yaml', 'utf8'));
        world.spec.dependencies = [{ name: 'my-world', source: { version: '1.0.0' } }];
        writeFileSync('world.yaml', yaml.stringify(world));
        await runInstall(['world.yaml', '--mods-dir=dist'], silentLogger);
        await runPrefab(['add', 'my-world/welcome', '--world=world.yaml'], silentLogger);
        await runPrefab(['add', 'my-world/welcome', '--world=world.yaml'], silentLogger);
        const placed = yaml.parse(readFileSync('world.yaml', 'utf8')).spec.initialEntities;
        expect(placed[1].prefab.entityIds.label).not.toBe(placed[2].prefab.entityIds.label);
        await runPrefab(['unpack', placed[1].id, '--world=world.yaml'], silentLogger);
        expect(yaml.parse(readFileSync('world.yaml', 'utf8')).spec.initialEntities[1]).not.toHaveProperty('prefab');
        await checkPublicRelease(entry, 'https://cdn.example/mods', async (url) =>
            readFileSync(join(process.cwd(), 'dist', url.replace('https://cdn.example/mods/', ''))),
        );
    });
    it('更新失敗では YAML と既存 lock を一緒に保持する', async () => {
        process.chdir(dir);
        initProject(['world', 'failed-update'], silentLogger);
        process.chdir('failed-update');
        const world = yaml.parse(readFileSync('world.yaml', 'utf8'));
        world.spec.dependencies = [{ name: 'demo', source: { version: '1.0.0' } }];
        writeFileSync('world.yaml', yaml.stringify(world));
        mkdirSync('dist/demo', { recursive: true });
        writeFileSync('dist/demo/mod.json', JSON.stringify({ version: '2.0.0' }));
        writeFileSync('world.lock.json', JSON.stringify({ lockVersion: 1, mods: {} }));
        const before = readFileSync('world.yaml', 'utf8');
        const lock = readFileSync('world.lock.json', 'utf8');
        await expect(runUpdate(['world.yaml', '--mods-dir=dist'], silentLogger)).rejects.toThrow();
        expect(readFileSync('world.yaml', 'utf8')).toBe(before);
        expect(readFileSync('world.lock.json', 'utf8')).toBe(lock);
    });
    it('同じ版の差し替えと同時編集を拒否する', async () => {
        const entry = { id: 'demo', version: '1.0.0', manifestIntegrity: `sha256-${'B'.repeat(43)}=`, components: {} };
        await expect(
            assertReleaseUnchanged(entry, 'https://cdn.example/mods', async () => ({
                ...entry,
                manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
            })),
        ).rejects.toThrow('版を上げて');
        const path = join(dir, 'simultaneous.yaml');
        writeFileSync(path, 'changed');
        expect(() => writeWorldFiles([{ path, text: 'overwrite', expected: 'old' }])).toThrow('ファイルが変わりました');
        expect(readFileSync(path, 'utf8')).toBe('changed');
    });
});
