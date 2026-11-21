import type { PortalTarget } from '@ubichill/core-components';
import { createContext, useContext } from 'react';

/**
 * 入口（core:portal）を押したときの移り方。SNS の画面（InstancePage）が渡す。
 * world.html とエディタのプレビューでは渡さないので、入口は押せない。
 */
export type PortalNavigate = (target: PortalTarget, label: string) => void;

const PortalNavigationContext = createContext<PortalNavigate | null>(null);

export const PortalNavigationProvider = PortalNavigationContext.Provider;

export const usePortalNavigation = (): PortalNavigate | null => useContext(PortalNavigationContext);
