import type { ComponentInstance, InitialEntity } from '@ubichill/shared';

/**
 * GameObject ツリーを 1 Component = 1 ComponentInstance に展開する純関数。
 * 子 Entity の transform.x/y は親基準の相対座標 → 親 origin を加算して絶対化する。
 * w/h は未指定 (undefined) なら 0 を入れて「サイズ未指定 = 自然サイズ尊重」を表す。
 */
export function flattenGameObject(
    gameObject: InitialEntity,
    parentOrigin: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    parentEntityId?: string,
): Array<Omit<ComponentInstance, 'id'> & { id: string }> {
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
    const own = (gameObject.components ?? []).map((c, i) => {
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
            id: `${gameObject.id}::${i}`,
            type: c.type,
            entityId: gameObject.id,
            parentEntityId,
            ownerId: null,
            lockedBy: null,
            transform: componentTransform,
            data: c.data ?? {},
        };
    });
    const fromChildren = (gameObject.children ?? []).flatMap((child) =>
        flattenGameObject(child, { x: absX, y: absY, z: absZ }, gameObject.id),
    );
    return [...own, ...fromChildren];
}
