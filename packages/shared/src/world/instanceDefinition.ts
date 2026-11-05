/**
 * ワールドから Go のインスタンスサーバーに渡す定義（`InstanceDefinition`）を作る純粋な変換。
 * backend（インスタンスの作成）・CLI（`ubichill world build`）・dev サーバーが同じ関数で作るので、
 * どこで動かしても Go が受け取る初期状態は同じになる。
 */
import {
    type AvailableComponent,
    type ComponentInstance,
    EMPTY_ENTITY_TYPE,
    type WorldEnvironmentData,
} from '../mod/entities';
import type { ModLock } from '../schemas/modLock.schema';
import type { InitialEntity, ResolvedWorld } from '../schemas/world.schema';

/**
 * ワールドスナップショットペイロード（flat ComponentInstance 単位）。
 *
 * GameObject に複数 Component が載っている場合、各 Component を 1 つの flat ComponentInstance に展開して配信する。
 */
export interface WorldSnapshotPayload {
    entities: ComponentInstance[];
    availableComponents: AvailableComponent[];
    /** アクティブなmodIDのリスト */
    activeMods: string[];
    environment: WorldEnvironmentData;
    /** ワールドに焼かれた mod 完全性ロック（あれば）。ロード時の hash 照合に使う。 */
    lock?: ModLock;
    /** ワールドの provenance kind（local/github/...）。表示用。 */
    sourceKind?: string;
}

/** Go の `PUT /realtime/v1/instances/{id}` と `--world` が受け取る定義（protocol/instance/openapi.json の InstanceDefinition）。 */
export interface InstanceDefinition {
    id: string;
    name: string;
    maxUsers: number;
    snapshot: WorldSnapshotPayload;
}

/**
 * GameObject ツリーを 1 Component = 1 ComponentInstance に展開する純関数。
 * 子 Entity の transform.x/y は親基準の相対座標 → 親 origin を加算して絶対化する。
 * w/h は未指定 (undefined) なら 0 を入れて「サイズ未指定 = 自然サイズ尊重」を表す。
 *
 * Component を1つも持たない GameObject（座標だけのマーカー等）も、
 * `EMPTY_ENTITY_TYPE` を type に持つ ComponentInstance を1件発行することで
 * `Ubi.entity.query`/`get`・entityRef から参照できるようにする。
 */
export function flattenGameObject(
    gameObject: InitialEntity,
    parentOrigin: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    parentEntityId?: string,
): ComponentInstance[] {
    const t = gameObject.transform;
    const absX = parentOrigin.x + t.x;
    const absY = parentOrigin.y + t.y;
    const absZ = parentOrigin.z + (t.z ?? 0);
    const transform: ComponentInstance['transform'] = {
        x: absX,
        y: absY,
        z: absZ,
        w: t.w ?? 0,
        h: t.h ?? 0,
        scale: t.scale ?? 1,
        rotation: t.rotation ?? 0,
    };
    const components = gameObject.components ?? [];
    const own: ComponentInstance[] =
        components.length === 0
            ? [
                  {
                      id: `${gameObject.id}::0`,
                      type: EMPTY_ENTITY_TYPE,
                      entityId: gameObject.id,
                      parentEntityId,
                      ownerId: null,
                      lockedBy: null,
                      transform,
                      data: {},
                  },
              ]
            : components.map((c, i) => {
                  const ct = c.transform;
                  const componentTransform: ComponentInstance['transform'] = ct
                      ? {
                            x: ct.x ?? transform.x,
                            y: ct.y ?? transform.y,
                            z: ct.z ?? transform.z,
                            w: ct.w ?? transform.w,
                            h: ct.h ?? transform.h,
                            scale: ct.scale ?? transform.scale,
                            rotation: ct.rotation ?? transform.rotation,
                        }
                      : transform;
                  return {
                      // 永続 id (c.id) があればそれを使い、並べ替え・挿入・削除をしても他
                      // Component の flat id が変わらないようにする。省略時 (旧データ) は
                      // 従来通り index フォールバックにする。
                      id: `${gameObject.id}::${c.id ?? i}`,
                      type: c.type,
                      entityId: gameObject.id,
                      parentEntityId,
                      ownerId: null,
                      lockedBy: null,
                      overlay: c.overlay,
                      transform: componentTransform,
                      data: c.data ?? {},
                  };
              });
    const fromChildren = (gameObject.children ?? []).flatMap((child) =>
        flattenGameObject(child, { x: absX, y: absY, z: absZ }, gameObject.id),
    );
    return [...own, ...fromChildren];
}

/** 定義を作るのに要るワールドの部分（ResolvedWorld から取る）。 */
export type InstanceWorld = Pick<
    ResolvedWorld,
    'displayName' | 'initialEntities' | 'dependencies' | 'environment' | 'lock' | 'source'
>;

/**
 * ワールドから Go に渡す定義を作る。`id`・`maxUsers` は呼び出し側が決める
 * （backend は DB のインスタンス、CLI は引数。上限の検査は Go が行う）。
 */
export function toInstanceDefinition(
    world: InstanceWorld,
    options: { id: string; maxUsers: number },
): InstanceDefinition {
    return {
        id: options.id,
        name: world.displayName,
        maxUsers: options.maxUsers,
        snapshot: {
            entities: world.initialEntities.flatMap((entity) => flattenGameObject(entity)),
            availableComponents: [],
            activeMods: world.dependencies?.map((dependency) => dependency.name) ?? [],
            environment: world.environment,
            lock: world.lock,
            sourceKind: world.source.kind,
        },
    };
}
