import type { InitialEntity } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    cloneEntitySubtree,
    findEntityPath,
    getEntityAt,
    type RefFieldsOf,
    remapEntityRefs,
    renameEntity,
    toRenamedEntityId,
} from './entityTree';

const entity = (
    id: string,
    components: InitialEntity['components'],
    children: InitialEntity[] = [],
): InitialEntity => ({ id, transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 }, tags: [], components, children });

const FIELDS: Record<string, Record<string, unknown>> = {
    'vp:controls': {
        screen: { type: 'entityRef', component: 'core:media' },
        panels: { type: 'entityRefArray' },
        title: { type: 'string' },
    },
};
const fieldsOf: RefFieldsOf = (type) => FIELDS[type];

/** 操作パネル（子の tv を参照）と、外の stage を参照する配線。 */
const player = entity(
    'player',
    [{ type: 'vp:controls', data: { screen: 'tv', panels: ['tv', 'stage', 7, 'player'], title: 'tv' } }],
    [entity('tv', [{ type: 'core:media', data: {} }])],
);

describe('cloneEntitySubtree: 参照の付け替え', () => {
    it('subtree の中を指す参照はコピーの新しい id へ、外を指す参照は元のまま', () => {
        const cloned = cloneEntitySubtree(player, ['player', 'tv', 'stage'], fieldsOf);
        expect(cloned.id).toBe('player-copy');
        expect(cloned.children[0]?.id).toBe('tv-copy');
        expect(cloned.components[0]?.data).toEqual({
            screen: 'tv-copy',
            panels: ['tv-copy', 'stage', 7, 'player-copy'],
            // 参照でないフィールドは、値が id と同じ文字列でも変えない
            title: 'tv',
        });
    });

    it('元の Entity の data は書き換えない', () => {
        cloneEntitySubtree(player, ['player', 'tv'], fieldsOf);
        expect(player.components[0]?.data.screen).toBe('tv');
    });

    it('採番が既存の -copy と衝突しても、付け替え先は実際に採番した id', () => {
        const cloned = cloneEntitySubtree(player, ['player', 'tv', 'tv-copy', 'player-copy'], fieldsOf);
        expect(cloned.children[0]?.id).toBe('tv-copy-2');
        expect(cloned.components[0]?.data.screen).toBe('tv-copy-2');
    });

    it('自分自身を指す参照もコピー自身を指す', () => {
        const self = entity('loop', [{ type: 'vp:controls', data: { screen: 'loop' } }]);
        expect(cloneEntitySubtree(self, ['loop'], fieldsOf).components[0]?.data.screen).toBe('loop-copy');
    });

    it('宣言を知らない型（mod の取得前）の data は触らない', () => {
        const unknown = entity('a', [{ type: 'other:mod', data: { screen: 'a' } }]);
        expect(cloneEntitySubtree(unknown, ['a'], fieldsOf).components[0]?.data).toEqual({ screen: 'a' });
    });
});

