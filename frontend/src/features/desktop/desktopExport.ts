// SPDX-License-Identifier: Apache-2.0
/**
 * 「文件 → 导出」的三档下载（#34C）。
 *
 * 三条纪律：
 *  1. **复用既有请求层与下载工具**，不在这里重写 fetch/blob 逻辑：
 *     - 收藏夹 CSV 走 api/jobs.ts 的 downloadFavoritesExport（#28F，后端 CF 带 UTF-8 BOM，
 *       文件名来自 Content-Disposition，前端不重复实现命名规则）；
 *     - 知识库 Markdown 目录走 api/knowledge.ts 的 exportKnowledgeMarkdown（#29，zip +
 *       filename* 解码已封装），落盘用 utils/download.ts 的 downloadBlob；
 *     - 整库备份不在这里：它是页面里的「备份与恢复」（由菜单项导航过去）。
 *  2. 任何失败都收敛成 { ok:false, error }，由容器弹 toast——菜单动作不能把异常抛到 React。
 *  3. 依赖可注入：离线用例不碰网络与真实下载（见 desktopExport.test.ts）。
 */
import { downloadFavoritesExport } from "../../api/jobs";
import { exportKnowledgeMarkdown } from "../../api/knowledge";
import { downloadBlob } from "../../utils/download";

export interface DesktopExportDeps {
  /** 收藏夹 CSV：函数内部自带下载（#28F 的既有实现就这样）。 */
  exportFavoritesCsv: () => Promise<void>;
  /** 知识库 zip：返回 blob 与后端给的文件名，由本模块落盘。 */
  exportKnowledgeZip: () => Promise<{ blob: Blob; filename: string }>;
  download: (blob: Blob, filename: string) => void;
}

const DEFAULT_DEPS: DesktopExportDeps = {
  exportFavoritesCsv: () => downloadFavoritesExport("csv"),
  exportKnowledgeZip: exportKnowledgeMarkdown,
  download: downloadBlob,
};

export interface DesktopExportResult {
  ok: boolean;
  /** 后端给的失败原因（如"知识库为空"）；没有可展示文案时为 undefined。 */
  error?: string;
}

function errorMessage(cause: unknown): string | undefined {
  return cause instanceof Error && cause.message ? cause.message : undefined;
}

/** 收藏夹 → CSV（全部收藏，不带页面筛选）。 */
export async function exportFavoritesCsv(
  deps: Partial<DesktopExportDeps> = {},
): Promise<DesktopExportResult> {
  const resolved = { ...DEFAULT_DEPS, ...deps };
  try {
    await resolved.exportFavoritesCsv();
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  }
}

/** 知识库 → Markdown 目录 zip（空知识库时后端 404，错误文案原样带回给 toast）。 */
export async function exportKnowledgeZip(
  deps: Partial<DesktopExportDeps> = {},
): Promise<DesktopExportResult> {
  const resolved = { ...DEFAULT_DEPS, ...deps };
  try {
    const { blob, filename } = await resolved.exportKnowledgeZip();
    resolved.download(blob, filename);
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  }
}
