/**
 * Go のインスタンスサーバー（`ubichill-instance`）を npm で配るプラットフォームの一覧。
 * `packages/instance/build.mjs`（クロスビルド）・`packages/cli/build.mjs`（optionalDependencies）・
 * 実行時の解決（instanceBinary.ts）がこの 1 つを見る。
 */
export interface InstancePlatform {
    /** Node の `process.platform`。 */
    os: 'darwin' | 'linux' | 'win32';
    /** Node の `process.arch`。 */
    cpu: 'arm64' | 'x64';
}

export const INSTANCE_PLATFORMS: readonly InstancePlatform[] = [
    { os: 'darwin', cpu: 'arm64' },
    { os: 'darwin', cpu: 'x64' },
    { os: 'linux', cpu: 'x64' },
    { os: 'linux', cpu: 'arm64' },
    { os: 'win32', cpu: 'x64' },
];

export const instancePackageName = (platform: InstancePlatform): string =>
    `@ubichill/instance-${platform.os}-${platform.cpu}`;

export const instanceBinaryName = (os: InstancePlatform['os']): string =>
    os === 'win32' ? 'ubichill-instance.exe' : 'ubichill-instance';

/** Go の GOOS / GOARCH（Node の名前から）。 */
export const goTarget = (platform: InstancePlatform): { GOOS: string; GOARCH: string } => ({
    GOOS: platform.os === 'win32' ? 'windows' : platform.os,
    GOARCH: platform.cpu === 'x64' ? 'amd64' : platform.cpu,
});

export const findInstancePlatform = (os: string, cpu: string): InstancePlatform | undefined =>
    INSTANCE_PLATFORMS.find((p) => p.os === os && p.cpu === cpu);
