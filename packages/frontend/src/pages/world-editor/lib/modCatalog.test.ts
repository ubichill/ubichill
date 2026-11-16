import { createModLock, type Dependency, type InitialEntity, type ModLockEntry } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    candidateDependency,
    candidateFromIndex,
    candidateFromPackage,
    candidateStatus,
    checkable,
    installedMods,
    matchesCandidate,
    modUsage,
    removalWarning,
    selectableCandidates,
    sortVersions,
    uniqueCandidates,
    withCandidates,
    withDependencies,
    withoutDependencies,
} from './modCatalog';

const hostPen = candidateFromIndex({
    id: 'pen',
    name: 'ペン',
    version: '2.3.1',
    versions: [{ version: '2.3.0' }, { version: '2.3.1' }, { version: '2.10.0' }],
});
const registryPen = candidateFromIndex({
    id: 'pen',
    name: 'pen',
    version: '1.0.0',
    baseUrl: 'https://reg.example/mods/',
});
const authorPen = candidateFromPackage({
    author: 'bob@peer.example',
    id: 'pen',
    version: '3.0.0',
    baseUrl: 'https://cdn.peer.example/mods',
});
const dep = (name: string, version: string, extra: Partial<Dependency['source']> = {}): Dependency => ({
    name,
    source: { version, ...extra },
});
const entry = (id: string, version: string, extra: Partial<ModLockEntry> = {}): ModLockEntry => ({
    id,
    version,
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    components: {},
    ...extra,
});

describe('candidateFromIndex / candidateFromPackage', () => {
    it('版は新しい順に並べ、数字として比べる（2.10.0 は 2.3.1 より新しい）', () => {
        expect(hostPen.versions).toEqual(['2.10.0', '2.3.1', '2.3.0']);
    });

    it('取得元・作者が違えば同じ ID でも別の候補。末尾の / は同じ取得元として扱う', () => {
        const keys = new Set([hostPen.key, registryPen.key, authorPen.key]);
        expect(keys.size).toBe(3);
        expect(
            candidateFromIndex({ id: 'pen', name: 'pen', version: '1.0.0', baseUrl: 'https://reg.example/mods' }).key,
        ).toBe(registryPen.key);
    });

    it('依存に書く形: 本体の mod は取得元を書かず、作者参照の mod は作者と取得元を書く', () => {
        expect(candidateDependency(hostPen)).toEqual(dep('pen', '2.3.1'));
        expect(candidateDependency(authorPen, '2.0.0')).toEqual(
            dep('pen', '2.0.0', { url: 'https://cdn.peer.example/mods', author: 'bob@peer.example' }),
        );
    });
});

describe('candidateStatus', () => {
    it('入っていなければ追加できる', () => {
        expect(candidateStatus(hostPen, [dep('brush', '1.0.0')], undefined)).toEqual({ kind: 'available' });
    });

    it('同じ取得元で入っていれば使用中。一覧の最新版より古ければ更新できる', () => {
        expect(candidateStatus(hostPen, [dep('pen', '2.3.1')], undefined)).toEqual({
            kind: 'installed',
            version: '2.3.1',
            outdated: false,
        });
        expect(candidateStatus(hostPen, [dep('pen', '2.3.0')], undefined)).toMatchObject({ outdated: true });
    });

    it('一覧より新しい版を使っていても「更新」にしない（一覧が古いだけ）', () => {
        expect(candidateStatus(hostPen, [dep('pen', '9.0.0')], undefined)).toMatchObject({ outdated: false });
    });

    it("'latest' のままの依存は lock が固定している版で比べる。lock にも無ければ更新の判断をしない", () => {
        const lock = createModLock({ pen: entry('pen', '2.3.0') });
        expect(candidateStatus(hostPen, [dep('pen', 'latest')], lock)).toEqual({
            kind: 'installed',
            version: '2.3.0',
            outdated: true,
        });
        expect(candidateStatus(hostPen, [dep('pen', 'latest')], undefined)).toEqual({
            kind: 'installed',
            version: undefined,
            outdated: false,
        });
    });

    it('同じ ID を別の取得元から入れていれば、追加も更新もできない', () => {
        expect(candidateStatus(registryPen, [dep('pen', '2.3.1')], undefined)).toEqual({ kind: 'conflict' });
        expect(candidateStatus(hostPen, [dep('pen', '1.0.0', { url: 'https://reg.example/mods' })], undefined)).toEqual(
            {
                kind: 'conflict',
            },
        );
    });
});

