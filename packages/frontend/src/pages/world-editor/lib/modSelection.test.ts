import type { Dependency } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { computeModDiff, modToDependency, selectionToDependencies } from './modSelection';

const local = (name: string, version = 'latest'): Dependency => ({ name, source: { type: 'local', version } });
const url = (name: string, u: string, version = 'latest'): Dependency => ({
    name,
    source: { type: 'url', url: u, version },
});

describe('selectionToDependencies', () => {
    it('baseUrl 有無で local/url を切り替える', () => {
        expect(
            selectionToDependencies([
                { id: 'a', version: 'latest' },
                { id: 'b', version: '1.0.0', baseUrl: 'https://example.com/mods/b' },
            ]),
        ).toEqual([local('a'), url('b', 'https://example.com/mods/b', '1.0.0')]);
    });
});

describe('modToDependency', () => {
    it('ローカル mod は local 依存にする', () => {
        expect(modToDependency({ id: 'm', name: 'm', version: '1.0.0' })).toEqual(local('m'));
    });

    it('baseUrl を持つ mod は url 依存にする', () => {
        expect(
            modToDependency({ id: 'm', name: 'm', version: '1.0.0', baseUrl: 'https://example.com/m' }, '2.0.0'),
        ).toEqual(url('m', 'https://example.com/m', '2.0.0'));
    });
});

describe('computeModDiff', () => {
    it('追加/削除/更新を正しく分類する', () => {
        const current = [local('a'), local('b', '1.0.0')];
        const next = [local('b', '2.0.0'), url('c', 'https://example.com/c')];
        const diff = computeModDiff(current, next);

        expect(diff.added).toEqual([url('c', 'https://example.com/c')]);
        expect(diff.removed).toEqual([local('a')]);
        expect(diff.updated).toEqual([{ from: local('b', '1.0.0'), to: local('b', '2.0.0') }]);
    });

    it('取得元 URL の変化も更新として扱う', () => {
        const current = [local('a', '1.0.0')];
        const next = [url('a', 'https://example.com/a', '1.0.0')];
        const diff = computeModDiff(current, next);

        expect(diff.added).toEqual([]);
        expect(diff.removed).toEqual([]);
        expect(diff.updated).toEqual([{ from: local('a', '1.0.0'), to: url('a', 'https://example.com/a', '1.0.0') }]);
    });

    it('変化が無ければ空の差分を返す', () => {
        const deps = [local('a')];
        const diff = computeModDiff(deps, deps);

        expect(diff.added).toEqual([]);
        expect(diff.removed).toEqual([]);
        expect(diff.updated).toEqual([]);
    });
});
