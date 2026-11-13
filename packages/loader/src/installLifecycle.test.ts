import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModLock, lockedMods, type ModLockEntry, PROTOCOL_VERSION } from '@ubichill/shared';
import { silentLogger } from '@ubichill/terminal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { runInstall } from './installDependencies';
import * as packages from './packages';
import { runUpdate } from './updateDependencies';

const integrity = (text: string) => `sha256-${createHash('sha256').update(text).digest('base64')}`;
const entry = (version: string, seed = version, caps: string[] = []): ModLockEntry => ({
    id: 'demo',
    version,
    manifestIntegrity: integrity(seed),
    components: { 'demo:main': { workerUrl: 'main.js', integrity: integrity(seed), capabilities: caps } },
});
let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ubichill-lock-review-'));
});
afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
});
function setup(version = 'latest', author?: string, url?: string) {
    const world = {
        apiVersion: 'ubichill.com/v1alpha1',
        kind: 'World',
        metadata: { name: 'test', version: '1.0.0' },
        spec: {
            displayName: 'test',
            dependencies: [
                { name: 'demo', source: { version, ...(author ? { author } : {}), ...(url ? { url } : {}) } },
            ],
            initialEntities: [],
        },
    };
    const path = join(dir, 'world.yaml');
    writeFileSync(path, yaml.stringify(world));
    const modsDir = join(dir, 'mods');
    return { path, modsDir, args: [path, `--mods-dir=${modsDir}`], lockPath: join(dir, 'world.lock.json') };
}
function publish(modsDir: string, value: ModLockEntry) {
    mkdirSync(join(modsDir, 'demo', `v${value.version}`), { recursive: true });
    writeFileSync(join(modsDir, 'demo', 'mod.json'), JSON.stringify({ version: value.version }));
    writeFileSync(join(modsDir, 'demo', `v${value.version}`, 'lock.json'), JSON.stringify(value));
}
const readLock = (path: string) => lockedMods(JSON.parse(readFileSync(path, 'utf8')));

