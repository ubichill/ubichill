/**
 * 新規mod作成時のビルドパイプライン検証テスト。
 *
 * リポジトリ外の新規プロジェクトで `buildMod()` が正しく動作することを、
 * 一時ディレクトリに最小構成のmodを生成して確認する。
 *
 * テスト観点:
 * - package.json からの id/name/version 導出
 * - export const config を持つ .worker.ts(x) の自動検出
 * - ネストした dataFields を含む config の抽出
 * - capability 自動検出と宣言の突合せ
 * - manifest.json / lock.json / SRI integrity の生成
 * - 同名コンポーネントの重複排除
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildMod } from '../cli/build.ts';

function sriOf(text: string): string {
    return `sha256-${createHash('sha256').update(text).digest('base64')}`;
}

interface ModFixture {
    packageJson: Record<string, unknown>;
    files: Record<string, string>;
}

/** 一時ディレクトリに fixture を書き込んでパスを返す */
function setupFixture(fixture: ModFixture): string {
    const safeName = String(fixture.packageJson.name ?? 'unknown').replace(/[@/]/g, '-');
    const dir = mkdtempSync(join(tmpdir(), `ubichill-mod-test-${safeName}-`));
    writeFileSync(join(dir, 'package.json'), JSON.stringify(fixture.packageJson, null, 2), 'utf-8');
    const srcDir = join(dir, 'src');
    for (const [relPath, content] of Object.entries(fixture.files)) {
        const segments = relPath.split('/');
        segments.pop();
        const parentDir = join(srcDir, ...segments);
        mkdirSync(parentDir, { recursive: true });
        writeFileSync(join(srcDir, relPath), content, 'utf-8');
    }
    return dir;
}

