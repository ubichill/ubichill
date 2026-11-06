import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { changesetPackages, readChangesets, unconsumableChangesets } from './changesets.mjs';

const changesetDir = fileURLToPath(new URL('../.changeset', import.meta.url));

describe('changesetPackages', () => {
    it('引用符あり・なし、どちらのパッケージ名も読む', () => {
        const md = '---\n"@ubichill/sdk": patch\n@ubichill/cli: minor\n---\n\n本文';
        expect(changesetPackages(md)).toEqual(['@ubichill/sdk', '@ubichill/cli']);
    });

    it('本文の中の「"x": patch」のような行は拾わない', () => {
        const md = '---\n"@ubichill/sdk": patch\n---\n\n"@ubichill/react": major と書いても対象ではない\n';
        expect(changesetPackages(md)).toEqual(['@ubichill/sdk']);
    });

    it('CRLF でも読む', () => {
        expect(changesetPackages('---\r\n"ubichill": major\r\n---\r\n')).toEqual(['ubichill']);
    });

    it('frontmatter が無い・空なら空', () => {
        expect(changesetPackages('本文だけ')).toEqual([]);
        expect(changesetPackages('---\n---\n')).toEqual([]);
    });
});

describe('unconsumableChangesets', () => {
    const ignore = ['@ubichill/react', '@ubichill/sandbox'];

    it('ignore だけを指す changeset は消費されない', () => {
        const changesets = [{ file: 'a.md', markdown: '---\n"@ubichill/react": patch\n"@ubichill/sandbox": patch\n---\n' }];
        expect(unconsumableChangesets(changesets, ignore)).toEqual(['a.md']);
    });

    it('公開するパッケージを 1 つでも含めば消費される', () => {
        const changesets = [{ file: 'b.md', markdown: '---\n"@ubichill/react": patch\n"@ubichill/sdk": patch\n---\n' }];
        expect(unconsumableChangesets(changesets, ignore)).toEqual([]);
    });

    it('対象が空の changeset も消費されない扱いにする', () => {
        expect(unconsumableChangesets([{ file: 'empty.md', markdown: '---\n---\n' }], ignore)).toEqual(['empty.md']);
    });
});

describe('.changeset', () => {
    it('すべての changeset が changeset version で消費される（残るとリリースが止まる）', () => {
        const { ignore } = JSON.parse(readFileSync(`${changesetDir}/config.json`, 'utf-8'));
        expect(unconsumableChangesets(readChangesets(changesetDir), ignore)).toEqual([]);
    });
});
