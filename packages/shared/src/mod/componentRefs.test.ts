import { describe, expect, it } from 'vitest';
import {
    conflictedMediaSurfaces,
    describeReferenceProblem,
    fieldLabel,
    findMediaConflicts,
    findReferenceProblems,
    frameMediaTargets,
    isMediaOutputField,
    isRefField,
    type RefCheckEntity,
    type ReferenceProblem,
    type RefFieldSpec,
    refTargets,
    remapRefs,
    resolveRefs,
} from './componentRefs';

const entity = (
    id: string,
    components: RefCheckEntity['components'],
    children: RefCheckEntity[] = [],
): RefCheckEntity => ({ id, components, children });

describe('refTargets', () => {
    it('entityRef は文字列 1 つだけを受ける', () => {
        expect(refTargets({ type: 'entityRef' }, 'screen')).toEqual(['screen']);
        expect(refTargets({ type: 'entityRef' }, ['screen'])).toEqual([]);
        expect(refTargets({ type: 'entityRef' }, 42)).toEqual([]);
        expect(refTargets({ type: 'entityRef' }, '')).toEqual([]);
    });

    it('entityRefArray は文字列以外・空文字・重複を落とす', () => {
        expect(refTargets({ type: 'entityRefArray' }, ['a', 1, '', null, 'b', 'a'])).toEqual(['a', 'b']);
        expect(refTargets({ type: 'entityRefArray' }, 'a')).toEqual([]);
    });

    it('参照でない型のフィールドからは何も取らない', () => {
        expect(refTargets({ type: 'string' }, 'a')).toEqual([]);
    });
});

describe('resolveRefs', () => {
    it('参照フィールドだけを、宣言した型とともに解決する', () => {
        const fields: Record<string, RefFieldSpec> = {
            screen: { type: 'entityRef', component: 'core:media' },
            targets: { type: 'entityRefArray' },
            title: { type: 'string' },
        };
        expect(resolveRefs(fields, { screen: 's', targets: ['a', 'b'], title: 'x' })).toEqual([
            { field: 'screen', entityIds: ['s'], component: 'core:media' },
            { field: 'targets', entityIds: ['a', 'b'] },
        ]);
    });

    it('未設定の参照は空の列で残す（どのフィールドがあるかは分かる）', () => {
        expect(resolveRefs({ screen: { type: 'entityRef' } }, {})).toEqual([{ field: 'screen', entityIds: [] }]);
    });

    it('dataFields が無ければ空', () => {
        expect(resolveRefs(undefined, { screen: 's' })).toEqual([]);
    });

    it('data のプロトタイプの値（toString など）を参照先として拾わない', () => {
        expect(resolveRefs({ toString: { type: 'entityRef' } }, {})).toEqual([{ field: 'toString', entityIds: [] }]);
    });
});

describe('崩れた宣言（manifest は読み込み時に検証しない）', () => {
    it('isRefField は null・プリミティブ・型の無いもので投げず false', () => {
        for (const spec of [null, undefined, 'entityRef', 42, [], {}, { type: 1 }]) {
            expect(isRefField(spec)).toBe(false);
        }
        expect(isRefField({ type: 'entityRef' })).toBe(true);
        expect(isRefField({ type: 'entityRefArray', component: 'vp:screen' })).toBe(true);
    });

    it('component が文字列でない参照は、型を問わない参照に化けさせず参照として扱わない', () => {
        expect(isRefField({ type: 'entityRef', component: 5 })).toBe(false);
        expect(resolveRefs({ screen: { type: 'entityRef', component: ['x'] } }, { screen: 'tv' })).toEqual([]);
    });

    it('null の宣言が混ざっても、解決・検査・競合の判定が落ちない', () => {
        const fields = { broken: null, screen: { type: 'entityRef', required: true } };
        expect(resolveRefs(fields, { screen: 'tv' })).toEqual([{ field: 'screen', entityIds: ['tv'] }]);
        const world = [entity('a', [{ type: 'm:c', data: {} }])];
        expect(findReferenceProblems(world, () => fields).map((p) => p.kind)).toEqual(['missing']);
        expect(() => findMediaConflicts([{ key: 'a', entityId: 'a', type: 'm:c' }], () => fields)).not.toThrow();
    });

    it('dataFields そのものが配列・文字列でも落ちない', () => {
        expect(resolveRefs(['entityRef'] as never, {})).toEqual([]);
        expect(resolveRefs('entityRef' as never, {})).toEqual([]);
    });

    it('fieldLabel は文字列の label だけを使う', () => {
        expect(fieldLabel({ screen: { type: 'entityRef', label: 'スクリーン' } }, 'screen')).toBe('スクリーン');
        expect(fieldLabel({ screen: { type: 'entityRef', label: 3 } }, 'screen')).toBe('screen');
        expect(fieldLabel({ screen: null }, 'screen')).toBe('screen');
        expect(fieldLabel(undefined, 'screen')).toBe('screen');
    });
});

