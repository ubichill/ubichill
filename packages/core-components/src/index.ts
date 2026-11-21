import { ColliderDataSchema } from './collider/schema.js';
import { ImageDataSchema } from './image/schema.js';
import { MediaDataSchema } from './media/schema.js';
import { PortalDataSchema } from './portal/schema.js';
import { CORE_COMPONENT_TYPES, type CoreComponentType } from './public.js';
import { TextDataSchema } from './text/schema.js';
import { UiDataSchema } from './ui/schema.js';

export * from './collider/index.js';
export * from './image/index.js';
export * from './media/index.js';
export * from './portal/index.js';
export * from './public.js';
export * from './text/index.js';
export * from './ui/index.js';

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
        case CORE_COMPONENT_TYPES.media:
            return MediaDataSchema.safeParse(data);
        case CORE_COMPONENT_TYPES.ui:
            return UiDataSchema.safeParse(data);
        case CORE_COMPONENT_TYPES.image:
            return ImageDataSchema.safeParse(data);
        case CORE_COMPONENT_TYPES.text:
            return TextDataSchema.safeParse(data);
        case CORE_COMPONENT_TYPES.portal:
            return PortalDataSchema.safeParse(data);
    }
}
