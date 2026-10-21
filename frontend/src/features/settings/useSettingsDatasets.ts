// SPDX-License-Identifier: Apache-2.0
import { App } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  activateDataset,
  createDataset,
  deleteDataset,
  exportAllDatasets,
  exportDataset,
  importDataset,
  listDatasets,
  renameDataset,
} from "../../api/settings";
import type { BackupAssetIssues, BackupCoverage } from "../../api/settings";
import type { DatasetInfo } from "../../types";
import { formatErrorGuidance, isDatasetScopeExpired } from "../../api/errorGuidance";
import { initializeDatasetScope } from "../../api/datasetScope";
import { downloadBlob } from "../../utils/download";
import { formatBytes } from "../../utils/format";
import { reloadPage } from "../../utils/navigation";
import { describeImportIssues } from "./datasetImportFeedback";

/**
 * 未纳入备份的数据目录项（R17/H3）的提示文案；没有未覆盖项时返回 null。
 *
 * 这条只说**范围**，不说"备份失败"：包本身是好的，只是数据目录里还有些东西（用户自己
 * 放进数据目录的文件、新功能写出的新目录等）不在里面。`truncated` 时后端扫描到了上限，
 * 数量只是下限，必须说成"至少 N 项"，不能让用户以为是精确值。
 */
function describeUncovered(coverage?: BackupCoverage): string | null {
  if (!coverage || coverage.count <= 0) return null;
  const amount = coverage.truncated ? `至少 ${coverage.count} 项` : `${coverage.count} 项`;
  const size = coverage.bytes > 0 ? `（${formatBytes(coverage.bytes)}）` : "";
  return (
    `另有 ${amount}${size}未纳入备份：它们在数据目录里，但不在这个包里；` +
    "详见包内 manifest.json 的 uncovered 段"
  );
}