describe('findReferenceProblems', () => {
    const fields: Record<string, Record<string, RefFieldSpec>> = {
        'vp:controls': {
            screen: { type: 'entityRef', component: 'vp:screen', required: true },
            playlist: { type: 'entityRef', component: 'vp:playlist' },
        },
        'vp:search': { playlists: { type: 'entityRefArray', component: 'vp:playlist', required: true } },
    };
    const fieldsOf = (type: string) => fields[type];

    it('正しく配線されたワールドには問題が無い（階層の形は問わない）', () => {
        const world = [
            entity('controls', [{ type: 'vp:controls', data: { screen: 'screen', playlist: 'nested' } }]),
            entity('elsewhere', [], [entity('screen', [{ type: 'vp:screen' }])]),
            entity(
                'box',
                [{ type: 'vp:search', data: { playlists: ['nested'] } }],
                [entity('nested', [{ type: 'vp:playlist' }])],
            ),
        ];
        expect(findReferenceProblems(world, fieldsOf)).toEqual([]);
    });

    it('同じ Entity を指してもよい（Unity のように 1 つの Entity に並べる組み方）', () => {
        const world = [
            entity('player', [
                { type: 'vp:controls', data: { screen: 'player', playlist: 'player' } },
                { type: 'vp:screen' },
                { type: 'vp:playlist' },
            ]),
        ];
        expect(findReferenceProblems(world, fieldsOf)).toEqual([]);
    });

    it('required の参照が空なら missing。任意の参照が空なのは問題にしない', () => {
        const world = [entity('controls', [{ type: 'vp:controls', data: {} }])];
        expect(findReferenceProblems(world, fieldsOf)).toEqual([
            {
                entityId: 'controls',
                componentType: 'vp:controls',
                componentIndex: 0,
                field: 'screen',
                kind: 'missing',
                component: 'vp:screen',
            },
        ]);
    });

    it('entityRefArray の required は空配列・中身がすべて無効な値でも missing', () => {
        const world = [entity('s', [{ type: 'vp:search', data: { playlists: ['', 3] } }])];
        expect(findReferenceProblems(world, fieldsOf).map((p) => p.kind)).toEqual(['missing']);
    });

    it('存在しない Entity・型の違う Entity を指したら、それぞれ報告する', () => {
        const world = [
            entity('controls', [{ type: 'vp:controls', data: { screen: 'ghost', playlist: 'controls' } }]),
            entity('s', [{ type: 'vp:search', data: { playlists: ['controls', 'ghost2'] } }]),
        ];
        expect(findReferenceProblems(world, fieldsOf).map((p) => [p.entityId, p.field, p.kind])).toEqual([
            ['controls', 'screen', 'not-found'],
            ['controls', 'playlist', 'wrong-type'],
            ['s', 'playlists', 'wrong-type'],
            ['s', 'playlists', 'not-found'],
        ]);
    });

    it('同じ Entity に同じ型が 2 つあれば componentIndex で区別する', () => {
        const world = [entity('c', [{ type: 'vp:controls', data: { screen: 'c' } }, { type: 'vp:controls' }])];
        const problems = findReferenceProblems(world, fieldsOf);
        expect(problems.map((p) => [p.componentIndex, p.kind])).toEqual([
            [0, 'wrong-type'],
            [1, 'missing'],
        ]);
    });

    it('fieldsOf が知らない型（mod が未取得）は検査しない', () => {
        const world = [entity('x', [{ type: 'unknown:thing', data: { screen: 'ghost' } }])];
        expect(findReferenceProblems(world, fieldsOf)).toEqual([]);
    });

    it('component を宣言しない参照は、存在だけを確かめる', () => {
        const world = [entity('a', [{ type: 'm:any', data: { target: 'b', missing: 'nope' } }]), entity('b', [])];
        const anyFields = { target: { type: 'entityRef' }, missing: { type: 'entityRef' } };
        expect(findReferenceProblems(world, () => anyFields).map((p) => [p.field, p.kind])).toEqual([
            ['missing', 'not-found'],
        ]);
    });
});

