import { createModLock, type Dependency, lockedMods, type ModLock, type ModLockEntry } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ModInstallationCheck } from '../../../world/modInstallation';
import { changedDependencyNames, installFailureText, type ModInstallDeps, proposeModInstall } from './modInstall';

const dep = (name: string, version: string, extra: Partial<Dependency['source']> = {}): Dependency => ({
    name,
    source: { version, ...extra },
});
const entry = (id: string, version: string, hash = 'A', extra: Partial<ModLockEntry> = {}): ModLockEntry => ({
    id,
    version,
    manifestIntegrity: `sha256-${hash.repeat(43)}=`,
    components: {},
    ...extra,
});
const allowed = (modId: string, version: string): ModInstallationCheck => ({
    modId,
    version,
    result: { status: 'verified', author: 'official@ubichill.com' },
    allowed: true,
});

/** 依存の版どおりの lock を返す取得元（previous にあれば使う）。 */
function fakeDeps(overrides: Partial<ModInstallDeps> = {}) {
    const deps = {
        check: vi.fn(async (list: Dependency[]) => list.map((d) => allowed(d.name, d.source.version))),
        resolveLock: vi.fn(async (list: Dependency[], previous: ModLock | undefined) =>
            createModLock(
                Object.fromEntries(
                    list.map((d) => {
                        const kept = lockedMods(previous)[d.name];
                        return [
                            d.name,
                            kept?.version === d.source.version ? kept : entry(d.name, d.source.version, 'B'),
                        ];
                    }),
                ),
            ),
        ),
        verify: vi.fn(async () => undefined),
        ...overrides,
    };
    return deps;
}

describe('changedDependencyNames', () => {
    it('追加と版・取得元の変更だけを数え、外したものは数えない', () => {
        const current = [dep('a', '1.0.0'), dep('b', '1.0.0'), dep('c', '1.0.0')];
        const next = [dep('a', '1.0.0'), dep('b', '2.0.0'), dep('d', '1.0.0')];
        expect([...changedDependencyNames(current, next)].sort()).toEqual(['b', 'd']);
    });
});

