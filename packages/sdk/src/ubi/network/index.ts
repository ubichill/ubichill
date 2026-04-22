import type { FetchOptions } from '@ubichill/shared';
import type { RpcFn, SendFn } from '../types';

export type NetworkModule = {
    sendToHost<
        TPayloadMap extends Record<string, unknown> = Record<string, unknown>,
        K extends keyof TPayloadMap & string = keyof TPayloadMap & string,
    >(type: K, data: TPayloadMap[K]): void;
    broadcast<
        TPayloadMap extends Record<string, unknown> = Record<string, unknown>,
        K extends keyof TPayloadMap & string = keyof TPayloadMap & string,
    >(type: K, data: TPayloadMap[K]): void;
    fetch(url: string, options?: FetchOptions): Promise<unknown>;
};

export function createNetworkModule(send: SendFn, rpc: RpcFn): NetworkModule {
    return {
        sendToHost: (type, data) => send({ type: 'NETWORK_SEND_TO_HOST', payload: { type, data } }),
        broadcast: (type, data) => send({ type: 'NETWORK_BROADCAST', payload: { type, data } }),
        fetch: (url, options) => rpc({ type: 'NET_FETCH', payload: { url, options } }),
    };
}
