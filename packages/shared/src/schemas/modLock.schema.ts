import { z } from 'zod';

// ============================================
// Mod Lock スキーマ（ワールドに埋め込む mod 完全性ロック）
//
// 設計:
// - ワールドは mod を「最新ポインタ」で無検証ロードするため、mod 公開者が
//   同一 version のままバンドルを差し替えれば任意コード注入・権限昇格ができる。
// - lock は各 mod の「固定 version + コード hash + capability 上限」を宣言し、
//   ロード時に fetch したバイト列と照合する（Subresource Integrity 相当）。
// - capability は lock を天井とし、manifest（配布者の自己申告）を信頼しない。
// - lock はワールド YAML の `spec.lock` に埋め込むため、ワールド URL の provenance が
//   そのまま lock の信頼根になる（プレイヤーは mod 公開者を信頼しなくてよい）。
//
// integrity は SRI 形式 `sha256-<base64>`。既存のファイル名 hex8 はキャッシュ
// バスティング用途のまま温存し、lock はフル sha256 を別途保持する。
// ============================================

/**
 * integrity 文字列（`sha256-<base64>`）。
 * sha256 は 32 byte ＝ 標準 base64 で必ず 43 文字 + `=` 1 個（計 44）になるため長さも固定する。
 * 任意長を許すと `sha256-AAAA` のような不正値を弾けない。
 */
export const IntegritySchema = z.string().regex(/^sha256-[A-Za-z0-9+/]{43}=$/, 'Must be "sha256-<base64(32byte)>"');

/**
 * lock された 1 つの Component。
 * `modId:componentName` 形式のキーで {@link ModLockEntrySchema.components} に格納される。
 */
export const ModLockComponentSchema = z.object({
    /** versioned ディレクトリからの相対 workerUrl（manifest と同形）。 */
    workerUrl: z.string(),
    /** worker バンドルのバイト列 sha256（SRI）。 */
    integrity: IntegritySchema,
    /** 付与を許す capability の上限（ビルド時に固定した値）。 */
    capabilities: z.array(z.string()).default([]),
});

export type ModLockComponent = z.infer<typeof ModLockComponentSchema>;

/**
 * lock された 1 つの mod（固定 version + manifest hash + component 群）。
 * data-only Component（worker 無し）は components に載らない。
 */
export const ModLockEntrySchema = z.object({
    id: z.string(),
    /** 固定した解決バージョン（最新ポインタを信頼せずこの版を直接取得する）。 */
    version: z.string(),
    /** versioned manifest.json のバイト列 sha256（SRI）。メタ改ざん検知用。 */
    manifestIntegrity: IntegritySchema,
    /** `modId:componentName` → lock 済み Component。 */
    components: z.record(z.string(), ModLockComponentSchema).default({}),
});

export type ModLockEntry = z.infer<typeof ModLockEntrySchema>;

/** ワールドが固定する mod ロック全体（`modId` → entry）。 */
export const ModLockSchema = z.object({
    lockVersion: z.literal(1),
    mods: z.record(z.string(), ModLockEntrySchema).default({}),
});

export type ModLock = z.infer<typeof ModLockSchema>;
