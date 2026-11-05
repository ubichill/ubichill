/**
 * compileMod（メモリに成果物を作る）と writeArtifacts（書く）の契約。
 * dev サーバーは compileMod の結果をそのまま配り、`inputs` で監視する対象を決める。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMod, compileMod, type ModArtifacts, writeArtifacts } from './build.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const penDir = join(repoRoot, 'mods', 'pen');
const wasmDemoDir = join(repoRoot, 'mods', 'wasm-demo');

/** ディレクトリの中身（相対パス → 中身）。 */
function snapshot(dir: string): Map<string, Buffer> {
    const out = new Map<string, Buffer>();
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const path = join(entry.parentPath, entry.name);
        out.set(relative(dir, path).split('\\').join('/'), readFileSync(path));
    }
    return out;
}

describe('compileMod', () => {
    let pen: ModArtifacts;
    beforeAll(async () => {
        pen = await compileMod(penDir);
    });

    it('v<version>/ に置くファイル（Worker・manifest・lock）を相対パスで持つ', () => {
        expect(pen.id).toBe('pen');
        expect(pen.components.sort()).toEqual(['pen:canvas', 'pen:pen', 'pen:tray']);
        const paths = [...pen.files.keys()].sort();
        expect(paths).toContain('manifest.json');
        expect(paths).toContain('lock.json');
        expect(paths.filter((p) => /^(canvas|pen|tray)\/index\.[0-9a-f]{8}\.js$/.test(p))).toHaveLength(3);
        const lock = JSON.parse(new TextDecoder().decode(pen.files.get('lock.json')));
        expect(lock).toEqual(pen.lockEntry);
        for (const [type, component] of Object.entries(pen.lockEntry.components)) {
            expect(pen.files.has(component.workerUrl.replace(/^\.\//, '')), type).toBe(true);
        }
    });

    it('inputs に Worker・import した共有コード・package.json・tsconfig が入る（監視の対象）', () => {
        const inputs = [...pen.inputs];
        for (const expected of [
            join(penDir, 'package.json'),
            join(penDir, 'tsconfig.json'),
            join(penDir, 'src', 'pen.worker.tsx'),
            join(penDir, 'src', 'canvas.worker.ts'),
            join(penDir, 'src', 'events.ts'),
        ]) {
            expect(inputs, expected).toContain(expected);
        }
        // mod の外（SDK）も含む。node_modules を除いて監視するのは dev サーバーの仕事
        expect(inputs.some((p) => p.includes(join('packages', 'sdk', 'src')))).toBe(true);
    });

    it('asset は files と inputs の両方に入る', async () => {
        const demo = await compileMod(wasmDemoDir);
        const assets = [...demo.files.keys()].filter((p) => !/\.json$/.test(p) && !/\/index\.[0-9a-f]{8}\.js$/.test(p));
        expect(assets.length).toBeGreaterThan(0);
        for (const asset of assets) expect([...demo.inputs]).toContain(join(wasmDemoDir, 'assets', asset));
    });
});

describe('writeArtifacts', () => {
    const dirs: string[] = [];
    const tmp = (name: string) => {
        const dir = mkdtempSync(join(tmpdir(), `ubichill-${name}-`));
        dirs.push(dir);
        return dir;
    };
    afterAll(() => {
        for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    });

    it('compileMod → writeArtifacts は buildMod と同じファイルを出す', async () => {
        const viaBuild = tmp('build');
        const viaSplit = tmp('split');
        await buildMod(penDir, { distDir: viaBuild });
        await writeArtifacts(await compileMod(penDir), { distDir: viaSplit });
        const a = snapshot(viaBuild);
        const b = snapshot(viaSplit);
        expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
        for (const [path, bytes] of a) expect(b.get(path)?.equals(bytes), path).toBe(true);
    });

    it('内容が変わった Worker の古いバンドルを消し、lock が変わったら署名を消す', async () => {
        const dist = tmp('stale');
        const artifacts = await compileMod(penDir);
        await writeArtifacts(artifacts, { distDir: dist });
        const versionDir = join(dist, `v${artifacts.version}`);
        writeFileSync(join(versionDir, 'pen', 'index.00000000.js'), 'stale');
        writeFileSync(join(versionDir, 'lock.sig.json'), '{"old": true}');
        // 同じ内容を書き直すと、署名は残り、古い名前のバンドルは消える
        await writeArtifacts(artifacts, { distDir: dist });
        expect(readdirSync(join(versionDir, 'pen'))).not.toContain('index.00000000.js');
        expect(readdirSync(versionDir)).toContain('lock.sig.json');
        // lock の内容が変わると署名は無効なので消える
        const changed: ModArtifacts = {
            ...artifacts,
            files: new Map([...artifacts.files, ['lock.json', new TextEncoder().encode('{"changed": true}')]]),
        };
        await writeArtifacts(changed, { distDir: dist });
        expect(readdirSync(versionDir)).not.toContain('lock.sig.json');
    });
});
