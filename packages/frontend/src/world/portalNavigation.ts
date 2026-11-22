import type { PortalTarget } from '@ubichill/core-components';
import { createContext, useContext } from 'react';

/**
 * ポータルの行き先。ワールドに置くポータルはワールド、部屋で利用者が置くポータルは部屋（部屋のサーバーから見た住所のまま。
 * 見る人から見た住所には SNS の画面が直す）。
 */
export type PortalGoal = PortalTarget | { kind: 'room'; room: string };

/**
 * ポータル（core:portal）を押したときの移り方。SNS の画面（InstancePage）が渡す。
 * world.html とエディタのプレビューでは渡さないので、ポータルは押せない。look は分かっていれば、移る先の読み込み画面に出す。
 */
export type PortalNavigate = (
    goal: PortalGoal,
    label: string,
    look?: { displayName: string; thumbnail?: string },
) => void;

const PortalNavigationContext = createContext<PortalNavigate | null>(null);

export const PortalNavigationProvider = PortalNavigationContext.Provider;

export const usePortalNavigation = (): PortalNavigate | null => useContext(PortalNavigationContext);

/** ポータルに出す行き先のワールド（名前とサムネイル）。 */
export interface PortalDestination {
    name: string;
    thumbnail?: string;
    /** 見る人が通れない（部屋: 公開範囲・招待・満員。ワールド: プライベートのワールド） */
    locked?: boolean;
}

/**
 * 行き先のワールドを引く。SNS の画面とエディタが渡す（world.html では渡さないので、ポータルは名前と印だけ）。
 * 見つからなければ null（部屋へのポータルなら、部屋がもう無い）。
 */
export type PortalLookup = (goal: PortalGoal) => Promise<PortalDestination | null>;

const PortalLookupContext = createContext<PortalLookup | null>(null);

export const PortalLookupProvider = PortalLookupContext.Provider;

export const usePortalLookup = (): PortalLookup | null => useContext(PortalLookupContext);
