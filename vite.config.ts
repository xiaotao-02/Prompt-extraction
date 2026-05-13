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
    // 临时关闭压缩 + 打开 sourcemap，确保 React 抛错时给的是完整堆栈而不是 #310 这样的数字代码。
    // 排查完后可以恢复 minify: 'esbuild'。
    minify: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/chunk-[hash].js',
      },
    },
  },
});
