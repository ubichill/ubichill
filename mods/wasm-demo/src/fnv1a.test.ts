import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createWasmHasher, fnv1aReference, toHex } from './fnv1a';
import { buildFnv1aWasm } from './fnv1aWasm';

const committed = readFileSync(new URL('../assets/fnv1a.wasm', import.meta.url));
const encode = (text: string) => new TextEncoder().encode(text);

async function hasher() {
    return createWasmHasher(await WebAssembly.compile(buildFnv1aWasm()));
}

describe('fnv1a.wasm', () => {
    it('同梱した assets/fnv1a.wasm は生成器の出力と同じ（gen:wasm のやり直し忘れを検出）', () => {
        expect(new Uint8Array(committed)).toEqual(buildFnv1aWasm());
    });

    it('妥当な WASM で、memory と fnv1a だけを export し、何も import しない', async () => {
        const module = await WebAssembly.compile(buildFnv1aWasm());
        expect(WebAssembly.Module.imports(module)).toEqual([]);
        expect(WebAssembly.Module.exports(module)).toEqual([
            { name: 'memory', kind: 'memory' },
            { name: 'fnv1a', kind: 'function' },
        ]);
    });

    it.each([
        ['', '811c9dc5'],
        ['a', 'e40c292c'],
        ['foobar', 'bf9cf968'],
    ])('FNV-1a の既知の値と一致する: %j', async (text, expected) => {
        const wasm = await hasher();
        expect(toHex(wasm.digest(encode(text)))).toBe(expected);
        expect(toHex(fnv1aReference(encode(text)))).toBe(expected);
    });

    it('64KiB（1 ページ）を超える入力はメモリを広げて計算し、参照実装と一致する', async () => {
        const wasm = await hasher();
        const big = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 7919 + 13) & 0xff);
        expect(wasm.digest(big)).toBe(fnv1aReference(big));
    });

    it('大きい入力のあとに小さい入力を渡しても、前の内容が結果に混ざらない', async () => {
        const wasm = await hasher();
        wasm.digest(new Uint8Array(100_000).fill(0xff));
        expect(toHex(wasm.digest(encode('a')))).toBe('e40c292c');
    });

    it('0xff を含むバイト列（UTF-8 として不正）もそのまま計算する', async () => {
        const wasm = await hasher();
        const bytes = new Uint8Array([0x00, 0xff, 0xfe, 0x80]);
        expect(wasm.digest(bytes)).toBe(fnv1aReference(bytes));
    });
});
