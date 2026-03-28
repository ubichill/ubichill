import type { UbiEntityContext } from './types';

/**
 * エンティティウィジェット基底クラス。
 *
 * Host (EntityRenderer) が `el.ubiCtx = ctx` でコンテキストを注入する。
 * プラグイン開発者は onUpdate を実装して描画を行う。
 *
 * @example
 * ```ts
 * class MyWidget extends UbiWidget<MyData> {
 *     #root?: import('react-dom/client').Root;
 *
 *     connectedCallback() {
 *         this.#root = createRoot(this);
 *     }
 *
 *     onUpdate(ctx: UbiEntityContext<MyData>) {
 *         this.#root?.render(<MyContent ctx={ctx} />);
 *     }
 *
 *     disconnectedCallback() {
 *         this.#root?.unmount();
 *     }
 * }
 * customElements.define('my-widget', MyWidget);
 * ```
 */
export abstract class UbiWidget<TData = unknown, TEphemeral = unknown> extends HTMLElement {
    #ctx: UbiEntityContext<TData, TEphemeral> | null = null;

    set ubiCtx(ctx: UbiEntityContext<TData, TEphemeral>) {
        this.#ctx = ctx;
        this.onUpdate(ctx);
    }

    get ubiCtx(): UbiEntityContext<TData, TEphemeral> | null {
        return this.#ctx;
    }

    /**
     * コンテキストが更新されるたびに呼ばれる（初回含む）。
     * React を使う場合は `createRoot(this).render(...)` をここで呼ぶ。
     */
    protected abstract onUpdate(ctx: UbiEntityContext<TData, TEphemeral>): void;
}
