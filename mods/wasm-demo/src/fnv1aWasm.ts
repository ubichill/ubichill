/**
 * FNV-1a (32bit) を計算する WASM をバイト列で組み立てる。ツールチェーン無しで再現できるようにするため。
 * `pnpm --filter @ubichill/mod-wasm-demo gen:wasm` が assets/fnv1a.wasm に書き出す。
 *
 * (module
 *   (memory (export "memory") 1)
 *   (func (export "fnv1a") (param $ptr i32) (param $len i32) (result i32)
 *     (local $hash i32) (local $end i32)
 *     hash = 0x811c9dc5; end = ptr + len
 *     while (ptr < end) { hash = (hash ^ mem[ptr]) * 0x01000193; ptr++ }
 *     hash))
 */

const I32 = 0x7f;
const OP = {
    block: 0x02,
    loop: 0x03,
    br: 0x0c,
    brIf: 0x0d,
    end: 0x0b,
    localGet: 0x20,
    localSet: 0x21,
    i32Load8U: 0x2d,
    i32Const: 0x41,
    i32GeU: 0x4f,
    i32Add: 0x6a,
    i32Mul: 0x6c,
    i32Xor: 0x73,
    voidBlock: 0x40,
} as const;

function unsignedLeb128(value: number): number[] {
    const byte = value & 0x7f;
    const rest = value >>> 7;
    return rest === 0 ? [byte] : [byte | 0x80, ...unsignedLeb128(rest)];
}

function signedLeb128(value: number): number[] {
    const byte = value & 0x7f;
    const rest = value >> 7;
    const done = (rest === 0 && (byte & 0x40) === 0) || (rest === -1 && (byte & 0x40) !== 0);
    return done ? [byte] : [byte | 0x80, ...signedLeb128(rest)];
}

const vector = (items: number[][]): number[] => [...unsignedLeb128(items.length), ...items.flat()];
const section = (id: number, content: number[]): number[] => [id, ...unsignedLeb128(content.length), ...content];
const name = (text: string): number[] => {
    const bytes = [...new TextEncoder().encode(text)];
    return [...unsignedLeb128(bytes.length), ...bytes];
};

const PTR = 0;
const LEN = 1;
const HASH = 2;
const END = 3;

const body = [
    ...[1, 2, I32], // 追加のローカル: i32 を 2 つ（hash, end）
    ...[OP.i32Const, ...signedLeb128(0x811c9dc5 | 0)],
    ...[OP.localSet, HASH],
    ...[OP.localGet, PTR, OP.localGet, LEN, OP.i32Add, OP.localSet, END],
    ...[OP.block, OP.voidBlock, OP.loop, OP.voidBlock],
    ...[OP.localGet, PTR, OP.localGet, END, OP.i32GeU, OP.brIf, 1],
    ...[OP.localGet, HASH, OP.localGet, PTR, OP.i32Load8U, 0, 0, OP.i32Xor],
    ...[OP.i32Const, ...signedLeb128(0x01000193), OP.i32Mul, OP.localSet, HASH],
    ...[OP.localGet, PTR, OP.i32Const, 1, OP.i32Add, OP.localSet, PTR],
    ...[OP.br, 0, OP.end, OP.end],
    ...[OP.localGet, HASH, OP.end],
];

export function buildFnv1aWasm(): Uint8Array<ArrayBuffer> {
    return new Uint8Array([
        ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
        ...section(1, vector([[0x60, 2, I32, I32, 1, I32]])),
        ...section(3, vector([[0]])),
        ...section(5, vector([[0x00, 1]])),
        ...section(
            7,
            vector([
                [...name('memory'), 0x02, 0],
                [...name('fnv1a'), 0x00, 0],
            ]),
        ),
        ...section(10, vector([[...unsignedLeb128(body.length), ...body]])),
    ]);
}
