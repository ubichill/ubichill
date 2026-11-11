import { z } from 'zod';
import { PackageAuthorSchema } from '../mod/packageRef';

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
    /**
     * この mod だけの取得元 URL（末尾スラッシュなし）。世界の他 mod と別ホストに
     * 配布されている場合のみ設定する。未設定ならホスト側の既定 baseUrl を使う。
     */
    baseUrl: z.string().url().optional(),
    /** ワールド作者が指定した作者。lock v2 では実行時にも署名の作者と照合する。 */
    author: PackageAuthorSchema.optional(),
});

export type ModLockEntry = z.infer<typeof ModLockEntrySchema>;

/** ワールドが固定する mod ロック全体（`modId` → entry）。 */
export const ModLockSchema = z
    .object({
        lockVersion: z.union([z.literal(1), z.literal(2)]),
        mods: z.record(z.string(), ModLockEntrySchema).default({}),
        packages: z.record(z.string(), ModLockEntrySchema).optional(),
    })
    .superRefine((lock, ctx) => {
        if (lock.lockVersion === 2 && (!lock.packages || Object.keys(lock.mods).length))
            ctx.addIssue({ code: 'custom', message: 'lock v2 は packages に保存し、旧 Host が使う mods は空にします' });
        if (lock.lockVersion === 1 && (lock.packages || Object.values(lock.mods).some((m) => m.author)))
            ctx.addIssue({ code: 'custom', message: '作者を固定する lock は lockVersion: 2 が必要です' });
    });

export type ModLock = z.infer<typeof ModLockSchema>;

/** v2 は旧 Host の mods を空にし、作者固定を知らないコードを実行させない。 */
export function lockedMods(
    lock:
        | { lockVersion?: number; mods: Record<string, ModLockEntry>; packages?: Record<string, ModLockEntry> }
        | null
        | undefined,
): Record<string, ModLockEntry> {
    return lock?.lockVersion === 2 ? (lock.packages ?? {}) : (lock?.mods ?? {});
}
export function createModLock(entries: Record<string, ModLockEntry>): ModLock {
    return Object.values(entries).some((e) => e.author)
        ? { lockVersion: 2, mods: {}, packages: entries }
        : { lockVersion: 1, mods: entries };
}
