/**
 * ランチパッドの中の画面から、ページを移らずに別の画面（設定の特定の項目・人のプロフィール）を開く手段（インスタンスから抜けない）。
 */
import { createContext, useContext } from 'react';
import type { SettingsSection } from './tabs/SettingsTab';

export interface HudNavigation {
    openSettings: (section: SettingsSection) => void;
    openUser: (userId: string) => void;
}

export const HudNavigationContext = createContext<HudNavigation | null>(null);

export function useHudNavigation(): HudNavigation | null {
    return useContext(HudNavigationContext);
}
