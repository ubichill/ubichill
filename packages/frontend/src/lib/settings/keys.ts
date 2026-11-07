/**
 * settings/keys — 設定の localStorage キー登録簿。
 *
 * キー文字列の散在を防ぐ単一の出所。新しいユーザー設定を足すときはここに追記する。
 * 値は既存データとの互換を保つため従来のキー名を踏襲している。
 */
export const SETTINGS_KEYS = {
    /** ワールド一覧の並び替えキー。 */
    worldSortKey: 'ubichill_world_sort',
    /** ユーザーが追加したmodレジストリ URL 一覧（設定タブ・ワールドエディタで共有）。 */
    editorRegistryUrls: 'world-editor:registry-urls',
    /** mod権限ポリシー（ティア既定・mod別 grant・外部通信ドメイン）。 */
    permissionPolicy: 'ubichill:permission-policy',
    /** ワールドのメディア全体の音量・ミュート（HUD の「音声」）。 */
    mediaOutput: 'ubichill:media-output',
} as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];
