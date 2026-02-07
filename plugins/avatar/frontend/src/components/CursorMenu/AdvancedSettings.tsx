'use client';

import type { AppAvatarDef, CursorState } from '@ubichill/shared';
import { useRef } from 'react';
import styles from './AdvancedSettings.module.css';

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
        <div className={styles.container}>
            <h4 className={styles.title}>詳細設定</h4>

            <select
                value={selectedState}
                onChange={(e) => onSelectedStateChange(e.target.value as CursorState)}
                className={styles.stateSelect}
            >
                {AVAILABLE_STATES.map((state) => (
                    <option key={state} value={state}>
                        {state} {avatar.states[state]?.url ? '✓' : ''}
                    </option>
                ))}
            </select>

            <form onSubmit={onUrlSubmit} className={styles.urlForm}>
                <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => onUrlInputChange(e.target.value)}
                    placeholder="画像URLを入力..."
                    className={styles.urlInput}
                />
                <button type="submit" disabled={!urlInput.trim()} className={styles.submitButton}>
                    適用
                </button>
            </form>

            <div className={styles.hotspotGrid}>
                <label className={styles.hotspotLabel}>
                    ホットスポット X
                    <input
                        type="number"
                        value={currentStateDef.hotspot.x}
                        onChange={(e) =>
                            updateAvatarState(selectedState, {
                                hotspot: { ...currentStateDef.hotspot, x: Number(e.target.value) },
                            })
                        }
                        className={styles.hotspotInput}
                    />
                </label>
                <label className={styles.hotspotLabel}>
                    ホットスポット Y
                    <input
                        type="number"
                        value={currentStateDef.hotspot.y}
                        onChange={(e) =>
                            updateAvatarState(selectedState, {
                                hotspot: { ...currentStateDef.hotspot, y: Number(e.target.value) },
                            })
                        }
                        className={styles.hotspotInput}
                    />
                </label>
            </div>

            <div className={styles.divider} />

            <input
                type="file"
                ref={fileInputRef}
                onChange={onFileUpload}
                accept="image/*,.cur,.ani"
                className={styles.fileInput}
            />
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isConverting}
                className={styles.uploadButton}
            >
                📁 ファイルをアップロード (.png, .jpg, .cur, .ani)
            </button>

            {currentStateDef.url && (
                <button type="button" onClick={onClear} className={styles.clearButton}>
                    🗑️ リセット
                </button>
            )}
        </div>
    );
};
