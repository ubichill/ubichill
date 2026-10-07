import { UbiErrorCode } from '@ubichill/shared/mod/errors';
import { describe, expect, it, vi } from 'vitest';
import type { RpcFn } from '../types';
import { createAssetModule } from './index';

/** (module (func (export "answer") (result i32) i32.const 42)) */
const ANSWER_WASM = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 10, 1, 6, 97, 110, 115, 119, 101, 114, 0, 0, 10,
    6, 1, 4, 0, 65, 42, 11,
]);

function rpcReturning(...results: Array<ArrayBuffer | Error>) {
    const queue = [...results];
    return vi.fn(async () => {
        const next = queue.shift();
        if (next instanceof Error || next === undefined) throw next ?? new Error('no more');
        return next;
    }) as unknown as RpcFn & ReturnType<typeof vi.fn>;
}

describe('createAssetModule', () => {
    it('bytes は ASSET_LOAD を送り、signal を RPC に渡す', async () => {
        const rpc = rpcReturning(new Uint8Array([1]).buffer);
        const asset = createAssetModule({ rpc });
        const signal = new AbortController().signal;
        await asset.bytes('data/a.bin', { signal });
        expect(rpc).toHaveBeenCalledWith({ type: 'ASSET_LOAD', payload: { path: 'data/a.bin' } }, { signal });
    });

    it('text は UTF-8 として読む', async () => {
        const asset = createAssetModule({ rpc: rpcReturning(new TextEncoder().encode('こんにちは').buffer) });
        expect(await asset.text('hello.txt')).toBe('こんにちは');
    });

    it('wasm はコンパイルした Module を返し、同じパスは 1 度しか取得・コンパイルしない', async () => {
        const rpc = rpcReturning(ANSWER_WASM.slice().buffer);
        const asset = createAssetModule({ rpc });

        const [a, b] = await Promise.all([asset.wasm('answer.wasm'), asset.wasm('answer.wasm')]);
        const instance = await WebAssembly.instantiate(a, {});

        expect(a).toBe(b);
        expect(rpc).toHaveBeenCalledTimes(1);
        expect((instance.exports.answer as () => number)()).toBe(42);
    });

    it('取得に失敗した wasm はキャッシュせず、次の呼び出しで取り直す', async () => {
        const rpc = rpcReturning(new Error('network'), ANSWER_WASM.slice().buffer);
        const asset = createAssetModule({ rpc });
        await expect(asset.wasm('answer.wasm')).rejects.toThrow('network');
        await expect(asset.wasm('answer.wasm')).resolves.toBeInstanceOf(WebAssembly.Module);
        expect(rpc).toHaveBeenCalledTimes(2);
    });

    it('壊れた wasm はコンパイルエラーになる（integrity は Host が見るが、中身の妥当性はエンジンが見る）', async () => {
        const asset = createAssetModule({ rpc: rpcReturning(new Uint8Array([0, 97, 115, 109, 9]).buffer) });
        await expect(asset.wasm('broken.wasm')).rejects.toBeInstanceOf(WebAssembly.CompileError);
    });

    it('WebAssembly の無い環境では取得せずに UNSUPPORTED_FEATURE', async () => {
        const rpc = rpcReturning();
        const asset = createAssetModule({ rpc, webAssembly: undefined });
        await expect(asset.wasm('a.wasm')).rejects.toMatchObject({ code: UbiErrorCode.UNSUPPORTED_FEATURE });
        expect(rpc).not.toHaveBeenCalled();
    });
});
