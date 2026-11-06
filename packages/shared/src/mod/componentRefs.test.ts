import { describe, expect, it } from 'vitest';
import {
    describeReferenceProblem,
    findReferenceProblems,
    type RefCheckEntity,
    type RefFieldSpec,
    refTargets,
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
