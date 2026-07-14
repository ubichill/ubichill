/**
 * @ubichill/ui-renderer — ホスト側の VNode→DOM 描画と DOM 入力収集。
 *
 * mod の隔離実行（@ubichill/sandbox）とは分離した「表示・入力」の関心事。
 * framework 非依存（React 非依存）。
 *
 * - VNodeRenderer : mod が返す VNode を実 DOM に変換（タグ許可リスト / URL 検証 / innerHTML 禁止）。
 * - InputCollector / SharedInputPool : DOM 入力を集約し Worker へ渡す入力フレームを作る。
 */
export { InputCollector } from './InputCollector';
export {
    acquireSharedInput,
    collectSharedInputFor,
    releaseSharedInput,
    setSharedScrollElement,
} from './SharedInputPool';
export { renderVNode } from './VNodeRenderer';
