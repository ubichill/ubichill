import { UbiError, UbiErrorCode } from '@ubichill/shared/mod/errors';
import { CommandType } from '@ubichill/shared/mod/protocol';
import type { RpcFn } from '../types';

export type AssetLoadOptions = {
    /** abort すると読み込みを取り消す（Host 側の通信も止まる）。 */
    signal?: AbortSignal;
};

export type AssetModule = {
    /**
     * mod に同梱したアセット（`assets/` 配下）のバイト列。Host が manifest の integrity と照合してから渡す。
     * パスは `assets/` からの相対（例: `'wasm/engine.wasm'`）。
     */
    bytes(path: string, options?: AssetLoadOptions): Promise<ArrayBuffer>;
    /** UTF-8 のテキストとして読む。 */
    text(path: string, options?: AssetLoadOptions): Promise<string>;
    /**
     * WASM をコンパイルする。同じパスは 1 度だけコンパイルして使い回す。
     * インスタンス化は `WebAssembly.instantiate(module, imports)` で行う（imports に渡したものだけが WASM の権限になる）。
     */
    wasm(path: string): Promise<WebAssembly.Module>;
};

export type AssetModuleDeps = {
    rpc: RpcFn;
    /** 差し替え用（テスト・WebAssembly の無い環境）。既定は globalThis.WebAssembly。 */
    webAssembly?: Pick<typeof WebAssembly, 'compile'> | undefined;
};

export function createAssetModule(deps: AssetModuleDeps): AssetModule {
    const { rpc } = deps;
    // 明示的に undefined を渡したとき（WebAssembly の無い環境の再現）も既定値に戻さない。
    const webAssembly = 'webAssembly' in deps ? deps.webAssembly : globalThis.WebAssembly;
    const compiled = new Map<string, Promise<WebAssembly.Module>>();

    const bytes = (path: string, options?: AssetLoadOptions): Promise<ArrayBuffer> =>
        rpc<ArrayBuffer>({ type: CommandType.ASSET_LOAD, payload: { path } }, { signal: options?.signal });

    const compile = async (path: string): Promise<WebAssembly.Module> => {
        if (!webAssembly) {
            throw new UbiError(UbiErrorCode.UNSUPPORTED_FEATURE, 'この環境では WebAssembly を使えません');
        }
        return webAssembly.compile(await bytes(path));
    };

    return {
        bytes,
        text: async (path, options) => new TextDecoder().decode(await bytes(path, options)),
        wasm(path) {
            const cached = compiled.get(path);
            if (cached) return cached;
            const pending = compile(path);
            compiled.set(path, pending);
            // 失敗はキャッシュしない（一時的な通信失敗のあとに再試行できるように）。
            pending.catch(() => compiled.delete(path));
            return pending;
        },
    };
}
