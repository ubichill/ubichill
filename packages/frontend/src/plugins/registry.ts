import type { AvatarPluginProps } from '@ubichill/plugin-avatar';
import { AvatarPlugin, avatarWidgetDefinition } from '@ubichill/plugin-avatar';
import { penWidgetDefinition } from '@ubichill/plugin-pen';
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

// App-Level Plugins (UI overlays, full-screen features)
export interface AppPlugin<P = unknown> {
    id: string;
    Component: React.ComponentType<P>;
}

export const APP_PLUGINS: AppPlugin<AvatarPluginProps>[] = [
    {
        id: 'avatar',
        Component: AvatarPlugin,
    },
];
