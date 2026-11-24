/**
 * ページの外（通知のメールなど）から設定の欄を開く `/settings/:section`。設定はランチパッドの中にあるので、
 * ホームの部屋に入るまで開く欄を持ち越し（sessionStorage。タブごと）、入ったらランチパッドをその欄で開く。
 */

export const SETTINGS_SECTIONS = ['home', 'privacy', 'fediverse', 'publishing', 'storage', 'account', 'mods'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface SettingsLink {
    section: SettingsSection;
    /** 「公開」で目立たせる公開環境（追加の通知メールのリンク） */
    environment: string | null;
}

const isSettingsSection = (value: unknown): value is SettingsSection =>
    typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value);

const environmentOf = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;

/** `/settings/:section?environment=` を読む。知らない欄は null。 */
export function settingsLinkOf(section: string | undefined, search: string): SettingsLink | null {
    if (!isSettingsSection(section)) return null;
    const environment = section === 'publishing' ? environmentOf(new URLSearchParams(search).get('environment')) : null;
    return { section, environment };
}

/** sessionStorage 互換。 */
export interface SettingsLinkStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const SETTINGS_LINK_KEY = 'ubichill:settings-link';

export function keepSettingsLink(store: SettingsLinkStore, link: SettingsLink): void {
    store.setItem(SETTINGS_LINK_KEY, JSON.stringify(link));
}

/** 持ち越した欄（壊れていれば null）。開いたら {@link clearSettingsLink} で捨てる（1 回だけ開く）。 */
export function readSettingsLink(store: SettingsLinkStore): SettingsLink | null {
    const raw = store.getItem(SETTINGS_LINK_KEY);
    if (raw === null) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const { section, environment } = parsed as Record<string, unknown>;
        if (!isSettingsSection(section)) return null;
        return { section, environment: section === 'publishing' ? environmentOf(environment) : null };
    } catch {
        return null;
    }
}

export function clearSettingsLink(store: SettingsLinkStore): void {
    store.removeItem(SETTINGS_LINK_KEY);
}

/** 設定のこの欄を開く URL（ログインし直した後に戻る先など）。 */
export const settingsPath = (section: SettingsSection): string => `/settings/${section}`;
