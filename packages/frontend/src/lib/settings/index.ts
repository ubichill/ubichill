/**
 * settings — ユーザー設定の永続化層 (localStorage ベース)。
 *
 * - store   : 純粋な get/set/remove
 * - useSetting : React フック
 * - keys    : 設定キー登録簿
 */
export { SETTINGS_KEYS, type SettingsKey } from './keys';
export { readSetting, removeSetting, writeSetting } from './store';
export { useSetting } from './useSetting';
