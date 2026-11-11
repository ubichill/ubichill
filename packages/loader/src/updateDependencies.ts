/**
 * 依存更新ロジック（Node 専用）。world.yaml で `source.version` が pin されている
 * mod について現行最新 version を調べ、異なれば YAML を書き換えてから
 * ロックを再生成する（`ubichill update`）。
 *
 * `source.version: 'latest'`（既定・常に最新を追う）の mod は YAML を書き換えず、
 * ロック再生成だけ行う（＝lock 断片が現行最新のもので上書きされる）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
    assertCapabilityUpdate,
    assertPackageReplacement,
    canAdvanceModVersion,
    createModLock,
    lockedMods,
    type ModLockEntry,
    ModLockEntrySchema,
    ModLockSchema,
    requiredLockModIds,
    WorldDefinitionSchema,
} from '@ubichill/shared';
import type { Logger } from '@ubichill/terminal';
import yaml from 'yaml';
import { buildWorldLock, createDependencyAwareLockEntryGetter, resolveLatestVersion } from './buildWorldLock.ts';
import { resolvePackage } from './packages.ts';
import { writeWorldFiles } from './worldFiles.ts';

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
export async function runUpdate(argv: string[], log: Logger): Promise<void> {
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
    if (targetModId && !dependencies.some((d) => d.name === targetModId))
        throw new Error(`依存にありません: ${targetModId}`);
    const lockPath = argValue(argv, 'out') ?? worldPath.replace(/\.ya?ml$/i, '.lock.json');
    const oldLockText = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null;
    const oldLock = oldLockText ? ModLockSchema.parse(JSON.parse(oldLockText)) : undefined;
    const targets = targetModId ? dependencies.filter((d) => d.name === targetModId) : dependencies;

    const doc = yaml.parseDocument(raw);
    const bumps: string[] = [];

    const authored = new Map<string, ModLockEntry>();
    for (const dep of targets) {
        const previous = lockedMods(oldLock)[dep.name];
        const currentVersion = previous?.version ?? dep.source.version;
        if (dep.source.author && dep.source.url) {
            const resolved = await resolvePackage({ author: dep.source.author, id: dep.name });
            if (!canAdvanceModVersion(currentVersion, resolved.entry.version)) {
                if (previous) authored.set(dep.name, previous);
                continue;
            }
            assertPackageReplacement(previous, resolved.entry);
            authored.set(dep.name, resolved.entry);
            dep.source.version = resolved.entry.version;
            dep.source.url = resolved.entry.baseUrl;
            doc.setIn(['spec', 'dependencies', dependencies.indexOf(dep), 'source'], dep.source);
            continue;
        }
        const latest = dep.source.url
            ? await resolveLatestVersion(dep.source.url, dep.name)
            : resolveLocalLatestVersion(modsDir, dep.name);
        if (latest && !canAdvanceModVersion(currentVersion, latest)) {
            if (previous) authored.set(dep.name, previous);
            continue;
        }
        if (!latest || latest === dep.source.version || dep.source.version === 'latest') continue;

        const depIndex = (def.spec.dependencies ?? []).indexOf(dep);
        doc.setIn(['spec', 'dependencies', depIndex, 'source', 'version'], latest);
        bumps.push(`${dep.name}: ${dep.source.version} → ${latest}`);
    }

    const next = WorldDefinitionSchema.parse(doc.toJS());
    const preserved = oldLock
        ? createModLock(
              Object.fromEntries(
                  Object.entries(lockedMods(oldLock)).filter(([id]) => !targets.some((d) => d.name === id)),
              ),
          )
        : undefined;
    const get = createDependencyAwareLockEntryGetter(
        next.spec.dependencies,
        async (id, version) => {
            const v = version ?? resolveLocalLatestVersion(modsDir, id);
            if (!v) return null;
            const path = join(modsDir, id, `v${v}`, 'lock.json');
            return existsSync(path) ? ModLockEntrySchema.parse(JSON.parse(readFileSync(path, 'utf8'))) : null;
        },
        undefined,
        preserved,
    );
    const ids = requiredLockModIds(next.spec);
    const lock = await buildWorldLock(ids, (id) =>
        authored.get(id) ? Promise.resolve(authored.get(id) ?? null) : get(id),
    );
    if (ids.some((id) => !lockedMods(lock)[id])) throw new Error('依存を取得できないため更新しませんでした');
    assertCapabilityUpdate(oldLock, lock, argv.includes('--accept-capabilities'));
    writeWorldFiles([
        {
            path: worldPath,
            text: JSON.stringify(yaml.parse(raw)) === JSON.stringify(doc.toJS()) ? raw : String(doc),
            expected: raw,
        },
        { path: lockPath, text: `${JSON.stringify(lock, null, 2)}\n`, expected: oldLockText },
    ]);
    if (bumps.length)
        log.success(`${bumps.length} 個の mod の版を上げました\n${bumps.map((bump) => `  ${bump}`).join('\n')}`);
    else log.success('指定した依存の lock を更新しました。公開時に署名し直してください');
}