describe('cloneEntitySubtree: Component の項目を落とさない', () => {
    const hud = entity(
        'hud',
        [
            {
                id: 'score',
                type: 'other:score',
                data: { nested: { n: 1 } },
                overlay: 'bottom-left',
                transform: { x: 24, y: 24 },
            },
            { id: 'timer', type: 'other:timer', data: {}, overlay: false },
            { type: 'other:plain', data: {} },
        ],
        [entity('hud-child', [{ id: 'label', type: 'other:label', data: {}, overlay: true }])],
    );

    it('id と overlay が複製にも残る（画面固定の HUD がワールド座標に落ちない）', () => {
        const cloned = cloneEntitySubtree(hud, ['hud'], fieldsOf);
        expect(cloned.components.map((c) => c.id)).toEqual(['score', 'timer', undefined]);
        expect(cloned.components.map((c) => c.overlay)).toEqual(['bottom-left', false, undefined]);
        expect(cloned.children[0]?.components[0]).toMatchObject({ id: 'label', overlay: true });
    });

    it('overlay: false は「画面固定にしない」という指定なので落とさない', () => {
        expect(cloneEntitySubtree(hud, ['hud'], fieldsOf).components[1]).toHaveProperty('overlay', false);
    });

    it('data と transform は元と共有しない', () => {
        const cloned = cloneEntitySubtree(hud, ['hud'], fieldsOf);
        const [first] = cloned.components;
        expect(first?.data).toEqual({ nested: { n: 1 } });
        expect(first?.data.nested).not.toBe(hud.components[0]?.data.nested);
        expect(first?.transform).toEqual({ x: 24, y: 24 });
        expect(first?.transform).not.toBe(hud.components[0]?.transform);
    });

    it('Component の id は複製先の Entity の中で一意のまま', () => {
        const cloned = cloneEntitySubtree(hud, ['hud'], fieldsOf);
        const ids = cloned.components.flatMap((c) => (c.id ? [c.id] : []));
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('renameEntity', () => {
    const world = [
        player,
        entity(
            'stage',
            [{ type: 'vp:controls', data: { screen: 'tv', panels: ['player'] } }],
            [entity('deep', [{ type: 'vp:controls', data: { screen: 'tv' } }])],
        ),
    ];

    it('id を変え、ツリー中のどこからの参照も新しい id に付け替える', () => {
        const next = renameEntity(world, [0, 0], 'screen-1', fieldsOf);
        expect(getEntityAt(next, [0, 0])?.id).toBe('screen-1');
        expect(next[0]?.components[0]?.data).toMatchObject({
            screen: 'screen-1',
            panels: ['screen-1', 'stage', 7, 'player'],
        });
        expect(next[1]?.components[0]?.data.screen).toBe('screen-1');
        expect(getEntityAt(next, [1, 0])?.components[0]?.data.screen).toBe('screen-1');
    });

    it('参照でないフィールドの同じ文字列は変えない', () => {
        const next = renameEntity(world, [0, 0], 'screen-1', fieldsOf);
        expect(next[0]?.components[0]?.data.title).toBe('tv');
    });

    it('同じ id への改名・存在しない path は何も変えない', () => {
        expect(renameEntity(world, [0, 0], 'tv', fieldsOf)).toBe(world);
        expect(renameEntity(world, [9], 'x', fieldsOf)).toBe(world);
    });
});

describe('toRenamedEntityId: 改名の入力を保存できる id にそろえる', () => {
    const KEBAB = /^[a-z0-9-]{1,50}$/;

    it('大文字・空白・記号は kebab-case にそろえる', () => {
        expect(toRenamedEntityId('Player', [])).toBe('player');
        expect(toRenamedEntityId('  My Big_Tv!! ', [])).toBe('my-big-tv');
    });

    it('使える文字が無い入力（日本語だけ・記号だけ・空）は改名しない', () => {
        expect(toRenamedEntityId('プレイヤー', [])).toBeNull();
        expect(toRenamedEntityId('---', [])).toBeNull();
        expect(toRenamedEntityId('', [])).toBeNull();
    });

    it('日本語の混じった入力は使える部分だけ残す', () => {
        expect(toRenamedEntityId('tv テレビ 2', [])).toBe('tv-2');
    });

    it('重なれば末尾の数字を進める', () => {
        expect(toRenamedEntityId('hoge', ['hoge'])).toBe('hoge2');
        expect(toRenamedEntityId('hoge', ['hoge', 'hoge2'])).toBe('hoge3');
        expect(toRenamedEntityId('hoge2', ['hoge2'])).toBe('hoge3');
        expect(toRenamedEntityId('Hoge', ['hoge'])).toBe('hoge2');
    });

    it('長い入力も、重なって数字を足しても 50 文字を超えない', () => {
        const long = 'a'.repeat(80);
        const first = toRenamedEntityId(long, []);
        expect(first).toBe('a'.repeat(50));
        const next = toRenamedEntityId(long, [first ?? '']);
        expect(next).toMatch(KEBAB);
        expect(next).not.toBe(first);
    });

    it('末尾の長い数字列を進めても指数表記にならない', () => {
        const digits = `a${'9'.repeat(49)}`;
        const next = toRenamedEntityId(digits, [digits]);
        expect(next).toMatch(KEBAB);
        expect(next).not.toBe(digits);
    });

    it('同じ名前が大量にあっても一意な id を返す', () => {
        const taken = ['tv', ...Array.from({ length: 5000 }, (_, i) => `tv${i + 2}`)];
        expect(toRenamedEntityId('tv', taken)).toBe('tv5002');
    });
});

describe('remapEntityRefs', () => {
    it('変わる参照が無い Component は同じオブジェクトのまま', () => {
        const world = [entity('a', [{ type: 'vp:controls', data: { screen: 'tv' } }])];
        const next = remapEntityRefs(world, new Map([['ghost', 'x']]), fieldsOf);
        expect(next[0]?.components[0]).toBe(world[0]?.components[0]);
    });
});

describe('findEntityPath', () => {
    const tree = [entity('a', []), entity('b', [], [entity('c', []), entity('d', [], [entity('e', [])])])];

    it('子孫までたどって場所を返す', () => {
        expect(findEntityPath(tree, 'e')).toEqual([1, 1, 0]);
        expect(getEntityAt(tree, [1, 1, 0])?.id).toBe('e');
    });

    it('ルートはそのまま、無ければ null', () => {
        expect(findEntityPath(tree, 'a')).toEqual([0]);
        expect(findEntityPath(tree, 'zzz')).toBeNull();
        expect(findEntityPath([], 'a')).toBeNull();
    });

    it('同じ id が複数あれば先に見つかった方（前の兄弟の子孫を優先）', () => {
        const dup = [entity('p', [], [entity('x', [])]), entity('x', [])];
        expect(findEntityPath(dup, 'x')).toEqual([0, 0]);
    });
});
