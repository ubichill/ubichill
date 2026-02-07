import { cursorWidgetDefinition } from '@ubichill/plugin-cursor';
import { penWidgetDefinition } from '@ubichill/plugin-pen';
import type { WidgetDefinition } from '@ubichill/sdk';

// ここに追加していくだけ！
// biome-ignore lint/suspicious/noExplicitAny: Registry requires flexibility
export const INSTALLED_PLUGINS: WidgetDefinition<any>[] = [
    penWidgetDefinition,
    cursorWidgetDefinition,
];

// IDから検索しやすくするMap
export const PLUGIN_MAP = new Map(INSTALLED_PLUGINS.map((p) => [p.id, p]));
