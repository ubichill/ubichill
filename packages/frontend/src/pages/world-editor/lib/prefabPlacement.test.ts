import { flattenGameObject, type InitialEntity, resolveOverlayMode } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { entityWithComponentAt } from './addComponent';
import { decodePrefabDrag, encodePrefabDrag } from './dnd';
import { drawnBox, enclosing } from './drawnBounds';
import { centerOf, contentBounds, placementFor } from './prefabPlacement';

const box = (id: string, x: number, y: number, w?: number, h?: number, children: InitialEntity[] = []) => ({
    id,
    transform: { x, y, z: 0, w, h, scale: 1, rotation: 0 },
    components: [],
    tags: [],
    children,
});

type Part = InitialEntity['components'][number];
const part = (patch: Partial<Part> = {}): Part => ({ type: 'demo:thing', data: {}, ...patch });
const withParts = (entity: InitialEntity, components: Part[]): InitialEntity => ({ ...entity, components });

/** 実行時（flattenGameObject）が描く範囲の真ん中。親を at に置いたとき */
const drawnCenterWhenPlaced = (entities: InitialEntity[], at: { x: number; y: number }) => {
    const root = { ...box('root', at.x, at.y), children: entities };
    const drawn = enclosing(
        flattenGameObject(root)
            .filter((c) => resolveOverlayMode(c.overlay) === null)
            .flatMap((c) => drawnBox(c.transform) ?? []),
    );
    return drawn && { x: drawn.x + drawn.width / 2, y: drawn.y + drawn.height / 2 };
};

