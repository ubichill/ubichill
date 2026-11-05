/**
 * ファイルの変更を、どの mod をビルドし直すか・ワールドを作り直すかに分ける。
 *
 * 監視するのは mod のディレクトリ（再帰）と、mod の外で import しているファイルのディレクトリ、mod の一覧のディレクトリ、
 * world.yaml のディレクトリだけ（プロジェクト全体を再帰で見ない: node_modules を抱える monorepo で重く、Linux では
 * inotify の上限にも当たる）。
 */
import { type FSWatcher, watch } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

export interface ChangePlanInput {
    /** mod の id → ディレクトリ（絶対パス）。 */
    modDirs: ReadonlyMap<string, string>;
    /** mod の id → 前回のビルドが読んだファイル（絶対パス）。 */
    inputsByMod: ReadonlyMap<string, ReadonlySet<string>>;
    /** mod の一覧を置くディレクトリ（単体 mod のときは undefined）。 */
    modsRoot?: string;
    /** world.yaml の絶対パス（無ければ undefined）。 */
    worldPath?: string;
}

export interface ChangePlan {
    /** ビルドし直す mod。 */
    rebuild: ReadonlySet<string>;
    /** mod の一覧を探し直す（mod のディレクトリの追加・削除）。 */
    rescan: boolean;
    /** ワールドを作り直す。 */
    reconfigure: boolean;
}

const IGNORED = new Set(['node_modules', '.git', 'dist', 'dist-npm', '.ubichill']);

const within = (path: string, dir: string): boolean =>
    path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/** 無視するディレクトリの下か（`node_modules` の中の変更で mod をビルドし直さない）。 */
export const isIgnoredPath = (path: string): boolean => path.split(/[\\/]/).some((segment) => IGNORED.has(segment));

/** 変わったパス（絶対）から、することを決める。表: docs/design/world-runtime-dev.md「監視と再ビルド」。 */
export function planChanges(paths: readonly string[], input: ChangePlanInput): ChangePlan {
    const rebuild = new Set<string>();
    const plan = { rescan: false, reconfigure: false };
    for (const raw of paths) {
        const path = resolve(raw);
        if (isIgnoredPath(path)) continue;
        if (input.worldPath && path === input.worldPath) plan.reconfigure = true;
        if (input.modsRoot && dirname(path) === input.modsRoot) plan.rescan = true;
        for (const [id, dir] of input.modDirs) {
            if (within(path, dir)) rebuild.add(id);
        }
        for (const [id, inputs] of input.inputsByMod) {
            if (inputs.has(path)) rebuild.add(id);
        }
    }
    return { rebuild, ...plan };
}

export interface WatchTarget {
    path: string;
    recursive: boolean;
}

/** 監視する場所: mod のディレクトリ（再帰）、外の入力のディレクトリ、mod の一覧のディレクトリ、world.yaml のディレクトリ。 */
export function watchTargets(input: ChangePlanInput): WatchTarget[] {
    const targets = new Map<string, boolean>();
    for (const dir of input.modDirs.values()) targets.set(dir, true);
    for (const [id, inputs] of input.inputsByMod) {
        const modDir = input.modDirs.get(id);
        for (const path of inputs) {
            if (isIgnoredPath(path) || (modDir && within(path, modDir))) continue;
            const dir = dirname(path);
            if (![...targets].some(([t, recursive]) => recursive && within(dir, t)))
                targets.set(dir, targets.get(dir) ?? false);
        }
    }
    if (input.modsRoot) targets.set(input.modsRoot, targets.get(input.modsRoot) ?? false);
    if (input.worldPath) {
        const dir = dirname(input.worldPath);
        targets.set(dir, targets.get(dir) ?? false);
    }
    return [...targets].map(([path, recursive]) => ({ path, recursive }));
}

export interface Watcher {
    /** 監視する場所を入れ替える（ビルドのたびに入力が変わる）。 */
    update(targets: readonly WatchTarget[]): void;
    close(): void;
}

/** 変更を 100ms まとめて `onChange` に渡す。 */
export function createWatcher(onChange: (paths: string[]) => void, debounceMs = 100): Watcher {
    const watchers = new Map<string, FSWatcher>();
    const pending = new Set<string>();
    const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined };
    const flush = () => {
        timer.current = undefined;
        const paths = [...pending];
        pending.clear();
        if (paths.length > 0) onChange(paths);
    };
    const open = (target: WatchTarget) => {
        try {
            const watcher = watch(target.path, { recursive: target.recursive }, (_event, filename) => {
                pending.add(filename ? resolve(target.path, String(filename)) : target.path);
                clearTimeout(timer.current);
                timer.current = setTimeout(flush, debounceMs);
            });
            watcher.on('error', () => watchers.delete(target.path));
            watchers.set(target.path, watcher);
        } catch {
            // 消えたディレクトリなど。次の更新で見直す
        }
    };
    return {
        update(targets) {
            const wanted = new Map(targets.map((t) => [t.path, t]));
            for (const [path, watcher] of watchers) {
                if (!wanted.has(path)) {
                    watcher.close();
                    watchers.delete(path);
                }
            }
            for (const target of targets) if (!watchers.has(target.path)) open(target);
        },
        close() {
            clearTimeout(timer.current);
            for (const watcher of watchers.values()) watcher.close();
            watchers.clear();
        },
    };
}
