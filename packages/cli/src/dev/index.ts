/**
 * `ubichill dev [world.yaml] [--port=<n>] [--mods-dir=<dir>] [--max-users=<n>]`
 *
 * Go のインスタンスサーバーの起動・mod の監視ビルド・自動リロードを 1 コマンドにする。
 * サーバーは node:http と esbuild だけで動き、Vite・Docker・DB は使わない。複数タブ・複数ブラウザの同期は最初から動く。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ModLockSchema } from '@ubichill/shared';
import yaml from 'yaml';
import { compileMod } from '../build.ts';
import { findInstanceBinary } from '../instanceBinary.ts';
import { discoverModDirs } from './discover.ts';
import { initialGenerationState } from './generation.ts';
import { superviseGo } from './goRuntime.ts';
import { createPipeline, type WorldSource } from './pipeline.ts';
import { createDevServer } from './server.ts';
import { handleShutdown } from './shutdown.ts';
import { createWatcher, planChanges, watchTargets, worldLockPath } from './watch.ts';
import { findWorldDist } from './worldAssets.ts';

const USAGE = 'usage: ubichill dev [world.yaml] [--port=<n>] [--mods-dir=<dir>] [--max-users=<n>]';
const DEFAULT_PORT = 3333;

const argValue = (argv: string[], name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** world.yaml と、横に `.lock.json` があればそれも読む（壊れていればワールドの診断になる）。 */
function readWorld(worldPath: string): WorldSource {
    const lockPath = worldLockPath(worldPath);
    const lock = existsSync(lockPath)
        ? (() => {
              const parsed = (() => {
                  try {
                      return ModLockSchema.safeParse(JSON.parse(readFileSync(lockPath, 'utf-8')));
                  } catch (error) {
                      throw new Error(
                          `${basename(lockPath)} が読めません: ${error instanceof Error ? error.message : error}`,
                      );
                  }
              })();
              if (!parsed.success)
                  throw new Error(`${basename(lockPath)} が lock の形ではありません: ${parsed.error.message}`);
              return parsed.data;
          })()
        : undefined;
    return {
        raw: yaml.parse(readFileSync(worldPath, 'utf-8')) as unknown,
        url: pathToFileURL(worldPath).href,
        ...(lock ? { lock } : {}),
    };
}

export async function runDev(argv: string[]): Promise<void> {
    if (argv.includes('--help')) {
        console.log(USAGE);
        return;
    }
    const cwd = process.cwd();
    const port = Number(argValue(argv, 'port') ?? DEFAULT_PORT);
    const maxUsers = Number(argValue(argv, 'max-users') ?? 20);
    if (!Number.isInteger(port) || port < 1 || !Number.isInteger(maxUsers) || maxUsers < 1) throw new Error(USAGE);
    const modsDirArg = argValue(argv, 'mods-dir');
    const worldArg = argv.find((a) => !a.startsWith('--'));
    const worldPath = worldArg
        ? resolve(cwd, worldArg)
        : existsSync(join(cwd, 'world.yaml'))
          ? join(cwd, 'world.yaml')
          : undefined;
    if (worldArg && !existsSync(worldPath as string)) throw new Error(`${worldArg} が見つかりません`);
    const { modsRoot, modDirs } = discoverModDirs(cwd, modsDirArg);
    if (modDirs.size === 0 && !worldPath) {
        throw new Error(
            'mod も world.yaml も見つかりません。mod のルート（package.json と src/）で実行するか、world.yaml を指定してください',
        );
    }

    const worldDist = findWorldDist();
    if ('error' in worldDist) throw new Error(worldDist.error);
    const binary = findInstanceBinary();
    if ('error' in binary) throw new Error(binary.error);

    const log = (line: string) => console.log(line);
    const origins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
    const go = superviseGo({
        binary: binary.path,
        origins,
        log,
        onRestarted: () => void pipeline.restoreRoom(),
    });

    const pipeline = createPipeline(
        {
            discoverMods: async () => discoverModDirs(cwd, modsDirArg).modDirs,
            compile: compileMod,
            loadWorld: async () => (worldPath ? readWorld(worldPath) : undefined),
            go: () => go.current,
            broadcast: (event) => server.broadcast(event),
            log,
            maxUsers,
        },
        initialGenerationState(randomBytes(4).toString('hex')),
    );
    const server = createDevServer({
        state: () => pipeline.state,
        diagnostics: () => pipeline.diagnostics,
        goPort: () => go.current?.port,
        worldDist: worldDist.path,
        onReconfigure: () => pipeline.schedule({ mods: new Set(), reconfigure: true }),
    });

    const watcher = createWatcher((paths) => {
        const plan = planChanges(paths, {
            modDirs: pipeline.modDirs,
            inputsByMod: pipeline.inputsByMod,
            modsRoot,
            worldPath,
        });
        if (plan.rebuild.size === 0 && !plan.rescan && !plan.reconfigure) return;
        pipeline.schedule({ mods: plan.rescan ? 'all' : plan.rebuild, reconfigure: plan.reconfigure });
        void pipeline
            .idle()
            .then(() =>
                watcher.update(
                    watchTargets({ modDirs: pipeline.modDirs, inputsByMod: pipeline.inputsByMod, modsRoot, worldPath }),
                ),
            );
    });

    // 再起動を止め、起動の途中のものも含めて Go が終わるのを待ってから抜ける（子プロセスを残さない）。起動の途中の Ctrl+C も受ける
    const shutdown = handleShutdown(async () => {
        watcher.close();
        await Promise.all([server.close(), go.stop()]);
    });

    try {
        // 先にポートを開く: 使用中ならビルドの前に分かり、開いたページは最初のビルドの結果（世代か診断）を SSE で受け取る
        await new Promise<void>((done, fail) => {
            server.server.once('error', fail);
            server.server.listen(port, () => {
                server.server.off('error', fail);
                done();
            });
        });
        await go.start();
        pipeline.schedule({ mods: 'all', reconfigure: true });
        await pipeline.idle();
        watcher.update(
            watchTargets({ modDirs: pipeline.modDirs, inputsByMod: pipeline.inputsByMod, modsRoot, worldPath }),
        );
    } catch (error) {
        // 止めている途中なら、起動の中止は失敗ではない（抜けるのはシグナルの側）
        if (shutdown.started) return shutdown.trigger();
        // ポートが使用中などで起動できないときも、起動した Go を残さない
        await shutdown.trigger().catch(() => undefined);
        throw error;
    }
    log(
        `\n🌐 http://localhost:${port}/  （${worldPath ? basename(worldPath) : 'mod から合成したワールド'}、手元の mod ${pipeline.modDirs.size}）`,
    );
    log('   保存すると自動でビルドして読み直します。Ctrl+C で止めます\n');
}
