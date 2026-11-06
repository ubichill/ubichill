/**
 * `world.yaml` が無いときのワールド。手元の mod の Component を 1 つずつ、中央に格子で置く。
 * 型を宣言した参照フィールドは、その型を置いた Entity に配線しておく（mod の開発者がすぐ動かせるように）。
 * 戻り値は YAML をパースしたのと同じ生の定義（`definitionToResolved` に渡す）。
 */
import type { FieldsOf } from './references.ts';

export interface SynthesizedMod {
    id: string;
    /** Component 型（`<id>:<name>`）。 */
    components: readonly string[];
}

const WORLD = { width: 2000, height: 1500 };
const CELL = 320;

const entityIdOf = (type: string): string => type.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

/** 型を宣言した参照フィールドを、その型の Entity に向ける。entityRef は 1 つ目、entityRefArray は全部。 */
function wiredData(type: string, types: readonly string[], fieldsOf: FieldsOf): Record<string, unknown> {
    const wired = Object.entries(fieldsOf(type) ?? {}).flatMap(([field, spec]): Array<[string, unknown]> => {
        const targets = spec.component ? types.filter((t) => t === spec.component).map(entityIdOf) : [];
        if (targets.length === 0) return [];
        if (spec.type === 'entityRef') return [[field, targets[0]]];
        if (spec.type === 'entityRefArray') return [[field, targets]];
        return [];
    });
    return Object.fromEntries(wired);
}

export function synthesizeWorld(
    mods: readonly SynthesizedMod[],
    fieldsOf: FieldsOf = () => undefined,
): Record<string, unknown> {
    const types = mods.flatMap((mod) => mod.components);
    const columns = Math.max(1, Math.ceil(Math.sqrt(types.length)));
    const rows = Math.max(1, Math.ceil(types.length / columns));
    const originX = WORLD.width / 2 - ((columns - 1) * CELL) / 2;
    const originY = WORLD.height / 2 - ((rows - 1) * CELL) / 2;
    return {
        apiVersion: 'ubichill.com/v1alpha1',
        kind: 'World',
        metadata: { name: 'dev', version: '0.0.0' },
        spec: {
            displayName: 'ubichill dev',
            capacity: { default: 10, max: 20 },
            environment: { backgroundColor: '#F0F8FF', worldSize: WORLD },
            dependencies: mods.map((mod) => ({ name: mod.id, source: { version: 'latest' } })),
            initialEntities: types.map((type, index) => {
                const data = wiredData(type, types, fieldsOf);
                return {
                    id: entityIdOf(type),
                    transform: {
                        x: originX + (index % columns) * CELL,
                        y: originY + Math.floor(index / columns) * CELL,
                    },
                    components: [Object.keys(data).length > 0 ? { type, data } : { type }],
                };
            }),
        },
    };
}
