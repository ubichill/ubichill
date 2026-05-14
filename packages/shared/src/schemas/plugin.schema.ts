import { z } from 'zod';
import { TransformSchema } from './world.schema';

// ============================================
// Plugin Manifest スキーマ
//
// 設計:
// - 1 つの Plugin は複数の Component を配布できる
// - Component 名は `pluginId:componentName` 形式で参照される
// - Worker 起動を伴う Component は `src` (build 時) / `workerUrl` (runtime) を持つ
// - データ専用 Component（worker なし）は `dataFields` だけ宣言できる
// ============================================

/**
 * Inspector で必ず表示する data フィールドの仕様。
 * 旧 `useAvailableEntityKinds.DataFieldSpec` と互換。
 */
export const ComponentDataFieldSpecSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('string'),
        default: z.string().optional(),
        multiline: z.boolean().optional(),
        placeholder: z.string().optional(),
        label: z.string().optional(),
        help: z.string().optional(),
    }),
    z.object({
        type: z.literal('number'),
        default: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        label: z.string().optional(),
        help: z.string().optional(),
    }),
    z.object({
        type: z.literal('boolean'),
        default: z.boolean().optional(),
        label: z.string().optional(),
        help: z.string().optional(),
    }),
    z.object({
        type: z.literal('color'),
        default: z.string().optional(),
        label: z.string().optional(),
        help: z.string().optional(),
    }),
    z.object({
        type: z.literal('url'),
        default: z.string().optional(),
        placeholder: z.string().optional(),
        label: z.string().optional(),
        help: z.string().optional(),
    }),
    z.object({
        type: z.literal('enum'),
        default: z.string().optional(),
        options: z.array(z.string()),
        label: z.string().optional(),
        help: z.string().optional(),
    }),
    z.object({
        type: z.literal('json'),
        default: z.unknown().optional(),
        label: z.string().optional(),
        help: z.string().optional(),
    }),
]);

export type ComponentDataFieldSpec = z.infer<typeof ComponentDataFieldSpecSchema>;

/**
 * Component manifest エントリ。
 * - `src` (build) / `workerUrl` (runtime) どちらも無いものはデータ専用。
 * - `watchScope`: 'entity' (default) は自 GameObject 内の Component のみ可視。
 *   'world' はワールド全体を見る (旧挙動)。
 */
export const ComponentManifestEntrySchema = z.object({
    src: z.string().optional(),
    workerUrl: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    canvasTargets: z.array(z.string()).optional(),
    mediaTargets: z.array(z.string()).optional(),
    fetchDomains: z.array(z.string()).optional(),
    watchEntityTypes: z.array(z.string()).optional(),
    watchScope: z.enum(['entity', 'world']).optional(),
    defaultTransform: TransformSchema.partial().optional(),
    dataFields: z.record(z.string(), ComponentDataFieldSpecSchema).optional(),
    displayName: z.string().optional(),
});

export type ComponentManifestEntry = z.infer<typeof ComponentManifestEntrySchema>;

/**
 * `plugins/<name>/plugin.json` のソース形式。
 * build-workers.mjs が読み、`packages/frontend/public/plugins/<name>/v<ver>/manifest.json` を生成する。
 */
export const PluginManifestSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    version: z.string(),
    components: z.record(z.string(), ComponentManifestEntrySchema).default({}),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * versioned manifest（runtime 用）。
 * `src` を持たず `workerUrl` のみ。
 */
export const PluginVersionedManifestSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    version: z.string(),
    components: z.record(z.string(), ComponentManifestEntrySchema).default({}),
});

export type PluginVersionedManifest = z.infer<typeof PluginVersionedManifestSchema>;
