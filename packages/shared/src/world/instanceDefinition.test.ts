import { describe, expect, it } from 'vitest';
import { EMPTY_ENTITY_TYPE } from '../mod/entities';
import type { InitialEntity, ResolvedWorld } from '../schemas/world.schema';
import { flattenGameObject, toInstanceDefinition } from './instanceDefinition';

function makeEntity(overrides: Partial<InitialEntity> = {}): InitialEntity {
    return {
        id: 'root',
        transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
        components: [],
        tags: [],
        children: [],
        ...overrides,
    };
}

describe('flattenGameObject', () => {
    it('1 component を 1 ComponentInstance に展開し、id を entityId と index から採番する', () => {
        const result = flattenGameObject(
            makeEntity({
                components: [{ type: 'pen:pen', data: { color: '#000' } }],
            }),
        );
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('root::0');
        expect(result[0].type).toBe('pen:pen');
        expect(result[0].entityId).toBe('root');
        expect(result[0].parentEntityId).toBeUndefined();
        expect(result[0].data).toEqual({ color: '#000' });
    });

    it('component.id (永続id) があればそれを flat id に使う（index フォールバックしない）', () => {
        const result = flattenGameObject(
            makeEntity({
                components: [
                    { id: 'health', type: 'core:health', data: {} },
                    { type: 'core:tag', data: {} }, // id 省略 → index フォールバック
                ],
            }),
        );
        expect(result.map((e) => e.id)).toEqual(['root::health', 'root::1']);
    });

    it('component.id があると、他 component の並べ替え・追加をしても flat id が変わらない', () => {
        const before = flattenGameObject(
            makeEntity({
                components: [
                    { id: 'a', type: 'x:a', data: {} },
                    { id: 'b', type: 'x:b', data: {} },
                ],
            }),
        );
        // 先頭に新しい component を挿入（index ベースなら既存2件のindexがずれる）
        const after = flattenGameObject(
            makeEntity({
                components: [
                    { id: 'new', type: 'x:new', data: {} },
                    { id: 'a', type: 'x:a', data: {} },
                    { id: 'b', type: 'x:b', data: {} },
                ],
            }),
        );
        expect(before.find((e) => e.type === 'x:a')?.id).toBe(after.find((e) => e.type === 'x:a')?.id);
        expect(before.find((e) => e.type === 'x:b')?.id).toBe(after.find((e) => e.type === 'x:b')?.id);
    });

    it('複数 component を複数 ComponentInstance に展開する', () => {
        const result = flattenGameObject(
            makeEntity({
                components: [
                    { type: 'a:a', data: {} },
                    { type: 'b:b', data: {} },
                ],
            }),
        );
        expect(result.map((e) => e.id)).toEqual(['root::0', 'root::1']);
    });

    it('w/h 未指定は 0 を入れる（サイズ未指定 = 自然サイズ尊重）', () => {
        const result = flattenGameObject(makeEntity({ components: [{ type: 'a:a', data: {} }] }));
        expect(result[0].transform.w).toBe(0);
        expect(result[0].transform.h).toBe(0);
    });

    it('子 Entity の transform は親 origin を加算して絶対化し、parentEntityId を付与する', () => {
        const result = flattenGameObject(
            makeEntity({
                id: 'parent',
                transform: { x: 10, y: 20, z: 5, scale: 1, rotation: 0 },
                components: [{ type: 'p:p', data: {} }],
                children: [
                    makeEntity({
                        id: 'child',
                        transform: { x: 3, y: 4, z: 2, scale: 1, rotation: 0 },
                        components: [{ type: 'c:c', data: {} }],
                    }),
                ],
            }),
        );

        const child = result.find((e) => e.entityId === 'child');
        expect(child?.transform.x).toBe(13); // 10 + 3
        expect(child?.transform.y).toBe(24); // 20 + 4
        expect(child?.transform.z).toBe(7); // 5 + 2
        expect(child?.parentEntityId).toBe('parent');
    });

    it('component が無い Entity は EMPTY_ENTITY_TYPE の ComponentInstance を1件返す', () => {
        const result = flattenGameObject(makeEntity());
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe(EMPTY_ENTITY_TYPE);
        expect(result[0].id).toBe('root::0');
        expect(result[0].entityId).toBe('root');
    });

    it('component 固有の transform 上書きが無ければ Entity の transform をそのまま継承する', () => {
        const result = flattenGameObject(
            makeEntity({
                transform: { x: 10, y: 20, z: 5, w: 60, h: 240, scale: 1, rotation: 0 },
                components: [
                    { type: 'pen:tray', data: {} },
                    { type: 'pen:pen', data: {} },
                ],
            }),
        );
        expect(result[0].transform).toEqual(result[1].transform);
        expect(result[1].transform.w).toBe(60);
        expect(result[1].transform.h).toBe(240);
    });

    it('component 固有の transform 上書きがあれば全フィールドを上書きする（x/y も絶対値で上書き）', () => {
        const result = flattenGameObject(
            makeEntity({
                transform: { x: 10, y: 20, z: 5, w: 60, h: 240, scale: 1, rotation: 0 },
                components: [
                    { type: 'pen:tray', data: {} },
                    { type: 'pen:pen', data: {}, transform: { x: 2, y: 3, w: 36, h: 48 } },
                ],
            }),
        );
        const pen = result[1];
        expect(pen.transform.x).toBe(2); // 上書き（10 + 2 ではない）
        expect(pen.transform.y).toBe(3); // 上書き（20 + 3 ではない）
        expect(pen.transform.w).toBe(36);
        expect(pen.transform.h).toBe(48);
        // z/rotation/scale は上書き指定が無いので Entity 側を継承する
        expect(pen.transform.z).toBe(5);
        expect(pen.transform.rotation).toBe(0);
        expect(pen.transform.scale).toBe(1);
        // tray 側は上書きしていないので Entity の transform をそのまま持つ
        expect(result[0].transform.w).toBe(60);
        expect(result[0].transform.h).toBe(240);
    });

    // overlay は「画面固定HUDとして描画するか」を Host のレンダラへ伝える唯一の経路なので、
    // ここで落ちると mod 側からは原因が全く見えないまま HUD がワールド座標へ流れる。
    it('overlay（画面固定の基準の角）を ComponentInstance へ引き継ぐ', () => {
        const result = flattenGameObject(
            makeEntity({
                components: [
                    { type: 'mobile-controller:controller', data: {}, overlay: 'bottom-left' },
                    { type: 'pen:tray', data: {}, overlay: true },
                    { type: 'danmaku:wall', data: {} },
                ],
            }),
        );
        expect(result[0].overlay).toBe('bottom-left');
        expect(result[1].overlay).toBe(true);
        // 指定が無い Component に overlay を勝手に生やさない（ワールド座標のままであるべき）
        expect(result[2].overlay).toBeUndefined();
    });
});

