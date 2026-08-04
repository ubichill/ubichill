import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * SDK 型定義バンドルの重い検証（scripts/build-sdk.dts.verify.mjs）専用の設定。
 *
 * このファイルは意図的に vitest.config.ts の既定 include（*.test.mjs）に引っ掛からない
 * 名前にしている（通常の `pnpm test` を重くしないため）。`pnpm verify:sdk-types` から
 * `--config vitest.sdk-verify.config.ts` で明示的に呼ぶときだけ実行する。
 *
 * mergeConfig は test.include を配列連結してしまい、通常スイート（24ファイル）も一緒に
 * 再実行され遅くなるため使わない。alias だけを base から引き継ぎ、include は独立させる。
 */
export default defineConfig({
    resolve: baseConfig.resolve,
    test: {
        environment: 'node',
        include: ['scripts/build-sdk.dts.verify.mjs'],
    },
});
