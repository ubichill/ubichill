/**
 * mod にも公開できる、Zod 非依存の Core Component API。
 *
 * このパッケージが持つのは「Host 組み込み Component のデータ形式」だけ。
 * Collider の型や幾何計算は実行時の振る舞いなので `@ubichill/runtime` が持つ
 * （Host も mod もそちらから取る）。
 */
export const CORE_COMPONENT_TYPES = {
    collider: 'core:collider',
} as const;

export type CoreComponentType = (typeof CORE_COMPONENT_TYPES)[keyof typeof CORE_COMPONENT_TYPES];
