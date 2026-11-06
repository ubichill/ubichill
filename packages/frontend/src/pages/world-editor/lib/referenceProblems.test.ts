import type { InitialEntity } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import type { AvailableEntityKind } from '../hooks/useAvailableEntityKinds';
import { editorReferenceProblems, problemsByEntity, refTargetError } from './referenceProblems';

const entity = (
    id: string,
    components: InitialEntity['components'],
    children: InitialEntity[] = [],
): InitialEntity => ({ id, transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 }, tags: [], components, children });

const kind = (type: string, dataFields: AvailableEntityKind['dataFields']): AvailableEntityKind => ({
    modName: type.split(':')[0],
    kind: type,
    suggestSize: false,
    dataFields,
    viewKind: 'jsx',
});

const kinds = [
    kind('vp:controls', {
        screen: { type: 'entityRef', component: 'vp:screen', required: true, label: 'スクリーン' },
    }),
    kind('vp:screen', {}),
];

describe('editorReferenceProblems', () => {
    it('フィールドのラベルを使って説明する', () => {
        const world = [entity('controls', [{ type: 'vp:controls', data: {} }])];
        expect(editorReferenceProblems(world, kinds).map((p) => p.message)).toEqual([
            'controls の vp:controls の「スクリーン」が未設定です。vp:screen を持つ Entity を指定してください',
        ]);
    });

    it('子の奥にある Entity への参照も解決する', () => {
        const world = [
            entity('controls', [{ type: 'vp:controls', data: { screen: 'deep' } }]),
            entity('a', [], [entity('b', [], [entity('deep', [{ type: 'vp:screen', data: {} }])])]),
        ];
        expect(editorReferenceProblems(world, kinds)).toEqual([]);
    });

    it('mod をまだ読み込んでいない（kinds に無い）型は問題にしない', () => {
        const world = [entity('controls', [{ type: 'vp:controls', data: {} }])];
        expect(editorReferenceProblems(world, [])).toEqual([]);
    });
});

describe('editorReferenceProblems: 崩れた manifest', () => {
    it('dataFields に null の宣言があっても落ちず、読める宣言だけで検査する', () => {
        const broken = kind('bad:mod', { ghost: null, screen: { type: 'entityRef', required: true } } as never);
        const world = [entity('a', [{ type: 'bad:mod', data: {} }])];
        expect(editorReferenceProblems(world, [broken]).map((p) => p.kind)).toEqual(['missing']);
    });
});

describe('problemsByEntity', () => {
    it('同じ Entity の問題をまとめる', () => {
        const map = problemsByEntity([
            { entityId: 'a', message: '1' },
            { entityId: 'b', message: '2' },
            { entityId: 'a', message: '3' },
        ]);
        expect([...map]).toEqual([
            ['a', ['1', '3']],
            ['b', ['2']],
        ]);
    });
});

describe('refTargetError', () => {
    const world = [entity('tv', [{ type: 'vp:screen', data: {} }], [entity('label', [])])];

    it('型が合えば問題なし、型を問わない参照は存在だけを見る', () => {
        expect(refTargetError(world, 'tv', 'vp:screen')).toBeNull();
        expect(refTargetError(world, 'label', undefined)).toBeNull();
    });

    it('型が違う・存在しない Entity は理由を返す', () => {
        expect(refTargetError(world, 'label', 'vp:screen')).toBe('「label」に vp:screen がありません');
        expect(refTargetError(world, 'ghost', undefined)).toBe('Entity「ghost」がありません');
    });
});