describe('matchesCandidate', () => {
    it('名前・ID・作者の部分一致で、大文字小文字と前後の空白を無視する', () => {
        expect(matchesCandidate(hostPen, ' ペン ')).toBe(true);
        expect(matchesCandidate(authorPen, 'BOB@')).toBe(true);
        expect(matchesCandidate(hostPen, 'bob')).toBe(false);
        expect(matchesCandidate(hostPen, '')).toBe(true);
    });
});

describe('uniqueCandidates', () => {
    it('同じ候補は最初の 1 件だけ残し、並びは変えない', () => {
        expect(uniqueCandidates([registryPen, hostPen, registryPen, authorPen])).toEqual([
            registryPen,
            hostPen,
            authorPen,
        ]);
    });
});

describe('checkable', () => {
    it('追加・更新できるものだけチェックできる（使用中で最新・同じ ID が入っているものはできない）', () => {
        expect(checkable(hostPen, { kind: 'available' }, [])).toBe(true);
        expect(checkable(hostPen, { kind: 'installed', version: '2.3.0', outdated: true }, [])).toBe(true);
        expect(checkable(hostPen, { kind: 'installed', version: '2.3.1', outdated: false }, [])).toBe(false);
        expect(checkable(hostPen, { kind: 'conflict' }, [])).toBe(false);
    });

    it('同じ ID の別の候補をチェックしていればできない（自分自身のチェックは数えない）', () => {
        expect(checkable(hostPen, { kind: 'available' }, [authorPen])).toBe(false);
        expect(checkable(hostPen, { kind: 'available' }, [hostPen])).toBe(true);
    });
});

describe('selectableCandidates', () => {
    const brush = candidateFromIndex({ id: 'brush', name: 'brush', version: '1.0.0' });
    const rows = (list: (typeof hostPen)[], deps: Dependency[] = []) =>
        list.map((candidate) => ({ candidate, status: candidateStatus(candidate, deps, undefined) }));

    it('同じ ID の候補が並んでいれば先のものだけを選び、使用中で最新のものは選ばない', () => {
        expect(selectableCandidates(rows([authorPen, hostPen, brush]), [])).toEqual([authorPen, brush]);
        expect(selectableCandidates(rows([hostPen, brush], [dep('pen', '2.3.1')]), [])).toEqual([brush]);
    });

    it('一覧に出ていない候補をチェック済みなら、同じ ID の候補は選ばない', () => {
        expect(selectableCandidates(rows([authorPen, brush]), [hostPen])).toEqual([brush]);
    });
});

describe('withCandidates', () => {
    it('チェックした候補を最新版で足し、入っている古い版は同じ位置で上げる', () => {
        const brush = candidateFromIndex({ id: 'brush', name: 'brush', version: '1.0.0' });
        const current = [dep('pen', '2.3.0'), dep('stamp', '1.0.0')];
        expect(withCandidates(current, undefined, [brush, hostPen])).toEqual([
            dep('pen', '2.3.1'),
            dep('stamp', '1.0.0'),
            dep('brush', '1.0.0'),
        ]);
    });

    it('使用中で最新のもの・同じ ID が入っているもの・同じ ID を 2 つ選んだときの 2 つ目は足さない', () => {
        const current = [dep('pen', '2.3.1')];
        expect(withCandidates(current, undefined, [hostPen, registryPen])).toEqual(current);
        expect(withCandidates([], undefined, [authorPen, hostPen])).toEqual([candidateDependency(authorPen)]);
    });
});