describe('contentBounds', () => {
    it('子の位置は親からの相対で足し、大きさの無い Entity は数えない', () => {
        const entities = [box('canvas', 0, 0), box('tray', 10, 20, 266, 67, [box('pen', 9, 7, 55, 48)])];
        expect(contentBounds(entities)).toEqual({ x: 10, y: 20, width: 266, height: 67 });
    });

    it('子が親の外にはみ出していれば含める', () => {
        expect(contentBounds([box('tray', 10, 10, 20, 20, [box('pen', 100, 100, 10, 10)])])).toEqual({
            x: 10,
            y: 10,
            width: 110,
            height: 110,
        });
    });

    it('大きさのある Entity が 1 つも無ければ null', () => {
        expect(contentBounds([box('a', 5, 5), box('b', 0, 0)])).toBeNull();
    });

    it('Component にだけ大きさがあれば、その大きさで数える', () => {
        const sign = withParts(box('sign', 30, 10), [part({ transform: { w: 200, h: 80 } })]);
        expect(contentBounds([sign])).toEqual({ x: 30, y: 10, width: 200, height: 80 });
    });

    it('w と h を Entity と Component で分けて持っていても合わせて使う', () => {
        const sign = withParts(box('sign', 0, 0, undefined, 80), [part({ transform: { w: 200 } })]);
        expect(contentBounds([sign])).toEqual({ x: 0, y: 0, width: 200, height: 80 });
    });

    it('Component がある Entity は、Entity の大きさではなく Component が描く大きさで数える', () => {
        const framed = withParts(box('frame', 0, 0, 400, 300), [part({ transform: { w: 200, h: 80 } })]);
        expect(contentBounds([framed])).toEqual({ x: 0, y: 0, width: 200, height: 80 });
        const both = withParts(box('frame', 0, 0, 400, 300), [part(), part({ id: 'b', transform: { w: 500, h: 10 } })]);
        expect(contentBounds([both])).toEqual({ x: 0, y: 0, width: 500, height: 300 });
    });

    it('Transform の大きさの子と Component だけの大きさの子を合わせて囲む', () => {
        const entities = [
            box('a', 0, 0, 100, 50),
            withParts(box('b', 300, 100), [part({ transform: { w: 200, h: 80 } })]),
        ];
        expect(contentBounds(entities)).toEqual({ x: 0, y: 0, width: 500, height: 180 });
    });

    it('入れ子の位置は足し、親の拡大は子に掛けない（描く側も掛けない）', () => {
        const entities = [
            withParts(
                {
                    ...box('tray', 10, 20, undefined, undefined, [
                        withParts(box('pen', 100, -40), [part({ transform: { w: 20, h: 20 } })]),
                        box('cap', -30, 5, 10, 10),
                    ]),
                    transform: { x: 10, y: 20, z: 0, scale: 3, rotation: 0 },
                },
                [part({ transform: { w: 50, h: 50 } })],
            ),
        ];
        // tray: (10,20) 150×150 / pen: (110,-20) 20×20 / cap: (-20,25) 10×10
        expect(contentBounds(entities)).toEqual({ x: -20, y: -20, width: 180, height: 190 });
    });

    it('拡大は左上を軸に掛け、Component の拡大は Entity の拡大を置き換える（掛け合わせない）', () => {
        const scaled = {
            ...box('big', 0, 0, 100, 40),
            transform: { x: 0, y: 0, z: 0, w: 100, h: 40, scale: 2, rotation: 0 },
        };
        expect(contentBounds([scaled])).toEqual({ x: 0, y: 0, width: 200, height: 80 });
        expect(contentBounds([withParts(scaled, [part({ transform: { scale: 0.5 } })])])).toEqual({
            x: 0,
            y: 0,
            width: 50,
            height: 20,
        });
    });

    it('回転は左上を軸に回した外接矩形で数える', () => {
        const turned = withParts(box('sign', 0, 0), [part({ transform: { w: 200, h: 80, rotation: 90 } })]);
        const b = contentBounds([turned]);
        expect(b?.x).toBeCloseTo(-80);
        expect(b?.y).toBeCloseTo(0);
        expect(b?.width).toBeCloseTo(80);
        expect(b?.height).toBeCloseTo(200);
    });

    it('画面固定の Component と x・y を上書きした Component は、親を動かしても付いてこないので数えない', () => {
        const hud = withParts(box('hud', 0, 0), [part({ overlay: 'bottom-left', transform: { w: 300, h: 300 } })]);
        const pinned = withParts(box('pinned', 0, 0), [part({ transform: { x: 900, w: 50, h: 50 } })]);
        const sign = withParts(box('sign', 10, 10), [part({ transform: { w: 20, h: 20 } })]);
        expect(contentBounds([hud, pinned, sign])).toEqual({ x: 10, y: 10, width: 20, height: 20 });
        expect(contentBounds([hud, pinned])).toBeNull();
    });

    it('大きさを中身に任せた Component（w・h の無い mod）しか無ければ null', () => {
        expect(contentBounds([withParts(box('a', 0, 0), [part()]), box('b', 0, 0, 100)])).toBeNull();
    });
});

