/**
 * npm に入れた @ubichill/instance-<os>-<cpu> が、この環境で本当に起動するかを確かめる（CI の各 OS で実行）。
 * 指定したディレクトリの node_modules から自分のプラットフォームのパッケージを解決し、`--guests` で起動して `/health` を待つ。
 *
 * 使い方: node smoke.mjs --dir=<@ubichill/cli を npm install したディレクトリ>
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { findInstancePlatform, instanceBinaryName, instancePackageName } from '../cli/src/instancePlatforms.ts';

const dir = resolve(process.argv.slice(2).find((a) => a.startsWith('--dir='))?.slice('--dir='.length) ?? '.');
const platform = findInstancePlatform(process.platform, process.arch);
if (!platform) throw new Error(`unsupported platform ${process.platform}-${process.arch}`);
const name = instancePackageName(platform);
const packageJson = createRequire(join(dir, 'package.json')).resolve(`${name}/package.json`);
const binary = join(dirname(packageJson), instanceBinaryName(platform.os));
if (!existsSync(binary)) throw new Error(`${binary} がありません`);

const port = 3077 + Math.floor(Math.random() * 1000);
const child = spawn(binary, ['--guests', `--listen=127.0.0.1:${port}`], { stdio: ['ignore', 'inherit', 'inherit'] });
const stop = () => {
    if (!child.killed) child.kill();
};
process.on('exit', stop);

const deadline = Date.now() + 20000;
let status = 0;
while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
    if (response?.ok) {
        status = response.status;
        break;
    }
    if (child.exitCode !== null) throw new Error(`${name} が終了しました (exit ${child.exitCode})`);
    await new Promise((r) => setTimeout(r, 250));
}
stop();
if (status !== 200) throw new Error(`${name} が 20 秒以内に /health に応答しませんでした`);
console.log(`✅ ${name}: ${binary} が起動し /health が 200`);
