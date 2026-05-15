/**
 * Legacy `initialEntities[]` (`kind` + `data`) → 新形式 (`id` + `components[]`) の
 * ベストエフォート マイグレーション。
 *
 * Stage 1 の破壊的スキーマ変更を、既存ワールド YAML / DB レコードに対して
 * 透過的に適用するための薄い純関数レイヤー。
 *
 * Stage 4 で旧形式サポートを削除する際は、このファイルごと削除すれば legacy 経路は消える。
 */

interface LegacyTransform {
    x: number;
    y: number;
    z?: number;
    w?: number;
    h?: number;
    scale?: number;
    rotation?: number;
}

interface LegacyEntity {
    kind: string;
    transform: LegacyTransform;
    data?: Record<string, unknown>;
}

interface NewComponent {
    type: string;
    data: Record<string, unknown>;
}

interface NewEntity {
    id: string;
    transform: LegacyTransform;
    components: NewComponent[];
    tags: string[];
    children: NewEntity[];
}

/**
 * `kind` 形式のエンティティかどうかを判定する。
 * 新形式は `id` + `components`、旧形式は `kind` を持つ。
 */
function isLegacyEntity(e: unknown): e is LegacyEntity {
    if (!e || typeof e !== 'object') return false;
    const obj = e as Record<string, unknown>;
    return typeof obj.kind === 'string' && !Array.isArray(obj.components);
}

/**
 * kebab-case 化されたエンティティ ID を、`kind` + 連番から生成する。
 * 例: `pen:tray` → `pen-tray`、同 kind の 2 個目は `pen-tray-2`
 */
function buildId(kind: string, used: Set<string>): string {
    const base = kind.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    let n = 2;
    while (used.has(`${base}-${n}`)) n += 1;
    const out = `${base}-${n}`;
    used.add(out);
    return out;
}

/**
 * 旧 `kind` 形式のエンティティ配列を新形式に変換する純関数。
 * 入力に新形式が混ざっていても順次素通しする。
 */
function migrateInitialEntities(entities: unknown[]): NewEntity[] {
    const used = new Set<string>();
    return entities.map((e) => {
        if (isLegacyEntity(e)) {
            const id = buildId(e.kind, used);
            return {
                id,
                transform: e.transform,
                components: [{ type: e.kind, data: e.data ?? {} }],
                tags: [],
                children: [],
            };
        }
        const obj = e as {
            id?: unknown;
            transform?: unknown;
            components?: unknown;
            tags?: unknown;
            children?: unknown;
        };
        const id = typeof obj.id === 'string' ? obj.id : buildId('entity', used);
        used.add(id);
        const tags = Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [];
        const children = Array.isArray(obj.children) ? migrateInitialEntities(obj.children) : [];
        return {
            id,
            transform: (obj.transform ?? { x: 0, y: 0 }) as LegacyTransform,
            components: Array.isArray(obj.components) ? (obj.components as NewComponent[]) : [],
            tags,
            children,
        };
    });
}

/**
 * パース済み YAML オブジェクトを Stage 1 の新形式に正規化する純関数。
 * 既に新形式の場合は何も変えずに返す。
 */
export function migrateLegacyWorldYaml(parsed: unknown): unknown {
    if (!parsed || typeof parsed !== 'object') return parsed;
    const root = parsed as Record<string, unknown>;
    const spec = root.spec;
    if (!spec || typeof spec !== 'object') return parsed;
    const specObj = spec as Record<string, unknown>;
    const entities = specObj.initialEntities;
    if (!Array.isArray(entities)) return parsed;

    const hasLegacy = entities.some(isLegacyEntity);
    if (!hasLegacy) return parsed;

    return {
        ...root,
        spec: {
            ...specObj,
            initialEntities: migrateInitialEntities(entities),
        },
    };
}
