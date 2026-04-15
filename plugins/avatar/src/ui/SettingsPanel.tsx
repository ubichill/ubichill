import {
    currentTemplateId,
    localAvatar,
    localCursorStyle,
    setCurrentTemplateId,
    setLocalAvatar,
    setSettingsDirty,
    templates,
    thumbnailUrls,
} from '../state';
import { cssToState } from '../systems/utils';

/** 適用中テンプレート ID（ホスト側の読み込み完了前に重複クリックをブロック） */
let _pendingTemplateId: string | null = null;

function resetToDefault(): void {
    if (_pendingTemplateId !== null) return;
    setCurrentTemplateId(null);
    setLocalAvatar({ states: {} });
    setSettingsDirty(true);
    Ubi.network.sendToHost('avatar:resetTemplate', {});
}

function applyTemplate(templateId: string): void {
    if (_pendingTemplateId === templateId) return; // 連打を無視
    _pendingTemplateId = templateId;
    setCurrentTemplateId(templateId);
    setSettingsDirty(true);
    Ubi.network.sendToHost('avatar:applyTemplate', { templateId });
    // ホスト側の完了通知がないため、一定時間後に解除してリトライを許可する
    setTimeout(() => {
        if (_pendingTemplateId === templateId) {
            _pendingTemplateId = null;
            setSettingsDirty(true);
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
        setSettingsDirty(true);
    }
}

export const SettingsPanel = () => {
    const cursorState = cssToState(localCursorStyle);
    const currentStateDef =
        localAvatar.states[cursorState as keyof typeof localAvatar.states] ?? localAvatar.states.default;

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
            {templates.length === 0 ? (
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
                    {templates.map((t) => {
                        const isSelected = currentTemplateId === t.id;
                        const isLoading = _pendingTemplateId === t.id;
                        // 選択済み＋ロード完了: 変換済みdata URL（ANI対応）
                        // それ以外: マニフェストの直接パス（PNG/SVGのみ表示可、ANIはフォールバック）
                        // ホストから事前変換済みURL（ANI含む全形式対応）を優先
                        const hostThumb = thumbnailUrls.get(t.id) ?? '';
                        const thumbUrl =
                            isSelected && !isLoading ? (localAvatar.states?.default?.url ?? hostThumb) : hostThumb;

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
            {currentTemplateId !== null && (
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
                            setLocalAvatar({
                                ...localAvatar,
                                states: {
                                    ...localAvatar.states,
                                    [cursorState]: { url, hotspot },
                                },
                            });
                            Ubi.network.sendToHost('user:update', { avatar: localAvatar });
                        }}
                    />
                </div>
            </details>
        </div>
    );
};
