/**
 * ワールド定義（パース済みの YAML / DB の生の値）を検証して {@link ResolvedWorld} にする純粋な写像。
 * backend（配信された定義を解決する）と CLI（手元の world.yaml から Go の定義を作る）が同じ規則を使う。
 * 取得（fetch）・署名の照合はここには無い（backend の worldResolver / identity）。
 */
import { DEFAULTS } from '../mod/entities';
import type { ModLock } from '../schemas/modLock.schema';
import {
    collectModIds,
    type InitialEntity,
    type ResolvedWorld,
    type WorldDefinition,
    WorldDefinitionSchema,
    type WorldMod,
    type WorldSource,
} from '../schemas/world.schema';
import type { WorldIdentity } from '../schemas/worldIdentity.schema';

// ── 旧形式（`kind` + `data`）の initialEntities の移行 ───────────────────────────

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
    prefab?: unknown;
}

/** 新形式は `id` + `components`、旧形式は `kind` を持つ。 */
function isLegacyEntity(e: unknown): e is LegacyEntity {
    if (!e || typeof e !== 'object') return false;
    const obj = e as Record<string, unknown>;
    return typeof obj.kind === 'string' && !Array.isArray(obj.components);
}

/** `kind` + 連番から kebab-case の id を作る（`pen:tray` → `pen-tray`、2 個目は `pen-tray-2`）。 */
function buildId(kind: string, used: Set<string>): string {
    const base = kind.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const candidate = (n: number): string => (n === 1 ? base : `${base}-${n}`);
    const n = [...Array(used.size + 2).keys()].map((i) => i + 1).find((i) => !used.has(candidate(i))) ?? 1;
    used.add(candidate(n));
    return candidate(n);
}

/**
 * `used` はツリー全体で 1 つを共有する。子階層が独立した Set を持つと親/兄弟と id が衝突し、
 * flatten 時の ComponentInstance.id（`${entityId}::${i}`）がぶつかって state が誤適用される。
 */
function migrateInitialEntities(entities: unknown[], used: Set<string>): NewEntity[] {
    return entities.map((e) => {
        if (isLegacyEntity(e)) {
            return {
                id: buildId(e.kind, used),
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
            prefab?: unknown;
        };
        const id = typeof obj.id === 'string' ? obj.id : buildId('entity', used);
        used.add(id);
        return {
            id,
            ...(obj.prefab ? { prefab: obj.prefab } : {}),
            transform: (obj.transform ?? { x: 0, y: 0 }) as LegacyTransform,
            components: Array.isArray(obj.components) ? (obj.components as NewComponent[]) : [],
            tags: Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [],
            children: Array.isArray(obj.children) ? migrateInitialEntities(obj.children, used) : [],
        };
    });
}

/** パース済み YAML を今の形式に正規化する。既に新形式なら何も変えずに返す。 */
export function migrateLegacyWorldYaml(parsed: unknown): unknown {
    if (!parsed || typeof parsed !== 'object') return parsed;
    const root = parsed as Record<string, unknown>;
    const spec = root.spec;
    if (!spec || typeof spec !== 'object') return parsed;
    const specObj = spec as Record<string, unknown>;
    const entities = specObj.initialEntities;
    if (!Array.isArray(entities) || !entities.some(isLegacyEntity)) return parsed;
    return { ...root, spec: { ...specObj, initialEntities: migrateInitialEntities(entities, new Set()) } };
}

// ── 検証と写像 ─────────────────────────────────────────────────────────────────

/** unknown をパース・マイグレーション・検証して WorldDefinition にする（不正は throw）。 */
export function validateWorldDefinition(parsed: unknown, url: string): WorldDefinition {
    const result = WorldDefinitionSchema.safeParse(migrateLegacyWorldYaml(parsed));
    if (!result.success) {
        const issue = result.error.issues[0];
        throw new Error(`ワールド定義が無効です (${url}): ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`);
    }
    return result.data;
}

/** 保存した生の定義をスキーマに通す（既定値を補う）。読めなければ undefined。 */
export function parseStoredDefinition(raw: unknown): WorldDefinition | undefined {
    const result = WorldDefinitionSchema.safeParse(migrateLegacyWorldYaml(raw));
    return result.success ? result.data : undefined;
}

export interface ResolveExtra {
    authorId?: string;
    lock?: ModLock;
    identity?: WorldIdentity;
}

/**
 * 初期エンティティの component 型（modId:name）と dependencies から使用 mod を重複なく集める。
 * version は dependency 宣言（source.version）由来。component 由来のみだと version は不明。
 */
function collectMods(
    entities: InitialEntity[],
    dependencies?: Array<{ name: string; source?: { version?: string } }>,
): WorldMod[] {
    const versionByName = new Map((dependencies ?? []).map((d) => [d.name, d.source?.version] as const));
    const ids = new Set<string>([...collectModIds(entities), ...versionByName.keys()]);
    return [...ids].map((id) => ({ id, version: versionByName.get(id) }));
}

/**
 * 省略可能フィールドの既定値を埋めるだけの正規化。フィールドを列挙して組み直すと
 * スキーマに増えた項目（overlay 等）を黙って捨ててしまうため、必ずスプレッドで引き継ぐ。
 */
const normalizeEntity = (e: InitialEntity): InitialEntity => ({
    ...e,
    components: e.components.map((c) => ({ ...c, data: c.data ?? {} })),
    tags: e.tags ?? [],
    children: (e.children ?? []).map(normalizeEntity),
});

/** 検証済み WorldDefinition を ResolvedWorld に写像する。 */
export function mapToResolved(
    def: WorldDefinition,
    url: string,
    source: WorldSource,
    extra?: ResolveExtra,
): ResolvedWorld {
    const env = def.spec.environment ?? DEFAULTS.WORLD_ENVIRONMENT;
    const initialEntities = def.spec.initialEntities.map(normalizeEntity);
    return {
        url,
        source,
        id: def.metadata.name,
        authorId: extra?.authorId,
        authorName: def.metadata.author?.name,
        version: def.metadata.version,
        displayName: def.spec.displayName,
        description: def.spec.description,
        thumbnail: def.spec.thumbnail,
        environment: {
            backgroundColor: env.backgroundColor ?? DEFAULTS.WORLD_ENVIRONMENT.backgroundColor,
            worldSize: env.worldSize ?? DEFAULTS.WORLD_ENVIRONMENT.worldSize,
        },
        capacity: def.spec.capacity,
        dependencies: def.spec.dependencies?.map((d) => ({ name: d.name, source: d.source })),
        initialEntities,
        mods: collectMods(initialEntities, def.spec.dependencies),
        // 別配信の lock（兄弟ファイル / DB カラム）を優先し、無ければ埋め込みフォールバック。
        lock: extra?.lock ?? def.spec.lock,
        identity: extra?.identity,
        ...(def.spec.requires ? { requires: def.spec.requires } : {}),
    };
}

/** 生の定義を検証して ResolvedWorld にする（不正は throw）。 */
export function definitionToResolved(
    parsed: unknown,
    url: string,
    source: WorldSource,
    extra?: ResolveExtra,
): ResolvedWorld {
    return mapToResolved(validateWorldDefinition(parsed, url), url, source, extra);
}
