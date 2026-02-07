'use client';

import { memo, useEffect, useState } from 'react';
import { processAniFile, processCurFile } from '../../utils/cursorProcessor';
import type { ParsedTemplate } from '../../utils/loader';

const getBaseUrl = () => {
    if (typeof window !== 'undefined') return window.location.origin;
    return '';
};

interface TemplateCardProps {
    template: ParsedTemplate;
    onSelect: (template: ParsedTemplate) => void;
    disabled?: boolean;
}

export const TemplateCard: React.FC<TemplateCardProps> = memo(({ template, onSelect, disabled }) => {
    const [thumbnailUrl, setThumbnailUrl] = useState<string>('');

    useEffect(() => {
        const loadThumbnail = async () => {
            // サムネイル画像を取得(defaultまたはimageフィールドから)
            const imageUrl = template.image || template.mappings?.default;
            if (!imageUrl) {
                console.warn('[TemplateCard] No image URL found for template:', template.name);
                return;
            }

            const fullUrl = imageUrl.startsWith('http') ? imageUrl : `${getBaseUrl()}${imageUrl}`;
            const ext = imageUrl.split('.').pop()?.toLowerCase();

            console.log('[TemplateCard] Loading thumbnail:', { name: template.name, fullUrl, ext });

            try {
                // ANI/CURファイルの場合は変換処理が必要
                if (ext === 'ani' || ext === 'cur') {
                    const res = await fetch(fullUrl);
                    if (!res.ok) {
                        throw new Error(`Failed to fetch thumbnail: ${res.status}`);
                    }
                    const buffer = await res.arrayBuffer();

                    let resultUrl = '';
                    if (ext === 'cur') {
                        const processed = await processCurFile(buffer);
                        resultUrl = processed.url;
                    } else if (ext === 'ani') {
                        const processed = await processAniFile(buffer);
                        resultUrl = processed.url;
                    }
                    if (resultUrl) {
                        console.log('[TemplateCard] Thumbnail loaded successfully:', template.name);
                        setThumbnailUrl(resultUrl);
                    }
                } else {
                    // 通常の画像ファイルはそのまま使用
                    setThumbnailUrl(fullUrl);
                }
            } catch (e) {
                console.error('[TemplateCard] Failed to load thumbnail for', template.name, e);
            }
        };

        loadThumbnail();
    }, [template]);

    return (
        <button
            type="button"
            onClick={() => onSelect(template)}
            disabled={disabled}
            style={{
                padding: '12px',
                backgroundColor: 'white',
                border: '2px solid #e9ecef',
                borderRadius: '12px',
                cursor: disabled ? 'wait' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s',
                opacity: disabled ? 0.6 : 1,
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
            }}
            onMouseEnter={(e) => {
                if (!disabled) {
                    e.currentTarget.style.borderColor = '#228be6';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
                }
            }}
            onMouseLeave={(e) => {
                if (!disabled) {
                    e.currentTarget.style.borderColor = '#e9ecef';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
                }
            }}
        >
            {thumbnailUrl ? (
                <img
                    src={thumbnailUrl}
                    alt={template.name}
                    style={{
                        width: '48px',
                        height: '48px',
                        objectFit: 'contain',
                    }}
                />
            ) : (
                <div
                    style={{
                        width: '48px',
                        height: '48px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: '#f1f3f5',
                        borderRadius: '8px',
                        fontSize: '24px',
                    }}
                >
                    🖱️
                </div>
            )}
            <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#212529' }}>{template.name}</div>
                {template.description && (
                    <div style={{ fontSize: '11px', color: '#868e96', marginTop: '2px' }}>{template.description}</div>
                )}
            </div>
        </button>
    );
});

TemplateCard.displayName = 'TemplateCard';
