'use client';

import type { AppAvatarDef, CursorState } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { bufferToDataUrl, processAniFile, processCurFile } from '../../utils/cursorProcessor';
import { applyTemplate, loadAvatarIndex, type ParsedTemplate } from '../../utils/loader';
import { AdvancedSettings } from './AdvancedSettings';
import { TemplateCard } from './TemplateCard';

const getBaseUrl = () => {
    if (typeof window !== 'undefined') return window.location.origin;
    return '';
};

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

interface CursorMenuProps {
    avatar: AppAvatarDef;
    onAvatarChange: (avatar: AppAvatarDef) => void;
}

export const CursorMenu: React.FC<CursorMenuProps> = ({ avatar, onAvatarChange }) => {
    const [templates, setTemplates] = useState<ParsedTemplate[]>([]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [selectedState, setSelectedState] = useState<CursorState>('default');
    const [urlInput, setUrlInput] = useState('');
    const [isConverting, setIsConverting] = useState(false);

    // YAMLテンプレートを読み込む
    useEffect(() => {
        loadAvatarIndex('/avatar-content/index.yaml')
            .then((loaded) => {
                console.log('[CursorMenu] Loaded YAML templates:', loaded);
                setTemplates(loaded);
            })
            .catch((err) => {
                console.error('[CursorMenu] Failed to load YAML templates:', err);
                console.log('[CursorMenu] Falling back to manual template definitions');
                // フォールバック: 手動で定義されたテンプレート
                setTemplates([
                    {
                        id: 'suisei',
                        name: 'Suisei',
                        mappings: {
                            default: '/templates/suisei/normal_select.ani',
                            pointer: '/templates/suisei/link_select.ani',
                            text: '/templates/suisei/text_select.ani',
                            wait: '/templates/suisei/busy.ani',
                            help: '/templates/suisei/normal_select.ani',
                            'not-allowed': '/templates/suisei/normal_select.ani',
                            move: '/templates/suisei/normal_select.ani',
                            grabbing: '/templates/suisei/normal_select.ani',
                        },
                    },
                    {
                        id: 'amongus',
                        name: 'Among Us',
                        mappings: {
                            default: '/templates/amongus/normal_select.ani',
                            pointer: '/templates/amongus/link_select.ani',
                            text: '/templates/amongus/text_select.ani',
                            wait: '/templates/amongus/busy.ani',
                            help: '/templates/amongus/normal_select.ani',
                            'not-allowed': '/templates/amongus/normal_select.ani',
                            move: '/templates/amongus/normal_select.ani',
                            grabbing: '/templates/amongus/normal_select.ani',
                        },
                    },
                    {
                        id: 'spiki',
                        name: 'Spiki',
                        mappings: {
                            default: '/templates/spiki/normal_select.ani',
                            pointer: '/templates/spiki/link_select.ani',
                            text: '/templates/spiki/text_select.ani',
                            wait: '/templates/spiki/busy.ani',
                            help: '/templates/spiki/help.ani',
                            'not-allowed': '/templates/spiki/unavailable.ani',
                            move: '/templates/spiki/move.ani',
                            grabbing: '/templates/spiki/move.ani',
                        },
                    },
                ]);
            });
    }, []);

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

    const handleTemplateSelect = async (template: ParsedTemplate) => {
        if (!confirm(`テンプレート "${template.name}" を適用しますか？\n現在の設定は上書きされます。`)) {
            return;
        }

        setIsConverting(true);
        const newStates = { ...avatar.states };

        try {
            const mappings = applyTemplate(template);

            for (const state of AVAILABLE_STATES) {
                const fileUrl = mappings[state];
                if (!fileUrl) continue;

                const fullUrl = fileUrl.startsWith('http') ? fileUrl : `${getBaseUrl()}${fileUrl}`;
                try {
                    const res = await fetch(fullUrl);
                    if (!res.ok) throw new Error(`Failed to fetch ${fullUrl}`);
                    const buffer = await res.arrayBuffer();
                    const ext = fileUrl.split('.').pop()?.toLowerCase();

                    let resultUrl = '';
                    let hotspot = { x: 0, y: 0 };

                    if (ext === 'cur') {
                        const processed = await processCurFile(buffer);
                        resultUrl = processed.url;
                        hotspot = processed.hotspot;
                    } else if (ext === 'ani') {
                        const processed = await processAniFile(buffer);
                        resultUrl = processed.url;
                        hotspot = processed.hotspot;
                    } else {
                        // 通常の画像ファイル
                        resultUrl = bufferToDataUrl(buffer, 'image/png');
                    }

                    if (resultUrl) {
                        newStates[state] = { url: resultUrl, hotspot };
                    }
                } catch (e) {
                    console.warn(`Failed to load template file for ${state}:`, e);
                }
            }

            onAvatarChange({
                ...avatar,
                states: newStates,
            });
        } catch (error) {
            console.error('Template application failed:', error);
            alert('テンプレートの適用中にエラーが発生しました。');
        } finally {
            setIsConverting(false);
        }
    };

    const handleUrlSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (urlInput.trim()) {
            updateAvatarState(selectedState, { url: urlInput.trim() });
            setUrlInput('');
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsConverting(true);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const ext = file.name.split('.').pop()?.toLowerCase();

            let resultUrl = '';
            let hotspot = { x: 0, y: 0 };

            if (ext === 'cur') {
                const res = await processCurFile(arrayBuffer);
                resultUrl = res.url;
                hotspot = res.hotspot;
            } else if (ext === 'ani') {
                const res = await processAniFile(arrayBuffer);
                resultUrl = res.url;
                hotspot = res.hotspot;
            } else {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const result = event.target?.result as string;
                    if (result) {
                        updateAvatarState(selectedState, { url: result, hotspot: { x: 0, y: 0 } });
                    }
                };
                reader.readAsDataURL(file);
                setIsConverting(false);
                return;
            }

            if (resultUrl) {
                updateAvatarState(selectedState, { url: resultUrl, hotspot });
            }
        } catch (error) {
            console.error('Failed to convert cursor file:', error);
            alert('カーソルファイルの処理に失敗しました。');
        } finally {
            setIsConverting(false);
        }
    };

    const handleClear = () => {
        updateAvatarState(selectedState, { url: '' });
        setUrlInput('');
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* テンプレート選択 (常に表示) */}
            <div
                style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    padding: '16px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                }}
            >
                <div
                    style={{
                        marginBottom: '12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: '#212529' }}>
                        カーソルテンプレート
                    </h3>
                    <button
                        type="button"
                        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        style={{
                            padding: '6px 12px',
                            backgroundColor: isSettingsOpen ? '#228be6' : '#f8f9fa',
                            color: isSettingsOpen ? 'white' : '#495057',
                            border: '1px solid #dee2e6',
                            borderRadius: '6px',
                            fontSize: '13px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                        }}
                    >
                        ⚙️ 詳細設定
                    </button>
                </div>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                        gap: '12px',
                    }}
                >
                    {templates.map((template) => (
                        <TemplateCard
                            key={template.id}
                            template={template}
                            onSelect={handleTemplateSelect}
                            disabled={isConverting}
                        />
                    ))}
                </div>

                {isConverting && (
                    <div
                        style={{
                            marginTop: '12px',
                            padding: '8px',
                            backgroundColor: '#e7f5ff',
                            borderRadius: '6px',
                            fontSize: '13px',
                            color: '#1971c2',
                            textAlign: 'center',
                        }}
                    >
                        🔄 テンプレートを適用中...
                    </div>
                )}
            </div>

            {/* 詳細設定パネル */}
            {isSettingsOpen && (
                <AdvancedSettings
                    avatar={avatar}
                    selectedState={selectedState}
                    urlInput={urlInput}
                    isConverting={isConverting}
                    onSelectedStateChange={setSelectedState}
                    onUrlInputChange={setUrlInput}
                    onUrlSubmit={handleUrlSubmit}
                    onFileUpload={handleFileUpload}
                    onClear={handleClear}
                    onAvatarChange={onAvatarChange}
                />
            )}
        </div>
    );
};
