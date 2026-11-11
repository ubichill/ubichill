import { isCoreComponentType } from '@ubichill/core-components';
import { z } from 'zod';
import type { ComponentDataFieldSpec } from '../schemas/mod.schema';
import type { ModLockEntry } from '../schemas/modLock.schema';
import { InitialEntitiesSchema, type InitialEntity, KebabCaseId, type PrefabLink } from '../schemas/world.schema';

export const PrefabSchema = z
    .object({
        name: z.string().min(1).max(100),
        description: z.string().max(1000).optional(),
        entities: InitialEntitiesSchema,
    })
    .superRefine((prefab, ctx) => {
        const all = flattenPrefabEntities(prefab.entities);
        if (all.length === 0 || all.length > 200)
            ctx.addIssue({ code: 'custom', message: 'プレハブは 1〜200 Entity にしてください' });
        for (const e of all) {
            if (e.prefab)
                ctx.addIssue({ code: 'custom', message: 'package 内のプレハブの入れ子参照には対応していません' });
            const ids = e.components.map((c) => c.id ?? c.type);
            if (new Set(ids).size !== ids.length)
                ctx.addIssue({ code: 'custom', message: '同じ型の Component には一意な id が必要です' });
        }
    });
export const PackagePrefabsSchema = z
    .record(KebabCaseId, PrefabSchema)
    .refine((p) => Object.keys(p).length <= 50, 'プレハブは 50 件までです');
export type PackagePrefab = z.infer<typeof PrefabSchema>;
export const flattenPrefabEntities = (entities: readonly InitialEntity[]): InitialEntity[] =>
    entities.flatMap((e) => [e, ...flattenPrefabEntities(e.children)]);
export type PrefabFields = Record<string, { dataFields?: Record<string, ComponentDataFieldSpec> }>;

/** package 自身と本体の標準 Component だけを含める。別 package の暗黙インストールはしない。 */
export function validatePackagePrefabs(
    modId: string,
    prefabs: Record<string, PackagePrefab>,
    components: PrefabFields,
): void {
    for (const prefab of Object.values(prefabs)) {
        const all = flattenPrefabEntities(prefab.entities);
        const ids = new Set(all.map((e) => e.id));
        for (const e of all)
            for (const c of e.components) {
                if (!isCoreComponentType(c.type) && (!c.type.startsWith(`${modId}:`) || !components[c.type]))
                    throw new Error(`プレハブの Component が見つかりません: ${c.type}`);
                for (const [key, field] of Object.entries(components[c.type]?.dataFields ?? {})) {
                    const value = c.data[key];
                    const refs =
                        field.type === 'entityRef'
                            ? [value]
                            : field.type === 'entityRefArray' && Array.isArray(value)
                              ? value
                              : [];
                    if (refs.some((ref) => typeof ref === 'string' && ref !== '' && !ids.has(ref)))
                        throw new Error(`プレハブの参照先がありません: ${c.type}.${key}`);
                }
            }
    }
}

/** 同じプレハブを複数配置しても Entity と宣言済み参照を衝突させない。 */
export function expandPrefab(
    prefab: PackagePrefab,
    fields: PrefabFields,
    ids: Record<string, string>,
): InitialEntity[] {
    const walk = (entities: InitialEntity[]): InitialEntity[] =>
        entities.map((e) => ({
            ...e,
            id: ids[e.id],
            components: e.components.map((c) => ({
                ...c,
                data: Object.fromEntries(
                    Object.entries(c.data).map(([key, value]) => {
                        const type = fields[c.type]?.dataFields?.[key]?.type;
                        if (type === 'entityRef' && typeof value === 'string') return [key, ids[value] ?? value];
                        if (type === 'entityRefArray' && Array.isArray(value))
                            return [key, value.map((v) => (typeof v === 'string' ? (ids[v] ?? v) : v))];
                        return [key, value];
                    }),
                ),
            })),
            children: walk(e.children),
        }));
    return walk(JSON.parse(JSON.stringify(prefab.entities)) as InitialEntity[]);
}

