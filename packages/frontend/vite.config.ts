import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * dev サーバー専用: /mods/<name>/mod.json を
 * ビルド済み public/ より SOURCE の mods/<name>/mod.json を優先して配信する。
 *
 * これにより `pnpm build:workers` なしでも mod.json の最新メタデータ
 * (capabilities, watchEntityTypes 等) が auto-loader に届く。
 */
const serveSourceModJson = () => ({
    name: 'serve-source-mod-json',
    configureServer(server: import('vite').ViteDevServer) {
        const modsRoot = resolve(__dirname, '../../mods');
        server.middlewares.use('/mods', (req, res, next) => {
            const match = /^\/([^/]+)\/mod\.json$/.exec(req.url ?? '');
            if (!match) return next();
            const sourcePath = join(modsRoot, match[1], 'mod.json');
            if (!existsSync(sourcePath)) return next();
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(readFileSync(sourcePath, 'utf-8'));
        });
    },
});

export default defineConfig({
    // 注意: `plugins` は Vite の予約キー（Vite プラグイン配列）なので mod にリネームしない。
    plugins: [react(), serveSourceModJson()],
    resolve: {
        // monorepo の他パッケージが node_modules/react を別途持っていると build 時に
        // React が 2 つ bundle され、フックが null になる ("Cannot read properties of null (reading 'useRef')").
        // 同じインスタンスを使うよう強制する。
        dedupe: ['react', 'react-dom'],
        // 配列 + 完全一致の正規表現（`^...$`）で指定する。plain object 形式の alias は
        // prefix マッチしてしまい、サブパス（例: @ubichill/shared/mod/errors）が意図せず
        // 親エイリアス（@ubichill/shared）に食われて壊れる（vitest.config.ts と同じ理由。
        // sandbox の worker バンドル時に実測: "../shared/src/index.ts/mod/errors" という
        // 壊れたパスで解決が失敗した）。
        alias: [
            // @/styled-system/* → styled-system/* (src/ 外)、@/ より先に定義
            { find: /^@\/styled-system/, replacement: resolve(__dirname, 'styled-system') },
            { find: /^@\//, replacement: `${resolve(__dirname, 'src')}/` },
            { find: /^@styled-system/, replacement: resolve(__dirname, 'styled-system') },
            { find: /^@styles/, replacement: resolve(__dirname, 'src/styles') },
            { find: /^@ubichill\/sdk$/, replacement: resolve(__dirname, '../sdk/src/index.ts') },
            { find: /^@ubichill\/sandbox$/, replacement: resolve(__dirname, '../sandbox/src/index.ts') },
            { find: /^@ubichill\/ui-renderer$/, replacement: resolve(__dirname, '../ui-renderer/src/index.ts') },
            { find: /^@ubichill\/ecs$/, replacement: resolve(__dirname, '../ecs/src/index.ts') },
            { find: /^@ubichill\/react$/, replacement: resolve(__dirname, '../react/src/index.ts') },
            { find: /^@ubichill\/shared$/, replacement: resolve(__dirname, '../shared/src/index.ts') },
            {
                find: /^@ubichill\/shared\/mod\/entities$/,
                replacement: resolve(__dirname, '../shared/src/mod/entities.ts'),
            },
            {
                find: /^@ubichill\/shared\/mod\/protocol$/,
                replacement: resolve(__dirname, '../shared/src/mod/protocol.ts'),
            },
            {
                find: /^@ubichill\/shared\/mod\/errors$/,
                replacement: resolve(__dirname, '../shared/src/mod/errors.ts'),
            },
            {
                find: /^@ubichill\/shared\/mod\/vnode$/,
                replacement: resolve(__dirname, '../shared/src/mod/vnode.ts'),
            },
            {
                find: /^@ubichill\/shared\/mod\/types$/,
                replacement: resolve(__dirname, '../shared/src/mod/types.ts'),
            },
        ],
    },
    server: {
        port: 3000,
        proxy: {
            // video-player mod 専用バックエンド (Python/FastAPI, port 8000)
            '/mods/video-player/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/mods\/video-player\/api/, ''),
            },
        },
    },
    build: {
        target: 'es2025',
        outDir: 'dist',
    },
});
