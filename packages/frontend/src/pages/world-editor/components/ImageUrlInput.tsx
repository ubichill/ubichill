import { useId, useRef, useState } from 'react';
import { uploadWorldAsset } from '@/lib/worlds/worldAssetsApi';
import { css } from '@/styled-system/css';
import { inputStyle } from './inspector/shared';

/**
 * 画像の URL の欄。「画像を上げる」で、このサーバーに画像を上げて URL を入れる（外のサイトの画像なら URL を直接入れる）。
 */
export function ImageUrlInput({
    value,
    onChange,
    name,
    label,
    placeholder = 'https://...',
}: {
    value: string;
    onChange: (next: string) => void;
    name?: string;
    /** URL の欄の名前（見出しが欄と結ばれていないとき） */
    label?: string;
    placeholder?: string;
}) {
    const fileInput = useRef<HTMLInputElement>(null);
    const errorId = useId();
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const upload = async (file: File) => {
        setUploading(true);
        setError(null);
        try {
            onChange((await uploadWorldAsset(file)).url);
        } catch (e) {
            setError(e instanceof Error ? e.message : '画像を上げられませんでした');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '1.5', w: 'full' })}>
            <div className={css({ display: 'flex', gap: '2', alignItems: 'center' })}>
                <input
                    type="url"
                    name={name}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    aria-label={label}
                    aria-invalid={error !== null}
                    aria-describedby={error ? errorId : undefined}
                    className={inputStyle}
                />
                <button
                    type="button"
                    className={uploadButton}
                    disabled={uploading}
                    onClick={() => fileInput.current?.click()}
                >
                    {uploading ? '上げています...' : '画像を上げる'}
                </button>
                <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                    hidden
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void upload(file);
                    }}
                />
            </div>
            {error && (
                <p id={errorId} role="alert" className={css({ fontSize: '12px', color: 'errorText' })}>
                    {error}
                </p>
            )}
        </div>
    );
}

const uploadButton = css({
    flexShrink: 0,
    px: '3',
    py: '1.5',
    fontSize: '12px',
    fontWeight: '600',
    color: 'text',
    bg: 'background',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover' },
    _disabled: { opacity: 0.6, cursor: 'wait' },
});
