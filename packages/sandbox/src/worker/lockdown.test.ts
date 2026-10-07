import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { CODEGEN_FORBIDDEN_MESSAGE, findLockdownLeaks, lockdownGlobalScope } from './lockdown';

/**
 * ブラウザの Worker と同じく、fetch 等を self ではなくプロトタイプ側に置いた偽の self を別 realm に作る。
 * 封鎖は不可逆（組み込みの constructor も書き換える）なので、テストごとに realm を作り直す。
 */
function createWorkerRealm() {
    const context = vm.createContext({});
    const realm = vm.runInContext(
        `(() => {
            const calls = [];
            const posted = [];
            const method = (fn) => ({ value: fn, writable: true, enumerable: true, configurable: true });
            const getter = (fn) => ({ get: fn, enumerable: true, configurable: true });
            const eventTargetPrototype = { addEventListener() {} };
            const workerGlobalScopePrototype = Object.create(eventTargetPrototype, {
                fetch: method(function fetch(url) { calls.push('fetch:' + url); return 'network'; }),
                importScripts: method(function importScripts() { calls.push('importScripts'); }),
                caches: getter(function () { return { open() { calls.push('caches'); } }; }),
                indexedDB: getter(function () { return { open() {} }; }),
                navigator: getter(function () { return { sendBeacon() { calls.push('beacon'); } }; }),
                fonts: getter(function () { return {}; }),
                setTimeout: method(function setTimeout(handler, _ms, ...args) {
                    calls.push(typeof handler === 'function' ? handler(...args) : 'eval:' + handler);
                    return 1;
                }),
                setInterval: method(function setInterval(handler) {
                    calls.push(typeof handler === 'function' ? 'interval' : 'eval:' + handler);
                    return 2;
                }),
            });
            const dedicatedPrototype = Object.create(workerGlobalScopePrototype, {
                postMessage: method(function postMessage(message) { posted.push(message); }),
            });
            const scope = Object.create(dedicatedPrototype);
            scope.XMLHttpRequest = function XMLHttpRequest() {};
            scope.WebSocket = function WebSocket() {};
            scope.BroadcastChannel = function BroadcastChannel() {};
            scope.Function = Function;
            scope.eval = eval;
            const functionPrototypes = [
                Object.getPrototypeOf(function () {}),
                Object.getPrototypeOf(async function () {}),
                Object.getPrototypeOf(function* () {}),
                Object.getPrototypeOf(async function* () {}),
            ];
            return { scope, calls, posted, functionPrototypes, workerGlobalScopePrototype, dedicatedPrototype };
        })()`,
        context,
    ) as {
        scope: Record<string, unknown>;
        calls: unknown[];
        posted: unknown[];
        functionPrototypes: object[];
        workerGlobalScopePrototype: Record<string, unknown>;
        dedicatedPrototype: Record<string, unknown>;
    };
    const run = (code: string): unknown => vm.runInContext(code, context);
    return { ...realm, run };
}

function lockdown(realm: ReturnType<typeof createWorkerRealm>, postMessageStub = vi.fn()) {
    lockdownGlobalScope(realm.scope, { postMessageStub, functionPrototypes: realm.functionPrototypes });
    return postMessageStub;
}

