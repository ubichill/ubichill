import {
    CORE_COMPONENT_TYPES,
    type PartLook,
    PortalDataSchema,
    readCoreData,
    SwitchDataSchema,
    WarpDataSchema,
} from '@ubichill/core-components';
import type { ComponentInstance } from '@ubichill/shared';

type Part = Pick<ComponentInstance, 'type' | 'data'>;

/** 押せる部品（ポータル・ワープ・スイッチ）の見た目。押せる部品でない・data が読めないときは null。 */
export function partLook(part: Part): PartLook | null {
    const data = part.data ?? {};
    switch (part.type) {
        case CORE_COMPONENT_TYPES.warp:
            return readCoreData(WarpDataSchema, data).data?.look ?? null;
        case CORE_COMPONENT_TYPES.switch:
            return readCoreData(SwitchDataSchema, data).data?.look ?? null;
        case CORE_COMPONENT_TYPES.portal:
            return readCoreData(PortalDataSchema, data).data?.look ?? null;
        default:
            return null;
    }
}

/** 見た目を持たず、Entity の矩形を押せる場所にする部品か。 */
export function isHitArea(part: Part): boolean {
    return partLook(part) === 'none';
}

/**
 * 描く順（Component の ID）。同じ z では後に描いたものが上になるので、押せる場所（見た目なしの部品）を、
 * 同じ Entity のほかの部品の後ろに回す。Component の並びによらず、画像・文字の上で押せてフォーカスの枠も見える。
 * 押せる場所は後ろへ動かすだけ（前へ動かして、ほかの Entity の下に潜らせない）。
 */
export function stackingOrder(
    parts: ReadonlyMap<string, Pick<ComponentInstance, 'type' | 'data' | 'entityId'>>,
): string[] {
    const entries = [...parts].map(([id, part], index) => ({
        id,
        index,
        entityId: part.entityId,
        hit: isHitArea(part),
    }));
    // Entity ごとの、押せる場所でない部品のうち最後に描くものの位置
    const lastDrawn = new Map(
        entries.flatMap(({ entityId, hit, index }) => (!hit && entityId ? [[entityId, index] as const] : [])),
    );
    return entries
        .map((entry) => ({
            ...entry,
            at:
                entry.hit && entry.entityId
                    ? Math.max(entry.index, lastDrawn.get(entry.entityId) ?? entry.index)
                    : entry.index,
        }))
        .sort((a, b) => a.at - b.at || Number(a.hit) - Number(b.hit) || a.index - b.index)
        .map(({ id }) => id);
}
