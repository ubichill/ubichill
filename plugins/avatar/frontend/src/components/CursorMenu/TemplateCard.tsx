import { memo, useEffect, useState } from 'react';
import { processAniFile, processCurFile } from '../../utils/cursorProcessor';
import type { ParsedTemplate } from '../../utils/loader';
import styles from './TemplateCard.module.css';

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
        <button type="button" onClick={() => onSelect(template)} disabled={disabled} className={styles.card}>
            {thumbnailUrl ? (
                <img src={thumbnailUrl} alt={template.name} className={styles.thumbnail} />
            ) : (
                <div className={styles.placeholder}>🖱️</div>
            )}
            <div className={styles.info}>
                <div className={styles.name}>{template.name}</div>
                {template.description && <div className={styles.description}>{template.description}</div>}
            </div>
        </button>
    );
});

TemplateCard.displayName = 'TemplateCard';
