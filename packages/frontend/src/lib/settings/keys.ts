/**
 * settings/keys — 設定の localStorage キー登録簿。
 *
 * キー文字列の散在を防ぐ単一の出所。新しいユーザー設定を足すときはここに追記する。
 * 値は既存データとの互換を保つため従来のキー名を踏襲している。
 */
export const SETTINGS_KEYS = {
    /** ロビーのワールド並び替えキー。 */
    lobbySortKey: 'ubichill_world_sort',
    /** ワールドエディタでユーザーが追加したプラグインレジストリ URL 一覧。 */
    editorRegistryUrls: 'world-editor:registry-urls',
    /** プラグイン権限ポリシー（ティア既定・プラグイン別 grant・fetch ドメイン）。 */
    permissionPolicy: 'ubichill:permission-policy',
} as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];
