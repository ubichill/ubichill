declare module 'upng-js' {
    export function encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels?: number[]): ArrayBuffer;
    export function decode(buffer: ArrayBuffer): {
        width: number;
        height: number;
        depth: number;
        ctype: number;
        frames: {
            rect: { x: number; y: number; width: number; height: number };
            delay: number;
            dispose: number;
            blend: number;
        }[];
        tabs: {
            acTL?: { num_frames: number; num_plays: number };
        };
        data: ArrayBuffer;
    };
    export function toRGBA8(out: unknown): ArrayBuffer[];
}
