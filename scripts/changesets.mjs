/**
 * `.changeset/*.md` の検査。
 *
 * `ignore` のパッケージだけを指す changeset は `changeset version` で消費されずに残り続ける。
 * 残っている間は changesets/action が「版を上げる PR を作る」側に入り続け、npm への公開が走らない
 * （#290 のマージ後に作る PR の差分が無く失敗し、ubichill@4.0.0 が出なかった）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** changeset の frontmatter から対象パッケージ名を取り出す。frontmatter が無ければ空。 */
export function changesetPackages(markdown) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
    if (!match) return [];
    return match[1]
        .split(/\r?\n/)
        .map((line) => /^\s*["']?([^"':\s][^"':]*)["']?\s*:\s*(major|minor|patch)\s*$/.exec(line)?.[1])
        .filter((name) => name !== undefined);
}

/** 消費されない changeset（対象が空、または全部 ignore）のファイル名。 */
export function unconsumableChangesets(changesets, ignore) {
    const ignored = new Set(ignore);
    return changesets
        .filter(({ markdown }) => changesetPackages(markdown).every((name) => ignored.has(name)))
        .map(({ file }) => file);
}

export function readChangesets(dir) {
    return readdirSync(dir)
        .filter((file) => file.endsWith('.md') && file !== 'README.md')
        .map((file) => ({ file, markdown: readFileSync(join(dir, file), 'utf-8') }));
}
