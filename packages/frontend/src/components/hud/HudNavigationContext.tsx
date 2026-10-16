/**
 * HUD の中の画面から、ページを移らずに別のタブ（設定の特定の項目など）を開く手段。
 * ロビーでもインスタンスの中の HUD でも同じように動く（インスタンスから抜けない）。
 */
import { createContext, useContext } from 'react';
import type { SettingsSection } from './tabs/SettingsTab';

export interface HudNavigation {
    openSettings: (section: SettingsSection) => void;
}

export const HudNavigationContext = createContext<HudNavigation | null>(null);

export function useHudNavigation(): HudNavigation | null {
    return useContext(HudNavigationContext);
}
