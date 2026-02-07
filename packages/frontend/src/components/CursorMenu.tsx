'use client';

import type { AppAvatarDef, CursorState } from '@ubichill/shared';
import * as ICO from 'icojs';
import { useEffect, useRef, useState, memo } from 'react';
import * as UPNG from 'upng-js';

// --- Constants & Types ---

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

interface TemplateManifest {
    id: string;
    name: string;
    directory: string;
    mappings: Record<string, string>;
}

interface CursorMenuProps {
    avatar: AppAvatarDef;
    onAvatarChange: (avatar: AppAvatarDef) => void;
}

// --- Helper Functions (Pure, defined outside component) ---

const getImageDataFromBuffer = async (
    buffer: ArrayBuffer,
): Promise<{ data: ArrayBuffer; width: number; height: number }> => {
    // ICO/CURパース
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images = await ICO.parseICO(buffer, 'image/png');
    if (!images || images.length === 0) {
        throw new Error('No images found');
    }

    // 最大サイズの画像を検索
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const largestImage = images.sort((a, b) => b.width - a.width)[0];

    return new Promise((resolve, reject) => {
        const img = new Image();
        const blob = new Blob([largestImage.buffer], { type: 'image/png' });
        const objectURL = URL.createObjectURL(blob);
        img.src = objectURL;
        img.onload = () => {
            // Revoke the object URL to prevent memory leak
            URL.revokeObjectURL(objectURL);

            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            resolve({
                data: imageData.data.buffer,
                width: img.width,
                height: img.height,
            });
        };
        img.onerror = () => {
            // Revoke the object URL even on error
            URL.revokeObjectURL(objectURL);
            reject(new Error('Failed to load image for buffer conversion'));
        };
    });
};

