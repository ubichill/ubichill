/**
 * `ubichill dev` が起動する Go のインスタンスサーバーのバイナリを探す。
 *
 * 1. 環境変数 `UBICHILL_INSTANCE_BIN`（自分でビルドしたものを使う）
 * 2. npm の `@ubichill/instance-<os>-<cpu>`（`@ubichill/cli` の optionalDependencies。os・cpu の合うものだけが入る）
 * 3. このリポジトリの中で動かしているとき: `packages/instance/dist-npm/<os>-<cpu>/`（`pnpm build:instance`）
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    findInstancePlatform,
    INSTANCE_PLATFORMS,
    type InstancePlatform,
    instanceBinaryName,
    instancePackageName,
} from './instancePlatforms.ts';

export const INSTANCE_BIN_ENV = 'UBICHILL_INSTANCE_BIN';

export interface ResolveInstanceBinaryDeps {
    platform: string;
    arch: string;
    env: Readonly<Record<string, string | undefined>>;
    /** パッケージの package.json の絶対パス。無ければ null。 */
    resolvePackage: (name: string) => string | null;
    exists: (path: string) => boolean;
    /** リポジトリの中で動かしているときの `packages/instance/dist-npm`。公開物では undefined。 */
    workspaceDist?: string;
}

export type ResolvedInstanceBinary = { path: string; source: 'env' | 'package' | 'workspace' } | { error: string };

export function resolveInstanceBinary(deps: ResolveInstanceBinaryDeps): ResolvedInstanceBinary {
    const fromEnv = deps.env[INSTANCE_BIN_ENV];
    if (fromEnv) {
        return deps.exists(fromEnv)
            ? { path: fromEnv, source: 'env' }
            : { error: `${INSTANCE_BIN_ENV}=${fromEnv} が見つかりません` };
    }
    const platform = findInstancePlatform(deps.platform, deps.arch);
    if (!platform) {
        return {
            error:
                `このプラットフォーム（${deps.platform}-${deps.arch}）向けの Go のインスタンスサーバーは配っていません` +
                `（対応: ${INSTANCE_PLATFORMS.map((p) => `${p.os}-${p.cpu}`).join(', ')}）。` +
                `services/instance を自分でビルドし、${INSTANCE_BIN_ENV} で場所を指定してください`,
        };
    }
    const binary = instanceBinaryName(platform.os);
    const packageJson = deps.resolvePackage(instancePackageName(platform));
    if (packageJson) {
        const path = join(dirname(packageJson), binary);
        if (deps.exists(path)) return { path, source: 'package' };
    }
    if (deps.workspaceDist) {
        const path = join(deps.workspaceDist, `${platform.os}-${platform.cpu}`, binary);
        if (deps.exists(path)) return { path, source: 'workspace' };
    }
    return {
        error:
            `${instancePackageName(platform)} が入っていません。` +
            '`npm install` を optionalDependencies 込みで（`--omit=optional` を付けずに）やり直すか、' +
            `${INSTANCE_BIN_ENV} でバイナリの場所を指定してください`,
    };
}

/** 実際の環境で探す。 */
export function findInstanceBinary(
    platform: InstancePlatform | { os: string; cpu: string } = { os: process.platform, cpu: process.arch },
): ResolvedInstanceBinary {
    const require = createRequire(import.meta.url);
    const here = dirname(fileURLToPath(import.meta.url));
    return resolveInstanceBinary({
        platform: platform.os,
        arch: platform.cpu,
        env: process.env,
        resolvePackage: (name) => {
            try {
                return require.resolve(`${name}/package.json`);
            } catch {
                return null;
            }
        },
        exists: existsSync,
        // ソースから動かすとき（packages/cli/src）だけ、リポジトリの packages/instance/dist-npm を見る
        workspaceDist: here.endsWith(join('packages', 'cli', 'src'))
            ? join(here, '..', '..', 'instance', 'dist-npm')
            : undefined,
    });
}
