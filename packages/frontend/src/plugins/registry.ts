import { penWidgetDefinition } from '@ubichill/plugin-pen';
import { videoPlayerDefinition } from '@ubichill/plugin-video-player';
import type { WidgetDefinition } from '@ubichill/sdk';

// ここに追加していくだけ！
// biome-ignore lint/suspicious/noExplicitAny: Registry requires flexibility
export const INSTALLED_PLUGINS: WidgetDefinition<any>[] = [penWidgetDefinition, videoPlayerDefinition];

// IDから検索しやすくするMap
export const PLUGIN_MAP = new Map(INSTALLED_PLUGINS.map((p) => [p.id, p]));
