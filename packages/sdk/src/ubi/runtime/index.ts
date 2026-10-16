/**
 * 実行環境の能力判定。mod は機能の有無で処理を切り替えるか、`require` で明確なエラーにする。
 *
 * WASM の機能はブラウザ（エンジン）で、通信・アセットの機能は Host のプロトコル版で決まる。
 */
import { UbiError, UbiErrorCode } from '@ubichill/shared/mod/errors';

export type RuntimeFeature =
    /** WebAssembly のコンパイルと実行 */
    | 'wasm'
    /** 128bit SIMD 命令 */
    | 'wasm:simd'
    /** WASM の例外処理（Pyodide 等の新しいビルドが使う） */
    | 'wasm:exceptions'
    /** 共有メモリでのスレッド（SharedArrayBuffer。ページが cross-origin isolated の場合のみ） */
    | 'wasm:threads'
    /** JS Promise Integration（同期的に書かれた WASM から非同期 API を待つ） */
    | 'wasm:jspi'
    /** `Ubi.fetch` の responseType: 'arrayBuffer'・maxBytes・timeoutMs・signal */
    | 'fetch:binary'
    /** `Ubi.asset`（integrity 照合つきの同梱アセット） */
    | 'asset'
    /** `Ubi.identity`（外部サービスへの身元証明。ログインしていなくても Host が対応していれば true） */
    | 'identity';

export type RuntimeModule = {
    /** Host のプロトコル版（`PROTOCOL_VERSION`）。 */
    readonly protocolVersion: number;
    /** 機能を使えるか。 */
    supports(feature: RuntimeFeature): boolean;
    /** 使えない機能なら `UNSUPPORTED_FEATURE` の UbiError を投げる。 */
    require(feature: RuntimeFeature): void;
};

/** 判定に使う環境（テストで差し替える）。 */
export type RuntimeEnvironment = {
    webAssembly?: typeof WebAssembly;
    sharedArrayBuffer?: unknown;
    crossOriginIsolated?: boolean;
};

/** v128 を返す関数 1 つ（i8x16.splat / i8x16.popcnt）。SIMD が無いエンジンでは validate が false。 */
const SIMD_PROBE = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);
/** try / catch_all を含む関数 1 つ。例外処理が無いエンジンでは validate が false。 */
const EXCEPTIONS_PROBE = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11,
]);

/** Host の機能 → それを持つ最初のプロトコル版。 */
const HOST_FEATURE_PROTOCOL: Partial<Record<RuntimeFeature, number>> = {
    'fetch:binary': 4,
    asset: 4,
    identity: 5,
};

function validates(webAssembly: typeof WebAssembly | undefined, bytes: Uint8Array<ArrayBuffer>): boolean {
    try {
        return webAssembly?.validate(bytes) ?? false;
    } catch {
        return false;
    }
}

/** エンジン側の機能を一度だけ調べる。 */
export function detectEngineFeatures(env: RuntimeEnvironment): ReadonlySet<RuntimeFeature> {
    const wasm = env.webAssembly;
    const hasWasm = typeof wasm?.compile === 'function' && typeof wasm.instantiate === 'function';
    const candidates: ReadonlyArray<readonly [RuntimeFeature, boolean]> = [
        ['wasm', hasWasm],
        ['wasm:simd', hasWasm && validates(wasm, SIMD_PROBE)],
        ['wasm:exceptions', hasWasm && validates(wasm, EXCEPTIONS_PROBE)],
        ['wasm:threads', hasWasm && typeof env.sharedArrayBuffer === 'function' && env.crossOriginIsolated === true],
        [
            'wasm:jspi',
            hasWasm &&
                'Suspending' in (wasm as object) &&
                typeof (wasm as { promising?: unknown }).promising === 'function',
        ],
    ];
    return new Set(candidates.filter(([, ok]) => ok).map(([feature]) => feature));
}

export function createRuntimeModule(getProtocolVersion: () => number, env: RuntimeEnvironment): RuntimeModule {
    const engine = detectEngineFeatures(env);
    const supports = (feature: RuntimeFeature): boolean => {
        const since = HOST_FEATURE_PROTOCOL[feature];
        return since === undefined ? engine.has(feature) : getProtocolVersion() >= since;
    };
    return {
        get protocolVersion() {
            return getProtocolVersion();
        },
        supports,
        require(feature) {
            if (!supports(feature)) {
                throw new UbiError(UbiErrorCode.UNSUPPORTED_FEATURE, `この環境では ${feature} を使えません`, {
                    feature,
                });
            }
        },
    };
}
