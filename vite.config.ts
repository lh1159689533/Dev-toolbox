import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // 显式加载 .env.local 中的变量（不限 VITE_ 前缀）
  const env = loadEnv(mode, process.cwd(), '');

  const GIT_TOKEN = env.GIT_TOKEN || '';
  const TAPD_AUTH = env.TAPD_AUTH || ''; // 个人访问令牌（Access Token）

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // 工蜂 OpenAPI 代理（工蜂使用 /api/v3，认证头 PRIVATE-TOKEN）
        '/git-api': {
          target: 'https://git.woa.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/git-api/, '/api/v3'),
          headers: GIT_TOKEN ? { 'PRIVATE-TOKEN': GIT_TOKEN } : {},
        },
        // TAPD OpenAPI 代理（个人访问令牌用 Bearer 认证）
        '/tapd-api': {
          target: 'http://apiv2.tapd.woa.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/tapd-api/, ''),
          headers: TAPD_AUTH
            ? { Authorization: `Bearer ${TAPD_AUTH}` }
            : {},
        },
      },
    },
  };
});
