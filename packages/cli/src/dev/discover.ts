/**
 * `ubichill dev` が手元でビルドする mod を探す（`ubichill build` と同じ規則）。
 *
 * - `mods/`（か `--mods-dir`）があれば、その下の package.json を持つ各ディレクトリ。
 * - 無ければ cwd が 1 つの mod。ただし `src/` が無ければ mod ではない（ワールドだけのリポジトリ。
 *   mod はすべて world.yaml の `dependencies[].source.url` から取る）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export interface DiscoverFs {
    exists: (path: string) => boolean;
    listDirs: (path: string) => string[];
    readJson: (path: string) => unknown;
}

export interface DiscoveredMods {
    /** mod の一覧を置くディレクトリ（単体 mod・ワールドだけのときは undefined）。 */
    modsRoot?: string;
    /** mod の id → ディレクトリ。 */
    modDirs: Map<string, string>;
}

/** mod の id は package.json から（`ubichill build` と同じ規則）。 */
function readModId(modDir: string, fs: DiscoverFs): string {
    const pkg = fs.readJson(join(modDir, 'package.json')) as { name?: string; ubichill?: { id?: string } };
    return pkg.ubichill?.id ?? pkg.name?.replace(/^@ubichill\/(?:mod-)?/, '') ?? basename(modDir);
}

export function discoverModDirs(cwd: string, modsDirArg: string | undefined, fs: DiscoverFs = diskFs): DiscoveredMods {
    const modsRoot = modsDirArg !== undefined ? resolve(cwd, modsDirArg) : join(cwd, 'mods');
    if (modsDirArg !== undefined || fs.exists(modsRoot)) {
        const modDirs = new Map(
            fs
                .listDirs(modsRoot)
                .map((name) => join(modsRoot, name))
                .filter((dir) => fs.exists(join(dir, 'package.json')))
                .map((dir) => [readModId(dir, fs), dir] as const),
        );
        return { modsRoot, modDirs };
    }
    if (!fs.exists(join(cwd, 'src')) && !fs.exists(join(cwd, 'prefabs'))) return { modDirs: new Map() };
    if (!fs.exists(join(cwd, 'package.json'))) {
        throw new Error('package.json が見つかりません。mod のルートで実行するか、--mods-dir=<dir> を指定してください');
    }
    return { modDirs: new Map([[readModId(cwd, fs), cwd]]) };
}

const diskFs: DiscoverFs = {
    exists: existsSync,
    listDirs: (path) =>
        readdirSync(path, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name),
    readJson: (path) => JSON.parse(readFileSync(path, 'utf-8')) as unknown,
};
