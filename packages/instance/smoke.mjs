/**
 * npm に入れた @ubichill/instance-<os>-<cpu> が、この環境で本当に起動するかを確かめる（CI の各 OS で実行）。
 * 指定したディレクトリの node_modules から自分のプラットフォームのパッケージを解決し、`--guests` で起動して `/health` を待つ。
 *
 * 使い方: node smoke.mjs --dir=<@ubichill/cli を npm install したディレクトリ>
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { createTerminal, DEBUG_ENV, debugFromEnv, formatDuration, HintedError, processIO } from '@ubichill/terminal';
import { findInstancePlatform, instanceBinaryName, instancePackageName } from '../cli/src/instancePlatforms.ts';

const HEALTH_TIMEOUT_MS = 20000;

/** /health が ok を返したときのステータス。期限までに返らなければ 0。先に子が終わったら throw。 */
async function waitForHealth({ url, child, name, deadline }) {
    if (Date.now() >= deadline) return 0;
    const response = await fetch(url).catch(() => null);
    if (response?.ok) return response.status;
    if (child.exitCode !== null) throw new Error(`${name} が終了しました (exit ${child.exitCode})`);
    await new Promise((r) => setTimeout(r, 250));
    return waitForHealth({ url, child, name, deadline });
}

async function main(term) {
    const dir = resolve(
        process.argv
            .slice(2)
            .find((a) => a.startsWith('--dir='))
            ?.slice('--dir='.length) ?? '.',
    );
    const platform = findInstancePlatform(process.platform, process.arch);
    if (!platform) throw new Error(`unsupported platform ${process.platform}-${process.arch}`);
    const name = instancePackageName(platform);
    const packageJson = createRequire(join(dir, 'package.json')).resolve(`${name}/package.json`);
    const binary = join(dirname(packageJson), instanceBinaryName(platform.os));
    if (!existsSync(binary)) throw new Error(`${binary} がありません`);

    // 空きポートは OS に選ばせる（乱数で選ぶと、Windows では 3389 など予約されたポートに当たって bind が拒まれる）
    const port = await new Promise((done, fail) => {
        const server = createServer();
        server.on('error', fail);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => done(typeof address === 'object' && address ? address.port : 0));
        });
    });
    const started = performance.now();
    const child = spawn(binary, ['--guests', `--listen=127.0.0.1:${port}`], {
        stdio: ['ignore', 'inherit', 'inherit'],
    });
    const stop = () => {
        if (!child.killed) child.kill();
    };
    process.on('exit', stop);

    const url = `http://127.0.0.1:${port}/health`;
    const status = await waitForHealth({ url, child, name, deadline: Date.now() + HEALTH_TIMEOUT_MS });
    stop();
    if (status !== 200) throw new Error(`${name} が ${HEALTH_TIMEOUT_MS / 1000} 秒以内に /health に応答しませんでした`);
    term.success(`${name} が起動し /health が 200`, `${binary}  ${formatDuration(performance.now() - started)}`);
}

const term = createTerminal(processIO(), { debug: debugFromEnv(process.env) });
try {
    await main(term);
} catch (err) {
    term.failure(
        err,
        err instanceof HintedError ? {} : { debugTip: `${DEBUG_ENV}=1 を付けるとスタックトレースを表示します` },
    );
    process.exit(1);
}
