import type { AvatarPluginProps } from '@ubichill/plugin-avatar';
import { AvatarPlugin, avatarWidgetDefinition } from '@ubichill/plugin-avatar';
import { PenTray, penWidgetDefinition } from '@ubichill/plugin-pen';
import { videoPlayerDefinition } from '@ubichill/plugin-video-player';
import type { WidgetDefinition } from '@ubichill/sdk';
import type React from 'react';

// Widget Plugins (Draggable entities in the world)
// biome-ignore lint/suspicious/noExplicitAny: Registry requires flexibility
export const INSTALLED_PLUGINS: WidgetDefinition<any>[] = [
    penWidgetDefinition,
    videoPlayerDefinition,
    avatarWidgetDefinition,
];

// IDから検索しやすくするMap
export const PLUGIN_MAP = new Map(INSTALLED_PLUGINS.map((p) => [p.id, p]));

// App-Level Plugin type definitions
export interface AppPluginBase {
    id: string;
}

export interface AvatarAppPlugin extends AppPluginBase {
    id: 'avatar';
    Component: React.ComponentType<AvatarPluginProps>;
}

export interface PenTrayAppPlugin extends AppPluginBase {
    id: 'pen-tray';
    Component: React.ComponentType;
}

export type AppPlugin = AvatarAppPlugin | PenTrayAppPlugin;

// App-Level Plugins (UI overlays, singleton components)
export const APP_PLUGINS: AppPlugin[] = [
    {
        id: 'avatar',
        Component: AvatarPlugin,
    },
    {
        id: 'pen-tray',
        Component: PenTray,
    },
];