describe('explicit install and monotonic update', () => {
    it('再ビルドのhashを通常のinstallで修復し、その後のcheckが通る', async () => {
        const w = setup();
        publish(w.modsDir, entry('1.0.0'));
        await runInstall(w.args, silentLogger);
        publish(w.modsDir, entry('1.0.0', 'rebuilt'));
        await runInstall([...w.args, '--check'], silentLogger);
        expect(process.exitCode).toBe(1);
        process.exitCode = 0;
        await runInstall(w.args, silentLogger);
        expect(readLock(w.lockPath).demo.manifestIntegrity).toBe(integrity('rebuilt'));
        await runInstall([...w.args, '--check'], silentLogger);
        expect(process.exitCode).toBe(0);
    });
    it('install は最新版を取って world.yaml に固定し、そのあとの install・公開では版を変えない。上げるのは update', async () => {
        const w = setup();
        publish(w.modsDir, entry('1.0.0'));
        await runInstall(w.args, silentLogger);
        const pinned = yaml.parse(readFileSync(w.path, 'utf8'));
        expect(pinned.spec.dependencies[0].source.version).toBe('1.0.0');
        expect(pinned.spec.requires).toEqual({ protocol: PROTOCOL_VERSION });

        publish(w.modsDir, entry('2.0.0'));
        await runInstall(w.args, silentLogger, { reuseExisting: true });
        expect(readLock(w.lockPath).demo.version).toBe('1.0.0');
        await runInstall(w.args, silentLogger);
        expect(readLock(w.lockPath).demo.version).toBe('1.0.0');

        await runUpdate(w.args, silentLogger);
        expect(readLock(w.lockPath).demo.version).toBe('2.0.0');
        expect(yaml.parse(readFileSync(w.path, 'utf8')).spec.dependencies[0].source.version).toBe('2.0.0');
    });
    it('latest のまま公開から呼ばれたら、最新版ではなく今の lock の版で固定する', async () => {
        const w = setup();
        publish(w.modsDir, entry('1.0.0'));
        writeFileSync(w.lockPath, JSON.stringify(createModLock({ demo: entry('1.0.0') })));
        publish(w.modsDir, entry('2.0.0'));
        await runInstall(w.args, silentLogger, { reuseExisting: true });
        expect(yaml.parse(readFileSync(w.path, 'utf8')).spec.dependencies[0].source.version).toBe('1.0.0');
        expect(readLock(w.lockPath).demo.version).toBe('1.0.0');
    });
    it('固定していない world.yaml は --check で落とし、ファイルは書き換えない', async () => {
        const w = setup();
        publish(w.modsDir, entry('1.0.0'));
        writeFileSync(w.lockPath, `${JSON.stringify(createModLock({ demo: entry('1.0.0') }), null, 2)}\n`);
        const before = readFileSync(w.path, 'utf8');
        await runInstall([...w.args, '--check'], silentLogger);
        expect(process.exitCode).toBe(1);
        expect(readFileSync(w.path, 'utf8')).toBe(before);
    });
    it.each(['latest', '2.0.0'])('古いlatestを指しても%sのupdateでは版を戻さない', async (version) => {
        const w = setup(version);
        publish(w.modsDir, entry('2.0.0'));
        await runInstall(w.args, silentLogger);
        publish(w.modsDir, entry('1.9.1'));
        await runUpdate(w.args, silentLogger);
        expect(readLock(w.lockPath).demo.version).toBe('2.0.0');
    });
    it('カタログの返す版が古くても作者参照のupdateは固定内容を保つ', async () => {
        const w = setup('2.0.0', 'alice@example.com', 'https://cdn.example/mods');
        const old = { ...entry('2.0.0'), author: 'alice@example.com', baseUrl: 'https://cdn.example/mods' };
        writeFileSync(w.lockPath, JSON.stringify(createModLock({ demo: old })));
        vi.spyOn(packages, 'resolvePackage').mockResolvedValue({
            entry: { ...old, version: '1.9.1' },
            manifest: { id: 'demo', version: '1.9.1', components: {} },
            signature: {},
            descriptor: { author: old.author, id: old.id, version: '1.9.1', baseUrl: old.baseUrl },
        });
        await runUpdate(w.args, silentLogger);
        expect(readLock(w.lockPath).demo).toEqual(old);
        expect(yaml.parse(readFileSync(w.path, 'utf8')).spec.dependencies[0].source.version).toBe('2.0.0');
    });
    it('URLの無い本体modはauthor付きの旧データでもカタログを必要としない', async () => {
        const w = setup('1.0.0', 'ubichill@example.com');
        publish(w.modsDir, entry('2.0.0'));
        const catalog = vi.spyOn(packages, 'resolvePackage');
        await runUpdate(w.args, silentLogger);
        expect(readLock(w.lockPath).demo.version).toBe('2.0.0');
        expect(catalog).not.toHaveBeenCalled();
    });
    it('update の権限追加を承認するまで既存の YAML と lock を変更しない', async () => {
        const w = setup();
        publish(w.modsDir, entry('1.0.0', 'a', ['ui:render']));
        await runInstall(w.args, silentLogger);
        const before = { world: readFileSync(w.path, 'utf8'), lock: readFileSync(w.lockPath, 'utf8') };
        publish(w.modsDir, entry('2.0.0', 'b', ['ui:render', 'network:fetch']));
        await expect(runUpdate(w.args, silentLogger)).rejects.toThrow('--accept-capabilities');
        expect({ world: readFileSync(w.path, 'utf8'), lock: readFileSync(w.lockPath, 'utf8') }).toEqual(before);
        await runUpdate([...w.args, '--accept-capabilities'], silentLogger);
        expect(readLock(w.lockPath).demo.version).toBe('2.0.0');
    });
});
