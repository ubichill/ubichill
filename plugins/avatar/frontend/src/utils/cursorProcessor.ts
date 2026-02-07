import { parseICO } from 'icojs';
import * as UPNG from 'upng-js';

// --- Types ---

interface IcoImage {
    width: number;
    height: number;
    buffer: ArrayBuffer;
    bpp?: number;
}

// --- Helper Functions ---

export const getImageDataFromBuffer = async (
    buffer: ArrayBuffer,
): Promise<{ data: ArrayBuffer; width: number; height: number }> => {
    const images = await parseICO(buffer, 'image/png');
    if (!images || images.length === 0) {
        throw new Error('No images found');
    }

    const largestImage = (images as unknown as IcoImage[]).sort(
        (a: IcoImage, b: IcoImage) => (b.width || 0) - (a.width || 0),
    )[0];

    return new Promise((resolve, reject) => {
        const img = new Image();
        const blob = new Blob([largestImage.buffer], { type: 'image/png' });
        const objectURL = URL.createObjectURL(blob);
        img.src = objectURL;
        img.onload = () => {
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
            URL.revokeObjectURL(objectURL);
            reject(new Error('Failed to load image for buffer conversion'));
        };
    });
};

export const bufferToDataUrl = (buffer: ArrayBuffer | Uint8Array, mimeType: string): string => {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${mimeType};base64,${base64}`;
};

export const getHotspotFromCur = (buffer: ArrayBuffer): { x: number; y: number } | null => {
    const view = new DataView(buffer);
    if (view.byteLength < 10) return null;

    try {
        const hotX = view.getUint16(10, true);
        const hotY = view.getUint16(12, true);
        return { x: hotX, y: hotY };
    } catch {
        return null;
    }
};

export const processCurFile = async (
    buffer: ArrayBuffer,
): Promise<{ url: string; hotspot: { x: number; y: number } }> => {
    const hotspot = getHotspotFromCur(buffer) || { x: 0, y: 0 };
    const imageData = await getImageDataFromBuffer(buffer);
    const pngBuffer = UPNG.encode([imageData.data], imageData.width, imageData.height, 0);
    const url = bufferToDataUrl(pngBuffer, 'image/png');
    return { url, hotspot };
};

export const processAniFile = async (
    buffer: ArrayBuffer,
): Promise<{ url: string; hotspot: { x: number; y: number } }> => {
    const view = new DataView(buffer);
    if (view.byteLength < 36) throw new Error('Invalid ANI file');

    const riffMagic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riffMagic !== 'RIFF') throw new Error('Not a valid RIFF file');

    let offset = 12;
    let iconOffset: number | null = null;
    let iconSize: number = 0;
    let hotspot = { x: 0, y: 0 };

    // ANIファイルからアイコンを探索
    while (offset < view.byteLength - 8) {
        const chunkId = String.fromCharCode(
            view.getUint8(offset),
            view.getUint8(offset + 1),
            view.getUint8(offset + 2),
            view.getUint8(offset + 3),
        );
        const chunkSize = view.getUint32(offset + 4, true);

        if (chunkId === 'icon') {
            // 直接iconチャンクが見つかった場合
            iconOffset = offset + 8;
            iconSize = chunkSize;
            const curHotspot = getHotspotFromCur(buffer.slice(iconOffset, iconOffset + chunkSize));
            if (curHotspot) hotspot = curHotspot;
            break;
        } else if (chunkId === 'LIST') {
            // LISTチャンク内を探索
            const listType = String.fromCharCode(
                view.getUint8(offset + 8),
                view.getUint8(offset + 9),
                view.getUint8(offset + 10),
                view.getUint8(offset + 11),
            );

            if (listType === 'fram') {
                // framチャンク内のiconを探す
                let listOffset = offset + 12;
                const listEnd = offset + 8 + chunkSize;

                while (listOffset < listEnd - 8 && listOffset < view.byteLength - 8) {
                    const subChunkId = String.fromCharCode(
                        view.getUint8(listOffset),
                        view.getUint8(listOffset + 1),
                        view.getUint8(listOffset + 2),
                        view.getUint8(listOffset + 3),
                    );
                    const subChunkSize = view.getUint32(listOffset + 4, true);

                    if (subChunkId === 'icon') {
                        iconOffset = listOffset + 8;
                        iconSize = subChunkSize;
                        const curHotspot = getHotspotFromCur(buffer.slice(iconOffset, iconOffset + subChunkSize));
                        if (curHotspot) hotspot = curHotspot;
                        break;
                    }

                    listOffset += 8 + subChunkSize + (subChunkSize % 2);
                }

                if (iconOffset !== null) break;
            }
        }

        offset += 8 + chunkSize + (chunkSize % 2);
    }

    if (iconOffset === null) {
        console.error('ANI file structure:', {
            fileSize: buffer.byteLength,
            riffMagic,
            firstChunks: Array.from({ length: Math.min(5, Math.floor(buffer.byteLength / 8)) }, (_, i) => {
                const off = 12 + i * 8;
                if (off >= buffer.byteLength - 4) return null;
                return String.fromCharCode(
                    view.getUint8(off),
                    view.getUint8(off + 1),
                    view.getUint8(off + 2),
                    view.getUint8(off + 3),
                );
            }).filter(Boolean),
        });
        throw new Error('No icon chunk found in ANI file');
    }

    const iconBuffer = buffer.slice(iconOffset, iconOffset + iconSize);
    const imageData = await getImageDataFromBuffer(iconBuffer);
    const pngBuffer = UPNG.encode([imageData.data], imageData.width, imageData.height, 0);
    const url = bufferToDataUrl(pngBuffer, 'image/png');
    return { url, hotspot };
};
