/**
 * Sandbox Worker のグローバル封鎖。
 *
 * ブラウザの Worker では `fetch` などが `self` 自身ではなく `WorkerGlobalScope.prototype` に載っている。
 * `self` だけを上書きしても `Object.getPrototypeOf(self).fetch.call(self, url)` で素通りできるため、
 * プロトタイプチェーンの全段から取り除く。
 *
 * 文字列からのコード生成（eval / Function / 関数の constructor / 文字列タイマー）も塞ぐ。
 * 動的なコードが必要な mod は、WASM 上のインタプリタ（QuickJS 等）で実行する。
 *
 * 対象のオブジェクトと組み込みのプロトタイプは引数で受け取る（別 realm で検証できるようにするため）。
 */

/** 通信・永続化・スクリプト読み込み・他コンテキストとの通信の入口。すべて Host の Ubi API を経由させる。 */
export const BLOCKED_GLOBALS = [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'WebSocketStream',
    'WebTransport',
    'EventSource',
    'importScripts',
    'Worker',
    'SharedWorker',
    'BroadcastChannel',
    'indexedDB',
    'caches',
    'localStorage',
    'sessionStorage',
    'cookieStore',
    'requestFileSystem',
    'webkitRequestFileSystem',
    'webkitRequestFileSystemSync',
    'webkitResolveLocalFileSystemURL',
    'webkitResolveLocalFileSystemSyncURL',
    'FontFace',
    'fonts',
    'navigator',
] as const;

const TIMER_GLOBALS = ['setTimeout', 'setInterval'] as const;

export const CODEGEN_FORBIDDEN_MESSAGE =
    '[Sandbox] 文字列からのコード生成は禁止されています。動的なコードは WASM 上の VM で実行してください。';

/** 関数系の組み込みプロトタイプ（Function / AsyncFunction / GeneratorFunction / AsyncGeneratorFunction）。 */
export type FunctionPrototypes = readonly object[];

/** この realm の関数系プロトタイプ。 */
export function currentFunctionPrototypes(): FunctionPrototypes {
    return [
        Object.getPrototypeOf(() => {}),
        Object.getPrototypeOf(async () => {}),
        Object.getPrototypeOf(function* () {}),
        Object.getPrototypeOf(async function* () {}),
    ];
}

export interface LockdownOptions {
    /** 封鎖後の `self.postMessage`（mod が直接呼んだときの警告など）。 */
    postMessageStub: (...args: unknown[]) => void;
    functionPrototypes: FunctionPrototypes;
}

function prototypeChain(target: object): object[] {
    const proto = Object.getPrototypeOf(target) as object | null;
    return proto === null ? [target] : [target, ...prototypeChain(proto)];
}

function hasOwn(target: object, key: string): boolean {
    return Object.hasOwn(target, key);
}

function freezeProperty(target: object, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, writable: false, enumerable: false, configurable: false });
}

/** 呼ぶと必ず EvalError を投げる関数。`prototype` を元の値にして `instanceof` を壊さない。 */
function codegenStub(name: string, prototype: object | undefined): (...args: unknown[]) => never {
    const stub = function forbiddenCodegen(): never {
        throw new EvalError(CODEGEN_FORBIDDEN_MESSAGE);
    };
    Object.defineProperty(stub, 'name', { value: name });
    if (prototype) Object.defineProperty(stub, 'prototype', { value: prototype, writable: false });
    return stub;
}

function guardTimer(scope: object, original: (...args: unknown[]) => unknown) {
    return (handler: unknown, ...rest: unknown[]): unknown => {
        if (typeof handler !== 'function') throw new EvalError(CODEGEN_FORBIDDEN_MESSAGE);
        return original.call(scope, handler, ...rest);
    };
}

/** チェーン上で `key` を自前で持つ段すべてに `valueFor(level)` を定義する。 */
function replaceAlongChain(scope: object, key: string, valueFor: (level: object) => unknown): void {
    for (const level of prototypeChain(scope)) {
        if (hasOwn(level, key)) freezeProperty(level, key, valueFor(level));
    }
}

/**
 * `scope`（Worker の `self`）を封鎖する。呼び出し前に必要な参照（postMessage 等）は退避しておくこと。
 * 失敗した項目は {@link findLockdownLeaks} で検出できる。
 */
export function lockdownGlobalScope(scope: object, options: LockdownOptions): void {
    for (const key of BLOCKED_GLOBALS) {
        replaceAlongChain(scope, key, () => undefined);
    }

    replaceAlongChain(Object.getPrototypeOf(scope) as object, 'postMessage', () => undefined);
    freezeProperty(scope, 'postMessage', options.postMessageStub);

    for (const key of TIMER_GLOBALS) {
        const original = (scope as Record<string, unknown>)[key];
        if (typeof original !== 'function') continue;
        const guarded = guardTimer(scope, original as (...args: unknown[]) => unknown);
        replaceAlongChain(scope, key, () => guarded);
    }

    const [functionPrototype] = options.functionPrototypes;
    replaceAlongChain(scope, 'eval', () => codegenStub('eval', undefined));
    replaceAlongChain(scope, 'Function', () => codegenStub('Function', functionPrototype));
    for (const prototype of options.functionPrototypes) {
        freezeProperty(prototype, 'constructor', codegenStub('Function', prototype));
    }
}

/**
 * 封鎖が効いていない入口を返す（空なら封鎖済み）。
 * getter は `this` 次第で例外を投げるため、値ではなくディスクリプタで判定する。
 */
export function findLockdownLeaks(scope: object, functionPrototypes: FunctionPrototypes): string[] {
    const chain = prototypeChain(scope);
    const leakedGlobals = BLOCKED_GLOBALS.filter((key) =>
        chain.some((level) => {
            const descriptor = Object.getOwnPropertyDescriptor(level, key);
            return descriptor !== undefined && (descriptor.get !== undefined || descriptor.value !== undefined);
        }),
    );
    const leakedConstructors = functionPrototypes
        .map((prototype, index) => ({ index, ctor: (prototype as { constructor?: unknown }).constructor }))
        .filter(({ ctor }) => !isCodegenStub(ctor))
        .map(({ index }) => `constructor#${index}`);
    const leakedCodegen = (['eval', 'Function'] as const).filter((key) =>
        chain.some((level) => hasOwn(level, key) && !isCodegenStub(Object.getOwnPropertyDescriptor(level, key)?.value)),
    );
    return [...leakedGlobals, ...leakedConstructors, ...leakedCodegen];
}

function isCodegenStub(fn: unknown): boolean {
    if (typeof fn !== 'function') return false;
    try {
        (fn as () => unknown)();
        return false;
    } catch (error) {
        return error instanceof EvalError && error.message === CODEGEN_FORBIDDEN_MESSAGE;
    }
}
