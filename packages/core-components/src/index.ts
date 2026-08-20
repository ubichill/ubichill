import { ColliderDataSchema } from './collider/schema.js';
import { CORE_COMPONENT_TYPES, type CoreComponentType } from './public.js';

export * from './collider/index.js';
export * from './public.js';

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
