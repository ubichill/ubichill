import { type EntityComponentDef, type InitialEntity, LIMITS } from '@ubichill/shared';
import { DEFAULT_H, DEFAULT_W } from './dragHelpers';
import type { AvailableEntityKind } from './entityKinds';
import { buildUniqueEntityId, collectEntityIds, nextRootZ } from './entityTree';
import { placementFor } from './prefabPlacement';

/** 追加する Component の初期値（各フィールドの default に、kind の既定 data を重ねる）。 */
function initialDataOf(kind: AvailableEntityKind | undefined): Record<string, unknown> {
    const base: Record<string, unknown> = kind?.defaultData ? structuredClone(kind.defaultData) : {};
    const defaults = Object.entries(kind?.dataFields ?? {})
        .filter(([, spec]) => spec.default !== undefined)
        .map(([name, spec]) => [name, spec.default] as const);
    return { ...Object.fromEntries(defaults), ...base };
}

/**
 * Entity に Component を足す。Component には transform を付けず Entity の transform を継ぐ
 * （個別の transform は座標が絶対値になり、置いた場所とずれるので作者が明示したときだけ）。
 * mod が決めた大きさ（defaultTransform の w・h）は、まだ Component の無い Entity にだけ使う。
 */
export function withComponentAdded(
    entity: InitialEntity,
    componentType: string,
    kind: AvailableEntityKind | undefined,
): InitialEntity {
    const idSeed = componentType.split(':').pop() || componentType;
    const takenIds = entity.components.map((c) => c.id).filter((id): id is string => !!id);
    const component: EntityComponentDef = {
        id: buildUniqueEntityId(idSeed, takenIds),
        type: componentType,
        data: initialDataOf(kind),
        // mod の manifest (config.overlay) は追加時点の既定値。以降は Inspector で Entity ごとに上書きできる。
        ...(kind?.overlay ? { overlay: kind.overlay } : {}),
    };
    const preset = entity.components.length === 0 ? kind?.defaultTransform : undefined;
    // 置いた場所は動かさず、大きさだけを使う
    const size = {
        ...(preset?.w !== undefined ? { w: preset.w } : {}),
        ...(preset?.h !== undefined ? { h: preset.h } : {}),
    };
    return {
        ...entity,
        ...(Object.keys(size).length > 0 ? { transform: { ...entity.transform, ...size } } : {}),
        components: [...entity.components, component],
    };
}

/**
 * 部品を 1 つ持つ新しい Entity を、真ん中が point（ワールド座標）に来るように作る（ワールドの空いたところに部品を落としたとき）。
 * id は部品の種類から、表示名は部品の表示名から付ける。
 */
export function entityWithComponentAt(
    componentType: string,
    kind: AvailableEntityKind | undefined,
    point: { x: number; y: number },
    existing: InitialEntity[],
    worldSize?: { width: number; height: number },
): InitialEntity {
    const seed = componentType.split(':').pop() || 'entity';
    const empty: InitialEntity = {
        id: buildUniqueEntityId(seed, collectEntityIds(existing)),
        ...(kind?.displayName ? { name: kind.displayName.slice(0, LIMITS.MAX_ENTITY_NAME_LENGTH) } : {}),
        transform: { x: 0, y: 0, z: nextRootZ(existing), w: DEFAULT_W, h: DEFAULT_H, scale: 1, rotation: 0 },
        components: [],
        tags: [],
        children: [],
    };
    const added = withComponentAdded(empty, componentType, kind);
    const size = { x: 0, y: 0, width: added.transform.w ?? DEFAULT_W, height: added.transform.h ?? DEFAULT_H };
    return { ...added, transform: { ...added.transform, ...placementFor(point, size, worldSize) } };
}
