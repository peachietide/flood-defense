import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 说明：
// - `npm run dev` 起开发服务器，热更新。
// - `npm run build` 产出 dist/index.html —— 单文件、内联全部 JS，
//   拷给别人双击就能开，不需要服务器、不需要外网。
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
    cssCodeSplit: false,
  },
});
