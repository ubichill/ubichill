/**
 * Avatar Cursor Worker — ローカルカーソル・リモートカーソル・絵文字・ラジアルメニュー担当。
 *
 * singleton: true のため毎ユーザー1インスタンス起動。
 * 起動時に avatar:cursor 世界エンティティの transform.z を読み込み、
 * カーソルオーバーレイの CSS zIndex に反映する。
 */

import { cursor, resetCursor } from './state';
import { AvatarCursorSystem } from './systems/AvatarCursorSystem';

resetCursor();

// ワールドエンティティから zIndex を取得（avatar:cursor エンティティの transform.z）
void (async () => {
    try {
        const entities = await Ubi.world.queryEntities('avatar:cursor');
        if (entities.length > 0) {
            cursor.zIndex = entities[0].transform.z;
            Ubi.log(`[Avatar Cursor] zIndex: ${entities[0].transform.z}`, 'info');
        }
    } catch {
        // 失敗時はデフォルト値 (10100) を使用
    }
})();

Ubi.registerSystem(AvatarCursorSystem);

console.log('[Avatar Cursor Worker] Initialized.');