describe('置いた後に描かれる中身の真ん中', () => {
    const drop = { x: 700, y: 500 };
    const cases: [string, InitialEntity[]][] = [
        [
            'Component にだけ 200×80 の大きさがある',
            [withParts(box('sign', 0, 0), [part({ transform: { w: 200, h: 80 } })])],
        ],
        [
            'Transform の大きさと Component だけの大きさが混ざる',
            [box('a', -40, 0, 100, 50), withParts(box('b', 300, 100), [part({ transform: { w: 200, h: 80 } })])],
        ],
        [
            '入れ子で位置がずれ、拡大した Entity がある',
            [
                {
                    ...box('tray', 5, 5, 60, 30, [
                        withParts(box('pen', 70, 40), [part({ transform: { w: 30, h: 10, scale: 2 } })]),
                    ]),
                    transform: { x: 5, y: 5, z: 0, w: 60, h: 30, scale: 1.5, rotation: 0 },
                },
            ],
        ],
    ];

    it.each(cases)('%s: 落とした場所に来る', (_, entities) => {
        const at = placementFor(drop, contentBounds(entities));
        const center = drawnCenterWhenPlaced(entities, at);
        // 置く位置は整数 px に丸めるので 0.5px まではずれる
        expect(Math.abs((center?.x ?? Number.NaN) - drop.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs((center?.y ?? Number.NaN) - drop.y)).toBeLessThanOrEqual(0.5);
    });

    it('大きさがどこにも無ければ、親を落とした場所に置く', () => {
        const entities = [withParts(box('marker', 30, 30), [part()])];
        expect(placementFor(drop, contentBounds(entities))).toEqual(drop);
    });
});

describe('centerOf', () => {
    it('親の位置に関係なく、親の原点から見た描かれる範囲の真ん中', () => {
        const sign = withParts(box('sign', 999, 999), [part({ transform: { w: 200, h: 80 } })]);
        expect(centerOf(sign)).toEqual({ x: 100, y: 40 });
    });

    it('拡大した親は、拡大後の真ん中', () => {
        const big = { ...box('big', 0, 0), transform: { x: 0, y: 0, z: 0, w: 100, h: 40, scale: 2, rotation: 0 } };
        expect(centerOf(big)).toEqual({ x: 100, y: 40 });
    });

    it('親に大きさが無ければ親の原点（子の大きさは見ない）', () => {
        expect(centerOf(box('group', 50, 50, undefined, undefined, [box('child', 0, 0, 100, 100)]))).toEqual({
            x: 0,
            y: 0,
        });
    });
});

describe('placementFor', () => {
    const bounds = { x: 10, y: 20, width: 200, height: 100 };

    it('中身の真ん中が置いた場所に来る', () => {
        // 中身の真ん中 = 親 + (10 + 100, 20 + 50)
        expect(placementFor({ x: 500, y: 400 }, bounds)).toEqual({ x: 390, y: 330 });
    });

    it('ワールドの端に落としても、中身がはみ出さない位置に寄せる', () => {
        const world = { width: 1000, height: 800 };
        expect(placementFor({ x: 0, y: 0 }, bounds, world)).toEqual({ x: -10, y: -20 });
        expect(placementFor({ x: 1000, y: 800 }, bounds, world)).toEqual({ x: 790, y: 680 });
    });

    it('中身がワールドより大きければ、左上をワールドの端にそろえる', () => {
        expect(
            placementFor({ x: 50, y: 50 }, { x: 0, y: 0, width: 3000, height: 50 }, { width: 1000, height: 800 }),
        ).toEqual({ x: 0, y: 25 });
    });

    it('中身に大きさが無ければ、親をその場所に置く（半端な px にしない）', () => {
        expect(placementFor({ x: 10.6, y: 20.2 }, null)).toEqual({ x: 11, y: 20 });
    });
});

describe('entityWithComponentAt', () => {
    const kind = {
        kind: 'core:image',
        modName: 'core',
        displayName: '画像',
        defaultTransform: { w: 320, h: 180 },
        suggestSize: true,
        viewKind: 'logic' as const,
    };

    it('部品の大きさで真ん中を落とした場所に置き、部品の名前を表示名にする', () => {
        const created = entityWithComponentAt('core:image', kind, { x: 400, y: 300 }, [box('image', 0, 0)]);
        expect(created.id).toBe('image-2');
        expect(created.name).toBe('画像');
        expect(created.transform).toMatchObject({ x: 240, y: 210, w: 320, h: 180 });
        expect(created.components.map((c) => c.type)).toEqual(['core:image']);
    });

    it('知らない部品（mod の取得前）でも既定の大きさで作る', () => {
        const created = entityWithComponentAt('demo:thing', undefined, { x: 0, y: 0 }, [], { width: 500, height: 500 });
        expect(created.name).toBeUndefined();
        expect(created.transform).toMatchObject({ x: 0, y: 0, w: 200, h: 150 });
    });
});

describe('prefab drag', () => {
    it('運んだ値を読み戻せる', () => {
        expect(decodePrefabDrag(encodePrefabDrag({ modId: 'pen', name: 'pen-set' }))).toEqual({
            modId: 'pen',
            name: 'pen-set',
        });
    });

    it('ほかのページから落とされた文字列は読まない', () => {
        expect(decodePrefabDrag('')).toBeNull();
        expect(decodePrefabDrag('https://example.com/a/b')).toBeNull();
        expect(decodePrefabDrag('pen/pen-set/extra')).toBeNull();
        expect(decodePrefabDrag('Pen/Set')).toBeNull();
    });
});