describe('proposeModInstall', () => {
    const lock = createModLock({ pen: entry('pen', '2.3.0') });

    it('何も変わらなければ何もしない（通信もしない）', async () => {
        const deps = fakeDeps();
        const current = [dep('pen', '2.3.0')];
        expect(await proposeModInstall({ current, next: [...current], lock }, deps)).toEqual({ kind: 'unchanged' });
        expect(deps.check).not.toHaveBeenCalled();
    });

    it('外すだけなら通信せず、lock はそのまま残す（配置済みの Component が使うため）', async () => {
        const deps = fakeDeps();
        const result = await proposeModInstall({ current: [dep('pen', '2.3.0')], next: [], lock }, deps);
        expect(result).toEqual({ kind: 'ready', dependencies: [], lock });
        expect(deps.check).not.toHaveBeenCalled();
        expect(deps.resolveLock).not.toHaveBeenCalled();
    });

    it('確かめるのは変わった依存と lock に無い依存だけ。固定済みで変わらない依存は確かめ直さない', async () => {
        const deps = fakeDeps();
        await proposeModInstall(
            {
                current: [dep('pen', '2.3.0'), dep('ghost', '1.0.0')],
                next: [dep('pen', '2.3.0'), dep('ghost', '1.0.0'), dep('brush', '1.0.0')],
                lock,
            },
            deps,
        );
        expect(vi.mocked(deps.check).mock.calls[0][0].map((d) => d.name)).toEqual(['ghost', 'brush']);
    });

    it('1 つでも確かめられなければ、lock を解決せず何も変えない', async () => {
        const failure: ModInstallationCheck = {
            modId: 'brush',
            version: '1.0.0',
            result: { status: 'unsigned' },
            allowed: false,
        };
        const deps = fakeDeps({
            check: vi.fn(async (list: Dependency[]) =>
                list.map((d) => (d.name === 'brush' ? failure : allowed(d.name, d.source.version))),
            ),
        });
        const result = await proposeModInstall(
            { current: [], next: [dep('brush', '1.0.0'), dep('stamp', '1.0.0')], lock: undefined },
            deps,
        );
        expect(result).toEqual({ kind: 'rejected', failures: [failure] });
        expect(deps.resolveLock).not.toHaveBeenCalled();
    });

    it("'latest' を選んだ依存は、確かめた版で固定する", async () => {
        const deps = fakeDeps({
            check: vi.fn(async (list: Dependency[]) => list.map((d) => allowed(d.name, '1.4.0'))),
        });
        const result = await proposeModInstall({ current: [], next: [dep('brush', 'latest')], lock: undefined }, deps);
        expect(result).toMatchObject({ kind: 'ready', dependencies: [dep('brush', '1.4.0')] });
    });

    it('変わった lock だけを確かめる（前と同じ lock の mod は確かめ直さない）', async () => {
        const deps = fakeDeps();
        const result = await proposeModInstall(
            { current: [dep('pen', '2.3.0')], next: [dep('pen', '2.3.0'), dep('brush', '1.0.0')], lock },
            deps,
        );
        expect(vi.mocked(deps.verify).mock.calls.map(([e]) => e.id)).toEqual(['brush']);
        expect(result.kind === 'ready' && lockedMods(result.lock).pen).toEqual(lockedMods(lock).pen);
    });

    it('配布物を確かめられなければ失敗する（何も変えない）', async () => {
        const deps = fakeDeps({
            verify: vi.fn(async () => Promise.reject(new Error('package の作者を確認できません'))),
        });
        await expect(
            proposeModInstall({ current: [], next: [dep('brush', '1.0.0')], lock: undefined }, deps),
        ).rejects.toThrow('作者を確認できません');
    });

    it('取得元を変えて、同じ版番号で別の内容が来たら止める', async () => {
        const moved = createModLock({ pen: entry('pen', '2.3.0', 'A', { baseUrl: 'https://old.example/mods' }) });
        const deps = fakeDeps({
            resolveLock: vi.fn(async () =>
                createModLock({ pen: entry('pen', '2.3.0', 'C', { baseUrl: 'https://new.example/mods' }) }),
            ),
        });
        await expect(
            proposeModInstall(
                {
                    current: [dep('pen', '2.3.0', { url: 'https://old.example/mods' })],
                    next: [dep('pen', '2.3.0', { url: 'https://new.example/mods' })],
                    lock: moved,
                },
                deps,
            ),
        ).rejects.toThrow('内容が変わっています');
        expect(deps.verify).not.toHaveBeenCalled();
    });

    it('解決した lock に選んだ版が無ければ、以前の lock で補わずに失敗する', async () => {
        const deps = fakeDeps({ resolveLock: vi.fn(async () => createModLock({})) });
        await expect(
            proposeModInstall({ current: [dep('pen', '2.3.0')], next: [dep('pen', '2.3.1')], lock }, deps),
        ).rejects.toThrow('取得できない');
    });
});

describe('installFailureText', () => {
    const check = (result: ModInstallationCheck['result']): ModInstallationCheck => ({
        modId: 'pen',
        version: '1.0.0',
        result,
        allowed: false,
    });

    it('署名が通っても作者が違えば、その作者を出す（「いまは確かめられない」と言わない）', () => {
        const text = installFailureText(check({ status: 'verified', author: 'mallory@evil.example' }));
        expect(text).toContain('mallory@evil.example');
        expect(text).not.toContain('いまは');
    });

    it('署名なし・署名の拒否・通信の失敗を分ける', () => {
        expect(installFailureText(check({ status: 'unsigned' }))).toContain('署名がなく');
        expect(installFailureText(check({ status: 'rejected', reason: 'author-unconfirmed' }))).toContain('別の版');
        expect(installFailureText(check({ status: 'unavailable' }))).toContain('時間をおいて');
    });
});
