import { buildWorldLock, createDependencyAwareLockEntryGetter } from '@ubichill/loader';
import { createModLock, type Dependency, lockedMods, type ModLockEntry } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { computeModDiff, lockForSelection, modToDependency, selectionToDependencies } from './modSelection';

const local = (name: string, version = 'latest'): Dependency => ({ name, source: { version } });
const url = (name: string, u: string, version = 'latest'): Dependency => ({
    name,
    source: { url: u, version },
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

const entry = (version: string, extra: Partial<ModLockEntry> = {}): ModLockEntry => ({
    id: 'demo',
    version,
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    components: {},
    ...extra,
});

describe('lockForSelection', () => {
    it('更新先の取得に失敗したら、古いlockで成功扱いにせず、以前の依存とlockを残す', async () => {
        const baseUrl = 'https://cdn.example/mods';
        const dependencies = [url('demo', baseUrl, '1.0.0')];
        const previous = createModLock({ demo: entry('1.0.0', { baseUrl }) });
        const before = structuredClone({ dependencies, previous });
        const next = [url('demo', baseUrl, '2.0.0')];
        const get = createDependencyAwareLockEntryGetter(
            next,
            async () => null,
            async () => new Response('{}', { status: 503 }),
            previous,
        );
        const resolved = await buildWorldLock(['demo'], get);
        expect(() => lockForSelection(next, previous, resolved)).toThrow('demo');
        expect({ dependencies, previous }).toEqual(before);
    });

    it('更新が揃ったときだけ差し替え、配置済みComponentだけが使うlockも残す', () => {
        const implicit = entry('1.0.0', { id: 'implicit' });
        const previous = createModLock({ demo: entry('1.0.0'), implicit });
        const updated = entry('2.0.0');
        expect(
            lockedMods(lockForSelection([local('demo', '2.0.0')], previous, createModLock({ demo: updated }))),
        ).toEqual({
            demo: updated,
            implicit,
        });
        expect(lockedMods(previous).demo.version).toBe('1.0.0');
    });

    it('変更のない依存は、通信できなくても固定済みlockを使える', async () => {
        const previous = createModLock({ demo: entry('1.0.0') });
        const dependencies = [local('demo', '1.0.0')];
        const get = createDependencyAwareLockEntryGetter(
            dependencies,
            async () => {
                throw new Error('offline');
            },
            undefined,
            previous,
        );
        const resolved = await buildWorldLock(['demo'], get);
        expect(lockForSelection(dependencies, previous, resolved)).toEqual(previous);
    });

    it.each([
        { dependency: local('demo', '2.0.0'), resolved: entry('1.0.0') },
        { dependency: local('demo', '1.0.0'), resolved: entry('1.0.0', { id: 'other' }) },
        {
            dependency: url('demo', 'https://new.example', '1.0.0'),
            resolved: entry('1.0.0', { baseUrl: 'https://old.example' }),
        },
        {
            dependency: { name: 'demo', source: { version: '1.0.0', author: 'alice@example.com' } },
            resolved: entry('1.0.0', { author: 'bob@example.com' }),
        },
    ])('解決結果が選んだ版・ID・配布先・作者と違えば拒否する: %j', ({ dependency, resolved }) => {
        expect(() => lockForSelection([dependency], undefined, createModLock({ demo: resolved }))).toThrow('demo');
    });

    it('初めて追加するmodの取得失敗も拒否する', () => {
        expect(() => lockForSelection([local('demo')], undefined, createModLock({}))).toThrow('demo');
    });
});
