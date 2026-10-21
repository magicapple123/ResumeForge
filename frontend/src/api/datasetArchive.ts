// SPDX-License-Identifier: Apache-2.0
/**
 * 数据集备份包的导出，以及**包内范围**的解析（H2 附件告警 + H3 未覆盖项）。
 *
 * 从 `settings.ts` 拆出（生产代码 500 行预算）：导出返回的是二进制压缩包 + 若干
 * `X-Backup-*` 响应头，与那边一整排"读写设置 JSON"的接口是两套关注点，混在一个文件里
 * 只会让两边都变长。`settings.ts` 原样转发本模块的导出，既有 import 路径不受影响。
 */
import { getFilenameFromDisposition, requestRaw } from "./client";

/** 导出指定数据集（默认**包含**大模型 API Key；显式取消后剥离）。 */
export async function exportDataset(
  id: string,
  includeApiKeys = true,
  includeGlobalLLM = true,
  /** 下载名（可含中文）；省略时后端用「<数据集名>-<时间戳>.zip」。 */
  filename?: string,
): Promise<ArchiveDownload> {
  return downloadArchive(
    exportUrl(`/settings/datasets/${id}/export`, includeApiKeys, includeGlobalLLM, filename),
  );
}

/**
 * 导出**全部数据集**：当前活动的那份 + 列表里其余每一份。
 *
 * 与 `exportDataset` 的区别是"包里有没有其余数据集"。默认的导出只带当前这一份——多份
 * 数据集的用户如果按默认方式备份，其余几份不会进包，而这种事通常要到需要恢复时才发现。
 */
export async function exportAllDatasets(
  includeApiKeys = true,
  includeGlobalLLM = true,
  filename?: string,
): Promise<ArchiveDownload> {
  return downloadArchive(
    exportUrl("/settings/datasets/export-all", includeApiKeys, includeGlobalLLM, filename),
  );
}

/**
 * 拼导出 URL：始终显式带两个开关（后端默认 true），否则"取消勾选"会被当成缺省值
 * 重新包含。`include_global_llm` 控制整个 `global_llm.json` 段，不是只控密钥。
 */
function exportUrl(
  base: string,
  includeApiKeys: boolean,
  includeGlobalLLM: boolean,
  filename?: string,
): string {
  const params = [
    `include_api_keys=${includeApiKeys ? "true" : "false"}`,
    `include_global_llm=${includeGlobalLLM ? "true" : "false"}`,
  ];
  const name = (filename || "").trim();
  if (name) params.push(`filename=${encodeURIComponent(name)}`);
  return `${base}?${params.join("&")}`;
}

/** 附件告警计数（H2）：三类分开报，界面按类型写文案。 */
export interface BackupAssetIssues {
  /** 这次导出时磁盘上找不到（新缺失）→ 包里不包含。 */
  missing: number;
  /** 文件在，但字节与数据库登记的 SHA-256 不符 → 包里是当前磁盘上的那一份。 */
  mismatched: number;
  /** 数据集导入时就已缺失 → 只做说明，不算"不完整"。 */
  missingAtImport: number;
  /** 仅新缺失或哈希不符时为 true（后端 X-Backup-Incomplete）。 */
  incomplete: boolean;
}

/**
 * 本次导出**没有**纳入备份的数据目录顶层项（R17/H3）。
 *
 * 与 `BackupAssetIssues` 是两件事：那边是"被简历引用的附件丢了"，这里是"数据目录里
 * 还有别的东西（例如用户自己放进数据目录的文件、新功能写出的新目录）没进这个包"。前者
 * 意味着这份备份不完整、恢复后会缺附件；后者只是**范围**说明——用户需要知道"这个包
 * 不等于整个数据目录"，否则换机恢复后才发现少东西。包里 `manifest.json` 的 `uncovered`
 * 段逐项列出。
 */
export interface BackupCoverage {
  /** 未纳入备份的顶层项数量；`truncated` 为 true 时这只是下限。 */
  count: number;
  /** 这些项的总字节数（界面换算成可读体积展示）。 */
  bytes: number;
  /** 扫描达到上限（5000 文件 / 3 层），`count` 与 `bytes` 都只是下限。 */
  truncated: boolean;
}

export interface ArchiveDownload {
  blob: Blob;
  filename: string;
  /** 兼容既有调用点：等价于 assetIssues.incomplete。 */
  incompleteBackup: boolean;
  assetIssues: BackupAssetIssues;
  /** 没进这个包的数据目录顶层项（后端 X-Backup-Uncovered* 三个响应头）。 */
  coverage: BackupCoverage;
}

function headerCount(headers: Headers, name: string): number {
  const raw = Number(headers.get(name) ?? "0");
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0;
}

async function downloadArchive(url: string): Promise<ArchiveDownload> {
  // 响应是二进制压缩包，不是 JSON：走 requestRaw（错误分类/诊断与 request() 一致），
  // 导出大包走 export 预算（10 分钟），不吃 15s 的默认超时。
  const resp = await requestRaw(url, { budget: "export" });
  // RR-03 / H2：包里有附件缺失/与登记哈希不符时后端会在响应头标出来——不读它就会把
  // 一份不完整的备份播报成"完整备份成功"。三类计数分开读，文案才能说清是哪一种。
  const assetIssues: BackupAssetIssues = {
    missing: headerCount(resp.headers, "X-Backup-Asset-Missing"),
    mismatched: headerCount(resp.headers, "X-Backup-Asset-Mismatched"),
    missingAtImport: headerCount(resp.headers, "X-Backup-Asset-Missing-At-Import"),
    incomplete: resp.headers.get("X-Backup-Incomplete") === "1",
  };
  // H3：包里装了什么之外的**范围**也要读出来——数据目录里可能还有字体、手工放进去的
  // 文件等没进包的东西。三个头都缺（旧后端）时 count 为 0，界面一个字都不用多说。
  const coverage: BackupCoverage = {
    count: headerCount(resp.headers, "X-Backup-Uncovered"),
    bytes: headerCount(resp.headers, "X-Backup-Uncovered-Bytes"),
    truncated: resp.headers.get("X-Backup-Uncovered-Truncated") === "1",
  };
  return {
    blob: await resp.blob(),
    filename:
      getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ??
      "resumeforge-backup.zip",
    incompleteBackup: assetIssues.incomplete,
    assetIssues,
    coverage,
  };
}
