import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModLock, lockedMods } from '@ubichill/shared';
import { silentLogger } from '@ubichill/terminal';
import { afterEach, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import * as packages from '../../loader/src/packages';
import { installPackage } from './packages';

const dirs: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
it('作者参照のinstallで上書きするときも、権限追加を承認するまでファイルを変更しない', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ubichill-install-capability-'));
    dirs.push(dir);
    const path = join(dir, 'world.yaml');
    const lockPath = join(dir, 'world.lock.json');
    const integrity = `sha256-${createHash('sha256').update('a').digest('base64')}`;
    const old = {
        id: 'demo',
        author: 'alice@example.com',
        baseUrl: 'https://cdn.example/mods',
        version: '1.0.0',
        manifestIntegrity: integrity,
        components: {},
    };
    const entry = {
        ...old,
        version: '2.0.0',
        components: { 'demo:main': { workerUrl: 'main.js', integrity, capabilities: ['network:fetch'] } },
    };
    writeFileSync(
        path,
        yaml.stringify({
            apiVersion: 'ubichill.com/v1alpha1',
            kind: 'World',
            metadata: { name: 'test', version: '1.0.0' },
            spec: {
                displayName: 'test',
                dependencies: [
                    { name: 'demo', source: { author: old.author, url: old.baseUrl, version: old.version } },
                ],
                initialEntities: [],
            },
        }),
    );
    writeFileSync(lockPath, JSON.stringify(createModLock({ demo: old })));
    vi.spyOn(packages, 'resolvePackage').mockResolvedValue({
        entry,
        manifest: { id: 'demo', version: '2.0.0', components: {} },
        signature: {},
        descriptor: { author: old.author, id: old.id, baseUrl: old.baseUrl, version: '2.0.0' },
    });
    const before = readFileSync(path, 'utf8');
    const beforeLock = readFileSync(lockPath, 'utf8');
    const args = ['@alice@example.com/demo@2.0.0', `--world=${path}`];
    await expect(installPackage(args, silentLogger)).rejects.toThrow('--accept-capabilities');
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(readFileSync(lockPath, 'utf8')).toBe(beforeLock);
    await installPackage([...args, '--accept-capabilities'], silentLogger);
    expect(lockedMods(JSON.parse(readFileSync(lockPath, 'utf8'))).demo.version).toBe('2.0.0');
});
