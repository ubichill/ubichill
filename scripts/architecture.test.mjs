import { describe, expect, it } from 'vitest';
import { architectureRules, checkFile, importedModules, stripComments } from './architecture.mjs';

const rules = architectureRules({ loaderNodeOnly: new Set(['packages/loader/src/installDependencies.ts']) });
const violations = (path, source) => checkFile(path, source, rules).map((v) => v.rule);

describe('stripComments / importedModules', () => {
    it('コメントの中は見ないが、文字列の中の // は残す', () => {
        const code = stripComments("// import x from 'node:fs'\n/* from 'node:path' */\nconst u = 'https://a.example/x'; // 説明");
        expect(code).not.toContain('node:fs');
        expect(code).not.toContain('node:path');
        expect(code).toContain('https://a.example/x');
        expect(code).not.toContain('説明');
    });

    it('import・export from・import()・副作用の import・require を拾う', () => {
        const source = [
            "import a from 'a';",
            "import type { B } from 'b';",
            "export { c } from 'c';",
            "const d = await import('d');",
            "import 'e';",
            "const f = require('f');",
        ].join('\n');
        expect(importedModules(source).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    });
});

describe('host-runs-mods-without-backend', () => {
    it('mod の経路から Host の API を呼ぶと違反', () => {
        for (const path of [
            'packages/frontend/src/mods/modSignature.ts',
            'packages/loader/src/acquireMod.ts',
            'packages/sandbox/src/host/fetchHandler.ts',
            'packages/react/src/lib/modFetch.ts',
        ]) {
            expect(violations(path, "import { API_BASE } from '@/lib/api';")).toEqual(['host-runs-mods-without-backend']);
            expect(violations(path, 'fetch(`${base}/api/v1/mods/signature/verify`)')).toEqual(['host-runs-mods-without-backend']);
        }
    });

    it('説明のコメント・テスト・mod の経路の外は対象にしない', () => {
        expect(violations('packages/sandbox/src/host/fetchHandler.ts', '/**\n * コアの `/api/v1/…` は null\n */')).toEqual([]);
        expect(violations('packages/frontend/src/mods/x.test.ts', "fetch('/api/v1/x')")).toEqual([]);
        expect(violations('packages/frontend/src/lib/serviceTokens.ts', "fetch(`${API_BASE}/api/v1/service-tokens`)")).toEqual([]);
    });
});

describe('shared-is-pure', () => {
    it('Node・DOM・ネットワークに依存すると違反', () => {
        for (const source of ["import { readFileSync } from 'node:fs';", 'window.location.href', 'localStorage.getItem(k)', 'await fetch(url)']) {
            expect(violations('packages/shared/src/x.ts', source)).toEqual(['shared-is-pure']);
        }
    });

    it('型の名前や説明（Ubi.fetch）は違反にしない', () => {
        expect(violations('packages/shared/src/mod/types.ts', '/** Ubi.fetch() の型 */\nexport type FetchResult = {};')).toEqual([]);
    });
});

describe('loader-main-is-browser-safe', () => {
    it('既定の入口から読まれるファイルが Node のモジュールを読むと違反。Node 専用の入口は除く', () => {
        expect(violations('packages/loader/src/acquireMod.ts', "import fs from 'node:fs';")).toEqual(['loader-main-is-browser-safe']);
        expect(violations('packages/loader/src/installDependencies.ts', "import fs from 'node:fs';")).toEqual([]);
    });
});

describe('backend-runs-built-packages-only', () => {
    it('ソースのまま配るパッケージに依存すると違反（node_modules の中の .ts は実行できない）', () => {
        for (const m of ['@ubichill/loader', '@ubichill/react', '@ubichill/sandbox/host', '@ubichill/sdk']) {
            expect(violations('packages/backend/src/x.ts', `import { a } from '${m}';`)).toEqual(['backend-runs-built-packages-only']);
        }
        expect(violations('packages/backend/src/x.ts', "import { a } from '@ubichill/shared';")).toEqual([]);
        expect(violations('packages/backend/src/x.ts', "import { db } from '@ubichill/db';")).toEqual([]);
    });
});

describe('signatures-in-one-place', () => {
    it('署名の部品の外で Ed25519 の照合を呼ぶと違反', () => {
        for (const path of ['packages/backend/src/routes/cliAuth.ts', 'packages/frontend/src/mods/modSignature.ts', 'packages/sdk/cli/verify.ts']) {
            expect(violations(path.replace('packages/sdk/cli', 'packages/sdk/src'), 'await crypto.verifyEd25519(key, message, sig)')).toEqual([
                'signatures-in-one-place',
            ]);
        }
    });

    it('署名の部品・暗号の実装（定義）・テストは対象にしない', () => {
        const call = 'await crypto.verifyEd25519(key, message, sig)';
        expect(violations('packages/shared/src/signature/envelope.ts', call)).toEqual([]);
        expect(violations('packages/shared/src/user/cliAuth.ts', call)).toEqual([]);
        expect(violations('packages/loader/src/worldCrypto.ts', 'verifyEd25519: async (publicKey, message, signature) => {')).toEqual([]);
        expect(violations('packages/backend/src/x.test.ts', call)).toEqual([]);
    });
});

describe('mods-use-public-sdk-only', () => {
    it('mod が内部パッケージを読むと違反、公開パッケージは良い', () => {
        expect(violations('mods/pen/src/pen.worker.ts', "import { Ubi } from '@ubichill/sdk';")).toEqual(['mods-use-public-sdk-only']);
        expect(violations('mods/pen/src/pen.worker.ts', "import { Ubi } from 'ubichill';")).toEqual([]);
    });
});

describe('違反の報告', () => {
    it('規則の理由を添えて返す（落ちたときに直し方が分かるように）', () => {
        const [v] = checkFile('packages/shared/src/x.ts', "import 'node:fs';", rules);
        expect(v).toMatchObject({ rule: 'shared-is-pure', path: 'packages/shared/src/x.ts' });
        expect(v?.why.length).toBeGreaterThan(10);
    });
});
