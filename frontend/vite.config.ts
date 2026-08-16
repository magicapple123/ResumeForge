import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 后端地址：开发环境通过代理转发 /api，避免前端硬编码跨域地址
const BACKEND_URL = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
});
