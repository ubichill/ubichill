/**
 * `ubichill dev [world.yaml] [--port=<n>] [--host[=<addr>]] [--mods-dir=<dir>] [--max-users=<n>]`
 *
 * Go のインスタンスサーバーの起動・mod の監視ビルド・自動リロードを 1 コマンドにする。
 * サーバーは node:http と esbuild だけで動き、Vite・Docker・DB は使わない。複数タブ・複数ブラウザの同期は最初から動く。
 *
 * 端末: 起動の途中は進み具合の行、起動し終えたら最後に案内（URL）を 1 回だけ出す。以降は 1 件 1 行のイベント
 * （時刻・[dev] / [build] / [instance]・記号・本文）。画面は消さない（前の失敗を追えるように）。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { ModLockSchema } from '@ubichill/shared';
import { colorEnabled, HintedError, onceLogger, remapLevels, type Terminal } from '@ubichill/terminal';
import yaml from 'yaml';
import { compileMod } from '../build.ts';
import { describeBuildFailure } from '../buildFailure.ts';
import { findInstanceBinary } from '../instanceBinary.ts';
import { cliVersion } from '../output.ts';
import { devOrigins, devUrls, listenHost, parseHostOption } from './address.ts';
import { discoverModDirs } from './discover.ts';
import { currentGeneration, initialGenerationState } from './generation.ts';
import { superviseGo } from './goRuntime.ts';
import { createPipeline, type WorldSource } from './pipeline.ts';
import { createDevServer } from './server.ts';
import { handleShutdown } from './shutdown.ts';
import { bannerRows, listenFailure } from './startup.ts';
import { createWatcher, planChanges, watchTargets, worldLockPath } from './watch.ts';
import { findWorldDist } from './worldAssets.ts';

const USAGE = 'usage: ubichill dev [world.yaml] [--port=<n>] [--host[=<addr>]] [--mods-dir=<dir>] [--max-users=<n>]';
const DEFAULT_PORT = 3333;

const argValue = (argv: string[], name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** world.yaml と、横に `.lock.json` があればそれも読む（壊れていればワールドの診断になる）。 */
function readWorld(worldPath: string): WorldSource {
    const lockPath = worldLockPath(worldPath);
    const lock =
        lockPath && existsSync(lockPath)
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

export async function runDev(argv: string[], term: Terminal): Promise<void> {
    if (argv.includes('--help')) {
        term.print(USAGE);
        return;
    }
    const started = performance.now();
    const cwd = process.cwd();
    const port = Number(argValue(argv, 'port') ?? DEFAULT_PORT);
    const maxUsers = Number(argValue(argv, 'max-users') ?? 20);
    if (!Number.isInteger(port) || port < 1 || !Number.isInteger(maxUsers) || maxUsers < 1) throw new Error(USAGE);
    const host = parseHostOption(argv);
    const modsDirArg = argValue(argv, 'mods-dir');
    const worldArg = argv.find((a) => !a.startsWith('--'));
    const worldPath = worldArg
        ? resolve(cwd, worldArg)
        : existsSync(join(cwd, 'world.yaml'))
          ? join(cwd, 'world.yaml')
          : undefined;
    if (worldArg && !existsSync(worldPath as string)) {
        // `--host 0.0.0.0` と空白で区切ると、アドレスをワールドと取り違える
        if (argv[argv.indexOf(worldArg) - 1] === '--host')
            throw new HintedError(`${worldArg} が見つかりません`, `--host=${worldArg} の形で指定してください`);
        throw new Error(`${worldArg} が見つかりません`);
    }
    const { modsRoot, modDirs } = discoverModDirs(cwd, modsDirArg);
    if (modDirs.size === 0 && !worldPath) {
        throw new HintedError(
            'mod も world.yaml も見つかりません',
            'mod のルート（package.json と src/ のある場所）で実行するか、world.yaml を指定してください',
        );
    }

    const worldDist = findWorldDist();
    if ('error' in worldDist) throw new Error(worldDist.error);
    const binary = findInstanceBinary();
    if ('error' in binary) throw new Error(binary.error);

    const log = {
        dev: term.scope('dev'),
        build: term.scope('build'),
        instance: term.scope('instance'),
        http: term.scope('http'),
    };
    log.dev.debug(`world.html: ${worldDist.path}`);
    log.dev.debug(`Go のバイナリ: ${binary.path}`, binary.source);
    log.dev.debug(`手元の mod: ${[...modDirs.keys()].join('、') || 'なし'}`, modsRoot);

    const urls = devUrls(host, port, networkInterfaces());
    const go = superviseGo({
        binary: binary.path,
        origins: devOrigins(urls, port),
        log: log.instance,
        debug: term.debugEnabled,
        onRestarted: () => void pipeline.restoreRoom(),
    });

    // mod の Component ごとの行は debug に落とす（保存のたびに並ぶと、公開した 1 行が埋もれる）。
    // capability・esbuild の警告は出すが、同じものは 1 回だけ
    const compileLog = onceLogger(remapLevels(log.build, { info: 'debug', success: 'debug' }), ['warn']);
    const color = colorEnabled({ isTTY: process.stdout.isTTY, env: process.env });
    const pipeline = createPipeline(
        {
            discoverMods: async () => discoverModDirs(cwd, modsDirArg).modDirs,
            compile: (dir) => compileMod(dir, compileLog),
            loadWorld: async () => (worldPath ? readWorld(worldPath) : undefined),
            go: () => go.current,
            broadcast: (event) => server.broadcast(event),
            log: { dev: log.dev, build: log.build },
            describeBuildFailure: (error) => describeBuildFailure(error, { color }),
            maxUsers,
        },
        initialGenerationState(randomBytes(4).toString('hex')),
    );
    const server = createDevServer({
        state: () => pipeline.state,
        diagnostics: () => pipeline.diagnostics,
        goPort: () => go.current?.port,
        worldDist: worldDist.path,
        onReconfigure: () => {
            log.dev.info('ブラウザから部屋を作り直します');
            pipeline.schedule({ mods: new Set(), reconfigure: true });
        },
        log: log.http,
    });

    const watcher = createWatcher((paths) => {
        const plan = planChanges(paths, {
            modDirs: pipeline.modDirs,
            inputsByMod: pipeline.inputsByMod,
            modsRoot,
            worldPath,
        });
        log.dev.debug(
            `変わったファイル: ${paths.map((p) => relative(cwd, p) || p).join('、')}`,
            plan.rebuild.size === 0 && !plan.rescan && !plan.reconfigure
                ? '何もしない'
                : [
                      plan.rebuild.size > 0 ? `ビルド: ${[...plan.rebuild].join('、')}` : '',
                      plan.rescan ? 'mod を探し直す' : '',
                      plan.reconfigure ? 'ワールドを読み直す' : '',
                  ]
                      .filter((part) => part !== '')
                      .join('  '),
        );
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
        log.dev.debug('止めています（監視・HTTP・Go）');
        watcher.close();
        await Promise.all([server.close(), go.stop()]);
    });
    // 最後の砦: どこかで捕まらない例外が出て node が落ちるときも、Go を残さない（'exit' は同期の処理しかできない）
    process.on('exit', () => go.killNow());

    try {
        // 先にポートを開く: 使用中ならビルドの前に分かり、開いたページは最初のビルドの結果（世代か診断）を SSE で受け取る
        await new Promise<void>((done, fail) => {
            server.server.once('error', fail);
            server.server.listen({ port, host: listenHost(host) }, () => {
                server.server.off('error', fail);
                done();
            });
        }).catch((error: unknown) => {
            throw listenFailure(error, port, host);
        });
        log.dev.debug(`待ち受けました: ${listenHost(host) ?? '全部の口'}:${port}`);
        // 待ち受けた後のエラー（accept の EMFILE など）は、片付けてから失敗で抜ける
        server.server.on('error', (error) => {
            term.failure(error);
            void shutdown.trigger().finally(() => process.exit(1));
        });
        await go.start();
        pipeline.schedule({ mods: 'all', reconfigure: true });
        await pipeline.idle();
        // 最初のビルドの間に止められたら、監視を開き直さず、起動したとも言わない
        if (shutdown.started) return shutdown.trigger();
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
    const generation = currentGeneration(pipeline.state);
    term.banner({
        title: 'ubichill dev',
        version: cliVersion(),
        readyMs: performance.now() - started,
        rows: bannerRows({
            urls,
            host,
            world: worldPath ? relative(cwd, worldPath) || basename(worldPath) : 'mod から合成したワールド',
            modCount: generation ? Object.keys(generation.lock.mods).length : undefined,
            localCount: pipeline.modDirs.size,
            failing: pipeline.diagnostics.length > 0,
            debug: term.debugEnabled,
        }),
    });
}
