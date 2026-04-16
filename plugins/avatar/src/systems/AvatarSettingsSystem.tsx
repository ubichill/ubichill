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
    setSettingsDirty,
    setTemplates,
    setTemplatesLoaded,
    settingsDirty,
    templatesLoaded,
    thumbnailUrls,
} from '../state';
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
            const user = event.payload as { id: string; avatar?: AppAvatarDef };
            if (user.id === myUserId && user.avatar) {
                setLocalAvatar(user.avatar);
                setSettingsDirty(true);
                if (currentTemplateId !== null) {
                    clearPendingTemplate(currentTemplateId);
                }
            }
        }
    }

    if (settingsDirty) {
        setSettingsDirty(false);
        Ubi.ui.render(() => <SettingsPanel />, 'settings');
    }
};
