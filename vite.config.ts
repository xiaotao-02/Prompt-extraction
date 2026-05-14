import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import manifest from './src/manifest.config';

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5174,
    },
  },
  build: {
    target: 'esnext',
    // 默认仍然为开发体验保留：不压缩 + 带 sourcemap，便于 React 抛错时拿到完整堆栈。
    // 上架商店时通过 STORE=1 环境变量切到生产模式：开启 esbuild 压缩 + 关闭 sourcemap，
    // 减小 zip 体积、避免源码以 sourcemap 形式直接外泄给最终用户。
    // 入口脚本：`npm run release:store`。
    minify: process.env.STORE === '1' ? 'esbuild' : false,
    sourcemap: process.env.STORE === '1' ? false : true,
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/chunk-[hash].js',
      },
    },
  },
});
