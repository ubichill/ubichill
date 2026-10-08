import { describe, expect, it } from 'vitest';
import { isSandboxWorkerScriptPath, SANDBOX_WORKER_CSP, sandboxWorkerDevCsp } from './sandboxPolicy';

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

function directivesOf(csp: string) {
    return new Map(
        csp.split(';').map((d) => {
            const [name, ...values] = d.trim().split(/\s+/);
            return [name, values] as const;
        }),
    );
}

describe('SANDBOX_WORKER_CSP', () => {
    const directives = directivesOf(SANDBOX_WORKER_CSP);

    it('既定ですべて拒否し、通信系のディレクティブを個別に緩めていない', () => {
        expect(directives.get('default-src')).toEqual(["'none'"]);
        for (const name of ['connect-src', 'worker-src', 'font-src', 'img-src', 'media-src']) {
            expect(directives.has(name), name).toBe(false);
        }
    });

    it("スクリプトの URL を 1 つも許可しない（'self' も無い＝同一オリジンの mod の JS も import できない）", () => {
        expect(directives.get('script-src')).toEqual(["'unsafe-eval'", "'wasm-unsafe-eval'"]);
    });
});

describe('sandboxWorkerDevCsp', () => {
    it("渡したパスだけを許可し、'self' やワイルドカードを足さない", () => {
        const sources = [
            'http://localhost:3000/@fs/repo/packages/sdk/src/',
            'http://localhost:3000/node_modules/.vite/deps/',
        ];
        const directives = directivesOf(sandboxWorkerDevCsp(sources));
        expect(directives.get('default-src')).toEqual(["'none'"]);
        expect(directives.get('script-src')).toEqual([...sources, "'unsafe-eval'", "'wasm-unsafe-eval'"]);
    });
});
