/**
 * ランチパッドの中の画面から、ページを移らずに別の画面（ワールドの特定の欄・人のプロフィール）を開いたり、
 * 部屋を移ったりする手段（インスタンスから抜けずに済む）。ランチパッドの外では無い（null）。
 */
import { createContext, useContext } from 'react';
import type { JoinInstanceHandler } from './tabs/shared';
import type { WorldsSection } from './tabs/WorldsTab';

export interface HudNavigation {
    /** 今いる部屋（招待を送る先） */
    currentInstanceId: string;
    openWorlds: (section: WorldsSection) => void;
    openUser: (userId: string) => void;
    /** 部屋へ移る（ほかの人がいれば確認し、今の部屋を抜けてから） */
    joinInstance: JoinInstanceHandler;
}

export const HudNavigationContext = createContext<HudNavigation | null>(null);

export function useHudNavigation(): HudNavigation | null {
    return useContext(HudNavigationContext);
}
