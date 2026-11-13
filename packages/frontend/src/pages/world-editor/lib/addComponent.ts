import type { EntityComponentDef, InitialEntity } from '@ubichill/shared';
import type { AvailableEntityKind } from './entityKinds';
import { buildUniqueEntityId } from './entityTree';

/** 追加する Component の初期値（kind の既定 data と、各フィールドの default）。 */
function initialDataOf(kind: AvailableEntityKind | undefined): Record<string, unknown> {
    const base: Record<string, unknown> = kind?.defaultData ? structuredClone(kind.defaultData) : {};
    const defaults = Object.entries(kind?.dataFields ?? {})
        .filter(([, spec]) => spec.default !== undefined)
        .map(([name, spec]) => [name, spec.default] as const);
    return { ...base, ...Object.fromEntries(defaults) };
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
