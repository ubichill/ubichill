'use client';

import type { AppAvatarDef, CursorState } from '@ubichill/shared';
import { useRef } from 'react';

const AVAILABLE_STATES: CursorState[] = [
    'default',
    'pointer',
    'text',
    'wait',
    'help',
    'not-allowed',
    'move',
    'grabbing',
];

interface AdvancedSettingsProps {
    avatar: AppAvatarDef;
    selectedState: CursorState;
    urlInput: string;
    isConverting: boolean;
    onSelectedStateChange: (state: CursorState) => void;
    onUrlInputChange: (url: string) => void;
    onUrlSubmit: (e: React.FormEvent) => void;
    onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onClear: () => void;
    onAvatarChange: (avatar: AppAvatarDef) => void;
}

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
    avatar,
    selectedState,
    urlInput,
    isConverting,
    onSelectedStateChange,
    onUrlInputChange,
    onUrlSubmit,
    onFileUpload,
    onClear,
    onAvatarChange,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const currentStateDef = avatar.states[selectedState] || { url: '', hotspot: { x: 0, y: 0 } };

    const updateAvatarState = (
        state: CursorState,
        patch: Partial<{ url: string; hotspot: { x: number; y: number } }>,
    ) => {
        const current = avatar.states[state] || { url: '', hotspot: { x: 0, y: 0 } };
        const updated = { ...current, ...patch };

        onAvatarChange({
            ...avatar,
            states: {
                ...avatar.states,
                [state]: updated,
            },
        });
    };

    return (
        <div
            style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '16px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
            }}
        >
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#212529' }}>詳細設定</h4>

            <select
                value={selectedState}
                onChange={(e) => onSelectedStateChange(e.target.value as CursorState)}
                style={{
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid #dee2e6',
                    fontSize: '13px',
                }}
            >
                {AVAILABLE_STATES.map((state) => (
                    <option key={state} value={state}>
                        {state} {avatar.states[state]?.url ? '✓' : ''}
                    </option>
                ))}
            </select>

            <form onSubmit={onUrlSubmit} style={{ display: 'flex', gap: '8px' }}>
                <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => onUrlInputChange(e.target.value)}
                    placeholder="画像URLを入力..."
                    style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '6px',
                        border: '1px solid #dee2e6',
                        fontSize: '13px',
                    }}
                />
                <button
                    type="submit"
                    disabled={!urlInput.trim()}
                    style={{
                        padding: '8px 16px',
                        backgroundColor: '#228be6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '13px',
                        cursor: urlInput.trim() ? 'pointer' : 'not-allowed',
                        opacity: urlInput.trim() ? 1 : 0.5,
                    }}
                >
                    適用
                </button>
            </form>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ fontSize: '12px', color: '#495057' }}>
                    ホットスポット X
                    <input
                        type="number"
                        value={currentStateDef.hotspot.x}
                        onChange={(e) =>
                            updateAvatarState(selectedState, {
                                hotspot: { ...currentStateDef.hotspot, x: Number(e.target.value) },
                            })
                        }
                        style={{
                            width: '100%',
                            marginTop: '4px',
                            padding: '6px',
                            border: '1px solid #dee2e6',
                            borderRadius: '4px',
                        }}
                    />
                </label>
                <label style={{ fontSize: '12px', color: '#495057' }}>
                    ホットスポット Y
                    <input
                        type="number"
                        value={currentStateDef.hotspot.y}
                        onChange={(e) =>
                            updateAvatarState(selectedState, {
                                hotspot: { ...currentStateDef.hotspot, y: Number(e.target.value) },
                            })
                        }
                        style={{
                            width: '100%',
                            marginTop: '4px',
                            padding: '6px',
                            border: '1px solid #dee2e6',
                            borderRadius: '4px',
                        }}
                    />
                </label>
            </div>

            <div style={{ height: '1px', backgroundColor: '#e9ecef' }} />

            <input
                type="file"
                ref={fileInputRef}
                onChange={onFileUpload}
                accept="image/*,.cur,.ani"
                style={{ display: 'none' }}
            />
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isConverting}
                style={{
                    padding: '10px',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: isConverting ? 'wait' : 'pointer',
                    color: '#495057',
                }}
            >
                📁 ファイルをアップロード (.png, .jpg, .cur, .ani)
            </button>

            {currentStateDef.url && (
                <button
                    type="button"
                    onClick={onClear}
                    style={{
                        padding: '8px',
                        backgroundColor: 'transparent',
                        color: '#fa5252',
                        border: '1px solid #fa5252',
                        borderRadius: '6px',
                        fontSize: '13px',
                        cursor: 'pointer',
                    }}
                >
                    🗑️ リセット
                </button>
            )}
        </div>
    );
};
