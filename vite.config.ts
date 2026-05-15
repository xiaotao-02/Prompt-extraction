import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import fs from 'node:fs';
import type { Connect } from 'vite';
import manifest from './src/manifest.config';

/** dev 专用：聚合 iframe 指向 popup / options / 面板预览，随 HMR 与本机源码一致。 */
function devUiPreviewGallery(): import('vite').Plugin {
  const galleryAbs = path.resolve(__dirname, 'src/dev/preview/gallery.html');
  return {
    name: 'dev-ui-preview-gallery',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (
          url === '/__dev__/ui-preview' ||
          url === '/__dev__/ui-preview/' ||
          url === '/__dev__/ui-preview/index.html'
        ) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(fs.readFileSync(galleryAbs, 'utf-8'));
          return;
        }
        next();
      }) as Connect.NextHandleFunction);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devUiPreviewGallery(), crx({ manifest })],
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
        manualChunks(id) {
          if (/[/\\]node_modules[/\\](react-dom|scheduler)[/\\]/.test(id)) {
            return 'vendor-react-dom';
          }
          if (/[/\\]node_modules[/\\]react[/\\]/.test(id)) {
            return 'vendor-react';
          }
          if (/[/\\]node_modules[/\\]lucide-react[/\\]/.test(id)) {
            return 'vendor-lucide';
          }
        },
      },
    },
  },
});