const bufferToDataUrl = (buffer: ArrayBuffer | Uint8Array, mimeType: string): string => {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${mimeType};base64,${base64}`;
};

const getHotspotFromCur = (buffer: ArrayBuffer): { x: number; y: number } | null => {
    const view = new DataView(buffer);
    // Header (6 bytes)
    // 0-1: Reserved (0)
    // 2-3: Type (2 = Cursor)
    const type = view.getUint16(2, true);
    if (type !== 2) return null; // Not a cursor

    // Entry (16 bytes) follows immediately
    // 0: Width
    // 1: Height
    // 2: ColorCount
    // 3: Reserved
    // 4-5: X Hotspot
    // 6-7: Y Hotspot
    const x = view.getUint16(6 + 4, true);
    const y = view.getUint16(6 + 6, true);

    if (x > 256 || y > 256) return null; // 妥当性チェック
    return { x, y };
};

const processCurFile = async (buffer: ArrayBuffer): Promise<{ url: string; hotspot: { x: number; y: number } }> => {
    try {
        const { data, width, height } = await getImageDataFromBuffer(buffer);
        const hotspot = getHotspotFromCur(buffer) || { x: 0, y: 0 };

        // APNG (Static 1 frame)
        const pngBuffer = UPNG.encode([data], width, height, 0);
        const dataUrl = bufferToDataUrl(pngBuffer, 'image/png');
        return { url: dataUrl, hotspot };
    } catch (e) {
        console.error('CUR processing error:', e);
        throw e;
    }
};

const processAniFile = async (buffer: ArrayBuffer): Promise<{ url: string; hotspot: { x: number; y: number } }> => {
    const dataView = new DataView(buffer);
    let offset = 0;

    // RIFF Header check
    const riffHeader = new TextDecoder().decode(buffer.slice(0, 4));
    if (riffHeader !== 'RIFF') throw new Error('Invalid RIFF file');

    offset += 4;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _fileSize = dataView.getUint32(offset, true);
    offset += 4;

    const riffType = new TextDecoder().decode(buffer.slice(offset, offset + 4));
    if (riffType !== 'ACON') throw new Error('Invalid ANI file (not ACON)');
    offset += 4;

    // Chunks
    let jifRate = 0; // Default rate (jiffies = 1/60 sec)
    const frames: ArrayBuffer[] = [];
    const rates: number[] = [];
    let hotspot = { x: 0, y: 0 };
    let hotspotFound = false;

    // チャンク走査
    while (offset < buffer.byteLength) {
        const chunkId = new TextDecoder().decode(buffer.slice(offset, offset + 4));
        offset += 4;
        const chunkSize = dataView.getUint32(offset, true);
        offset += 4;

        // Padding correction: chunks are word-aligned
        const nextChunkOffset = offset + chunkSize + (chunkSize % 2);

        if (chunkId === 'anih') {
            // Animation Header
            if (chunkSize >= 36) {
                jifRate = dataView.getUint32(offset + 28, true);
            }
        } else if (chunkId === 'rate') {
            // Rate chunk
            for (let i = 0; i < chunkSize / 4; i++) {
                rates.push(dataView.getUint32(offset + i * 4, true));
            }
        } else if (chunkId === 'LIST') {
            // List chunk (contains 'fram')
            const listType = new TextDecoder().decode(buffer.slice(offset, offset + 4));
            if (listType === 'fram') {
                let listOffset = offset + 4;
                const listEnd = offset + chunkSize;

                while (listOffset < listEnd) {
                    const subChunkId = new TextDecoder().decode(buffer.slice(listOffset, listOffset + 4));
                    listOffset += 4;
                    const subChunkSize = dataView.getUint32(listOffset, true);
                    listOffset += 4;
                    const subNextOffset = listOffset + subChunkSize + (subChunkSize % 2);

                    if (subChunkId === 'icon') {
                        const iconBuffer = buffer.slice(listOffset, listOffset + subChunkSize);
                        frames.push(iconBuffer);

                        if (!hotspotFound) {
                            const h = getHotspotFromCur(iconBuffer);
                            if (h) {
                                hotspot = h;
                                hotspotFound = true;
                            }
                        }
                    }

                    listOffset = subNextOffset;
                }
            }
        }

        offset = nextChunkOffset;
    }

    if (frames.length === 0) throw new Error('No frames found in ANI file');

    // Extract RGBA from all frames
    const rgbaFrames: ArrayBuffer[] = [];
    let finalWidth = 0;
    let finalHeight = 0;

    for (const frameBuffer of frames) {
        const { data, width, height } = await getImageDataFromBuffer(frameBuffer);
        rgbaFrames.push(data);
        if (finalWidth === 0) {
            finalWidth = width;
            finalHeight = height;
        }
    }

    // Prepare delays
    const delays: number[] = [];
    const defaultJiffies = jifRate || 10;
    const defaultDelay = defaultJiffies * (1000 / 60);

    for (let i = 0; i < frames.length; i++) {
        const rate = rates[i];
        const delay = rate ? rate * (1000 / 60) : defaultDelay;
        delays.push(delay);
    }

    while (delays.length < frames.length) {
        delays.push(defaultDelay);
    }

    // Encode APNG
    const apngBuffer = UPNG.encode(rgbaFrames, finalWidth, finalHeight, 0, delays);
    const apngBlob = new Blob([apngBuffer], { type: 'image/png' });

    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Failed to convert APNG blob to Data URL'));
            }
        };
        reader.onerror = () => {
            reject(reader.error ?? new Error('Error reading APNG blob'));
        };
        reader.readAsDataURL(apngBlob);
    });

    return { url: dataUrl, hotspot };
};

// --- Child Components ---

const TemplateButton = memo(({
    template,
    onSelect,
    disabled,
}: {
    template: TemplateManifest;
    onSelect: (t: TemplateManifest) => void;
    disabled: boolean;
}) => {
    const [thumbnailUrl, setThumbnailUrl] = useState<string>('');

    useEffect(() => {
        const loadThumbnail = async () => {
            const defaultCursorFile = template.mappings['default'];
            if (!defaultCursorFile) return;

            const baseUrl = getBaseUrl();
            const url = `${baseUrl}/templates/${template.directory}/${defaultCursorFile}`;
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Failed to fetch thumbnail source`);
                const buffer = await res.arrayBuffer();
                const ext = defaultCursorFile.split('.').pop()?.toLowerCase();

                let resultUrl = '';
                if (ext === 'cur') {
                    const processed = await processCurFile(buffer);
                    resultUrl = processed.url;
                } else if (ext === 'ani') {
                    const processed = await processAniFile(buffer);
                    resultUrl = processed.url;
                }
                if (resultUrl) setThumbnailUrl(resultUrl);
            } catch (e) {
                console.error('Thumbnail load failed:', e);
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
                padding: '8px',
                border: '1px solid #dee2e6',
                borderRadius: '6px',
                backgroundColor: '#f8f9fa',
                cursor: disabled ? 'wait' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s',
                height: '80px',
                justifyContent: 'center',
            }}
        >
            {thumbnailUrl ? (
                <img
                    src={thumbnailUrl}
                    alt={template.name}
                    style={{ width: '32px', height: '32px', objectFit: 'contain' }}
                />
            ) : (
                <span style={{ fontSize: '20px' }}>🎨</span>
            )}
            <span style={{ fontSize: '11px', fontWeight: '500' }}>{template.name}</span>
        </button>
    );
});
TemplateButton.displayName = 'TemplateButton';

// --- Main Component ---

