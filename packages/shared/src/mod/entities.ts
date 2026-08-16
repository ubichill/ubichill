/**
 * ゼロ依存の素朴な型（zod不使用）。@ubichill/shared の index.ts（schemas/* の zod スキーマ群を
 * `export * from './schemas'` で抱える barrel）から意図的に分離している。
 *
 * mod/types.ts・mod/vnode.ts・mod/protocol.ts・mod/errors.ts はここに定義された型を参照するだけで
 * barrel（index.ts）を経由しない。これにより @ubichill/sdk の型定義バンドル（dts-bundle-generator）
 * が barrel 経由で schemas/* の zod スキーマ（型チェックが極めて重い）まで読み込まずに済み、
 * ビルド時間が約80倍短縮される（実測: 21秒 → 250ms）。index.ts はここから `export *` して
 * 既存の barrel 経由の消費者との後方互換を保つ。
 */

// ============================================
// User Types
// ============================================

/**
 * ユーザーのステータス
 * 'online' - オンライン
 * 'busy' - 作業中（カーソル固定）
 * 'dnd' - 話しかけないで（Do Not Disturb）
 * 'away' - 離席中
 * 'offline' - オフライン
 */
export type UserStatus = 'online' | 'busy' | 'dnd' | 'away' | 'offline';

/**
 * カーソル位置
 */
export interface CursorPosition {
    x: number;
    y: number;
}

/**
 * ユーザー情報
 *
 * 画像系フィールドは「プロフィール画像」と「カーソル画像」を別ものとして扱う:
 *  - `avatarUrl`: ネームプレート / プロフィールページ / 設定画面に出る顔写真
 *  - `cursorUrl`: マウス先端に重ねる小型アイコン (ユーザーごとに自由設定)
 * どちらも null 可。未設定時は本体側がデフォルト SVG で代替する。
 */
export interface User {
    id: string;
    name: string;
    /** プロフィール画像 URL (ネームプレートやユーザーページに表示) */
    avatarUrl?: string;
    /** カーソル先端に重ねる画像 URL (avatarUrl とは別物・別に設定できる) */
    cursorUrl?: string | null;
    status: UserStatus;
    position: CursorPosition;
    lastActiveAt: number;
    /** 現在持っているペンの色（ペンmodが設定・解除する） */
    penColor?: string | null;
    /**
     * 現在持っているエンティティの ComponentInstance ID。
     * Ubi.grip.exclusive() が hold/release 時に更新する。
     * share: 'local' の場合は送信しないため null のまま。
     */
    heldEntityId?: string | null;
}

// ============================================
// UEP (Ubichill Entity Protocol) Types
// ============================================

/**
 * エンティティの変形情報（位置・サイズ・回転）
 */
export interface EntityTransform {
    x: number;
    y: number;
    z: number; // レイヤー順
    w: number; // 幅
    h: number; // 高さ
    scale: number; // 拡大縮小
    rotation: number; // 回転角度（度）
}

/**
 * Worker 互換の flat エンティティ。
 *
 * 1 GameObject 上の 1 Component に 1:1 で対応する。GameObject の hierarchy は
 * `entityId` (自身が乗る GameObject) と `parentEntityId` (親 GameObject) で表現。
 *
 * @template T ウィジェット固有のデータ型
 */
export interface ComponentInstance<T = unknown> {
    id: string;
    type: string;
    /** 自身が乗る GameObject の id。 */
    entityId?: string;
    /** 親 GameObject の id (子孫判定用)。ルートなら undefined。 */
    parentEntityId?: string;
    ownerId: string | null;
    lockedBy: string | null;
    transform: EntityTransform;
    data: T;
}

/**
 * Entity (GameObject) に載る 1 つの Component。
 */
export interface EntityComponent<T = unknown> {
    type: string; // "modId:componentName"
    data: T;
}

/**
 * GameObject — `id` + `transform` を持つ「箱」。
 *
 * 振る舞いはすべて `components: EntityComponent[]` 経由で配布される。
 * Stage 1 ではエディタ / YAML / DB の表現のみで、runtime は flatten 後の ComponentInstance を使う。
 */
export interface WorldEntity {
    id: string;
    transform: EntityTransform;
    components: EntityComponent[];
    ownerId: string | null;
    lockedBy: string | null;
}

/**
 * エンティティパッチ（Reliable）のペイロード。
 * Stage 1 では flat ComponentInstance 単位の patch（旧形式維持）。
 */
export interface EntityPatchPayload {
    entityId: string;
    patch: Partial<Omit<ComponentInstance, 'id' | 'type'>>;
}

/**
 * エンティティエフェメラル（Volatile）のペイロード
 */
export interface EntityEphemeralPayload {
    entityId: string;
    data: unknown; // バックエンドはこの中身を解釈しない
}

// ============================================
// World Snapshot (拡張版)
// ============================================

/**
 * 利用可能な Component（ツールバー用）。
 * 1 component = 1 振る舞い。`id` は `modId:componentName` 形式。
 */
export interface AvailableComponent {
    id: string; // "modId:componentName"
    displayName: string;
    icon?: string;
    defaults?: Record<string, unknown>;
}

/**
 * ワールド環境設定
 */
export interface WorldEnvironmentData {
    backgroundColor: string;
    worldSize: { width: number; height: number };
}