describe('buildMod（新規mod作成パイプライン）', () => {
    const tmpDirs: string[] = [];

    afterAll(() => {
        for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    });

    function buildFixture(fixture: ModFixture): { modDir: string; distDir: string; publicDir: string } {
        const modDir = setupFixture(fixture);
        tmpDirs.push(modDir);

        const distBase = mkdtempSync(join(tmpdir(), 'ubichill-mod-dist-'));
        const publicBase = mkdtempSync(join(tmpdir(), 'ubichill-mod-public-'));
        tmpDirs.push(distBase, publicBase);

        const id = (fixture.packageJson.ubichill as Record<string, string> | undefined)?.id ??
            (fixture.packageJson.name as string)?.replace(/^@ubichill\/(?:mod-)?/, '') ??
            'test-mod';

        const distDir = join(distBase, id);
        const publicDir = join(publicBase, id);

        return { modDir, distDir, publicDir };
    }

    it('最小構成のmod（1worker）がビルドでき、manifest.json にメタデータが出力される', async () => {
        const fixture: ModFixture = {
            packageJson: { name: '@ubichill/mod-simple', version: '1.0.0', description: 'Simple test mod' },
            files: {
                'main.worker.tsx': [
                    'import type { ComponentConfig } from "@ubichill/sdk";',
                    '',
                    'export const config: ComponentConfig = {',
                    '    watchScope: "entity",',
                    '    capabilities: ["ui:render"],',
                    '};',
                    '',
                    'Ubi.ui.render(() => <div>hello</div>, "main");',
                ].join('\n'),
            },
        };

        const { modDir, distDir, publicDir } = buildFixture(fixture);

        await buildMod(modDir, { distDir, publicDir });

        const version = '1.0.0';
        const manifestPath = join(distDir, `v${version}`, 'manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

        expect(manifest.id).toBe('simple');
        expect(manifest.name).toBe('Simple test mod');
        expect(manifest.version).toBe(version);

        const components = manifest.components as Record<string, unknown>;
        expect(Object.keys(components)).toContain('simple:main');
        const mainComp = components['simple:main'] as Record<string, unknown>;

        expect(mainComp.capabilities).toContain('ui:render');
        expect(mainComp.workerUrl).toMatch(/^\.\/main\/index\.[0-9a-f]{8}\.js$/);

        const lockPath = join(distDir, `v${version}`, 'lock.json');
        const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
        const workerRelPath = (lock.components['simple:main'].workerUrl as string).replace(/^\.\//, '');
        const workerPath = join(distDir, `v${version}`, workerRelPath);
        const workerBytes = readFileSync(workerPath, 'utf-8');
        expect(sriOf(workerBytes)).toBe(lock.components['simple:main'].integrity);

        const manifestText = readFileSync(manifestPath, 'utf-8');
        expect(sriOf(manifestText)).toBe(lock.manifestIntegrity);
    });

    it('dataFields を含む config が正しく抽出され manifest に出力される', async () => {
        const fixture: ModFixture = {
            packageJson: { name: '@ubichill/mod-with-fields', version: '2.0.0' },
            files: {
                'editor.worker.tsx': [
                    'import type { ComponentConfig } from "@ubichill/sdk";',
                    '',
                    'export const config: ComponentConfig = {',
                    '    watchScope: "entity",',
                    '    dataFields: {',
                    '        title: { type: "text", default: "untitled", label: "タイトル" },',
                    '        size: { type: "number", default: 16, min: 8, max: 72, step: 1 },',
                    '        darkMode: { type: "boolean", default: false },',
                    '        color: { type: "color", default: "#ff0000" },',
                    '    },',
                    '    capabilities: ["ui:render"],',
                    '};',
                    '',
                    'Ubi.ui.render(() => <div>editor</div>, "editor");',
                ].join('\n'),
            },
        };

        const { modDir, distDir, publicDir } = buildFixture(fixture);
        await buildMod(modDir, { distDir, publicDir });

        const manifest = JSON.parse(readFileSync(join(distDir, 'v2.0.0', 'manifest.json'), 'utf-8'));
        const comp = (manifest.components as Record<string, Record<string, unknown>>)['with-fields:editor'];

        expect(comp.dataFields).toBeDefined();
        const fields = comp.dataFields as Record<string, Record<string, unknown>>;
        expect(fields.title.type).toBe('text');
        expect(fields.title.default).toBe('untitled');
        expect(fields.size.default).toBe(16);
        expect(fields.size.min).toBe(8);
        expect(fields.darkMode.default).toBe(false);
        expect(fields.color.type).toBe('color');
    });

    it('複数 Worker がすべてビルドされ、manifest に全 component が列挙される', async () => {
        const fixture: ModFixture = {
            packageJson: { name: '@ubichill/mod-multi', version: '1.0.0' },
            files: {
                'panel.worker.tsx': [
                    'import type { ComponentConfig } from "@ubichill/sdk";',
                    'export const config: ComponentConfig = { capabilities: ["ui:render"] };',
                    'Ubi.ui.render(() => <div>A</div>, "panel");',
                ].join('\n'),
                'toolbar.worker.tsx': [
                    'import type { ComponentConfig } from "@ubichill/sdk";',
                    'export const config: ComponentConfig = { capabilities: ["ui:render", "scene:read"] };',
                    'Ubi.ui.render(() => <div>B</div>, "toolbar");',
                ].join('\n'),
                'status.worker.ts': [
                    'import type { ComponentConfig } from "@ubichill/sdk";',
                    'export const config: ComponentConfig = { capabilities: ["scene:read"] };',
                    'const e = Ubi.entity.self;',
                ].join('\n'),
            },
        };

        const { modDir, distDir, publicDir } = buildFixture(fixture);
        await buildMod(modDir, { distDir, publicDir });

        const manifest = JSON.parse(readFileSync(join(distDir, 'v1.0.0', 'manifest.json'), 'utf-8'));
        const comps = manifest.components as Record<string, unknown>;

        expect(Object.keys(comps)).toHaveLength(3);
        expect(comps['multi:panel']).toBeDefined();
        expect(comps['multi:toolbar']).toBeDefined();
        expect(comps['multi:status']).toBeDefined();
    });

    it('export const config を持たない .worker.ts はスキップされる', async () => {
        const fixture: ModFixture = {
            packageJson: { name: '@ubichill/mod-skip', version: '1.0.0' },
            files: {
                'valid.worker.ts': [
                    'import type { ComponentConfig } from "@ubichill/sdk";',
                    'export const config: ComponentConfig = { capabilities: [] };',
                ].join('\n'),
                'no_config.worker.ts': [
                    'export const foo = 42;',
                ].join('\n'),
            },
        };

        const { modDir, distDir, publicDir } = buildFixture(fixture);
        await buildMod(modDir, { distDir, publicDir });

        const manifest = JSON.parse(readFileSync(join(distDir, 'v1.0.0', 'manifest.json'), 'utf-8'));
        const comps = manifest.components as Record<string, unknown>;

        expect(Object.keys(comps)).toHaveLength(1);
        expect(comps['skip:valid']).toBeDefined();
    });

    it('package.json に version がないと例外を throw する', async () => {
        const fixture: ModFixture = {
            packageJson: { name: '@ubichill/mod-noversion' },
            files: {
                'main.worker.ts': [
                    'import type { ComponentConfig } from "@ubichill/sdk";',
                    'export const config: ComponentConfig = {};',
                ].join('\n'),
            },
        };

        const modDir = setupFixture(fixture);
        tmpDirs.push(modDir);
        const outDir = mkdtempSync(join(tmpdir(), 'ubichill-mod-out-'));
        tmpDirs.push(outDir);

        await expect(buildMod(modDir, { distDir: outDir, publicDir: outDir })).rejects.toThrow(
            'package.json に version が必要です',
        );
    });

    it('assets/ が存在する場合はバージョン固定パスにコピーされる', async () => {
        const modDir = mkdtempSync(join(tmpdir(), 'ubichill-mod-assets-'));
        tmpDirs.push(modDir);

        writeFileSync(join(modDir, 'package.json'), JSON.stringify({ name: '@ubichill/mod-assets', version: '1.0.0' }, null, 2), 'utf-8');
        const srcDir = join(modDir, 'src');
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(join(modDir, 'src', 'main.worker.ts'), [
            'import type { ComponentConfig } from "@ubichill/sdk";',
            'export const config: ComponentConfig = {};',
        ].join('\n'), 'utf-8');

        const assetsDir = join(modDir, 'assets');
        mkdirSync(join(assetsDir, 'sounds'), { recursive: true });
        writeFileSync(join(assetsDir, 'icon.svg'), '<svg></svg>', 'utf-8');
        writeFileSync(join(assetsDir, 'sounds', 'click.mp3'), 'fake', 'utf-8');

        const distDir = mkdtempSync(join(tmpdir(), 'ubichill-mod-dist-'));
        const publicDir = mkdtempSync(join(tmpdir(), 'ubichill-mod-public-'));
        tmpDirs.push(distDir, publicDir);

        await buildMod(modDir, { distDir, publicDir });

        const manifest = JSON.parse(readFileSync(join(distDir, 'v1.0.0', 'manifest.json'), 'utf-8'));
        expect(manifest.assets).toContain('icon.svg');
        expect(manifest.assets).toContain('sounds/click.mp3');

        expect(readFileSync(join(distDir, 'v1.0.0', 'icon.svg'), 'utf-8')).toBe('<svg></svg>');
        expect(readFileSync(join(distDir, 'v1.0.0', 'sounds/click.mp3'), 'utf-8')).toBe('fake');
    });
});
