declare module 'icojs' {
    export function parseICO(
        buffer: ArrayBuffer,
        mimeType?: string,
    ): Promise<Array<{ width: number; height: number; bpp: number; buffer: ArrayBuffer }>>;
    export function isICO(buffer: ArrayBuffer): boolean;
}
