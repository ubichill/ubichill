import type { WorldEntity } from '@ubichill/shared';
import type React from 'react';
import type { ReactNode } from 'react';
import type { PluginMessagingSchema } from './plugin/messaging-types';

/**
 * Widget コンポーネントに渡される Props
 * プラグインのメインコンポーネントはこの型を使ってください。
 *
 * @typeparam TData - エンティティデータ型（プラグイン固有の状態）
 * @typeparam TEphemeral - 揮発的データ型（リアルタイム同期用）
 *
 * @example
 * ```tsx
 * interface MyPluginData {
 *     color: string;
 *     label: string;
 * }
 *
 * interface MyPluginEphemeral {
 *     cursorPos: { x: number; y: number };
 * }
 *
 * const MyWidget: React.FC<WidgetComponentProps<MyPluginData, MyPluginEphemeral>> = ({
 *     entity,
 *     update,
 *     broadcast,
 *     ephemeral,
 * }) => {
 *     const handleColorChange = (color: string) => {
 *         update({ data: { ...entity.data, color } });
 *     };
 *
 *     const handleMouseMove = (x: number, y: number) => {
 *         broadcast?.({ cursorPos: { x, y } });
 *     };
 *
 *     return (
 *         <div>
 *             {}
 *         </div>
 *     );
 * };
 * ```
 */

export interface WidgetComponentProps<TData = unknown, TEphemeral = unknown> {
    /** ワールド上のエンティティ（現在の永続状態） */
    entity: WorldEntity<TData>;

    /** 他のユーザーにロックされているか */
    isLocked: boolean;

    /**
     * 状態を永続的にサーバーへ保存・同期する
     *
     * エンティティのデータ（`entity.data`）を更新する際に使用します。
     * サーバーとすべてのクライアントに同期されます。
     *
     * @param patch 部分更新（マージされます）
     *
     * @example
     * ```ts
     * // データを更新
     * update({ data: { ...entity.data, color: '#ff0000' } });
     *
     * // トランスフォーム（位置・サイズ）を更新
     * update({ transform: { x: 100, y: 50 } });
     * ```
     */
    update: (patch: Partial<WorldEntity<TData>>) => void;

    /**
     * 他クライアントから受け取った揮発的データ（リアルタイム同期）
     *
     * `broadcast()` で送信されたデータが格納されます。
     * サーバーに保存されず、接続中のクライアント間でのみ共有されます。
     *
     * @example
     * ```tsx
     * // 他ユーザーのカーソル位置を描画
     * if (ephemeral?.cursorPos) {
     *     <div style={{ left: ephemeral.cursorPos.x }}>●</div>
     * }
     * ```
     */
    ephemeral?: TEphemeral;

    /**
     * 揮発的データを他クライアントへブロードキャストする（サーバー保存なし）
     *
     * `ephemeral` Props に対応しています。
     * 主に「描画中の軌跡」「マウス移動」など、一時的なデータ送信に使用します。
     *
     * @param data ブロードキャストするデータ（TEphemeral 型）
     *
     * @example
     * ```ts
     * const handleMouseMove = (x: number, y: number) => {
     *     broadcast?.({ cursorPos: { x, y } });
     * };
     * ```
     */
    broadcast?: (data: TEphemeral) => void;
}

/**
 * プラグインのメタデータ定義
 *
 * @typeparam TData - エンティティデータ型（永続状態）
 * @typeparam TEphemeral - 揮発的データ型（リアルタイム同期）
 *
 * @example
 * ```tsx
 * export const myPluginDefinition: WidgetDefinition<MyData, MyEphemeral> = {
 *     id: 'myplugin:widget',
 *     name: 'My Plugin',
 *     defaultSize: { w: 300, h: 300 },
 *     defaultData: {  ... },
 *     Component: MyWidget,
 *     SingletonComponent: MyTray,
 * };
 * ```
 */
export interface WidgetDefinition<TData = unknown, TEphemeral = unknown> {
    /** 一意なID (例: "pen:pen", "video-player:player") */
    id: string;

    /** 表示名 (ツールバー用) */
    name: string;

    /** アイコン（JSX） */
    icon?: ReactNode;

    /** デフォルトサイズと初期データ */
    defaultSize: { w: number; h: number };
    defaultData: TData;

    /** メイン Widget コンポーネント */
    Component: React.FC<WidgetComponentProps<TData, TEphemeral>>;

    /**
     * シングルトンUI（任意）
     *
     * ワールドに参加している間、画面全体に1つだけレンダリングされるコンポーネント。
     * 例：ペントレイツールバー、設定パネル、グローバルコントローラー
     *
     * 複数プラグインが `SingletonComponent` を定義する場合、
     * 全てが同時にレンダリングされます。
     */
    SingletonComponent?: React.FC;

    /**
     * プラグイン設定ファイルへのパス（CI/ビルド用、オプション）
     *
     * CLI ツール（Ubicrate）がプラグインをスキャンする際の参照用。
     * デフォルトは `./plugin.json` が検索されます。
     *
     * @example
     * ```ts
     * configPath: './plugin.json'
     * ```
     */
    configPath?: string;
}
