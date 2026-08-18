import { ColliderDataSchema } from './collider/schema';

export * from './collider';

/** Hostが信頼して同梱する予約済みComponent型。外部modとしては解決しない。 */
export const CORE_COMPONENT_TYPES = {
    collider: 'core:collider',
} as const;

export type CoreComponentType = (typeof CORE_COMPONENT_TYPES)[keyof typeof CORE_COMPONENT_TYPES];

export function isCoreComponentType(type: string): type is CoreComponentType {
    return Object.values(CORE_COMPONENT_TYPES).includes(type as CoreComponentType);
}

/** `core:` は本体の予約namespace。未知のcore componentをワールドへ混入させない。 */
export function isCoreComponentNamespace(type: string): boolean {
    return type.startsWith('core:');
}

/** Core Component dataを型ごとの厳格なschemaで検証する。 */
export function validateCoreComponentData(type: CoreComponentType, data: unknown) {
    switch (type) {
        case CORE_COMPONENT_TYPES.collider:
            return ColliderDataSchema.safeParse(data);
    }
}