export const CursorMenu: React.FC<CursorMenuProps> = ({ avatar, onAvatarChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedState, setSelectedState] = useState<CursorState>('default');
    const [urlInput, setUrlInput] = useState('');
    const [isConverting, setIsConverting] = useState(false);
    const [templates, setTemplates] = useState<TemplateManifest[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const currentStateDef = avatar.states[selectedState] || { url: '', hotspot: { x: 0, y: 0 } };

    useEffect(() => {
        fetch(`${getBaseUrl()}/templates/manifest.json`)
            .then((res) => res.json())
            .then((data) => setTemplates(data))
            .catch((err) => console.error('Failed to load templates:', err));
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
                // 普通の画像ファイル
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
            alert('カーソルファイルの処理に失敗しました。別のファイルを試してください。');
        } finally {
            setIsConverting(false);
        }
    };

    const handleTemplateSelect = async (template: TemplateManifest) => {
        if (!confirm(`テンプレート "${template.name}" を適用しますか？\n現在の設定は上書きされます。`)) {
            return;
        }

        setIsConverting(true);
        const newStates = { ...avatar.states };

        try {
            for (const state of AVAILABLE_STATES) {
                const filename = template.mappings[state];
                if (!filename) continue;

                const baseUrl = getBaseUrl();
                const url = `${baseUrl}/templates/${template.directory}/${filename}`;
                try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`Failed to fetch ${url}`);
                    const buffer = await res.arrayBuffer();
                    const ext = filename.split('.').pop()?.toLowerCase();

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

    const handleClear = () => {
        updateAvatarState(selectedState, { url: '' });
        setUrlInput('');
    };

    return (
        <div style={{ position: 'relative' }}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '6px 12px',
                    backgroundColor: 'white',
                    border: '1px solid #dee2e6',
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                }}
            >
                <span>🖱️</span> カーソル変更
            </button>

            {isOpen && (
                <div
                    style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '8px',
                        backgroundColor: 'white',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        border: '1px solid #dee2e6',
                        padding: '16px',
                        width: '320px',
                        maxHeight: '80vh',
                        overflowY: 'auto',
                        zIndex: 1000,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>カーソル設定</h3>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            style={{
                                border: 'none',
                                background: 'none',
                                cursor: 'pointer',
                                fontSize: '16px',
                                padding: '0 4px',
                            }}
                        >
                            ×
                        </button>
                    </div>

                    {templates.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#495057' }}>テンプレート</span>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                                {templates.map((template) => (
                                    <TemplateButton
                                        key={template.id}
                                        template={template}
                                        onSelect={handleTemplateSelect}
                                        disabled={isConverting}
                                    />
                                ))}
                            </div>
                            <div style={{ height: '1px', backgroundColor: '#f1f3f5', margin: '4px 0' }} />
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                        <select
                            value={selectedState}
                            onChange={(e) => setSelectedState(e.target.value as CursorState)}
                            style={{
                                width: '100%',
                                padding: '6px',
                                borderRadius: '4px',
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
                    </div>

                    <form onSubmit={handleUrlSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label
                            style={{
                                fontSize: '12px',
                                fontWeight: 'bold',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                            }}
                        >
                            "{selectedState}" の画像URL
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="text"
                                    value={urlInput}
                                    onChange={(e) => setUrlInput(e.target.value)}
                                    placeholder="https://..."
                                    style={{
                                        flex: 1,
                                        padding: '6px',
                                        borderRadius: '4px',
                                        border: '1px solid #dee2e6',
                                        fontSize: '13px',
                                        fontWeight: 'normal',
                                    }}
                                />
                                <button
                                    type="submit"
                                    disabled={!urlInput.trim()}
                                    style={{
                                        padding: '6px 12px',
                                        backgroundColor: '#228be6',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        fontSize: '12px',
                                        cursor: 'pointer',
                                        opacity: urlInput.trim() ? 1 : 0.6,
                                    }}
                                >
                                    設定
                                </button>
                            </div>
                        </label>
                    </form>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        <label style={{ fontSize: '12px', flex: 1 }}>
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
                                    padding: '4px',
                                    border: '1px solid #dee2e6',
                                    borderRadius: '4px',
                                }}
                            />
                        </label>
                        <label style={{ fontSize: '12px', flex: 1 }}>
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
                                    padding: '4px',
                                    border: '1px solid #dee2e6',
                                    borderRadius: '4px',
                                }}
                            />
                        </label>
                    </div>

                    <div style={{ height: '1px', backgroundColor: '#f1f3f5' }} />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label
                            style={{
                                fontSize: '12px',
                                fontWeight: 'bold',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                            }}
                        >
                            画像アップロード (.png, .jpg, .cur, .ani)
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileUpload}
                                accept="image/*,.cur,.ani"
                                style={{ display: 'none' }}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isConverting}
                                style={{
                                    padding: '8px',
                                    backgroundColor: '#f8f9fa',
                                    border: '1px solid #dee2e6',
                                    borderRadius: '4px',
                                    fontSize: '13px',
                                    cursor: isConverting ? 'wait' : 'pointer',
                                    textAlign: 'center',
                                    color: '#495057',
                                    width: '100%',
                                    opacity: isConverting ? 0.7 : 1,
                                }}
                            >
                                {isConverting ? '変換中...' : 'ファイルを選択...'}
                            </button>
                        </label>
                    </div>

                    {currentStateDef.url && (
                        <>
                            <div style={{ height: '1px', backgroundColor: '#f1f3f5' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '12px', color: '#868e96' }}>現在の設定: カスタム</span>
                                <button
                                    type="button"
                                    onClick={handleClear}
                                    style={{
                                        padding: '4px 8px',
                                        backgroundColor: 'transparent',
                                        color: '#fa5252',
                                        border: '1px solid #fa5252',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        cursor: 'pointer',
                                    }}
                                >
                                    リセット
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
