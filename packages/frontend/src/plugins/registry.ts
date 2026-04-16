import type { WidgetDefinition, WorkerPluginDefinition } from '@ubichill/sdk/react';

type PluginLoader = () => Promise<WidgetDefinition | WorkerPluginDefinition>;

/**
 * Worker 以外のプラグイン（Custom Element ベース）の静的ローダー。
 *
 * Worker プラグインは plugin.json の entities メタデータから自動ロードされるため
 * ここには登録不要。CE ベースの非 Worker プラグインのみ列挙する。
 */
export const PLUGIN_LOADERS: Record<string, PluginLoader> = {};
