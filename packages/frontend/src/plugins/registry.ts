import type { WidgetDefinition } from '@ubichill/sdk/react';

type WidgetLoader = () => Promise<WidgetDefinition>;

/**
 * エンティティタイプ → WidgetDefinition 動的ローダー
 *
 * world:snapshot の activePlugins またはエンティティタイプに基づいて
 * 実行時に動的ロードされる。ビルド時に静的バンドルしない。
 */
export const PLUGIN_LOADERS: Record<string, WidgetLoader> = {
    'pen:pen': () => import('@ubichill/plugin-pen').then((m) => m.penWidgetDefinition),
    avatar: () => import('@ubichill/plugin-avatar').then((m) => m.avatarWidgetDefinition),
    'video-player': () => import('@ubichill/plugin-video-player').then((m) => m.videoPlayerDefinition),
};

/**
 * plugin.json の id → エンティティタイプ のマッピング
 *
 * activePlugins は plugin.json の id（例: 'avatar:avatar'）を含むが、
 * WidgetDefinition.id はエンティティタイプ（例: 'avatar'）のため変換が必要。
 */
export const PLUGIN_ID_TO_ENTITY_TYPE: Record<string, string> = {
    'pen:pen': 'pen:pen',
    'avatar:avatar': 'avatar',
};
