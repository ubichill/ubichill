/**
 * jsx-runtime — Worker 内で TSX を使うための JSX ファクトリ実装。
 *
 * TypeScript の automatic runtime（jsxImportSource: "@ubichill/sdk"）に対応する。
 * DOM を一切触らず、シリアライズ可能な VNode オブジェクトを返す。
 *
 * onUbi* プロパティに関数が渡されると、ハンドラーレジストリに登録して
 * '__h{n}' という文字列 ID に置き換える。
 * Host が onUbi* 要素を操作すると EVT_UI_ACTION を Worker へ送り、
 * UbiSDK が _callHandler(n) を呼んで元の関数を起動する。
 */

import type { VNode, VNodeChild, VNodeProps, VNodeType } from '@ubichill/shared';

// @ubichill/shared の index.ts は Zod スキーマをまとめて re-export するため
// `export { FRAGMENT } from '@ubichill/shared'` にすると Worker バンドルに Zod が混入する。
// 同じ文字列値を直接定義して Zod 依存を断ち切る。
export const Fragment = 'ubichill:fragment' as const;

// ============================================================
// ハンドラーレジストリ（globalThis 共有状態）
// ============================================================

/**
 * sandbox（Vite バンドル）とプラグイン（esbuild バンドル）は同一 Worker 内でそれぞれ
 * この jsx-runtime の別インスタンスを持つ。
 * モジュールローカル変数では状態が分離してしまうため、globalThis に共有状態を置き、
 * どのインスタンスからでも同じオブジェクトを参照する。
 */
const _SHARED_KEY = '__ubichill_jsx_state';

type _JsxState = {
    handlersMap: Map<string, Array<(...args: unknown[]) => void>>;
    currentTargetId: string;
    handlerIdx: number;
};

function _getState(): _JsxState {
    const g = globalThis as Record<string, unknown>;
    if (!g[_SHARED_KEY]) {
        g[_SHARED_KEY] = {
            handlersMap: new Map<string, Array<(...args: unknown[]) => void>>(),
            currentTargetId: 'default',
            handlerIdx: 0,
        };
    }
    return g[_SHARED_KEY] as _JsxState;
}

/**
 * レンダリングサイクル開始。Ubi.ui.render(factory, targetId) が内部で呼ぶ。
 * 指定 targetId のハンドラー配列をリセットし、インデックスカウンターを 0 に戻す。
 */
export function _beginRender(targetId: string): void {
    const s = _getState();
    s.currentTargetId = targetId;
    s.handlerIdx = 0;
    s.handlersMap.set(targetId, []);
}

/**
 * targetId に対応するハンドラー配列を削除する。
 * Ubi.ui.unmount(targetId) 時に呼んでメモリを解放する。
 */
export function _clearTarget(targetId: string): void {
    _getState().handlersMap.delete(targetId);
}

/**
 * targetId とインデックスでハンドラーを呼び出す。
 * UbiSDK の EVT_UI_ACTION 処理で使う。
 */
export function _callHandler(targetId: string, index: number, ...args: unknown[]): void {
    _getState()
        .handlersMap.get(targetId)
        ?.[index]?.(...args);
}

// ============================================================
// プロパティのシリアライズ
// ============================================================

/**
 * JSX プロパティを VNodeProps に変換する。
 * onUbi* 関数 → '__h{n}' 文字列 ID に変換してハンドラーを登録する。
 */
function serializeProps(rawProps: Record<string, unknown>): VNodeProps {
    const result: VNodeProps = {};
    for (const key of Object.keys(rawProps)) {
        if (key === 'children') continue;
        const val = rawProps[key];
        if (key.startsWith('onUbi') && typeof val === 'function') {
            const s = _getState();
            const handlers = s.handlersMap.get(s.currentTargetId);
            if (handlers) {
                const idx = s.handlerIdx++;
                handlers[idx] = val as (...args: unknown[]) => void;
                result[key] = `__h${idx}`;
            }
            // _beginRender() 未コール時はハンドラーを無視（インデックスズレ防止）
        } else if (val !== undefined) {
            result[key] = val as VNodeProps[string];
        }
    }
    return result;
}

