import { type ColliderData, createDefaultColliderData } from '@ubichill/core-components';

function finiteNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 不完全なYAMLもフォームで修復できるよう、表示用の有効なColliderへ寄せる。 */
export function normalizeColliderForEditor(data: Record<string, unknown>): ColliderData {
    const fallback = createDefaultColliderData(data.shape === 'circle' ? 'circle' : 'rect');
    const rawOffset =
        typeof data.offset === 'object' && data.offset !== null ? (data.offset as Record<string, unknown>) : undefined;
    const common = {
        offset: {
            x: finiteNumber(rawOffset?.x, fallback.offset.x),
            y: finiteNumber(rawOffset?.y, fallback.offset.y),
        },
        isTrigger: typeof data.isTrigger === 'boolean' ? data.isTrigger : fallback.isTrigger,
        layer: typeof data.layer === 'string' ? data.layer : fallback.layer,
        mask:
            Array.isArray(data.mask) && data.mask.every((item) => typeof item === 'string') ? data.mask : fallback.mask,
    };

    if (data.shape === 'circle') {
        const circleFallback = createDefaultColliderData('circle');
        return {
            ...common,
            shape: 'circle',
            radius: finiteNumber(data.radius, circleFallback.radius),
        };
    }

    const rawSize = data.size;
    const size =
        rawSize === 'entity'
            ? 'entity'
            : typeof rawSize === 'object' && rawSize !== null
              ? {
                    w: finiteNumber((rawSize as Record<string, unknown>).w, 100),
                    h: finiteNumber((rawSize as Record<string, unknown>).h, 100),
                }
              : 'entity';
    return { ...common, shape: 'rect', size };
}
