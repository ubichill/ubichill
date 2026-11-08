/**
 * world.html（SNS 無しでワールドを動かす画面）だけを dist-world/ にビルドする。
 *
 * SNS の画面（vite.config.ts → dist/）とは別のビルドにする。入口を world.html だけにするので、chunk は
 * world.html から辿れるコードだけで作られ、CSS も world から辿れるファイルだけから抽出する（panda.world.config.ts）。
 * `@ubichill/cli` の配布物（ubichill dev が配る画面）と自前ホストはこの出力を使い、SNS のビルドに依存しない。
 *
 * public/（同梱の mod・アバターの画像など SNS の配信物）は写さない。world.html が使うアイコンだけを出す。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pandacss from '@pandacss/dev/postcss';
import { mergeConfig, type Plugin, type UserConfig } from 'vite';
import { baseConfig } from './vite.config';

/** Vite が受け取る postcss のプラグインの型。 */
type VitePostcssPlugin = NonNullable<Exclude<NonNullable<UserConfig['css']>['postcss'], string | undefined>['plugins']>[number];

const emitIcon = (): Plugin => ({
    name: 'world-icon',
    apply: 'build',
    generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'icon.png', source: readFileSync(resolve(__dirname, 'public/icon.png')) });
    },
});

const world: UserConfig = {
    publicDir: false,
    plugins: [emitIcon()],
    css: {
        postcss: {
            // Panda が依存する postcss と Vite が依存する postcss の版が違い（8.5.14 / 8.5.28）、型だけが合わない。実行時の形は同じ
            plugins: [pandacss({ configPath: resolve(__dirname, 'panda.world.config.ts') }) as unknown as VitePostcssPlugin],
        },
    },
    build: {
        outDir: 'dist-world',
        emptyOutDir: true,
        rollupOptions: { input: { world: resolve(__dirname, 'world.html') } },
    },
};

export default mergeConfig(baseConfig, world);
