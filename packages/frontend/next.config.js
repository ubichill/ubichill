/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    transpilePackages: [
        '@ubichill/shared',
        '@ubichill/sdk',
        '@ubichill/plugin-pen',
        '@ubichill/plugin-music-player',
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
