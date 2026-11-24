/**
 * ランチパッドの中の画面から、ページを移らずに別の画面（ワールドの特定の欄・人のプロフィール）を開いたり、
 * 部屋を移ったりする手段（インスタンスから抜けずに済む）。ランチパッドの外では無い（null）。
 */
import type { Instance } from '@ubichill/shared';
import { createContext, useContext } from 'react';
import type { PortalPlacementLook } from '@/world';
import type { JoinInstanceHandler } from './tabs/shared';
import type { WorldsSection } from './tabs/WorldsTab';

export interface HudNavigation {
    /** 今いる部屋（招待を送る先） */
    currentInstanceId: string;
    /** 今いる部屋の中身（読み込むまで null） */
    currentInstance: Instance | null;
    openWorlds: (section: WorldsSection) => void;
    openUser: (userId: string) => void;
    /** フレンドとのメッセージの会話を開く */
    openConversation: (userId: string) => void;
    /** 部屋へ移る（ほかの人がいれば確認し、今の部屋を抜けてから） */
    joinInstance: JoinInstanceHandler;
    /** 今いる部屋に、部屋へのポータルを置く */
    portal: PortalOpener;
}

export interface PortalTarget {
    /** 置く場所を選ぶ間に出す行き先の見た目（部屋のワールドの名前とサムネイル） */
    look: PortalPlacementLook;
    /** 置く場所を決めてから呼ぶ。行き先（このサーバーから見た部屋の住所）を返す。新しいインスタンスはここで作る */
    room: () => Promise<string>;
}

export interface PortalOpener {
    /** 置けないときの理由。置けるなら null */
    unavailable: string | null;
    /** ランチパッドを閉じて、置く場所を選ばせる。選んだら行き先を決めて置き、失敗はトーストで知らせる */
    place: (target: PortalTarget) => void;
}

export const HudNavigationContext = createContext<HudNavigation | null>(null);

export function useHudNavigation(): HudNavigation | null {
    return useContext(HudNavigationContext);
}
