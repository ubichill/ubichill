import type { UbiInstanceContext } from './types';

/**
 * シングルトン UI 基底クラス（ワールド参加中に 1 つだけ描画される）。
 *
 * Host (InstanceRenderer) が `el.instanceCtx = ctx` でコンテキストを注入する。
 * プラグイン開発者は onUpdate を実装してレンダリングを行う。
 *
 * @example
 * ```ts
 * class MyOverlay extends UbiSingleton {
 *     #root?: import('react-dom/client').Root;
 *
 *     connectedCallback() {
 *         this.#root = createRoot(this);
 *     }
 *
 *     onUpdate(ctx: UbiInstanceContext) {
 *         this.#root?.render(<MyOverlayContent ctx={ctx} />);
 *     }
 *
 *     disconnectedCallback() {
 *         this.#root?.unmount();
 *     }
 * }
 * customElements.define('my-overlay', MyOverlay);
 * ```
 */
export abstract class UbiSingleton extends HTMLElement {
    #ctx: UbiInstanceContext | null = null;

    set instanceCtx(ctx: UbiInstanceContext) {
        this.#ctx = ctx;
        this.onUpdate(ctx);
    }

    get instanceCtx(): UbiInstanceContext | null {
        return this.#ctx;
    }

    /**
     * コンテキストが更新されるたびに呼ばれる（初回含む）。
     * React を使う場合は `createRoot(this).render(...)` をここで呼ぶ。
     */
    protected abstract onUpdate(ctx: UbiInstanceContext): void;
}
