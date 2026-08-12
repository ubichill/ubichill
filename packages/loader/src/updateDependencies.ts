/**
 * 依存更新ロジック（Node 専用）。world.yaml で `source.version` が pin されている
 * mod について現行最新 version を調べ、異なれば YAML を書き換えてから
 * ロックを再生成する（`ubichill update`）。
 *
 * `source.version: 'latest'`（既定・常に最新を追う）の mod は YAML を書き換えず、
 * ロック再生成だけ行う（＝lock 断片が現行最新のもので上書きされる）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WorldDefinitionSchema } from '@ubichill/shared';
import yaml from 'yaml';
import { resolveLatestVersion } from './buildWorldLock.ts';
import { runInstall } from './installDependencies.ts';

function argValue(argv: string[], name: string): string | undefined {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
}

/** ローカル mods ディレクトリ（`ubichill build` 出力）から現行最新 version を読む。 */
function resolveLocalLatestVersion(modsDir: string, modId: string): string | null {
    const indexPath = join(modsDir, modId, 'mod.json');
    if (!existsSync(indexPath)) return null;
    return (JSON.parse(readFileSync(indexPath, 'utf-8')) as { version?: string }).version ?? null;
}

/**
 * `argv`（サブコマンド名を除いた残り引数）から依存を更新する。
 * 使い方: `<world.yaml> [<modName>] [--mods-dir=<dir>] [--out=<path>]`。
 * `<modName>` を省略すると pin 済みの全 mod が対象になる。
 */
export async function runUpdate(argv: string[]): Promise<void> {
    const positional = argv.filter((a) => !a.startsWith('--'));
    const worldPath = positional[0];
    const targetModId = positional[1];
    if (!worldPath) {
        throw new Error('usage: ubichill update <world.yaml> [<modName>] [--mods-dir=<dir>] [--out=<path>]');
    }

    const raw = readFileSync(worldPath, 'utf-8');
    const def = WorldDefinitionSchema.parse(yaml.parse(raw));
    const modsDir = argValue(argv, 'mods-dir')
        ? resolve(argValue(argv, 'mods-dir') as string)
        : join(process.cwd(), 'mods');

    const dependencies = def.spec.dependencies ?? [];
    const targets = targetModId ? dependencies.filter((d) => d.name === targetModId) : dependencies;

    const doc = yaml.parseDocument(raw);
    const bumps: string[] = [];

    for (const dep of targets) {
        if (dep.source.version === 'latest') continue; // 常に最新を追う設定は書き換え不要
        const latest =
            dep.source.type === 'url' && dep.source.url
                ? await resolveLatestVersion(dep.source.url, dep.name)
                : resolveLocalLatestVersion(modsDir, dep.name);
        if (!latest || latest === dep.source.version) continue;

        const depIndex = (def.spec.dependencies ?? []).indexOf(dep);
        doc.setIn(['spec', 'dependencies', depIndex, 'source', 'version'], latest);
        bumps.push(`${dep.name}: ${dep.source.version} → ${latest}`);
    }

    if (bumps.length > 0) {
        writeFileSync(worldPath, String(doc), 'utf-8');
        console.log(`⬆️  ${bumps.length} mod を更新:\n  ${bumps.join('\n  ')}`);
    } else {
        console.log('⬆️  更新対象なし（pin 済み mod はすべて最新）');
    }

    // world.yaml の内容に関わらず lock は常に再生成する
    // （version 未 pin の mod の lock 断片も最新へ更新するため）。
    await runInstall([worldPath, ...argv.slice(1).filter((a) => a.startsWith('--'))]);
}
