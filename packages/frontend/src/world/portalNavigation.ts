import type { PortalTarget } from '@ubichill/core-components';
import { createContext, useContext } from 'react';

/**
 * ポータル（core:portal）を押したときの移り方。SNS の画面（InstancePage）が渡す。
 * world.html とエディタのプレビューでは渡さないので、ポータルは押せない。
 */
export type PortalNavigate = (target: PortalTarget, label: string) => void;

const PortalNavigationContext = createContext<PortalNavigate | null>(null);

export const PortalNavigationProvider = PortalNavigationContext.Provider;

export const usePortalNavigation = (): PortalNavigate | null => useContext(PortalNavigationContext);

/** ポータルに出す行き先のワールド（名前とサムネイル）。 */
export interface PortalDestination {
    name: string;
    thumbnail?: string;
}

/**
 * 行き先のワールドを引く。SNS の画面とエディタが渡す（world.html では渡さないので、ポータルは名前と印だけ）。
 * 見つからなければ null。
 */
export type PortalLookup = (target: PortalTarget) => Promise<PortalDestination | null>;

const PortalLookupContext = createContext<PortalLookup | null>(null);

export const PortalLookupProvider = PortalLookupContext.Provider;

export const usePortalLookup = (): PortalLookup | null => useContext(PortalLookupContext);
