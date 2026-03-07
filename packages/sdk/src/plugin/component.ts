// ============================================
// UbiBehaviour
//
// Unityライクな純粋なTypeScriptのコンポーネント基底クラス。
// プラグイン開発者はこのクラスを継承し、ロジックを実装します。
// ReactなどのUIフレームワークには一切依存しません。
// ============================================

import type { CursorPosition, User, WorldEntity } from '@ubichill/shared';

/**
 * プラグインのロジックをカプセル化するコンポーネント基底クラス。
 *
 * @example
 * ```ts
 * class MyBehaviour extends UbiBehaviour {
 *     start() {
 *         Ubi.ui.showToast('MyBehaviour started!');
 *     }
 *
 *     update(deltaTime: number) {
 *         // 毎フレームの処理
 *     }
 * }
 *
 * Ubi.registerBehaviour(new MyBehaviour());
 * ```
 */
export class UbiBehaviour {
    /**
     * コンポーネントが登録され、初期化されるタイミングで1度だけ呼ばれます。
     */
    start(): void {}

    /**
     * 毎フレーム (requestAnimationFrame相当) 呼ばれます。
     * @param deltaTime 前フレームからの経過時間 (ms)
     */
    update(_deltaTime: number): void {}

    /**
     * コンポーネントが破棄されるタイミングで呼ばれます。
     * リソースの解放などをここで行います。
     */
    destroy(): void {}

    // ============================================
    // イベントフック
    // ============================================

    /**
     * ユーザーがワールドに入室したとき呼ばれます。
     */
    onPlayerJoined(_user: User): void {}

    /**
     * ユーザーがワールドから退室したとき呼ばれます。
     */
    onPlayerLeft(_userId: string): void {}

    /**
     * 他のユーザーのカーソルが移動したとき呼ばれます。
     */
    onPlayerCursorMoved(_userId: string, _position: CursorPosition): void {}

    /**
     * 購読中のエンティティが更新されたとき呼ばれます。
     * ※ `Ubi.scene.subscribeEntity()` で購読したエンティティのみ対象
     */
    onEntityUpdated(_entity: WorldEntity): void {}

    /**
     * 汎用カスタムイベントを受信したとき呼ばれます。
     * ホスト側からの情報の受け渡し（例：マウスイベントなど）に使用します。
     *
     * @param eventType イベント名
     * @param data      ペイロード
     */
    onCustomEvent(_eventType: string, _data: unknown): void {}
}
