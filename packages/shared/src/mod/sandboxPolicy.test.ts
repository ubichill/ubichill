import { describe, expect, it } from 'vitest';
import { isSandboxWorkerScriptPath, SANDBOX_WORKER_CSP } from './sandboxPolicy';

describe('isSandboxWorkerScriptPath', () => {
    it.each([
        '/@fs/Users/me/ubichill/packages/sandbox/src/worker/sandbox.worker.ts',
        '/assets/sandbox.worker-B3x_9k-Q.js',
        'assets/sandbox.worker.js',
        '/frontend/dist/assets/sandbox.worker-abc123.js',
    ])('Sandbox Worker のスクリプト: %s', (path) => {
        expect(isSandboxWorkerScriptPath(path)).toBe(true);
    });

    it.each([
        '/assets/index-abc123.js',
        '/assets/sandbox.worker-abc.js.map',
        '/assets/mysandbox.worker.js',
        '/assets/sandbox.worker-abc.css',
        '/mods/pen/v1.0.0/sandbox.worker.json',
        '/assets/sandbox.worker.ts/evil.js',
    ])('それ以外: %s', (path) => {
        expect(isSandboxWorkerScriptPath(path)).toBe(false);
    });
});

describe('SANDBOX_WORKER_CSP', () => {
    const directives = new Map(
        SANDBOX_WORKER_CSP.split(';').map((d) => {
            const [name, ...values] = d.trim().split(/\s+/);
            return [name, values] as const;
        }),
    );

    it('既定ですべて拒否し、通信系のディレクティブを個別に緩めていない', () => {
        expect(directives.get('default-src')).toEqual(["'none'"]);
        for (const name of ['connect-src', 'worker-src', 'font-src', 'img-src', 'media-src']) {
            expect(directives.has(name), name).toBe(false);
        }
    });

    it('スクリプトは同一オリジンのみ（外部 URL・data:・blob: を許さない）', () => {
        const scriptSrc = directives.get('script-src') ?? [];
        expect(scriptSrc).toContain("'self'");
        expect(scriptSrc.filter((v) => !v.startsWith("'"))).toEqual([]);
        expect(scriptSrc).toContain("'wasm-unsafe-eval'");
    });
});
