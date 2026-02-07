import { cursorWidgetDefinition } from './cursor';
import { penWidgetDefinition } from './pen/definition';
import type { WidgetDefinition } from './types';

// ここに追加していくだけ！
// biome-ignore lint/suspicious/noExplicitAny: Registry requires flexibility
export const INSTALLED_PLUGINS: WidgetDefinition<any>[] = [penWidgetDefinition, cursorWidgetDefinition];

// IDから検索しやすくするMap
export const PLUGIN_MAP = new Map(INSTALLED_PLUGINS.map((p) => [p.id, p]));
