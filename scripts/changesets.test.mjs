/**
 * .changeset/*.md は、少なくとも 1 つ「版を上げて公開する」パッケージを対象にすること。
 * config.json の ignore に入っているパッケージだけを対象にした changeset は `changeset version` で消費されずに残り、
 * Release ワークフロー（changesets/action）が「まだ changeset がある」と判断して公開に進めなくなる（#242 の changeset で起きた）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('../.changeset/', import.meta.url);
const config = JSON.parse(readFileSync(new URL('config.json', dir), 'utf-8'));
const ignored = new Set(config.ignore ?? []);

/** フロントマターの `"<name>": <bump>` の名前。 */
export function changesetPackages(source) {
    const front = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? '';
    return [...front.matchAll(/^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/gm)].map((m) => m[1]);
}

describe('.changeset', () => {
    const files = readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'README.md');

    it.each(files.length > 0 ? files : ['（なし）'])('%s は ignore 以外のパッケージを対象にする', (name) => {
        if (name === '（なし）') return;
        const packages = changesetPackages(readFileSync(new URL(name, dir), 'utf-8'));
        expect(packages.length, `${name} に対象のパッケージがありません`).toBeGreaterThan(0);
        expect(
            packages.some((pkg) => !ignored.has(pkg)),
            `${name} は ignore のパッケージ（${packages.join(', ')}）だけを対象にしているので消費されず、公開が止まります`,
        ).toBe(true);
    });

    it('フロントマターを読める', () => {
        expect(changesetPackages('---\n"@ubichill/sdk": major\n\'@ubichill/cli\': minor\n---\n\n本文')).toEqual([
            '@ubichill/sdk',
            '@ubichill/cli',
        ]);
        expect(changesetPackages('本文だけ')).toEqual([]);
    });
});
