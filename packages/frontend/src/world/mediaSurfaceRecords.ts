import type { ComponentInstance, RefComponentRecord } from '@ubichill/shared';

/**
 * 部屋の Component を競合の判定に渡す形にする。ownerId があるのは部屋の中で参加者が作った Component
 * （ワールド定義の Component は ownerId が null で、Go は ownerId を書き換えさせない）。
 */
export function mediaRecordOf(e: ComponentInstance): RefComponentRecord {
    return {
        key: e.id,
        entityId: e.entityId ?? e.id,
        type: e.type,
        data: e.data as Record<string, unknown> | undefined,
        spawned: e.ownerId !== null,
    };
}
