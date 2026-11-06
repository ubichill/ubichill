import { describe, expect, it } from 'vitest';
import { INSTANCE_BIN_ENV, resolveInstanceBinary } from './instanceBinary.ts';
import { goTarget, INSTANCE_PLATFORMS, instanceBinaryName, instancePackageName } from './instancePlatforms.ts';

const deps = (overrides: Partial<Parameters<typeof resolveInstanceBinary>[0]> = {}) => ({
    platform: 'darwin',
    arch: 'arm64',
    env: {},
    resolvePackage: () => null,
    exists: () => false,
    ...overrides,
});

describe('instancePlatforms', () => {
    it('npm の名前と Go のターゲット名を対応づける', () => {
        expect(INSTANCE_PLATFORMS.map(instancePackageName)).toEqual([
            '@ubichill/instance-darwin-arm64',
            '@ubichill/instance-darwin-x64',
            '@ubichill/instance-linux-x64',
            '@ubichill/instance-linux-arm64',
            '@ubichill/instance-win32-x64',
        ]);
        expect(goTarget({ os: 'win32', cpu: 'x64' })).toEqual({ GOOS: 'windows', GOARCH: 'amd64' });
        expect(goTarget({ os: 'linux', cpu: 'arm64' })).toEqual({ GOOS: 'linux', GOARCH: 'arm64' });
        expect(instanceBinaryName('win32')).toBe('ubichill-instance.exe');
        expect(instanceBinaryName('linux')).toBe('ubichill-instance');
    });
});

describe('resolveInstanceBinary', () => {
    it('npm のプラットフォーム別パッケージの中のバイナリを返す', () => {
        const result = resolveInstanceBinary(
            deps({
                resolvePackage: (name) =>
                    name === '@ubichill/instance-darwin-arm64'
                        ? '/nm/@ubichill/instance-darwin-arm64/package.json'
                        : null,
                exists: (path) => path === '/nm/@ubichill/instance-darwin-arm64/ubichill-instance',
            }),
        );
        expect(result).toEqual({ path: '/nm/@ubichill/instance-darwin-arm64/ubichill-instance', source: 'package' });
    });

    it('Windows は .exe を探す', () => {
        const result = resolveInstanceBinary(
            deps({
                platform: 'win32',
                arch: 'x64',
                resolvePackage: () => 'C:\\nm\\@ubichill\\instance-win32-x64\\package.json',
                exists: (path) => path.endsWith('ubichill-instance.exe'),
            }),
        );
        expect(result).toMatchObject({ source: 'package' });
    });

    it('環境変数が最優先。指した先が無ければ他を探さずに失敗する', () => {
        const env = { [INSTANCE_BIN_ENV]: '/custom/instance' };
        expect(resolveInstanceBinary(deps({ env, exists: (p) => p === '/custom/instance' }))).toEqual({
            path: '/custom/instance',
            source: 'env',
        });
        const missing = resolveInstanceBinary(
            deps({ env, resolvePackage: () => '/nm/x/package.json', exists: () => false }),
        );
        expect(missing).toMatchObject({ error: expect.stringContaining('/custom/instance が見つかりません') });
    });

    it('パッケージが無ければリポジトリのビルド出力、それも無ければ optionalDependencies の案内', () => {
        const workspace = resolveInstanceBinary(
            deps({
                workspaceDist: '/repo/packages/instance/dist-npm',
                exists: (p) => p.endsWith('darwin-arm64/ubichill-instance'),
            }),
        );
        expect(workspace).toEqual({
            path: '/repo/packages/instance/dist-npm/darwin-arm64/ubichill-instance',
            source: 'workspace',
        });
        expect(resolveInstanceBinary(deps())).toMatchObject({
            error: expect.stringContaining('@ubichill/instance-darwin-arm64 が入っていません'),
        });
    });

    it('配っていないプラットフォームでは対応の一覧を出す', () => {
        expect(resolveInstanceBinary(deps({ platform: 'freebsd', arch: 'x64' }))).toMatchObject({
            error: expect.stringContaining('freebsd-x64'),
        });
        expect(resolveInstanceBinary(deps({ platform: 'linux', arch: 'ia32' }))).toMatchObject({
            error: expect.stringContaining('linux-x64, linux-arm64'),
        });
    });
});
