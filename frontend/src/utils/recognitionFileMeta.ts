// SPDX-License-Identifier: Apache-2.0
/**
 * 暂存文件的纯判定与文案：体积格式化、是否按 PDF 处理。
 *
 * 从 `components/RecognitionFilePreview.tsx` 拆出来（2026-10-23）。拆的理由只有一条：
 * 那个文件同时导出组件与普通函数，`react-refresh/only-export-components` 会因此失效
 * ——改一次预览样式都会整块刷新，测试之外的热更新体验也就没了。这两个函数本来就是
 * 纯函数（没有任何 React 依赖），放在 `utils/` 里也更容易被识别与断言。
 */
import type { StagedFile } from "../hooks/useRecognitionFiles";

/** 体积文案：B / KB / MB（MB 保留一位小数）。 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 是否按 PDF 处理：MIME 与扩展名任一命中即可（用户给的 MIME 不一定可信）。 */
export function isPdfFile(file: StagedFile): boolean {
  const mime = file.mime_type.split(";", 1)[0].trim().toLowerCase();
  return mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}
