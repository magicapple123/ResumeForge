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
      // react-hooks v7 全量规则（含 Compiler 系）：2026-10-07 按评审解锁链采纳。
      // 92 处存量违规已清掉 19（refs/use-memo/immutability 全清，error 级）；
      // 剩余 73 处 set-state-in-effect（弹窗重置 + 数据加载钩子两族）以 warn
      // 挂出、逐批改写（每次改完可就地升回 error），不影响 lint 门禁。
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/static-components": "error",
      "react-hooks/use-memo": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/immutability": "error",
      "react-hooks/globals": "error",
      "react-hooks/refs": "error",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/error-boundaries": "error",
      "react-hooks/purity": "error",
      "react-hooks/set-state-in-render": "error",
      "react-hooks/unsupported-syntax": "warn",
      "react-hooks/config": "error",
      "react-hooks/gating": "error",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
