/**
 * AvatarSettingsSystem — テンプレート読み込み・設定パネル描画を担当。
 *
 * avatar:settings エンティティの transform.z が設定パネルの CSS zIndex として使われる。
 * settings.worker.tsx にのみ登録される。
 */

import type { AppAvatarDef, Entity, System, WorkerEvent } from '@ubichill/sdk';
import { EcsEventType } from '@ubichill/sdk';
import type { TemplateEntry } from '../state';
import {
    currentTemplateId,
    localCursorStyle,
    setLocalAvatar,
    setLocalCursorStyle,
    setLocalStatus,
    setSettingsDirty,
    setTemplates,
    setTemplatesLoaded,
    settingsDirty,
    templatesLoaded,
    thumbnailUrls,
} from '../state';
import type { UserStatus } from '../types';
import { clearPendingTemplate, SettingsPanel } from '../ui/SettingsPanel';

export async function initTemplates(): Promise<void> {
    if (templatesLoaded) return;
    setTemplatesLoaded(true);
    try {
        const result = (await Ubi.network.fetch('/plugins/avatar/templates/manifest.json')) as {
            ok: boolean;
            body: string;
        };
        if (result.ok) {
            const data = JSON.parse(result.body) as TemplateEntry[];
            setTemplates(data);
            setSettingsDirty(true);
            // ホストにサムネイル変換を依頼（ANI → data URL 等）
            Ubi.network.sendToHost('avatar:initThumbnails', {});
        }
    } catch {
        // テンプレート読み込み失敗は無視
    }
}

export const AvatarSettingsSystem: System = (_entities: Entity[], _deltaTime: number, events: WorkerEvent[]) => {
    void initTemplates();
    const myUserId = Ubi.myUserId;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
            const d = event.payload as { cursorStyle?: string };
            if (d.cursorStyle && d.cursorStyle !== localCursorStyle) {
                setLocalCursorStyle(d.cursorStyle);
                setSettingsDirty(true);
            }
        }

        if (event.type === EcsEventType.HOST_MESSAGE) {
            const msg = event.payload as { type: string; payload: unknown };
            if (msg.type === 'avatar:thumbnails') {
                const { thumbnails } = msg.payload as { thumbnails: Record<string, string> };
                for (const [id, url] of Object.entries(thumbnails)) {
                    thumbnailUrls.set(id, url);
                }
                setSettingsDirty(true);
            }
        }

        if (event.type === EcsEventType.PLAYER_JOINED) {
            const user = event.payload as {
                id: string;
                status: UserStatus;
                avatar?: AppAvatarDef;
            };
            if (user.id === myUserId) {
                if (user.status) setLocalStatus(user.status);
                if (user.avatar) {
                    setLocalAvatar(user.avatar);
                    setSettingsDirty(true);
                    // テンプレート適用完了 → ローディング状態を解除
                    if (currentTemplateId !== null) {
                        clearPendingTemplate(currentTemplateId);
                    }
                }
            }
        }
    }

    // 設定パネル: 状態変化時のみ再描画
    if (settingsDirty) {
        setSettingsDirty(false);
        Ubi.ui.render(() => <SettingsPanel />, 'settings');
    }
};

// SettingsPanel で使う changeStatus 相当（設定ワーカーのみ）
export function changeStatus(newStatus: UserStatus): void {
    setLocalStatus(newStatus);
    Ubi.network.sendToHost('user:update', { status: newStatus, isMenuOpen: false });
}
