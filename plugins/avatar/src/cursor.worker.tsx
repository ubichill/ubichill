/**
 * Avatar Cursor Worker — ローカル・リモートカーソル表示を担当。
 * singleton: true のため毎ユーザー1インスタンス起動。
 */

import { AvatarCursorSystem, setZIndex } from './systems/AvatarCursorSystem';

// 位置同期を SDK に委譲（スロットリング・スクロール補正・broadcast を自動処理）
Ubi.presence.syncPosition({ throttleMs: 50 });

// ワールドエンティティから zIndex を取得（avatar:cursor エンティティの transform.z）
void (async () => {
    try {
        const entities = await Ubi.world.queryEntities('avatar:cursor');
        if (entities.length > 0) {
            setZIndex(entities[0].transform.z);
            Ubi.log(`[Avatar Cursor] zIndex: ${entities[0].transform.z}`, 'info');
        }
    } catch {
        // 失敗時はデフォルト値 (10100) を使用
    }
})();

Ubi.registerSystem(AvatarCursorSystem);

Ubi.log('initialized', 'info');
