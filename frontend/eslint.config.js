import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Vite writes pre-bundled third-party modules here while the app is running.
  // They are generated caches, not project source, and may contain plugin rules
  // that are intentionally not installed in this repository.
  { ignores: ["dist", "coverage", ".vite"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // react-hooks v7 的 configs.recommended 默认启用了 Compiler 系新规则
      // （set-state-in-effect / refs / use-memo / immutability 等，全量启用会在
      // 现有代码上产生 ~80 个新 error）。这里显式只保留 v5 recommended 等价的
      // 两条经典规则，保持 lint 基线不变；Compiler 系规则的采用留待独立 PR。
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
