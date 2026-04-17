/**
 * Avatar Settings Worker — テンプレート読み込み・設定パネル担当。
 *
 * singleton: true のため毎ユーザー1インスタンス起動。
 * 起動時に avatar:settings 世界エンティティの transform.z を読み込み、
 * 設定パネルの CSS zIndex に反映する。
 */

import { settings } from './state';
import { AvatarSettingsSystem } from './systems/AvatarSettingsSystem';

// ワールドエンティティから zIndex を取得（avatar:settings エンティティの transform.z）
void (async () => {
    try {
        const entities = await Ubi.world.queryEntities('avatar:settings');
        if (entities.length > 0) {
            settings.zIndex = entities[0].transform.z;
            Ubi.log(`[Avatar Settings] zIndex: ${entities[0].transform.z}`, 'info');
        }
    } catch {
        // 失敗時はデフォルト値 (9998) を使用
    }
})();

Ubi.registerSystem(AvatarSettingsSystem);

Ubi.log('initialized', 'info');
