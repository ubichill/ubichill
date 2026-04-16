import { settings } from '../state';
import { cssToState } from '../systems/utils';

/** 適用中テンプレート ID（ホスト側の読み込み完了前に重複クリックをブロック） */
let _pendingTemplateId: string | null = null;

function resetToDefault(): void {
    if (_pendingTemplateId !== null) return;
    settings.currentTemplateId = null;
    settings.avatar = { states: {} };
    settings.dirty = true;
    Ubi.network.sendToHost('avatar:resetTemplate', {});
}

function applyTemplate(templateId: string): void {
    if (_pendingTemplateId === templateId) return; // 連打を無視
    const template = settings.templates.find((t) => t.id === templateId);
    if (!template) return;
    _pendingTemplateId = templateId;
    settings.currentTemplateId = templateId;
    settings.dirty = true;
    // バージョン付き URL を組み立てて Host に送る（Host 側で ANI/CUR デコード）
    const files = (Object.entries(template.mappings) as [string, string | undefined][])
        .filter((entry): entry is [string, string] => !!entry[1])
        .map(([state, filename]) => ({
            state,
            url: `${Ubi.pluginBase}/templates/${template.directory}/${filename}`,
        }));
    Ubi.log(`[applyTemplate] ${templateId}: ${files.map((f) => `${f.state}=${f.url}`).join(', ')}`, 'info');
    Ubi.network.sendToHost('avatar:applyTemplate', { files });
    // ホスト側の完了通知がないため、一定時間後に解除してリトライを許可する
    setTimeout(() => {
        if (_pendingTemplateId === templateId) {
            _pendingTemplateId = null;
            settings.dirty = true;
        }
    }, 10_000);
}

/**
 * ホスト側でテンプレート適用が完了したとき（avatar が更新されたとき）に呼ぶ。
 * AvatarSettingsSystem が PLAYER_JOINED でローカルアバターを更新した後に呼び出す。
 */
export function clearPendingTemplate(templateId: string): void {
    if (_pendingTemplateId === templateId) {
        _pendingTemplateId = null;
        settings.dirty = true;
    }
}

