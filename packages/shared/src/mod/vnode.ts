/**
 * VNode — Worker とホスト間で postMessage でき、シリアライズ可能な仮想 DOM ノード。
 *
 * Worker 内で生成され、Host が実 DOM に変換する。React 非依存。
 * 関数はシリアライズ不可のため、イベントは onUbi* 文字列 ID（'__h{n}'）で参照する。
 */

/** Fragment 識別子: DOM 要素を生成しない複数子要素のラッパー */
export const FRAGMENT = 'ubichill:fragment' as const;
export type FragmentType = typeof FRAGMENT;

/** VNode が表現できるノードタイプ（タグ名 or Fragment） */
export type VNodeType = string | FragmentType;

/**
 * VNode のプロパティ型。
 * - style: Record<string, string | number>
 * - onUbi*: ハンドラーインデックスの文字列表現 '__h{n}'
 * - その他: プリミティブ値
 */
export type VNodeProps = Record<string, string | number | boolean | null | undefined | Record<string, string | number>>;

/** VNode の子要素型（.map() が生成するネスト配列を含む） */
export type VNodeChild = VNode | string | number | boolean | null | undefined | VNodeChild[];

/** シリアライズ可能な仮想 DOM ノード */
export interface VNode {
    type: VNodeType;
    props: VNodeProps;
    children: VNodeChild[];
    key?: string | number | null;
}
