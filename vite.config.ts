import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import manifest from './public/manifest.json';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: {
      input: {
        // 主页面（新标签页打开的完整工具集），CRXJS 不会自动把它作为入口
        index: resolve(process.cwd(), 'index.html'),
        // DevTools「操作录制」面板页，由 devtools_page 通过 panels.create 动态加载
        devtoolsPanel: resolve(process.cwd(), 'src/devtools/panel.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
