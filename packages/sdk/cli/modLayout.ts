/**
 * `ubichill build` の出力の配置（verify と publish が同じ規則で辿る）。
 *
 * - 複数 mod の出力（`--mods-dir`）: `<root>/<modId>/v<version>/`
 * - 単体 mod の出力（外部リポジトリの既定）: `<root>/v<version>/`（公開先で `<modId>/` の下に置く）
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ModVersionDir {
    /** 置き場所から決まる mod の ID。単体 mod の出力では置き場所に現れない。 */
    modId?: string;
    /** `v<version>`。 */
    versionDir: string;
    dir: string;
    /** メッセージ用（`pen/v1.0.0`）。 */
    label: string;
}

// `video-player` のように v で始まる mod の ID を版のディレクトリと取り違えない
const isVersionDir = (name: string): boolean => /^v\d+\./.test(name);

export function modVersionDirs(root: string, listDirs: (path: string) => string[]): ModVersionDir[] {
    const own = listDirs(root).filter(isVersionDir);
    if (own.length > 0) return own.map((v) => ({ versionDir: v, dir: join(root, v), label: v }));
    return listDirs(root).flatMap((modId) =>
        listDirs(join(root, modId))
            .filter(isVersionDir)
            .map((v) => ({ modId, versionDir: v, dir: join(root, modId, v), label: `${modId}/${v}` })),
    );
}

export const listDirsOnDisk = (path: string): string[] =>
    readdirSync(path, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