export function prefabEntityIds(
    prefab: PackagePrefab,
    existing: readonly InitialEntity[],
    previous: Record<string, string> = {},
): Record<string, string> {
    const used = new Set(flattenPrefabEntities(existing).map((e) => e.id));
    for (const id of Object.values(previous)) used.add(id);
    const ids = { ...previous };
    for (const entity of flattenPrefabEntities(prefab.entities)) {
        if (Object.hasOwn(ids, entity.id)) continue;
        let n = 1;
        let id = entity.id;
        while (used.has(id)) id = `${entity.id.slice(0, 40)}-${n++}`;
        used.add(id);
        ids[entity.id] = id;
    }
    return ids;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const keyed = (v: unknown[]): boolean => v.every((x) => object(x) && typeof (x.id ?? x.type) === 'string');

/** 3-way merge。配置側の編集を優先し、双方で同じ項目が変われば利用者へ競合を返す。 */
export function mergePrefab(
    base: InitialEntity[],
    current: InitialEntity[],
    next: InitialEntity[],
): { entities: InitialEntity[]; conflicts: string[] } {
    const conflicts: string[] = [];
    const merge = (b: unknown, c: unknown, n: unknown, path: string): unknown => {
        if (same(b, c)) return n;
        if (same(b, n) || same(c, n)) return c;
        if (object(b) && object(c) && object(n))
            return Object.fromEntries(
                [...new Set([...Object.keys(b), ...Object.keys(c), ...Object.keys(n)])].flatMap((key) => {
                    const value = merge(b[key], c[key], n[key], `${path}/${key}`);
                    return value === undefined ? [] : [[key, value]];
                }),
            );
        if (Array.isArray(b) && Array.isArray(c) && Array.isArray(n) && keyed(b) && keyed(c) && keyed(n)) {
            const map = (a: unknown[]) =>
                Object.fromEntries(
                    a.map((x) => {
                        const v = x as Record<string, unknown>;
                        return [String(v.id ?? v.type), v];
                    }),
                );
            const [bm, cm, nm] = [map(b), map(c), map(n)];
            const order = same(Object.keys(bm), Object.keys(cm))
                ? [...Object.keys(nm), ...Object.keys(cm)]
                : [...Object.keys(cm), ...Object.keys(nm)];
            return [...new Set(order)].flatMap((key) => {
                const value = merge(bm[key], cm[key], nm[key], `${path}/${key}`);
                return value === undefined ? [] : [value];
            });
        }
        conflicts.push(path);
        return c;
    };
    const entities = InitialEntitiesSchema.parse(merge(base, current, next, ''));
    return { entities, conflicts };
}

export function unpackPrefab(entity: InitialEntity): InitialEntity {
    const { prefab: _link, ...unpacked } = entity;
    return unpacked;
}
export function prefabLink(
    entry: { id: string; version: string; manifestIntegrity: string; baseUrl?: string; author?: string },
    name: string,
    entityIds: Record<string, string>,
): PrefabLink {
    return {
        modId: entry.id,
        name,
        version: entry.version,
        manifestIntegrity: entry.manifestIntegrity,
        baseUrl: entry.baseUrl,
        author: entry.author,
        entityIds,
    };
}

export function instantiatePrefab(
    entry: ModLockEntry,
    name: string,
    prefab: PackagePrefab,
    fields: PrefabFields,
    existing: InitialEntity[],
    rootId: string,
): InitialEntity {
    const root: InitialEntity = {
        id: rootId,
        transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
        components: [],
        tags: [],
        children: [],
    };
    const ids = prefabEntityIds(prefab, [...existing, root]);
    return { ...root, children: expandPrefab(prefab, fields, ids), prefab: prefabLink(entry, name, ids) };
}

export function updatePrefabInstance(
    root: InitialEntity,
    old: { prefab: PackagePrefab; fields: PrefabFields },
    next: { prefab: PackagePrefab; fields: PrefabFields; entry: ModLockEntry },
    existing: InitialEntity[],
) {
    const link = root.prefab;
    if (!link || link.modId !== next.entry.id || link.author !== next.entry.author)
        throw new Error('別の作者・package のプレハブへ置き換えられません');
    const owned = new Set(flattenPrefabEntities(root.children).map((e) => e.id));
    const outside = new Set(
        flattenPrefabEntities(existing)
            .filter((e) => !owned.has(e.id))
            .map((e) => e.id),
    );
    const localIds = new Set(flattenPrefabEntities(next.prefab.entities).map((e) => e.id));
    const retained = Object.fromEntries(
        Object.entries(link.entityIds).filter(([local, global]) => localIds.has(local) && !outside.has(global)),
    );
    const ids = prefabEntityIds(next.prefab, existing, retained);
    const merged = mergePrefab(
        expandPrefab(old.prefab, old.fields, link.entityIds),
        root.children,
        expandPrefab(next.prefab, next.fields, ids),
    );
    return {
        entity: { ...root, children: merged.entities, prefab: prefabLink(next.entry, link.name, ids) },
        conflicts: merged.conflicts,
    };
}
