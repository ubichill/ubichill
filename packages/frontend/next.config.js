/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    transpilePackages: ['@ubichill/shared'],
};

module.exports = nextConfig;
