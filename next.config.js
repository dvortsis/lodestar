const createNextIntlPlugin = require('next-intl/plugin');

const withNextIntl = createNextIntlPlugin('./i18n');

const mode = process.env.BUILD_MODE ?? 'standalone';
console.log("[Next] build mode:", mode);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: mode,
  // Add these two blocks to prevent GitHub Actions from freezing
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: [
      '@node-rs/jieba'
    ]
  }
}

module.exports = withNextIntl(nextConfig);