export const SettingsPanel = () => {
    const cursorState = cssToState(settings.cursorStyle);
    const currentStateDef =
        settings.avatar.states[cursorState as keyof typeof settings.avatar.states] ?? settings.avatar.states.default;

    return (
        <div
            style={{
                width: '280px',
                pointerEvents: 'auto',
                background: 'white',
                borderRadius: '16px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                padding: '16px',
                fontFamily: 'sans-serif',
                fontSize: '13px',
                color: '#212529',
            }}
        >
            {/* ヘッダー */}
            <div
                style={{
                    fontWeight: 'bold',
                    marginBottom: '12px',
                    fontSize: '14px',
                    color: '#1c7ed6',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                }}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4 0 20 12l-7 1-4 8z" />
                </svg>
                カーソルテーマ
            </div>

            {/* テンプレートカードグリッド */}
            {settings.templates.length === 0 ? (
                <div style={{ color: '#868e96', fontSize: '12px', textAlign: 'center', padding: '16px 0' }}>
                    テンプレートを読み込み中...
                </div>
            ) : (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '8px',
                        marginBottom: '12px',
                    }}
                >
                    {settings.templates.map((t) => {
                        const isSelected = settings.currentTemplateId === t.id;
                        const isLoading = _pendingTemplateId === t.id;
                        const hostThumb = settings.thumbnailUrls.get(t.id) ?? '';
                        const thumbUrl =
                            isSelected && !isLoading ? (settings.avatar.states?.default?.url ?? hostThumb) : hostThumb;

                        return (
                            <button
                                key={t.id}
                                type="button"
                                style={{
                                    padding: '10px 6px',
                                    border: `2px solid ${isSelected ? '#1c7ed6' : '#dee2e6'}`,
                                    borderRadius: '12px',
                                    background: isSelected ? '#e7f5ff' : '#f8f9fa',
                                    cursor: isLoading ? 'wait' : 'pointer',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '6px',
                                    boxShadow: isSelected ? '0 2px 8px rgba(28,126,214,0.2)' : 'none',
                                    transition: 'all 0.15s',
                                    opacity: isLoading ? 0.6 : 1,
                                }}
                                onUbiClick={() => applyTemplate(t.id)}
                            >
                                {/* サムネイル */}
                                <div
                                    style={{
                                        width: '48px',
                                        height: '48px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        background: thumbUrl ? 'transparent' : '#e9ecef',
                                        borderRadius: '8px',
                                        overflow: 'hidden',
                                    }}
                                >
                                    {isLoading ? (
                                        <svg
                                            width="18"
                                            height="18"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="#1c7ed6"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                        >
                                            <circle cx="12" cy="12" r="10" opacity="0.25" />
                                            <path d="M12 2a10 10 0 0 1 10 10" />
                                        </svg>
                                    ) : thumbUrl ? (
                                        <img
                                            src={thumbUrl}
                                            alt={t.name}
                                            style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                                        />
                                    ) : (
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="#adb5bd">
                                            <path d="M4 0 20 12l-7 1-4 8z" />
                                        </svg>
                                    )}
                                </div>

                                {/* 名前 */}
                                <div
                                    style={{
                                        fontSize: '11px',
                                        fontWeight: isSelected ? 'bold' : 'normal',
                                        color: isSelected ? '#1c7ed6' : '#495057',
                                        textAlign: 'center',
                                    }}
                                >
                                    {t.name}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* デフォルトに戻すボタン */}
            {settings.currentTemplateId !== null && (
                <button
                    type="button"
                    style={{
                        width: '100%',
                        padding: '6px 0',
                        marginBottom: '8px',
                        border: '1px solid #dee2e6',
                        borderRadius: '8px',
                        background: '#f8f9fa',
                        fontSize: '12px',
                        color: '#868e96',
                        cursor: 'pointer',
                    }}
                    onUbiClick={resetToDefault}
                >
                    デフォルトに戻す
                </button>
            )}

            {/* 詳細設定 (折りたたみ) */}
            <details style={{ marginTop: '4px' }}>
                <summary
                    style={{
                        fontSize: '11px',
                        color: '#868e96',
                        cursor: 'pointer',
                        userSelect: 'none',
                    }}
                >
                    詳細設定
                </summary>
                <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#868e96', marginBottom: '4px' }}>状態: {cursorState}</div>
                    {currentStateDef?.url && (
                        <img
                            src={currentStateDef.url}
                            alt="preview"
                            style={{
                                maxWidth: '40px',
                                maxHeight: '40px',
                                border: '1px solid #dee2e6',
                                borderRadius: '4px',
                                marginBottom: '8px',
                                display: 'block',
                            }}
                        />
                    )}
                    <label
                        htmlFor="avatar-cursor-image-url"
                        style={{ fontSize: '11px', color: '#868e96', display: 'block', marginBottom: '4px' }}
                    >
                        カーソル画像 URL
                    </label>
                    <input
                        id="avatar-cursor-image-url"
                        type="text"
                        value={currentStateDef?.url ?? ''}
                        placeholder="https://..."
                        style={{
                            width: '100%',
                            padding: '6px',
                            border: '1px solid #dee2e6',
                            borderRadius: '6px',
                            fontSize: '12px',
                            boxSizing: 'border-box',
                        }}
                        onUbiInput={(value: unknown) => {
                            const url = String(value);
                            const hotspot = currentStateDef?.hotspot ?? { x: 0, y: 0 };
                            settings.avatar = {
                                ...settings.avatar,
                                states: {
                                    ...settings.avatar.states,
                                    [cursorState]: { url, hotspot },
                                },
                            };
                            Ubi.network.sendToHost('user:update', { avatar: settings.avatar });
                        }}
                    />
                </div>
            </details>
        </div>
    );
};
