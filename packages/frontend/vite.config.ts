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
