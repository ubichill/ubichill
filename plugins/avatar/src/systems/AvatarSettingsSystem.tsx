/**
 * AvatarSettingsSystem — テンプレート読み込み・設定パネル描画を担当。
 *
 * avatar:settings エンティティの transform.z が設定パネルの CSS zIndex として使われる。
 * settings.worker.tsx にのみ登録される。
 */

import type { AppAvatarDef, Entity, System, WorkerEvent } from '@ubichill/sdk';
import { EcsEventType } from '@ubichill/sdk';
import type { TemplateEntry } from '../state';
import { DEFAULT_TEMPLATE_ID, settings } from '../state';
import { applyTemplate, clearPendingTemplate, SettingsPanel } from '../ui/SettingsPanel';

export async function initTemplates(): Promise<void> {
    if (settings.templatesLoaded) return;
    settings.templatesLoaded = true;
    try {
        Ubi.log(`[initTemplates] pluginBase: ${Ubi.pluginBase}`, 'info');
        const result = (await Ubi.network.fetch(`${Ubi.pluginBase}/templates/manifest.json`)) as {
            ok: boolean;
            status: number;
            body: string;
        };
        if (!result.ok) {
            Ubi.log(
                `テンプレートマニフェスト取得失敗 (${result.status}): ${Ubi.pluginBase}/templates/manifest.json`,
                'error',
            );
            return;
        }
        const data = JSON.parse(result.body) as TemplateEntry[];
        Ubi.log(`[initTemplates] ${data.length} テンプレート取得`, 'info');
        settings.templates = data;
        settings.dirty = true;

        // サムネイル用バージョン付き URL をまとめて Host に送る（Host 側で ANI/CUR デコード）
        const thumbnailFiles = data
            .filter((t) => !!t.mappings.default)
            .map((t) => ({
                id: t.id,
                url: `${Ubi.pluginBase}/templates/${t.directory}/${t.mappings.default as string}`,
            }));
        Ubi.log(`[initTemplates] サムネイル送信: ${thumbnailFiles.map((f) => f.url).join(', ')}`, 'info');
        Ubi.network.sendToHost('avatar:initThumbnails', { thumbnailFiles });
    } catch (err) {
        Ubi.log(`テンプレート初期化エラー: ${String(err)}`, 'error');
    }
}

function hasAvatarStates(avatar: AppAvatarDef): boolean {
    return Object.keys(avatar.states).length > 0;
}

function maybeApplyDefaultTemplate(): void {
    if (!settings.hasLocalUserSnapshot) return;
    if (settings.defaultTemplateEvaluated) return;
    if (settings.templates.length === 0) return;

    if (hasAvatarStates(settings.avatar)) {
        settings.defaultTemplateEvaluated = true;
        return;
    }

    const hasDefaultTemplate = settings.templates.some((template) => template.id === DEFAULT_TEMPLATE_ID);
    if (!hasDefaultTemplate) {
        settings.defaultTemplateEvaluated = true;
        Ubi.log(`デフォルトテンプレートが見つかりません: ${DEFAULT_TEMPLATE_ID}`, 'error');
        return;
    }

    settings.defaultTemplateEvaluated = true;
    applyTemplate(DEFAULT_TEMPLATE_ID);
}

export const AvatarSettingsSystem: System = (_entities: Entity[], _deltaTime: number, events: WorkerEvent[]) => {
    void initTemplates();
    const myUserId = Ubi.myUserId;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_CURSOR_STYLE) {
            const d = event.payload as { style: string };
            if (d.style !== settings.cursorStyle) {
                settings.cursorStyle = d.style;
                settings.dirty = true;
            }
        }

        if (event.type === EcsEventType.HOST_MESSAGE) {
            const msg = event.payload as { type: string; payload: unknown };
            if (msg.type === 'avatar:thumbnails') {
                const { thumbnails } = msg.payload as { thumbnails: Record<string, string> };
                Ubi.log(`[avatar:thumbnails] 受信: ${Object.keys(thumbnails).length} 件`, 'info');
                for (const [id, url] of Object.entries(thumbnails)) {
                    settings.thumbnailUrls.set(id, url);
                }
                settings.dirty = true;
            }
        }

        if (event.type === EcsEventType.PLAYER_JOINED) {
            const user = event.payload as { id: string; avatar?: AppAvatarDef };
            if (user.id === myUserId) {
                settings.hasLocalUserSnapshot = true;
                settings.avatar = user.avatar ?? { states: {} };
                settings.dirty = true;
                if (settings.currentTemplateId !== null) {
                    clearPendingTemplate(settings.currentTemplateId);
                }
            }
        }
    }

    maybeApplyDefaultTemplate();

    if (settings.dirty) {
        settings.dirty = false;
        Ubi.ui.render(() => <SettingsPanel />, 'settings');
    }
};
