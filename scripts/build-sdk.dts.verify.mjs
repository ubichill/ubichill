/**
 * SDK 型定義バンドルの重い検証（buildDts = TS Compiler API フルコンパイル、実測20秒級）。
 *
 * なぜ遅いのか調査済み: zod スキーマの混入が原因ではない（shared の barrel を分離しても
 * 速度は変わらなかった）。実際の原因は dts-bundle-generator が SDK の公開API全体
 * （100件超の再エクスポート型）を1プログラムとして型チェックする際の、TypeScriptチェッカー
 * 側の非線形コスト（多数の複雑な型を組み合わせるほど不均衡に遅くなる）。個々のサブパス
 * （@ubichill/ecs 単体・@ubichill/shared の各サブモジュール単体・UbiSDK単体）はいずれも
 * 数百ms〜1秒程度だが、SDKの公開面全体を1つのプログラムとして通すと20秒前後かかる。
 * dts-bundle-generator にキャッシュ/差分コンパイルの仕組みは無く、既知の軽減策
 * （noCheck オプション、shared の barrel 分離、webworker lib への絞り込み）はいずれも
 * 有意な改善を生まなかった（実測ログはPR参照）。
 *
 * ファイル名を意図的に `*.test.mjs` にしていない（vitest.config.ts の include に引っ掛からない
 * ようにし、通常の `pnpm test`/開発ループを重くしない）。CI・リリース前検証で明示的に実行する:
 *   pnpm exec vitest run scripts/build-sdk.dts.verify.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDts, buildJs, buildPackageJson, ENTRIES } from './build-sdk.mjs';

const INDEX_ENTRY = ENTRIES.find((e) => e.name === 'index');

let indexJs;
let indexDts;
beforeAll(async () => {
    indexJs = await buildJs(INDEX_ENTRY);
    indexDts = buildDts(INDEX_ENTRY);
}, 90000);

describe('buildDts（型定義バンドル・fail-closed）', () => {
    it('@ubichill/ecs, @ubichill/shared への import/export 文が残らない', () => {
        // ここが本題: 未使用の型でも外部モジュール指定子が残っていると consumer 側の
        // tsc が TS2307 で即エラーになることを実験で確認済み（このテストはその再発防止）。
        const codeLines = indexDts.split('\n').filter((l) => /^\s*(import|export)\b/.test(l));
        for (const line of codeLines) {
            expect(line, `import/export 文に外部 @ubichill/* 参照が残っている: ${line}`).not.toMatch(
                /['"]@ubichill\//,
            );
        }
    });

    it("JSDocコメント中の自己参照（{@link import('@ubichill/sdk')...}）は誤検知しない", () => {
        // buildDts 自体のガードが誤検知しないことを確認（コメント行は import/export 文ではない）。
        expect(indexDts).toContain("import('@ubichill/sdk')"); // コメント中に実在する自己参照
    });

    it('ecs由来・shared由来の型が実際にインライン展開され中身がある', () => {
        // System(ecs) / ComponentInstance(shared) の実体定義がインライン化されていること
        expect(indexDts).toMatch(/\bSystem\b/);
        expect(indexDts).toMatch(/\bComponentInstance\b/);
    });
});

describe('統合検証: @ubichill/ecs・@ubichill/shared が存在しない環境でも型チェックが通る', () => {
    it(
        'ビルド済みパッケージを未インストール環境に置いても tsc がエラーを出さない',
        () => {
            const tmp = mkdtempSync(join(tmpdir(), 'ubichill-sdk-consumer-'));
            try {
                const pkgDir = join(tmp, 'node_modules', 'ubichill');
                mkdirSync(pkgDir, { recursive: true });

                writeFileSync(join(pkgDir, 'index.js'), indexJs, 'utf-8');
                writeFileSync(join(pkgDir, 'index.d.ts'), indexDts, 'utf-8');
                writeFileSync(join(pkgDir, 'package.json'), buildPackageJson(), 'utf-8');

                writeFileSync(
                    join(tmp, 'use.ts'),
                    [
                        "import type { System, ComponentInstance } from 'ubichill';",
                        "import { UbiSDK, PROTOCOL_VERSION } from 'ubichill';",
                        'declare const sys: System;',
                        'declare const ci: ComponentInstance;',
                        'console.log(sys, ci, PROTOCOL_VERSION);',
                        'const sdk = new UbiSDK((d: unknown) => console.log(d));',
                        'console.log(sdk);',
                    ].join('\n'),
                    'utf-8',
                );
                writeFileSync(
                    join(tmp, 'tsconfig.json'),
                    JSON.stringify({
                        compilerOptions: {
                            strict: true,
                            noEmit: true,
                            module: 'esnext',
                            moduleResolution: 'bundler',
                            skipLibCheck: false,
                        },
                        include: ['use.ts'],
                    }),
                    'utf-8',
                );

                const tsgoBin = join(process.cwd(), 'node_modules', '.bin', 'tsgo');
                // 失敗時は execFileSync が非ゼロ終了で throw する。stdio 'pipe' でエラー本文を拾う。
                expect(() =>
                    execFileSync(tsgoBin, ['--noEmit', '-p', '.'], { cwd: tmp, stdio: 'pipe' }),
                ).not.toThrow();
            } finally {
                rmSync(tmp, { recursive: true, force: true });
            }
        },
        60000,
    );
});
