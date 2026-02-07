'use client';

import type { AppAvatarDef, CursorState } from '@ubichill/shared';
import * as ICO from 'icojs';
import { useRef, useState } from 'react';
import * as UPNG from 'upng-js';

interface CursorMenuProps {
    avatar: AppAvatarDef;
    onAvatarChange: (avatar: AppAvatarDef) => void;
}

export const CursorMenu: React.FC<CursorMenuProps> = ({ avatar, onAvatarChange }) => {
    const [isOpen, setIsOpen] = useState(false);

    // 現在編集中のステート
    const [selectedState, setSelectedState] = useState<CursorState>('default');

    const [urlInput, setUrlInput] = useState('');
    const [isConverting, setIsConverting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 現在の状態の設定
    const currentStateDef = avatar.states[selectedState] || { url: '', hotspot: { x: 0, y: 0 } };

    const handleUrlSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (urlInput.trim()) {
            updateAvatarState(selectedState, { url: urlInput.trim() });
            setUrlInput('');
        }
    };

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
            img.src = URL.createObjectURL(blob);
            img.onload = () => {
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
            img.onerror = () => reject(new Error('Failed to load image for buffer conversion'));
        });
    };

    const processCurFile = async (buffer: ArrayBuffer): Promise<string> => {
        try {
            const { data, width, height } = await getImageDataFromBuffer(buffer);
            // APNG (Static 1 frame)
            const pngBuffer = UPNG.encode([data], width, height, 0);
            const apngBlob = new Blob([pngBuffer], { type: 'image/png' });
            return URL.createObjectURL(apngBlob);
        } catch (e) {
            console.error('CUR processing error:', e);
            throw e;
        }
    };

    const processAniFile = async (buffer: ArrayBuffer): Promise<string> => {
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
                // cSize(4), cFrames(4), cSteps(4), cx(4), cy(4), cBitCount(4), cPlanes(4), jifRate(4), flags(4)
                if (chunkSize >= 36) {
                    jifRate = dataView.getUint32(offset + 28, true);
                }
            } else if (chunkId === 'rate') {
                // Rate chunk (array of dwords)
                for (let i = 0; i < chunkSize / 4; i++) {
                    rates.push(dataView.getUint32(offset + i * 4, true));
                }
            } else if (chunkId === 'LIST') {
                // List chunk (contains 'fram' type which contains 'icon' chunks)
                const listType = new TextDecoder().decode(buffer.slice(offset, offset + 4));
                if (listType === 'fram') {
                    // Inside LIST 'fram', we have 'icon' chunks
                    let listOffset = offset + 4;
                    const listEnd = offset + chunkSize;

                    while (listOffset < listEnd) {
                        const subChunkId = new TextDecoder().decode(buffer.slice(listOffset, listOffset + 4));
                        listOffset += 4;
                        const subChunkSize = dataView.getUint32(listOffset, true);
                        listOffset += 4;
                        const subNextOffset = listOffset + subChunkSize + (subChunkSize % 2);

                        if (subChunkId === 'icon') {
                            // This is the icon data (ICO/CUR format)
                            const iconBuffer = buffer.slice(listOffset, listOffset + subChunkSize);
                            frames.push(iconBuffer);
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
            // Use the dimensions of the first frame for the APNG
            if (finalWidth === 0) {
                finalWidth = width;
                finalHeight = height;
            }
        }

        // Prepare delays
        // ANI rate is in Jiffies (1/60 sec)
        // UPNG delay is in milliseconds
        const delays: number[] = [];
        // Default delay: if jifRate is 0, use 10 jiffies (typical default)
        const defaultJiffies = jifRate || 10;
        const defaultDelay = defaultJiffies * (1000 / 60);

        for (let i = 0; i < frames.length; i++) {
            const rate = rates[i];
            const delay = rate ? rate * (1000 / 60) : defaultDelay;
            delays.push(delay);
        }

        // Fill remaining delays if needed
        while (delays.length < frames.length) {
            delays.push(defaultDelay);
        }

        // Encode APNG
        const apngBuffer = UPNG.encode(rgbaFrames, finalWidth, finalHeight, 0, delays);
        const apngBlob = new Blob([apngBuffer], { type: 'image/png' });

        // Convert Blob to Data URL so it can be serialized and used by other clients
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

        return dataUrl;
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsConverting(true);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const ext = file.name.split('.').pop()?.toLowerCase();

            let resultUrl = '';

            if (ext === 'cur') {
                resultUrl = await processCurFile(arrayBuffer);
            } else if (ext === 'ani') {
                resultUrl = await processAniFile(arrayBuffer);
            } else {
                // 普通の画像ファイル
                const reader = new FileReader();
                reader.onload = (event) => {
                    const result = event.target?.result as string;
                    if (result) {
                        updateAvatarState(selectedState, { url: result });
                    }
                };
                reader.readAsDataURL(file);
                setIsConverting(false);
                return;
            }

            if (resultUrl) {
                updateAvatarState(selectedState, { url: resultUrl });
            }
        } catch (error) {
            console.error('Failed to convert cursor file:', error);
            alert('Failed to process cursor file. Please try another file.');
        } finally {
            setIsConverting(false);
        }
    };

    const handleClear = () => {
        updateAvatarState(selectedState, { url: '' });
        setUrlInput('');
    };

    // 定義済みステート一覧
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
                <span>🖱️</span> Change Cursor
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
                        zIndex: 1000,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>Cursor Settings</h3>
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

                    {/* State Selector */}
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

                    {/* URL Input */}
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
                            Image URL for "{selectedState}"
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
                                    Set
                                </button>
                            </div>
                        </label>
                    </form>

                    {/* Hotspot Settings */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <label style={{ fontSize: '12px', flex: 1 }}>
                            Hotspot X
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
                            Hotspot Y
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

                    {/* File Upload */}
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
                            Upload Image (.png, .jpg, .cur, .ani)
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
                                {isConverting ? 'Converting...' : 'Choose File...'}
                            </button>
                        </label>
                    </div>

                    {currentStateDef.url && (
                        <>
                            <div style={{ height: '1px', backgroundColor: '#f1f3f5' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '12px', color: '#868e96' }}>Current: Custom</span>
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
                                    Reset this state
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
