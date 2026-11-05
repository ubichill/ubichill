/**
 * `ubichill dev [world.yaml] [--port=<n>] [--mods-dir=<dir>] [--max-users=<n>]`
 *
 * Go のインスタンスサーバーの起動・mod の監視ビルド・自動リロードを 1 コマンドにする。
 * サーバーは node:http と esbuild だけで動き、Vite・Docker・DB は使わない。複数タブ・複数ブラウザの同期は最初から動く。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'yaml';
import { compileMod } from '../build.ts';
import { findInstanceBinary } from '../instanceBinary.ts';
import { initialGenerationState } from './generation.ts';
import { type GoRuntime, startGo } from './goRuntime.ts';
import { createPipeline } from './pipeline.ts';
import { createDevServer } from './server.ts';
import { createWatcher, planChanges, watchTargets } from './watch.ts';
import { findWorldDist } from './worldAssets.ts';

const USAGE = 'usage: ubichill dev [world.yaml] [--port=<n>] [--mods-dir=<dir>] [--max-users=<n>]';
const DEFAULT_PORT = 3333;

const argValue = (argv: string[], name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** mod の id は package.json から（`ubichill build` と同じ規則）。 */
function readModId(modDir: string): string {
    const pkg = JSON.parse(readFileSync(join(modDir, 'package.json'), 'utf-8')) as {
        name?: string;
        ubichill?: { id?: string };
    };
    return pkg.ubichill?.id ?? pkg.name?.replace(/^@ubichill\/(?:mod-)?/, '') ?? basename(modDir);
}

/** `ubichill build` と同じ: `mods/`（か --mods-dir）があればその下の各ディレクトリ、無ければ cwd が 1 つの mod。 */
export function discoverModDirs(
    cwd: string,
    modsDirArg: string | undefined,
): { modsRoot?: string; modDirs: Map<string, string> } {
    const modsRoot = modsDirArg !== undefined ? resolve(cwd, modsDirArg) : join(cwd, 'mods');
    if (modsDirArg !== undefined || existsSync(modsRoot)) {
        const modDirs = new Map<string, string>();
        for (const entry of readdirSync(modsRoot, { withFileTypes: true })) {
            if (!entry.isDirectory() || !existsSync(join(modsRoot, entry.name, 'package.json'))) continue;
            modDirs.set(readModId(join(modsRoot, entry.name)), join(modsRoot, entry.name));
        }
        return { modsRoot, modDirs };
    }
    if (!existsSync(join(cwd, 'package.json'))) {
        throw new Error('package.json が見つかりません。mod のルートで実行するか、--mods-dir=<dir> を指定してください');
    }
    return { modDirs: new Map([[readModId(cwd), cwd]]) };
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
    const worldArg = argv.find((a) => !a.startsWith('--'));
    const worldPath = worldArg
        ? resolve(cwd, worldArg)
        : existsSync(join(cwd, 'world.yaml'))
          ? join(cwd, 'world.yaml')
          : undefined;
    if (worldArg && !existsSync(worldPath as string)) throw new Error(`${worldArg} が見つかりません`);

    const worldDist = findWorldDist();
    if ('error' in worldDist) throw new Error(worldDist.error);
    const binary = findInstanceBinary();
    if ('error' in binary) throw new Error(binary.error);

    const log = (line: string) => console.log(line);
    const origins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
    const runtime = { current: undefined as GoRuntime | undefined, shuttingDown: false };
    const startRuntime = async () => {
        runtime.current = await startGo({
            binary: binary.path,
            origins,
            log,
            onExit: (code) => {
                runtime.current = undefined;
                // 終了処理の途中で Go が先に止まっても、起動し直さない
                if (runtime.shuttingDown) return;
                log(`⚠️  Go のインスタンスサーバーが終了しました (exit ${code})。起動し直します`);
                void startRuntime().then(() => pipeline.restoreRoom());
            },
        });
    };

    const pipeline = createPipeline(
        {
            discoverMods: async () => discoverModDirs(cwd, argValue(argv, 'mods-dir')).modDirs,
            compile: compileMod,
            loadWorld: async () =>
                worldPath
                    ? {
                          raw: yaml.parse(readFileSync(worldPath, 'utf-8')) as unknown,
                          url: pathToFileURL(worldPath).href,
                      }
                    : undefined,
            go: () => runtime.current,
            broadcast: (event) => server.broadcast(event),
            log,
            maxUsers,
        },
        initialGenerationState(randomBytes(4).toString('hex')),
    );
    const server = createDevServer({
        state: () => pipeline.state,
        goPort: () => runtime.current?.port,
        worldDist: worldDist.path,
        onReconfigure: () => pipeline.schedule({ mods: new Set(), reconfigure: true }),
    });

    const { modsRoot } = discoverModDirs(cwd, argValue(argv, 'mods-dir'));
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

    await startRuntime();
    pipeline.schedule({ mods: 'all', reconfigure: true });
    await pipeline.idle();
    watcher.update(watchTargets({ modDirs: pipeline.modDirs, inputsByMod: pipeline.inputsByMod, modsRoot, worldPath }));

    await new Promise<void>((done, fail) => {
        server.server.on('error', fail);
        server.server.listen(port, () => done());
    });
    log(
        `\n🌐 http://localhost:${port}/  （${worldPath ? basename(worldPath) : 'mod から合成したワールド'}、mod ${pipeline.modDirs.size}）`,
    );
    log('   保存すると自動でビルドして読み直します。Ctrl+C で止めます\n');

    const shutdown = async () => {
        // 先に再起動を止めてから閉じる（WebSocket を切ると Go 側の接続も切れるが、Go は止めない限り動き続ける）
        runtime.shuttingDown = true;
        watcher.close();
        await server.close();
        runtime.current?.stop();
        process.exit(0);
    };
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
}
