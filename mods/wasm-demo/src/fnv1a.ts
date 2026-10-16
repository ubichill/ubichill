const PAGE_SIZE = 64 * 1024;

/** FNV-1a (32bit) の参照実装。WASM の結果と突き合わせるのに使う。 */
export function fnv1aReference(bytes: Uint8Array): number {
    return bytes.reduce((hash, byte) => Math.imul(hash ^ byte, 0x01000193) >>> 0, 0x811c9dc5);
}

export const toHex = (hash: number): string => hash.toString(16).padStart(8, '0');

export interface WasmHasher {
    digest(bytes: Uint8Array): number;
}

/**
 * fnv1a.wasm をインスタンス化する。imports は空なので、この WASM は渡したメモリの計算以外に何もできない。
 */
export async function createWasmHasher(module: WebAssembly.Module): Promise<WasmHasher> {
    const instance = await WebAssembly.instantiate(module, {});
    const memory = instance.exports.memory as WebAssembly.Memory;
    const fnv1a = instance.exports.fnv1a as (ptr: number, len: number) => number;
    return {
        digest(bytes) {
            const missing = bytes.byteLength - memory.buffer.byteLength;
            if (missing > 0) memory.grow(Math.ceil(missing / PAGE_SIZE));
            new Uint8Array(memory.buffer, 0, bytes.byteLength).set(bytes);
            return fnv1a(0, bytes.byteLength) >>> 0;
        },
    };
}
