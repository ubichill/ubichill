import { describe, expect, it } from 'vitest';
import type { ColliderData } from '../collider/types.js';
import { type ColliderInstance, contactKey, detectContacts, diffContacts } from './contacts.js';

function box(
    id: string,
    x: number,
    y: number,
    overrides: Partial<ColliderData> & { entityId?: string } = {},
): ColliderInstance {
    const { entityId, ...data } = overrides;
    return {
        id,
        entityId,
        transform: { x, y, w: 10, h: 10 },
        data: {
            shape: 'rect',
            size: 'entity',
            offset: { x: 0, y: 0 },
            isTrigger: false,
            layer: 'default',
            mask: ['default'],
            ...data,
        } as ColliderData,
    };
}

/** 実装の区切り文字に依存しないよう、テスト側で組を文字列化する。 */
const keys = (contacts: readonly { a: string; b: string }[]): string[] => contacts.map((c) => `${c.a} ${c.b}`).sort();

describe('detectContacts', () => {
    it('重なっている 2 つを 1 組として返す', () => {
        expect(keys(detectContacts([box('a', 0, 0), box('b', 5, 5)]))).toEqual(['a b']);
    });

    it('離れていれば接触しない', () => {
        expect(detectContacts([box('a', 0, 0), box('b', 100, 100)])).toEqual([]);
    });

    // 「A と B」「B と A」が二重に出ると、mod 側で同じ衝突を 2 回処理してしまう。
    it('同じ組を順序違いで二重に返さない', () => {
        const contacts = detectContacts([box('b', 5, 5), box('a', 0, 0)]);
        expect(contacts).toHaveLength(1);
        expect(contacts[0]).toEqual({ a: 'a', b: 'b' });
    });

    it('自分自身とは接触しない', () => {
        expect(detectContacts([box('a', 0, 0)])).toEqual([]);
    });

    // 見た目用と当たり判定用の Collider を同じ GameObject に載せることがあるため。
    it('同じ GameObject 上の Collider 同士は接触扱いしない', () => {
        const contacts = detectContacts([box('a', 0, 0, { entityId: 'ship' }), box('b', 1, 1, { entityId: 'ship' })]);
        expect(contacts).toEqual([]);
    });

    it('GameObject が違えば重なりを検出する', () => {
        const contacts = detectContacts([box('a', 0, 0, { entityId: 'ship' }), box('b', 1, 1, { entityId: 'wall' })]);
        expect(keys(contacts)).toEqual(['a b']);
    });

    it('layer/mask が片方でも噛み合わなければ接触しない', () => {
        const bullet = box('bullet', 0, 0, { layer: 'bullet', mask: ['wall'] });
        const player = box('player', 1, 1, { layer: 'player', mask: ['wall'] });
        expect(detectContacts([bullet, player])).toEqual([]);
    });

    it('layer/mask が双方向に噛み合えば接触する', () => {
        const bullet = box('bullet', 0, 0, { layer: 'bullet', mask: ['wall'] });
        const wall = box('wall', 1, 1, { layer: 'wall', mask: ['bullet'] });
        expect(keys(detectContacts([bullet, wall]))).toEqual(['bullet wall']);
    });

    // isTrigger は「押し戻すか」の話で「触れたか」の話ではないので、検出結果からは除外しない。
    it('isTrigger でも接触として検出する（解釈は受け手に委ねる）', () => {
        const contacts = detectContacts([box('a', 0, 0, { isTrigger: true }), box('b', 5, 5)]);
        expect(keys(contacts)).toEqual(['a b']);
    });

    it('3 つ以上でも全ての組み合わせを返す', () => {
        expect(keys(detectContacts([box('a', 0, 0), box('b', 2, 2), box('c', 4, 4)]))).toEqual(['a b', 'a c', 'b c']);
    });

    it('円と矩形の混在も判定できる', () => {
        const circle: ColliderInstance = {
            id: 'circle',
            transform: { x: 12, y: 5 },
            data: {
                shape: 'circle',
                radius: 4,
                offset: { x: 0, y: 0 },
                isTrigger: false,
                layer: 'default',
                mask: ['default'],
            },
        };
        expect(keys(detectContacts([box('rect', 0, 0), circle]))).toEqual(['circle rect']);
    });
});

describe('contactKey', () => {
    it('順序を正規化した組から一意なキーを作る', () => {
        expect(contactKey({ a: 'a', b: 'b' })).toBe('a|b');
    });

    // id は kebab-case + `::` しか含まないので、区切りに使う文字が id 内に現れてはいけない。
    it('区切り文字が id と混ざらない', () => {
        const key = contactKey({ a: 'ship::0', b: 'wall::1' });
        expect(key.split('|')).toEqual(['ship::0', 'wall::1']);
    });
});

describe('diffContacts', () => {
    const ab = { a: 'a', b: 'b' };
    const cd = { a: 'c', b: 'd' };

    it('新しく現れた組は entered', () => {
        const e = diffContacts([], [ab]);
        expect(e.entered).toEqual([ab]);
        expect(e.stayed).toEqual([]);
        expect(e.exited).toEqual([]);
    });

    it('続いている組は stayed（entered を繰り返さない）', () => {
        const e = diffContacts([ab], [ab]);
        expect(e.entered).toEqual([]);
        expect(e.stayed).toEqual([ab]);
    });

    it('消えた組は exited', () => {
        const e = diffContacts([ab], []);
        expect(e.exited).toEqual([ab]);
        expect(e.stayed).toEqual([]);
    });

    it('同じフレームで入れ替わっても取り違えない', () => {
        const e = diffContacts([ab], [cd]);
        expect(e.entered).toEqual([cd]);
        expect(e.exited).toEqual([ab]);
        expect(e.stayed).toEqual([]);
    });

    it('順序が違っても同じ接触として扱う（正規化済みキーで比較）', () => {
        const e = diffContacts([{ a: 'a', b: 'b' }], [{ a: 'a', b: 'b' }]);
        expect(e.entered).toEqual([]);
        expect(e.stayed).toHaveLength(1);
    });
});