/** 设置页「数据」页里数据集的加载、导出、导入、切换、重命名、删除与新建。 */
export function useSettingsDatasets() {
  const { message, modal } = App.useApp();
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [datasetExporting, setDatasetExporting] = useState(false);
  const [datasetImporting, setDatasetImporting] = useState(false);
  // 全局模型配置（所有已保存记录）：默认随包导出（用户 2026-10-19 要求）。
  // 2026-10-20 起不再单独提供「包含 API Key」开关：勾选这一项就一并带上密钥，
  // 取消则两者都不带——用户不需要理解"配置段"和"密钥"是两份东西。
  const [includeGlobalLLM, setIncludeGlobalLLM] = useState(true);
  const [switchingDatasetId, setSwitchingDatasetId] = useState<string | null>(null);
  const [renamingDatasetId, setRenamingDatasetId] = useState<string | null>(null);
  const [deletingDatasetId, setDeletingDatasetId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<DatasetInfo | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [datasetCreating, setDatasetCreating] = useState(false);
  const [createDatasetOpen, setCreateDatasetOpen] = useState(false);
  const [createDatasetName, setCreateDatasetName] = useState("");

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新。
  const fetchDatasetList = useCallback(async (): Promise<DatasetInfo[] | null> => {
    try {
      return await listDatasets();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载数据集失败");
      return null;
    }
  }, [message]);

  // Compiler 规范：初始加载的 setState 放 .then 回调（外部数据到达时应用）。
  useEffect(() => {
    let cancelled = false;
    void fetchDatasetList().then((items) => {
      if (cancelled) return;
      if (items !== null) setDatasets(items);
      setDatasetsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchDatasetList]);

  // 事件路径（切换/删除/导入后的整表重拉，含 loading 翻动）。
  const loadDatasetList = useCallback(async () => {
    setDatasetsLoading(true);
    const items = await fetchDatasetList();
    if (items !== null) setDatasets(items);
    setDatasetsLoading(false);
  }, [fetchDatasetList]);

  /**
   * 导出结果提示（H2）：把"新缺失 / 哈希不符 / 导入时就缺"分开说。
   *
   * 旧文案把三类合成一句"备份不完整"：用户看到 310 个自导入起就不存在的附件也在报警，
   * 只能学会忽略这条警告。现在只有**这次导出真的丢了文件**才说"不完整"。
   */
  const reportBackupIssues = (
    successText: string,
    issues: BackupAssetIssues,
    coverage?: BackupCoverage,
  ) => {
    const parts: string[] = [];
    // 未覆盖项是**范围**说明，与上面三类附件问题分开播报：即使这份备份在附件上不完整，
    // 用户也需要知道"这个包不等于整个数据目录"。
    const uncovered = describeUncovered(coverage);
    if (issues.missing > 0) {
      parts.push(`有 ${issues.missing} 个被引用的附件在磁盘上找不到，备份里不包含它们`);
    }
    if (issues.mismatched > 0) {
      parts.push(`${issues.mismatched} 个附件内容与数据库登记不符，包里装的是当前磁盘上的字节`);
    }
    if (parts.length > 0) {
      message.warning(`${successText}，但这份备份「不完整」：${parts.join("；")}`);
      if (uncovered) message.info(uncovered);
      return;
    }
    message.success(successText);
    if (issues.missingAtImport > 0) {
      message.info(
        `另有 ${issues.missingAtImport} 个附件在该数据集导入时就已缺失，已在包内清单注明`,
      );
    }
    if (uncovered) message.info(uncovered);
  };

  const runDatasetExport = async (dataset: DatasetInfo, downloadName?: string) => {
    if (datasetExporting) return;
    setDatasetExporting(true);
    try {
      const { blob, filename, assetIssues, coverage } = await exportDataset(
        dataset.id,
        includeGlobalLLM,
        includeGlobalLLM,
        downloadName,
      );
      downloadBlob(blob, filename);
      reportBackupIssues(`已导出「${dataset.name}」到浏览器的下载目录`, assetIssues, coverage);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导出数据集失败");
    } finally {
      setDatasetExporting(false);
    }
  };

  const runExportAllDatasets = async (downloadName?: string) => {
    if (datasetExporting) return;
    setDatasetExporting(true);
    try {
      const { blob, filename, assetIssues, coverage } = await exportAllDatasets(
        includeGlobalLLM,
        includeGlobalLLM,
        downloadName,
      );
      downloadBlob(blob, filename);
      reportBackupIssues(
        `已把全部 ${datasets.length} 份数据集导出到浏览器的下载目录`,
        assetIssues,
        coverage,
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导出全部数据集失败");
    } finally {
      setDatasetExporting(false);
    }
  };

  const importDatasetFile = async (file: File, name: string, allowPartialAssets = false) => {
    if (datasetImporting) return;
    setDatasetImporting(true);
    try {
      const created = await importDataset(file, name, allowPartialAssets);
      await loadDatasetList();
      // "导出全部数据集"产生的包里会随行带上其余几份，导入时它们也各成一份新数据集。
      // 只报主数据集的名字会让用户以为另外几份没被恢复。
      const extras = created.restored_datasets?.length ?? 0;
      // 勾选过"包含 API Key"的包要如实告诉用户密钥也回来了（换机器解不开时仍需重填）。
      const parts = [`已导入数据集「${created.name}」`];
      if (extras > 0) {
        // 逐份点名（最多 3 个）：只说"另外 N 份"，用户还是不知道恢复了哪几份。
        const names = (created.restored_datasets ?? [])
          .map((dataset) => dataset.name)
          .filter(Boolean);
        const shownNames = names.slice(0, 3).join("、");
        parts.push(
          `并随包恢复了另外 ${extras} 份数据集` +
            (shownNames ? `（${shownNames}${names.length > 3 ? " 等" : ""}）` : ""),
        );
      }
      if (created.api_key_included) parts.push("备份中的大模型 API Key 已一并恢复");
      // 全局模型配置是"数据集之外"的一段：恢复条数与跳过原因都要说清楚，
      // 否则用户只看到数据集恢复，以为配置也回来了（或反之）。
      const globalLlm = created.global_llm;
      const globalFailed = Boolean(globalLlm?.error);
      if (globalLlm?.error) {
        parts.push(`全局模型配置未能导入（${globalLlm.error}）`);
      } else if (globalLlm && (globalLlm.imported || globalLlm.updated)) {
        const restored = (globalLlm.imported ?? 0) + (globalLlm.updated ?? 0);
        parts.push(
          `全局模型配置已恢复 ${restored} 条` +
            (globalLlm.skipped ? `（跳过 ${globalLlm.skipped} 条同名）` : ""),
        );
      } else if (globalLlm?.skipped) {
        parts.push(`全局模型配置 ${globalLlm.skipped} 条与本地同名，已保留本地版本`);
      }
      // 自定义字体（data/fonts/）随包导出：恢复了几份、有几份因为本机已有同名文件而
      // 保留本机版本，都要说清楚——用户可能正是因为"换机后字体要重新上传"才做备份的。
      // 注意字体与附件是两套口径：字体问题不进 problems，也不影响"这份备份完整与否"。
      const restoredFonts = created.restored_fonts ?? 0;
      if (restoredFonts > 0) parts.push(`恢复了 ${restoredFonts} 个自定义字体`);
      const skippedFonts = created.skipped_fonts ?? 0;
      if (skippedFonts > 0) parts.push(`${skippedFonts} 个同名字体保留本机版本`);
      // RR-03：带着附件问题导入时不得呈现成"完整恢复"——问题逐条（最多 3 条）摆出来。
      const problems = [...(created.backup_asset_warnings ?? []), ...(created.asset_issues ?? [])];
      if (created.assets_incomplete || problems.length > 0 || globalFailed) {
        const shown = problems.slice(0, 3).join("；");
        message.warning(
          `${parts.join("，")}；当前数据未受影响，但这份备份「不完整」：` +
            (shown || "附件存在缺失或校验不一致") +
            (problems.length > 3 ? `（共 ${problems.length} 条）` : ""),
        );
      } else {
        message.success(`${parts.join("，")}；当前数据未受影响`);
      }
      // 字体没能完全恢复只影响 PDF 导出的字形，**不算**这份备份不完整：单独一条提示，
      // 绝不并进上面那条"备份不完整"的分支（那会让用户以为简历里的附件丢了）。
      const fontIssues = created.font_issues ?? [];
      if (fontIssues.length > 0) {
        message.warning(
          `字体未完全恢复：${fontIssues.slice(0, 3).join("；")}` +
            (fontIssues.length > 3 ? `（共 ${fontIssues.length} 条）` : ""),
        );
      }
      // R16：整包逐份恢复，坏一份不影响其它份。成功提示之后必须点名没恢复的那几份，
      // 否则用户会把"恢复了一部分"当成"整包都回来了"。
      const trouble = describeImportIssues(created.failed, created.skipped);
      if (trouble) message.warning(trouble);
    } catch (err) {
      const text = err instanceof Error ? err.message : "导入备份失败";
      // 附件完整性问题默认让整次导入失败（写盘前就拒绝）。这里给用户一条显式出路：
      // 明确告知代价后，才带着"跳过有问题的附件"重试。
      if (text.includes("附件未通过校验")) {
        modal.confirm({
          title: "备份包的附件有问题",
          content: `${text}\n\n可以选择跳过有问题的附件，只导入数据库内容（这些附件在你本机的原文件不会被改动）。`,
          okText: "跳过附件继续导入",
          cancelText: "取消",
          onOk: () => importDatasetFile(file, name, true),
        });
      } else {
        message.error(text);
      }
    } finally {
      setDatasetImporting(false);
    }
  };

  const switchDataset = async (dataset: DatasetInfo) => {
    if (switchingDatasetId !== null) return;
    setSwitchingDatasetId(dataset.id);
    try {
      try {
        await activateDataset(dataset.id);
      } catch (err) {
        // 只有「页面 token 过期」能自助修：重新同步身份后重试一次。
        // 「数据集正在切换中」「排空超时」两类 409 保持原行为——重试只会再撞一次。
        if (!isDatasetScopeExpired(err)) throw err;
        await initializeDatasetScope();
        await activateDataset(dataset.id);
      }
      message.success(`已切换到「${dataset.name}」，正在重新加载页面`);
      // 整页重载：切换后所有本地状态都要按新数据集重建。失败时保留 loading 以便重试。
      window.setTimeout(reloadPage, 800);
    } catch (err) {
      // RF-20：失败不只显示原始异常——给「原因 + 建议 + 编号」指引。
      message.error(formatErrorGuidance(err, "切换数据集失败"));
      setSwitchingDatasetId(null);
    }
  };

  const confirmDatasetRename = async () => {
    if (!renameTarget || renamingDatasetId !== null) return;
    setRenamingDatasetId(renameTarget.id);
    try {
      await renameDataset(renameTarget.id, renameValue);
      setRenameTarget(null);
      await loadDatasetList();
      message.success("已重命名");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setRenamingDatasetId(null);
    }
  };

  const removeDataset = async (dataset: DatasetInfo) => {
    if (deletingDatasetId !== null) return;
    setDeletingDatasetId(dataset.id);
    try {
      await deleteDataset(dataset.id);
      await loadDatasetList();
      message.success(`已删除「${dataset.name}」，可在 data/datasets/.trash/ 找回`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除数据集失败");
    } finally {
      setDeletingDatasetId(null);
    }
  };

  const createEmptyDataset = async () => {
    const name = createDatasetName.trim();
    if (!name) {
      message.warning("请填写数据集名称");
      return;
    }
    if (datasetCreating) return;
    setDatasetCreating(true);
    try {
      const created = await createDataset(name);
      await loadDatasetList();
      setCreateDatasetOpen(false);
      setCreateDatasetName("");
      message.success(`已新建数据集「${created.name}」，可在列表里切换到它`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "新建数据集失败");
    } finally {
      setDatasetCreating(false);
    }
  };

  return {
    datasets,
    datasetsLoading,
    datasetExporting,
    datasetImporting,
    includeGlobalLLM,
    setIncludeGlobalLLM,
    switchingDatasetId,
    renamingDatasetId,
    deletingDatasetId,
    renameTarget,
    renameValue,
    datasetCreating,
    createDatasetOpen,
    createDatasetName,
    loadDatasetList,
    runDatasetExport,
    runExportAllDatasets,
    importDatasetFile,
    switchDataset,
    confirmDatasetRename,
    removeDataset,
    createEmptyDataset,
    setRenameTarget,
    setRenameValue,
    setCreateDatasetOpen,
    setCreateDatasetName,
  };
}
