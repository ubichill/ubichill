/**
 * SettingsPanel — Avatar 設定パネルの純レンダー関数。
 *
 * state と actions を受け取り VNode を返すだけ (副作用なし)。
 * テスト時は state を mock するだけで snapshot を取れる。
 */

import type { AppAvatarDef } from '@ubichill/sdk';
import type { JSX } from '@ubichill/sdk/jsx-runtime';
import { cssToState } from '../cssToState';

interface TemplateEntry {
    id: string;
    name: string;
    directory: string;
    mappings: Partial<Record<string, string>>;
}

export interface SettingsPanelState {
    templates: TemplateEntry[];
    currentTemplateId: string | null;
    pendingTemplateId: string | null;
    thumbnailUrls: Record<string, string>;
    cursorStyle: string;
    avatar: AppAvatarDef;
}

export interface SettingsPanelActions {
    onApplyTemplate(id: string): void;
    onResetToDefault(): void;
    onCursorImageUrlChange(stateKey: string, url: string): void;
}

export function renderSettingsPanel(state: SettingsPanelState, actions: SettingsPanelActions): JSX.Element {
    const cursorState = cssToState(state.cursorStyle);
    const currentStateDef =
        state.avatar.states[cursorState as keyof typeof state.avatar.states] ?? state.avatar.states.default;

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

            {state.templates.length === 0 ? (
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
                    {state.templates.map((t) => {
                        const isSelected = state.currentTemplateId === t.id;
                        const isLoading = state.pendingTemplateId === t.id;
                        const hostThumb = state.thumbnailUrls[t.id] ?? '';
                        const thumbUrl =
                            isSelected && !isLoading ? (state.avatar.states?.default?.url ?? hostThumb) : hostThumb;

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
                                onUbiClick={() => actions.onApplyTemplate(t.id)}
                            >
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

            {state.currentTemplateId !== null && (
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
                    onUbiClick={actions.onResetToDefault}
                >
                    デフォルトに戻す
                </button>
            )}

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
                        onUbiInput={(value: unknown) => actions.onCursorImageUrlChange(cursorState, String(value))}
                    />
                </div>
            </details>
        </div>
    );
}