/** 子要素を VNodeChild[] にフラット化する。 */
function flattenChildren(raw: VNodeChild | VNodeChild[]): VNodeChild[] {
    if (!Array.isArray(raw)) return [raw];
    // ネストした配列（map 等で生成）を 1 段だけ展開する
    const out: VNodeChild[] = [];
    for (const item of raw) {
        if (Array.isArray(item)) {
            for (const sub of item) out.push(sub as VNodeChild);
        } else {
            out.push(item);
        }
    }
    return out;
}

// ============================================================
// JSX ファクトリ（TypeScript automatic runtime 対応）
// ============================================================

/** Worker 内でのみ使用する関数コンポーネント型（シリアライズ前に解決される） */
type ComponentFn = (props: Record<string, unknown>) => VNode | null;

/**
 * 関数コンポーネントを Worker 内で即時解決する。
 * VNode はシリアライズ可能である必要があるため、型 = 文字列のみ許可。
 * 関数コンポーネントはここで呼び出して HTML タグの VNode ツリーに変換する。
 */
function makeVNode(
    type: VNodeType | ComponentFn,
    props: Record<string, unknown>,
    children: VNodeChild[],
    key?: string | number | null,
): VNode {
    if (typeof type === 'function') {
        // 関数コンポーネント: children を props に含めて即時呼び出す
        const childProp = children.length === 1 ? children[0] : children.length === 0 ? undefined : children;
        const result = type({ ...props, children: childProp });
        return result ?? { type: Fragment, props: {}, children: [], key: null };
    }
    return { type, props: serializeProps(props), children, key: key ?? null };
}

/**
 * 単一子要素を持つ要素用（TypeScript が jsx() を呼ぶ）。
 * children は props.children に含まれる。
 */
export function jsx(
    type: VNodeType | ComponentFn,
    props: Record<string, unknown> & { children?: VNodeChild | VNodeChild[] },
    key?: string | number | null,
): VNode {
    const { children, ...rest } = props;
    return makeVNode(type, rest, children !== undefined ? flattenChildren(children) : [], key);
}

/**
 * 複数子要素を持つ要素用（TypeScript が jsxs() を呼ぶ）。
 * children は props.children に含まれる配列。
 */
export function jsxs(
    type: VNodeType | ComponentFn,
    props: Record<string, unknown> & { children?: VNodeChild[] },
    key?: string | number | null,
): VNode {
    const { children, ...rest } = props;
    return makeVNode(type, rest, children ?? [], key);
}

/** Dev モードも同じ実装で十分（esbuild が本番バンドル時に除去する）。 */
export const jsxDEV = jsxs;

// ============================================================
// JSX 型宣言（TypeScript が jsxImportSource で参照する）
// ============================================================

/**
 * TSX ファイルで以下を tsconfig に追加するだけで型が効く:
 * ```json
 * { "jsx": "react-jsx", "jsxImportSource": "@ubichill/sdk" }
 * ```
 *
 * 全 HTML タグを受け付け、onUbi* イベントと style オブジェクトに対応する。
 */
export namespace JSX {
    /** JSX 式の戻り値型 */
    export type Element = VNode;

    /**
     * 全 HTML 組み込み要素の props 型。
     * - style: Record<string, string | number>
     * - onUbi*: (...args: unknown[]) => void（実行時に '__h{n}' 文字列 ID に変換される）
     * - children / key は JSX 標準プロパティ
     * - その他プリミティブ値
     * VNodeProps との交差型は index signature が競合するため使用しない。
     */
    export interface IntrinsicElements {
        [elemName: string]: {
            style?: Record<string, string | number>;
            children?: VNodeChild | VNodeChild[];
            key?: string | number | null;
            [key: string]: unknown;
        };
    }

    /**
     * 関数コンポーネントの型。
     * Worker 内で即時解決されるため、戻り値は VNode | null。
     */
    export interface ElementClass {
        render(): VNode;
    }

    /** children プロパティの名前を TypeScript に伝える */
    export interface ElementChildrenAttribute {
        children: Record<string, never>;
    }
}
