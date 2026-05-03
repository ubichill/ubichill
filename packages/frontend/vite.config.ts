import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * dev サーバー専用: /plugins/<name>/plugin.json を
 * ビルド済み public/ より SOURCE の plugins/<name>/plugin.json を優先して配信する。
 *
 * これにより `pnpm build:workers` なしでも plugin.json の最新メタデータ
 * (capabilities, watchEntityTypes 等) が auto-loader に届く。
 */
const serveSourcePluginJson = () => ({
    name: 'serve-source-plugin-json',
    configureServer(server: import('vite').ViteDevServer) {
        const pluginsRoot = resolve(__dirname, '../../plugins');
        server.middlewares.use('/plugins', (req, res, next) => {
            const match = /^\/([^/]+)\/plugin\.json$/.exec(req.url ?? '');
            if (!match) return next();
            const sourcePath = join(pluginsRoot, match[1], 'plugin.json');
            if (!existsSync(sourcePath)) return next();
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(readFileSync(sourcePath, 'utf-8'));
        });
    },
});

export default defineConfig({
    plugins: [react(), serveSourcePluginJson()],
    resolve: {
        alias: {
            // @/styled-system/* → styled-system/* (src/ 外)、@/ より先に定義
            '@/styled-system': resolve(__dirname, 'styled-system'),
            '@': resolve(__dirname, 'src'),
            '@styled-system': resolve(__dirname, 'styled-system'),
            '@styles': resolve(__dirname, 'src/styles'),
            // サブパスを先に定義しないと親エイリアスが優先されてしまう
            '@ubichill/sdk/react': resolve(__dirname, '../sdk/src/react/index.ts'),
            '@ubichill/sdk/ui': resolve(__dirname, '../sdk/src/ui/index.ts'),
            '@ubichill/sdk': resolve(__dirname, '../sdk/src/index.ts'),
            '@ubichill/sandbox': resolve(__dirname, '../sandbox/src/index.ts'),
            '@ubichill/engine': resolve(__dirname, '../engine/src/index.ts'),
            '@ubichill/react': resolve(__dirname, '../react/src/index.ts'),
            '@ubichill/shared': resolve(__dirname, '../shared/src/index.ts'),
        },
    },
    server: {
        port: 3000,
        proxy: {
            // video-player プラグイン専用バックエンド (Python/FastAPI, port 8000)
            '/plugins/video-player/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/plugins\/video-player\/api/, ''),
            },
        },
    },
    build: {
        target: 'es2025',
        outDir: 'dist',
    },
});