describe('describeReferenceProblem', () => {
    const at = { entityId: 'controls', componentType: 'vp:controls', componentIndex: 0, field: 'screen' };

    it('必要な型を添えて未設定を説明する', () => {
        expect(describeReferenceProblem({ ...at, kind: 'missing', component: 'vp:screen' }, 'スクリーン')).toBe(
            'controls の vp:controls の「スクリーン」が未設定です。vp:screen を持つ Entity を指定してください',
        );
    });

    it('ラベルが無ければフィールド名を使う', () => {
        expect(describeReferenceProblem({ ...at, kind: 'not-found', target: 'ghost' })).toBe(
            'controls の vp:controls の「screen」が指している Entity「ghost」がありません',
        );
    });
});

describe('動画面の競合（1 つの面に出力は 1 つ）', () => {
    const fields: Record<string, Record<string, RefFieldSpec>> = {
        'vp:controls': { screen: { type: 'entityRef', component: 'core:media' } },
        'm:dual': {
            main: { type: 'entityRef', component: 'core:media' },
            sub: { type: 'entityRef', component: 'core:media' },
        },
        'm:remote': { target: { type: 'entityRef' } },
    };
    const fieldsOf = (type: string) => fields[type];
    const record = (key: string, entityId: string, type: string, data?: Record<string, unknown>) => ({
        key,
        entityId,
        type,
        data,
    });

    it('同じ mod の Component でも、インスタンスが 2 つあれば競合する', () => {
        const conflicts = findMediaConflicts(
            [
                record('tv::0', 'tv', 'core:media'),
                record('a::0', 'a', 'vp:controls', { screen: 'tv' }),
                record('b::0', 'b', 'vp:controls', { screen: 'tv' }),
            ],
            fieldsOf,
        );
        expect([...conflicts.sharedSurfaces.keys()]).toEqual(['tv']);
        expect(conflicts.sharedSurfaces.get('tv')?.map((o) => o.key)).toEqual(['a::0', 'b::0']);
        expect([...conflictedMediaSurfaces(conflicts)]).toEqual(['tv']);
    });

    it('1 つのインスタンスでも、2 つのフィールドが同じ面を指せば競合する（出力が 2 つ）', () => {
        const conflicts = findMediaConflicts(
            [record('tv::0', 'tv', 'core:media'), record('d::0', 'd', 'm:dual', { main: 'tv', sub: 'tv' })],
            fieldsOf,
        );
        expect(conflicts.sharedSurfaces.get('tv')?.map((o) => o.field)).toEqual(['main', 'sub']);
    });

    it('面ごとに 1 つなら競合しない。core:media を宣言しない参照は出力に数えない', () => {
        const conflicts = findMediaConflicts(
            [
                record('tv::0', 'tv', 'core:media'),
                record('tv2::0', 'tv2', 'core:media'),
                record('a::0', 'a', 'vp:controls', { screen: 'tv' }),
                record('b::0', 'b', 'vp:controls', { screen: 'tv2' }),
                record('r::0', 'r', 'm:remote', { target: 'tv' }),
            ],
            fieldsOf,
        );
        expect(conflictedMediaSurfaces(conflicts).size).toBe(0);
    });

    it('core:media を 2 つ持つ Entity は、出力が 1 つでも競合する（読み込みの順で決めない）', () => {
        const conflicts = findMediaConflicts(
            [
                record('tv::0', 'tv', 'core:media'),
                record('tv::1', 'tv', 'core:media'),
                record('a::0', 'a', 'vp:controls', { screen: 'tv' }),
            ],
            fieldsOf,
        );
        expect([...conflicts.duplicatedSurfaces]).toEqual(['tv']);
        expect([...conflictedMediaSurfaces(conflicts)]).toEqual(['tv']);
    });

    it('面でない Entity を指す出力は数えない（型の違う参照として別に報告する）', () => {
        const conflicts = findMediaConflicts(
            [
                record('x::0', 'x', 'm:remote'),
                record('a::0', 'a', 'vp:controls', { screen: 'x' }),
                record('b::0', 'b', 'vp:controls', { screen: 'x' }),
            ],
            fieldsOf,
        );
        expect(conflictedMediaSurfaces(conflicts).size).toBe(0);
    });

    it('競合していない面ごとに、描いてよい出力を 1 つ決める（競合した面・重複した面には無い）', () => {
        const conflicts = findMediaConflicts(
            [
                record('tv::0', 'tv', 'core:media'),
                record('tv2::0', 'tv2', 'core:media'),
                record('tv3::0', 'tv3', 'core:media'),
                record('tv3::1', 'tv3', 'core:media'),
                record('a::0', 'a', 'vp:controls', { screen: 'tv' }),
                record('b::0', 'b', 'vp:controls', { screen: 'tv2' }),
                record('c::0', 'c', 'vp:controls', { screen: 'tv2' }),
                record('d::0', 'd', 'vp:controls', { screen: 'tv3' }),
            ],
            fieldsOf,
        );
        expect([...conflicts.owners]).toEqual([
            ['tv', { key: 'a::0', entityId: 'a', componentType: 'vp:controls', field: 'screen' }],
        ]);
    });

    it('部屋の中で作られた Component（spawned）は、面を指しても競合にせず、面を奪えない', () => {
        // 改造したクライアントが entity:create で tv を指す controls を作っても、作者の配線した出力が描き続ける
        const conflicts = findMediaConflicts(
            [
                record('tv::0', 'tv', 'core:media'),
                record('a::0', 'a', 'vp:controls', { screen: 'tv' }),
                { ...record('evil', 'evil', 'vp:controls', { screen: 'tv' }), spawned: true },
                { ...record('evil2', 'evil2', 'm:dual', { main: 'tv', sub: 'tv' }), spawned: true },
            ],
            fieldsOf,
        );
        expect(conflictedMediaSurfaces(conflicts).size).toBe(0);
        expect(conflicts.owners.get('tv')?.key).toBe('a::0');
    });

    it('作者の出力が無い面を、spawned の出力が手に入れることもない', () => {
        const conflicts = findMediaConflicts(
            [
                record('tv::0', 'tv', 'core:media'),
                { ...record('evil', 'evil', 'vp:controls', { screen: 'tv' }), spawned: true },
            ],
            fieldsOf,
        );
        expect(conflicts.owners.size).toBe(0);
    });

    it('entityRefArray は core:media を指しても出力にならない（描かないので数えない）', () => {
        const arrayFields = { 'm:wall': { screens: { type: 'entityRefArray', component: 'core:media' } } };
        const conflicts = findMediaConflicts(
            [
                record('tv::0', 'tv', 'core:media'),
                record('a::0', 'a', 'vp:controls', { screen: 'tv' }),
                record('w::0', 'w', 'm:wall', { screens: ['tv'] }),
            ],
            (type) => fieldsOf(type) ?? arrayFields[type as 'm:wall'],
        );
        expect(conflictedMediaSurfaces(conflicts).size).toBe(0);
        expect(conflicts.owners.get('tv')?.key).toBe('a::0');
        expect(isMediaOutputField({ type: 'entityRefArray', component: 'core:media' })).toBe(false);
    });

    it('findReferenceProblems: 競合した出力それぞれと、core:media の重複を報告する', () => {
        const world = [
            entity('tv', [{ type: 'core:media' }]),
            entity('a', [{ type: 'vp:controls', data: { screen: 'tv' } }]),
            entity('b', [{ type: 'm:remote' }, { type: 'vp:controls', data: { screen: 'tv' } }]),
            entity('tv2', [{ type: 'core:media' }, { type: 'core:media' }]),
            entity('c', [{ type: 'vp:controls', data: { screen: 'tv2' } }]),
        ];
        const problems = findReferenceProblems(world, fieldsOf);
        expect(problems.map((p) => [p.entityId, p.componentIndex, p.kind])).toEqual([
            ['tv2', 1, 'media-duplicate'],
            ['a', 0, 'media-shared'],
            ['b', 1, 'media-shared'],
        ]);
        expect(describeReferenceProblem(problems[1] as ReferenceProblem, 'スクリーン')).toBe(
            'a の vp:controls の「スクリーン」が指している動画面「tv」には、ほかに 1 個の出力が向いているため、動画を描きません。動画面ごとに再生を担当する Component を 1 つに決め、ほかのパネルからは参照で指示を送ってください',
        );
        expect(describeReferenceProblem(problems[0] as ReferenceProblem)).toBe(
            'tv2 に core:media が 2 つ以上あるため、動画を描きません。1 つにしてください',
        );
    });
});

