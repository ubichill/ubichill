import type { WorldDefinition } from '@ubichill/shared';
import { useMemo } from 'react';
import { MOD_CDN_URL } from '@/lib/mods/modCdn';
import { usePackages } from '@/lib/mods/usePackages';
import { CORE_ENTITY_KINDS, entityKindsFromManifest } from '../lib/entityKinds';

export * from '../lib/entityKinds';

export function useAvailableEntityKinds(definition: WorldDefinition | null) {
    const result = usePackages(definition);
    const kinds = useMemo(
        () => [
            ...CORE_ENTITY_KINDS,
            ...result.packages.flatMap(({ entry, manifest }) =>
                entityKindsFromManifest(
                    entry.id,
                    manifest.components,
                    `${entry.baseUrl ?? MOD_CDN_URL}/${entry.id}/v${entry.version}`,
                ),
            ),
        ],
        [result.packages],
    );
    return { ...result, kinds };
}