describe('withDependencies / withoutDependencies', () => {
    it('同じ名前は同じ位置で置き換え、新しいものは末尾に足す', () => {
        expect(
            withDependencies([dep('a', '1.0.0'), dep('b', '1.0.0')], [dep('c', '1.0.0'), dep('a', '2.0.0')]),
        ).toEqual([dep('a', '2.0.0'), dep('b', '1.0.0'), dep('c', '1.0.0')]);
    });

    it('外すのは名前で。無い名前を指定しても何も起きない', () => {
        expect(withoutDependencies([dep('a', '1.0.0'), dep('b', '1.0.0')], new Set(['b', 'zzz']))).toEqual([
            dep('a', '1.0.0'),
        ]);
    });
});

describe('installedMods', () => {
    it('同じ取得元の候補があれば、版の選択肢（使っている版を含む）と更新の有無を出す', () => {
        const [pen] = installedMods([dep('pen', '2.2.0')], undefined, [registryPen, hostPen]);
        expect(pen.candidate).toBe(hostPen);
        expect(pen.versions).toEqual(['2.10.0', '2.3.1', '2.3.0', '2.2.0']);
        expect(pen.outdated).toBe(true);
    });

    it('作者参照で入れた mod は、同じ作者の候補だけを使う（取得元が同じでも作者が違えば使わない）', () => {
        const impostor = { ...authorPen, key: 'other', author: 'mallory@evil.example' };
        const installed = dep('pen', '3.0.0', { url: authorPen.baseUrl, author: 'bob@peer.example' });
        expect(installedMods([installed], undefined, [impostor])[0]).toMatchObject({
            candidate: undefined,
            versions: [],
        });
        expect(installedMods([installed], undefined, [impostor, authorPen])[0].candidate).toBe(authorPen);
    });

    it('一覧に無い mod は版を選べない', () => {
        expect(installedMods([dep('ghost', '1.0.0')], undefined, [hostPen])[0]).toMatchObject({
            version: '1.0.0',
            versions: [],
            outdated: false,
        });
    });
});

describe('modUsage', () => {
    const entity = (id: string, types: string[], children: InitialEntity[] = []): InitialEntity => ({
        id,
        transform: { x: 0, y: 0, z: 0, w: 0, h: 0, rotation: 0, scale: 1 } as InitialEntity['transform'],
        components: types.map((type) => ({ type, data: {} })) as InitialEntity['components'],
        tags: [],
        children,
    });

    it('mod ごとに、その Component を使う Entity を数える。1 つの Entity に 2 つあっても 1、子も数え、core は数えない', () => {
        const usage = modUsage([
            entity(
                'tray',
                ['pen:tray', 'core:sprite'],
                [entity('pen-1', ['pen:pen', 'pen:pen']), entity('ball', ['danmaku:player'])],
            ),
            entity('plain', ['core:sprite']),
        ]);
        expect(Object.fromEntries(usage)).toEqual({ pen: 2, danmaku: 1 });
    });
});

describe('removalWarning', () => {
    it('配置済みの Component が無ければ確認しない', () => {
        expect(removalWarning(['pen'], new Map())).toBeNull();
        expect(removalWarning(['pen'], new Map([['pen', 0]]))).toBeNull();
    });

    it('使われている mod だけを数とともに挙げる', () => {
        const message = removalWarning(['pen', 'brush'], new Map([['pen', 3]]));
        expect(message).toContain('pen: 3 個の Entity');
        expect(message).not.toContain('brush');
    });
});

describe('sortVersions', () => {
    it('新しい順・重複なし', () => {
        expect(sortVersions(['1.0.0', '1.10.0', '1.2.0', '1.0.0'])).toEqual(['1.10.0', '1.2.0', '1.0.0']);
    });
});