describe('lockdownGlobalScope', () => {
    it('プロトタイプ側の fetch を self 経由でもプロトタイプ経由でも呼べなくする', () => {
        const realm = createWorkerRealm();
        lockdown(realm);

        expect(realm.scope.fetch).toBeUndefined();
        expect(Object.getPrototypeOf(realm.scope).fetch).toBeUndefined();
        expect(realm.workerGlobalScopePrototype.fetch).toBeUndefined();
        expect(realm.calls).toEqual([]);
    });

    it('getter で提供される caches / navigator / indexedDB を、ディスクリプタごと取り除く', () => {
        const realm = createWorkerRealm();
        lockdown(realm);

        for (const key of ['caches', 'navigator', 'indexedDB', 'fonts']) {
            const descriptor = Object.getOwnPropertyDescriptor(realm.workerGlobalScopePrototype, key);
            expect(descriptor?.get, key).toBeUndefined();
            expect(descriptor?.value, key).toBeUndefined();
        }
    });

    it('封鎖後に再定義・再代入しても入口は戻らない', () => {
        const realm = createWorkerRealm();
        lockdown(realm);

        expect(() =>
            Object.defineProperty(realm.workerGlobalScopePrototype, 'fetch', { value: () => 'again' }),
        ).toThrow(TypeError);
        expect(() => realm.run('"use strict"; Object.getPrototypeOf(Object.getPrototypeOf(this))')).not.toThrow();
        expect(() => {
            realm.scope.XMLHttpRequest = () => 'again';
        }).toThrow(TypeError);
        expect(realm.scope.XMLHttpRequest).toBeUndefined();
    });

    it('存在しない入口を新たに生やさない', () => {
        const realm = createWorkerRealm();
        lockdown(realm);

        expect(Object.getOwnPropertyNames(realm.scope)).not.toContain('WebTransport');
        expect(Object.getOwnPropertyNames(realm.workerGlobalScopePrototype)).not.toContain('WebTransport');
    });

    it('self.postMessage は警告用の関数に、プロトタイプの postMessage は undefined にする', () => {
        const realm = createWorkerRealm();
        const stub = lockdown(realm);

        (realm.scope.postMessage as (m: unknown) => void)('raw');
        expect(stub).toHaveBeenCalledWith('raw');
        expect(realm.dedicatedPrototype.postMessage).toBeUndefined();
        expect(realm.posted).toEqual([]);
    });

    it('Function と eval は呼ぶと EvalError を投げ、instanceof Function は壊さない', () => {
        const realm = createWorkerRealm();
        lockdown(realm);
        const FunctionStub = realm.scope.Function as new (...args: string[]) => unknown;

        expect(() => new FunctionStub('return 1')).toThrow(CODEGEN_FORBIDDEN_MESSAGE);
        expect(() => (realm.scope.eval as (code: string) => unknown)('1')).toThrow(EvalError);
        expect(realm.run('(function () {})') instanceof FunctionStub).toBe(true);
    });

    it('関数の constructor 経由のコード生成（通常・async・generator・async generator）を塞ぐ', () => {
        const realm = createWorkerRealm();
        lockdown(realm);

        expect(() => realm.run('(() => {}).constructor("return 1")')).toThrow(CODEGEN_FORBIDDEN_MESSAGE);
        expect(() => realm.run('(async () => {}).constructor("return 1")')).toThrow(EvalError);
        expect(() => realm.run('(function* () {}).constructor("yield 1")')).toThrow(EvalError);
        expect(() => realm.run('(async function* () {}).constructor("yield 1")')).toThrow(EvalError);
        expect(() => realm.run('Reflect.construct((() => {}).constructor, ["return 1"])')).toThrow(EvalError);
        expect(realm.run('(() => {}).constructor.name')).toBe('Function');
    });

    it('文字列のタイマーは拒否し、関数のタイマーは引数ごとそのまま通す', () => {
        const realm = createWorkerRealm();
        lockdown(realm);
        const setTimeoutFn = realm.scope.setTimeout as (...args: unknown[]) => unknown;
        const setIntervalFn = realm.scope.setInterval as (...args: unknown[]) => unknown;

        expect(() => setTimeoutFn('fetch("/api")', 0)).toThrow(EvalError);
        expect(() => setIntervalFn('1', 0)).toThrow(EvalError);
        expect(setTimeoutFn((a: number, b: number) => a + b, 0, 2, 3)).toBe(1);
        expect(realm.calls).toEqual([5]);
    });

    it('プロトタイプに残った元のタイマーを直接呼んでも文字列は評価されない', () => {
        const realm = createWorkerRealm();
        lockdown(realm);
        const protoSetTimeout = realm.workerGlobalScopePrototype.setTimeout as (...args: unknown[]) => unknown;

        expect(() => protoSetTimeout.call(realm.scope, 'evil()', 0)).toThrow(EvalError);
        expect(realm.calls).toEqual([]);
    });
});

describe('findLockdownLeaks', () => {
    it('封鎖前の入口を列挙し、封鎖後は空になる', () => {
        const realm = createWorkerRealm();
        const before = findLockdownLeaks(realm.scope, realm.functionPrototypes);
        expect(before).toEqual(
            expect.arrayContaining(['fetch', 'caches', 'navigator', 'XMLHttpRequest', 'constructor#0', 'eval']),
        );

        lockdown(realm);
        expect(findLockdownLeaks(realm.scope, realm.functionPrototypes)).toEqual([]);
    });

    it('変更できない入口があると封鎖は失敗し、残った入口も報告される', () => {
        const realm = createWorkerRealm();
        Object.defineProperty(realm.workerGlobalScopePrototype, 'WebSocketStream', {
            value: () => 'stream',
            writable: false,
            configurable: false,
        });

        expect(() => lockdown(realm)).toThrow(TypeError);
        expect(findLockdownLeaks(realm.scope, realm.functionPrototypes)).toContain('WebSocketStream');
    });
});
