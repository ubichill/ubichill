/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    // @vercel/nft が動的 require を静的解析できず standalone に含めない場合に強制インクルード。
    // pnpm が packages/frontend/node_modules/ 以下にシンボリックリンクを作成する。
    ...(process.env.NODE_ENV === 'production' && {
        experimental: {
            outputFileTracingIncludes: {
                '/**': [
                    // @vercel/nft は pnpm 仮想ストアの実パスにファイルを置くが
                    // ホイストシンボリックリンク (node_modules/X) を standalone に再現しない。
                    // ここで明示指定するとシンボリックパスでファイルが置かれ Node.js が解決できる。
                    './node_modules/styled-jsx/**',
                    './node_modules/@swc/helpers/**',
                    './node_modules/@next/env/**',
                    './node_modules/react/**',
                    './node_modules/react-dom/**',
                    './node_modules/scheduler/**',
                ],
            },
        },
    }),
    transpilePackages: [
        '@ubichill/shared',
        '@ubichill/sdk',
        '@ubichill/plugin-pen',
        '@ubichill/plugin-avatar',
        '@ubichill/plugin-video-player',
    ],
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'images.unsplash.com',
            },
        ],
    },
};

module.exports = nextConfig;