describe('toInstanceDefinition', () => {
    const world = (overrides: Partial<ResolvedWorld> = {}) =>
        ({
            displayName: 'Home',
            initialEntities: [
                makeEntity({
                    id: 'tray',
                    transform: { x: 10, y: 20, z: 1, scale: 1, rotation: 0 },
                    components: [{ type: 'pen:tray', data: {} }],
                    children: [
                        makeEntity({
                            id: 'pen',
                            transform: { x: 1, y: 2, z: 0, scale: 1, rotation: 0 },
                            components: [{ type: 'pen:pen', data: { color: '#fff' } }],
                        }),
                    ],
                }),
                makeEntity({ id: 'marker' }),
            ],
            dependencies: [
                { name: 'pen', source: { type: 'url', version: 'latest' } },
                { name: 'danmaku', source: { type: 'url', version: '1.0.0' } },
            ],
            environment: { backgroundColor: '#123456', worldSize: { width: 100, height: 50 } },
            lock: { lockVersion: 1, mods: {} },
            source: { kind: 'local', url: 'https://h.example/api/v1/worlds/home' },
            ...overrides,
        }) as ResolvedWorld;

    it('backend が PUT していた JSON とキーの順番まで同じ定義を作る', () => {
        const w = world();
        const expected = JSON.stringify({
            id: 'inst-1',
            name: 'Home',
            maxUsers: 7,
            snapshot: {
                entities: w.initialEntities.flatMap((entity) => flattenGameObject(entity)),
                availableComponents: [],
                activeMods: ['pen', 'danmaku'],
                environment: w.environment,
                lock: w.lock,
                sourceKind: 'local',
            },
        });
        expect(JSON.stringify(toInstanceDefinition(w, { id: 'inst-1', maxUsers: 7 }))).toBe(expected);
    });

    it('入れ子の GameObject は絶対座標に展開され、Component の無い GameObject も 1 件になる', () => {
        const { snapshot } = toInstanceDefinition(world(), { id: 'i', maxUsers: 1 });
        expect(snapshot.entities.map((e) => e.id)).toEqual(['tray::0', 'pen::0', 'marker::0']);
        expect(snapshot.entities[1]?.transform).toMatchObject({ x: 11, y: 22, z: 1 });
        expect(snapshot.entities[1]?.parentEntityId).toBe('tray');
        expect(snapshot.entities[2]?.type).toBe(EMPTY_ENTITY_TYPE);
    });

    it('dependencies が無ければ activeMods は空で、lock が無ければ JSON に lock が現れない', () => {
        const def = toInstanceDefinition(world({ dependencies: undefined, lock: undefined }), { id: 'i', maxUsers: 1 });
        expect(def.snapshot.activeMods).toEqual([]);
        expect(JSON.parse(JSON.stringify(def)).snapshot).not.toHaveProperty('lock');
    });

    it('id と maxUsers は呼び出し側の値をそのまま使う（上限の検査は Go が行う）', () => {
        const def = toInstanceDefinition(world(), { id: 'dev-abc', maxUsers: 1000 });
        expect(def.id).toBe('dev-abc');
        expect(def.maxUsers).toBe(1000);
    });
});
