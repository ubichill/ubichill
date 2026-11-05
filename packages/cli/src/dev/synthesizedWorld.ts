/**
 * `world.yaml` が無いときのワールド。手元の mod の Component を 1 つずつ、中央に格子で置く。
 * 戻り値は YAML をパースしたのと同じ生の定義（`definitionToResolved` に渡す）。
 */

export interface SynthesizedMod {
    id: string;
    /** Component 型（`<id>:<name>`）。 */
    components: readonly string[];
}

const WORLD = { width: 2000, height: 1500 };
const CELL = 320;

export function synthesizeWorld(mods: readonly SynthesizedMod[]): Record<string, unknown> {
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
            initialEntities: types.map((type, index) => ({
                id: type.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
                transform: {
                    x: originX + (index % columns) * CELL,
                    y: originY + Math.floor(index / columns) * CELL,
                },
                components: [{ type }],
            })),
        },
    };
}