describe('frameMediaTargets', () => {
    it('動画面への出力のフィールドと同じ名前は、自分の枠に描かない（<video> を 2 つ作らない）', () => {
        const fields = {
            screen: { type: 'entityRef', component: 'core:media' },
            preview: { type: 'entityRef', component: 'vp:screen' },
        };
        expect(frameMediaTargets(['screen', 'preview', 'main'], fields)).toEqual(['preview', 'main']);
    });

    it('宣言が無い・壊れていれば、mediaTargets をそのまま使う', () => {
        expect(frameMediaTargets(['main'], undefined)).toEqual(['main']);
        expect(frameMediaTargets(['main'], { main: null })).toEqual(['main']);
        expect(frameMediaTargets(undefined, {})).toEqual([]);
    });
});

describe('remapRefs', () => {
    const fields = {
        screen: { type: 'entityRef' },
        panels: { type: 'entityRefArray' },
        title: { type: 'string' },
        broken: null,
    };

    it('参照フィールドの値だけを付け替える', () => {
        const renames = new Map([['tv', 'tv-2']]);
        expect(remapRefs(fields, { screen: 'tv', panels: ['tv', 'x', 3], title: 'tv', broken: 'tv' }, renames)).toEqual(
            {
                screen: 'tv-2',
                panels: ['tv-2', 'x', 3],
                title: 'tv',
                broken: 'tv',
            },
        );
    });

    it('変わるものが無ければ同じ data を返す', () => {
        const data = { screen: 'a', panels: ['b'] };
        expect(remapRefs(fields, data, new Map([['tv', 'x']]))).toBe(data);
    });

    it('付け替えは 1 回だけ（a→b, b→c で a が c にならない）', () => {
        const renames = new Map([
            ['a', 'b'],
            ['b', 'c'],
        ]);
        expect(remapRefs(fields, { screen: 'a', panels: ['a', 'b'] }, renames)).toEqual({
            screen: 'b',
            panels: ['b', 'c'],
        });
    });

    it('型の合わない値・プロトタイプの値は触らない', () => {
        const renames = new Map([['tv', 'x']]);
        expect(remapRefs(fields, { screen: ['tv'], panels: 'tv' }, renames)).toEqual({ screen: ['tv'], panels: 'tv' });
        expect(remapRefs({ toString: { type: 'entityRef' } }, {}, renames)).toEqual({});
    });
});
