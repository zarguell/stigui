import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'export',
    // GitHub Pages serves project sites from a subpath
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
    typescript: {
        ignoreBuildErrors: true,
    },
    eslint: {
        ignoreDuringBuilds: true,
    },
};

export default nextConfig;
