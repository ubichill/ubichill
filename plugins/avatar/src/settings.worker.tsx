/**
 * avatar:settings Worker — テンプレート読み込み + 設定パネル描画。
 *
 * singleton: true。状態は Ubi.state で宣言的に保持し、変化は onChange で再描画。
 */

import type { AppAvatarDef, RpcNetFetchResult } from '@ubichill/sdk';
import { AvatarEvents } from './events';
import { renderSettingsPanel, type SettingsPanelActions, type SettingsPanelState } from './ui/SettingsPanel';

interface TemplateEntry {
    id: string;
    name: string;
    directory: string;
    mappings: Partial<Record<string, string>>;
}

const DEFAULT_Z = 9998;

const settings = Ubi.state.define({
    templates: [] as TemplateEntry[],
    currentTemplateId: null as string | null,
    pendingTemplateId: null as string | null,
    templatesLoaded: false,
    thumbnailUrls: {} as Record<string, string>,
    cursorStyle: 'default',
    avatar: { states: {} } as AppAvatarDef,
    zIndex: DEFAULT_Z,
});

// ── 自エンティティの zIndex を読む ──
void (async () => {
    const [self] = await Ubi.entity.query('avatar:settings');
    if (self) settings.local.zIndex = self.transform.z;
})();

// ── テンプレート初期ロード (1 回だけ) ──
async function initTemplates(): Promise<void> {
    if (settings.local.templatesLoaded) return;
    settings.local.templatesLoaded = true;
    const result = (await Ubi.fetch(`${Ubi.pluginBase}/templates/manifest.json`)) as RpcNetFetchResult;
    if (!result.ok) {
        Ubi.log(`テンプレート取得失敗 (${result.status})`, 'error');
        return;
    }
    const data = JSON.parse(result.body) as TemplateEntry[];
    settings.local.templates = data;

    // サムネイル用バージョン付き URL をまとめて Host に送る
    const thumbnailFiles = data
        .filter((t) => !!t.mappings.default)
        .map((t) => ({
            id: t.id,
            url: `${Ubi.pluginBase}/templates/${t.directory}/${t.mappings.default as string}`,
        }));
    AvatarEvents.sendToHost('avatar:initThumbnails', { thumbnailFiles });
}

// ── アクション ──
const actions: SettingsPanelActions = {
    onApplyTemplate(id) {
        if (settings.local.pendingTemplateId === id) return;
        const template = settings.local.templates.find((t) => t.id === id);
        if (!template) return;
        settings.batch(() => {
            settings.local.pendingTemplateId = id;
            settings.local.currentTemplateId = id;
        });
        const files = (Object.entries(template.mappings) as [string, string | undefined][])
            .filter((entry): entry is [string, string] => !!entry[1])
            .map(([state, filename]) => ({
                state,
                url: `${Ubi.pluginBase}/templates/${template.directory}/${filename}`,
            }));
        AvatarEvents.sendToHost('avatar:applyTemplate', { files });
        // ホスト側完了通知が無い経路もあるため一定時間で解除しリトライを許可する
        setTimeout(() => {
            if (settings.local.pendingTemplateId === id) settings.local.pendingTemplateId = null;
        }, 10_000);
    },
    onResetToDefault() {
        if (settings.local.pendingTemplateId !== null) return;
        settings.batch(() => {
            settings.local.currentTemplateId = null;
            settings.local.avatar = { states: {} };
        });
        AvatarEvents.sendToHost('avatar:resetTemplate', {});
    },
    onCursorImageUrlChange(stateKey, url) {
        const cur = settings.local.avatar.states[stateKey as keyof typeof settings.local.avatar.states];
        const hotspot = cur?.hotspot ?? { x: 0, y: 0 };
        const next: AppAvatarDef = {
            ...settings.local.avatar,
            states: { ...settings.local.avatar.states, [stateKey]: { url, hotspot } },
        };
        settings.local.avatar = next;
        AvatarEvents.sendToHost('user:update', { avatar: next });
    },
};

function render(): void {
    const view: SettingsPanelState = {
        templates: settings.local.templates,
        currentTemplateId: settings.local.currentTemplateId,
        pendingTemplateId: settings.local.pendingTemplateId,
        thumbnailUrls: settings.local.thumbnailUrls,
        cursorStyle: settings.local.cursorStyle,
        avatar: settings.local.avatar,
    };
    Ubi.ui.render(() => renderSettingsPanel(view, actions), 'settings');
}

settings.onChange('templates', render);
settings.onChange('currentTemplateId', render);
settings.onChange('pendingTemplateId', render);
settings.onChange('thumbnailUrls', render);
settings.onChange('cursorStyle', render);
settings.onChange('avatar', render);

// ── イベント受信 ──
AvatarEvents.on('input:cursor_style', ({ style }) => {
    if (style !== settings.local.cursorStyle) settings.local.cursorStyle = style;
});
AvatarEvents.on('avatar:thumbnails', ({ thumbnails }) => {
    settings.local.thumbnailUrls = { ...settings.local.thumbnailUrls, ...thumbnails };
});
AvatarEvents.on('player:joined', (user) => {
    if (user.id === Ubi.myUserId && user.avatar) {
        settings.local.avatar = user.avatar;
        // テンプレート適用が反映されたら pending を解除
        if (settings.local.pendingTemplateId !== null) settings.local.pendingTemplateId = null;
    }
});

// テンプレート初回ロード (initTemplates 内で重複防止)
void initTemplates();

// 初回レンダー (テンプレ未ロードでも枠は出る)
render();
