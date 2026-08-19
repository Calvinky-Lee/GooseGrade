/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace packages ship raw TypeScript with no build step, which keeps the engine
  // importable by the UI, the API layer, and the containerized QA runner from one source.
  // Next has to compile them itself.
  transpilePackages: ['@goosegrade/types', '@goosegrade/engine', '@goosegrade/api'],
};

export default nextConfig;
