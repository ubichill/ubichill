import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
    plugins: [react()],
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
            '@ubichill/sandbox/host': resolve(__dirname, '../sandbox/src/host/index.ts'),
            '@ubichill/sandbox': resolve(__dirname, '../sandbox/src/index.ts'),
            '@ubichill/engine': resolve(__dirname, '../engine/src/index.ts'),
            '@ubichill/react': resolve(__dirname, '../react/src/index.ts'),
            '@ubichill/shared': resolve(__dirname, '../shared/src/index.ts'),
        },
    },
    server: {
        port: 3000,
    },
    build: {
        outDir: 'dist',
    },
});
