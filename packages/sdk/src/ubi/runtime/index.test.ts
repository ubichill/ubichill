import { UbiErrorCode } from '@ubichill/shared/mod/errors';
import { describe, expect, it } from 'vitest';
import { createRuntimeModule, detectEngineFeatures } from './index';

describe('detectEngineFeatures', () => {
    it('Node の WebAssembly では wasm / simd / exceptions を検出する', () => {
        const features = detectEngineFeatures({ webAssembly: WebAssembly });
        expect(features.has('wasm')).toBe(true);
        expect(features.has('wasm:simd')).toBe(true);
        expect(features.has('wasm:exceptions')).toBe(true);
    });

    it('validate が false を返すエンジンでは SIMD・例外処理を持たない', () => {
        const legacy = { ...WebAssembly, validate: () => false } as typeof WebAssembly;
        const features = detectEngineFeatures({ webAssembly: legacy });
        expect([...features]).toEqual(['wasm']);
    });

    it('validate が例外を投げても判定は落ちない', () => {
        const throwing = {
            ...WebAssembly,
            validate: () => {
                throw new Error('boom');
            },
        } as typeof WebAssembly;
        expect(detectEngineFeatures({ webAssembly: throwing }).has('wasm:simd')).toBe(false);
    });

    it('WebAssembly が無ければ何も持たない', () => {
        expect(detectEngineFeatures({}).size).toBe(0);
    });

    it('スレッドは SharedArrayBuffer と cross-origin isolated の両方が揃ったときだけ', () => {
        const base = { webAssembly: WebAssembly };
        expect(detectEngineFeatures({ ...base, sharedArrayBuffer: SharedArrayBuffer }).has('wasm:threads')).toBe(false);
        expect(detectEngineFeatures({ ...base, crossOriginIsolated: true }).has('wasm:threads')).toBe(false);
        expect(
            detectEngineFeatures({ ...base, sharedArrayBuffer: SharedArrayBuffer, crossOriginIsolated: true }).has(
                'wasm:threads',
            ),
        ).toBe(true);
    });

    it('JSPI は Suspending と promising の両方があるときだけ', () => {
        // 実行中の Node が JSPI を持つかに左右されないよう、必要なメンバーだけの偽物で確かめる。
        const core = { compile: WebAssembly.compile, instantiate: WebAssembly.instantiate, validate: () => true };
        const withJspi = { ...core, Suspending: class {}, promising: () => {} } as unknown as typeof WebAssembly;
        const halfJspi = { ...core, Suspending: class {} } as unknown as typeof WebAssembly;
        expect(detectEngineFeatures({ webAssembly: withJspi }).has('wasm:jspi')).toBe(true);
        expect(detectEngineFeatures({ webAssembly: halfJspi }).has('wasm:jspi')).toBe(false);
    });
});

describe('createRuntimeModule', () => {
    it('require は未対応の機能で UNSUPPORTED_FEATURE を投げ、対応していれば何もしない', () => {
        const runtime = createRuntimeModule(() => 4, { webAssembly: WebAssembly });
        expect(() => runtime.require('wasm')).not.toThrow();
        expect(() => runtime.require('wasm:threads')).toThrow(
            expect.objectContaining({ code: UbiErrorCode.UNSUPPORTED_FEATURE, detail: { feature: 'wasm:threads' } }),
        );
    });

    it('古い Host（プロトコル v3 以前）では asset・fetch:binary を持たない', () => {
        const runtime = createRuntimeModule(() => 3, { webAssembly: WebAssembly });
        expect(runtime.supports('asset')).toBe(false);
        expect(runtime.supports('fetch:binary')).toBe(false);
        expect(runtime.supports('wasm')).toBe(true);
    });
});
