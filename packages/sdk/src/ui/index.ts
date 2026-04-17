/**
 * @ubichill/sdk/ui — Custom Elements ベースのプラグイン UI 基盤
 *
 * Worker-safe ではない（DOM API を使用）。
 * ブラウザ環境（プラグインフロントエンド）からのみインポートすること。
 */

export type { SocketLike, UbiEntityContext, UbiInstanceContext } from './types';
export { UbiWidget } from './UbiWidget';
export { renderVNode } from './VNodeRenderer';
