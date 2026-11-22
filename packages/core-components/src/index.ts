import { ColliderDataSchema } from './collider/schema.js';
import { ImageDataSchema } from './image/schema.js';
import { MediaDataSchema } from './media/schema.js';
import { PortalDataSchema } from './portal/schema.js';
import { CORE_COMPONENT_TYPES, type CoreComponentType } from './public.js';
import { readCoreData, unknownKeysOf } from './read.js';
import { SpawnDataSchema } from './spawn/schema.js';
import { SwitchDataSchema } from './switch/schema.js';
import { TextDataSchema } from './text/schema.js';
import { UiDataSchema } from './ui/schema.js';
import { WarpDataSchema } from './warp/schema.js';

export * from './collider/index.js';
export * from './image/index.js';
export * from './look.js';
export * from './media/index.js';
export * from './portal/index.js';
export * from './public.js';
export * from './read.js';
export * from './spawn/index.js';
export * from './switch/index.js';
export * from './text/index.js';
export * from './ui/index.js';
export * from './warp/index.js';

export function isCoreComponentType(type: string): type is CoreComponentType {
    return Object.values(CORE_COMPONENT_TYPES).includes(type as CoreComponentType);
}

/** `core:` は本体の予約 namespace。この版が知らない `core:*` も mod として読み込まない。 */
export function isCoreComponentNamespace(type: string): boolean {
    return type.startsWith('core:');
}

/** 部品の型ごとの data の schema（知らない項目は断る strict なもの）。 */
export function coreComponentSchema(type: CoreComponentType) {
    switch (type) {
        case CORE_COMPONENT_TYPES.collider:
            return ColliderDataSchema;
        case CORE_COMPONENT_TYPES.media:
            return MediaDataSchema;
        case CORE_COMPONENT_TYPES.ui:
            return UiDataSchema;
        case CORE_COMPONENT_TYPES.image:
            return ImageDataSchema;
        case CORE_COMPONENT_TYPES.text:
            return TextDataSchema;
        case CORE_COMPONENT_TYPES.portal:
            return PortalDataSchema;
        case CORE_COMPONENT_TYPES.spawn:
            return SpawnDataSchema;
        case CORE_COMPONENT_TYPES.warp:
            return WarpDataSchema;
        case CORE_COMPONENT_TYPES.switch:
            return SwitchDataSchema;
    }
}

/** 書く側の検証。知らない項目も断る。 */
export function validateCoreComponentData(type: CoreComponentType, data: unknown) {
    return coreComponentSchema(type).safeParse(data);
}

/** 読む側の検証。知らない項目は捨てて読む（{@link readCoreData}）。 */
export function readCoreComponentData(type: CoreComponentType, data: unknown) {
    return readCoreData(coreComponentSchema(type), data);
}

/** 書く側に知らせる、この版に無い項目。 */
export function unknownCoreComponentKeys(type: CoreComponentType, data: unknown): string[] {
    return unknownKeysOf(coreComponentSchema(type), data);
}
