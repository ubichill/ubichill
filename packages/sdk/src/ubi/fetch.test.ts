/**
 * `Ubi.fetch` と RPC の取り消し・制限時間。実際の UbiSDK に、Host への送信を記録する関数を渡して確かめる。
 */
import { UbiError, UbiErrorCode } from '@ubichill/shared/mod/errors';
import type { ModGuestCommand } from '@ubichill/shared/mod/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UbiSDK } from './index';

function harness() {
    const sent: ModGuestCommand[] = [];
    const sdk = new UbiSDK((cmd) => {
        // Worker の postMessage と同じく、構造化複製できない値（AbortSignal 等）はここで落ちる。
        sent.push(structuredClone(cmd));
    });
    const respond = (id: string, data: unknown) =>
        sdk._dispatchEvent({ type: 'EVT_RPC_RESPONSE', id, success: true, data });
    const lastId = () => (sent.at(-1) as { id: string }).id;
    return { sdk, sent, respond, lastId };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('Ubi.fetch', () => {
    it('signal は Host へ送らず、responseType などのオプションだけを送る', () => {
        const { sdk, sent } = harness();
        void sdk.fetch('https://api.example.com/a.bin', {
            responseType: 'arrayBuffer',
            maxBytes: 1024,
            signal: new AbortController().signal,
        });
        expect(sent).toEqual([
            {
                type: 'NETWORK_FETCH',
                id: expect.stringMatching(/^rpc_/),
                payload: {
                    url: 'https://api.example.com/a.bin',
                    options: { responseType: 'arrayBuffer', maxBytes: 1024 },
                },
            },
        ]);
    });

    it('バイト列の応答をそのまま返す', async () => {
        const { sdk, respond, lastId } = harness();
        const pending = sdk.fetch('https://api.example.com/a.bin', { responseType: 'arrayBuffer' });
        const body = new Uint8Array([0, 255]).buffer;
        respond(lastId(), { ok: true, status: 200, statusText: 'OK', headers: {}, body });
        expect((await pending).body).toBe(body);
    });

    it('abort すると FETCH_ABORTED で失敗し、Host に同じ id の CMD_ABORT を送る', async () => {
        const { sdk, sent, lastId } = harness();
        const controller = new AbortController();
        const pending = sdk.fetch('https://api.example.com/slow', { signal: controller.signal });
        const requestId = lastId();

        controller.abort();

        await expect(pending).rejects.toMatchObject({ code: UbiErrorCode.FETCH_ABORTED });
        expect(sent.at(-1)).toEqual({ type: 'CMD_ABORT', payload: { requestId } });
    });

    it('取り消し後に Host の応答が遅れて届いても無視する', async () => {
        const { sdk, respond, lastId } = harness();
        const controller = new AbortController();
        const pending = sdk.fetch('https://api.example.com/slow', { signal: controller.signal });
        const requestId = lastId();
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(UbiError);
        expect(() => respond(requestId, { ok: true })).not.toThrow();
    });

    it('すでに abort 済みの signal なら何も送らずに失敗する', async () => {
        const { sdk, sent } = harness();
        const controller = new AbortController();
        controller.abort();
        await expect(sdk.fetch('https://api.example.com/x', { signal: controller.signal })).rejects.toMatchObject({
            code: UbiErrorCode.FETCH_ABORTED,
        });
        expect(sent).toEqual([]);
    });

    it('Host の制限時間（timeoutMs）より少し長く待ち、それでも応答が無ければ取り消す', async () => {
        vi.useFakeTimers();
        const { sdk, sent, lastId } = harness();
        const pending = sdk.fetch('https://api.example.com/x', { timeoutMs: 1_000 });
        const requestId = lastId();
        const settled = vi.fn();
        pending.catch(settled);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(5_000);
        await expect(pending).rejects.toMatchObject({ code: UbiErrorCode.RPC_TIMEOUT });
        expect(sent.at(-1)).toEqual({ type: 'CMD_ABORT', payload: { requestId } });
    });

    it('上限を超える timeoutMs は Host の上限に丸めて待つ（無限に待たない）', async () => {
        vi.useFakeTimers();
        const { sdk } = harness();
        const pending = sdk.fetch('https://api.example.com/x', { timeoutMs: Number.MAX_SAFE_INTEGER });
        pending.catch(() => {});
        await vi.advanceTimersByTimeAsync(310_000);
        await expect(pending).rejects.toMatchObject({ code: UbiErrorCode.RPC_TIMEOUT });
    });
});

describe('Ubi.asset（UbiSDK 経由）', () => {
    it('ASSET_LOAD を送り、Host の失敗コードを UbiError として返す', async () => {
        const { sdk, sent, lastId } = harness();
        const pending = sdk.asset.bytes('engine.wasm');
        expect(sent.at(-1)).toMatchObject({ type: 'ASSET_LOAD', payload: { path: 'engine.wasm' } });

        sdk._dispatchEvent({
            type: 'EVT_RPC_RESPONSE',
            id: lastId(),
            success: false,
            error: 'mismatch',
            errorCode: UbiErrorCode.ASSET_INTEGRITY_MISMATCH,
        });
        await expect(pending).rejects.toMatchObject({ code: UbiErrorCode.ASSET_INTEGRITY_MISMATCH });
    });

    it('Host のプロトコル版で fetch:binary / asset の対応を判定する', () => {
        const { sdk } = harness();
        expect(sdk.runtime.supports('asset')).toBe(false);
        sdk._setHostProtocolVersion(4);
        expect(sdk.runtime.protocolVersion).toBe(4);
        expect(sdk.runtime.supports('asset')).toBe(true);
        expect(sdk.runtime.supports('fetch:binary')).toBe(true);
    });
});
