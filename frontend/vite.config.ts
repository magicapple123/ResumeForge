import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { defineConfig, loadEnv, type Plugin } from "vite";

// RF-09 方案 A：构建结束时在产物目录写 version.json（{"version": "..."}），
// 供后端同源挂载静态资产时与 app_version 做配对校验（不一致记 ERROR 不阻断启动）。
function distVersionMarker(version: string): Plugin {
  let outDir = "dist";
  return {
    name: "write-dist-version-json",
    apply: "build",
    configResolved(resolvedConfig) {
      outDir = resolvedConfig.build.outDir;
    },
    closeBundle() {
      const markerPath = path.resolve(process.cwd(), outDir, "version.json");
      mkdirSync(path.dirname(markerPath), { recursive: true });
      writeFileSync(markerPath, `${JSON.stringify({ version })}\n`, "utf-8");
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.VITE_BACKEND_URL || "http://127.0.0.1:8000";
  // 在线体验产物：会被官网 iframe 从子路径（GitHub Pages 的 /ResumeForge-demo/）加载，
  // 所以资源引用必须是相对路径。普通构建保持默认的 "/"，不受影响。
  const demoMode = env.VITE_DEMO_MODE === "1";
  const pkgVersion = (JSON.parse(readFileSync("package.json", "utf-8")) as { version: string })
    .version;

  return {
    base: demoMode ? "./" : "/",
    // 开发调试辅助：按住 Alt+Shift（Windows）点击页面元素，自动在 VS Code 中定位到对应源码行。
    // 插件自身只在 dev server 生效，生产构建不受影响。
    plugins: [
      react(),
      codeInspectorPlugin({ bundler: "vite", editor: "code" }),
      distVersionMarker(pkgVersion),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
                id,
              )
            ) {
              return "react-vendor";
            }
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
