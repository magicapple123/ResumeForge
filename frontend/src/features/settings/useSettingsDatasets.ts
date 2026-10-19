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
import type { DatasetInfo } from "../../types";
import { formatErrorGuidance } from "../../api/errorGuidance";
import { downloadBlob } from "../../utils/download";
import { reloadPage } from "../../utils/navigation";
import { describeImportIssues } from "./datasetImportFeedback";

/** 设置页「数据」页里数据集的加载、导出、导入、切换、重命名、删除与新建。 */
export function useSettingsDatasets() {
  const { message, modal } = App.useApp();
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [datasetExporting, setDatasetExporting] = useState(false);
  const [datasetImporting, setDatasetImporting] = useState(false);
  // 导出是否随包带走大模型 API Key。默认勾选（D-A）：迁移整包时省去重填密钥；
  // 用户可以取消勾选把密钥剥离。
  const [includeApiKeys, setIncludeApiKeys] = useState(true);
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

  const runDatasetExport = async (dataset: DatasetInfo, downloadName?: string) => {
    if (datasetExporting) return;
    setDatasetExporting(true);
    try {
      const { blob, filename, incompleteBackup } = await exportDataset(
        dataset.id,
        includeApiKeys,
        downloadName,
      );
      downloadBlob(blob, filename);
      if (incompleteBackup) {
        // RR-03：包里有附件缺失或与登记哈希不符时不能说成"完整备份成功"。
        message.warning(
          `已导出「${dataset.name}」，但这份备份「不完整」：包内有附件缺失或内容与数据库登记的哈希不符，` +
            "明细见包内 manifest.json 的 asset_manifest 段",
        );
      } else {
        message.success(`已导出「${dataset.name}」到浏览器的下载目录`);
      }
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
      const { blob, filename, incompleteBackup } = await exportAllDatasets(
        includeApiKeys,
        downloadName,
      );
      downloadBlob(blob, filename);
      if (incompleteBackup) {
        message.warning(
          `已把全部 ${datasets.length} 份数据集导出到浏览器的下载目录，但这份备份「不完整」：` +
            "包内有附件缺失或内容与数据库登记的哈希不符，明细见包内 manifest.json 的 asset_manifest 段",
        );
      } else {
        message.success(`已把全部 ${datasets.length} 份数据集导出到浏览器的下载目录`);
      }
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
      // RR-03：带着附件问题导入时不得呈现成"完整恢复"——问题逐条（最多 3 条）摆出来。
      const problems = [...(created.backup_asset_warnings ?? []), ...(created.asset_issues ?? [])];
      if (created.assets_incomplete || problems.length > 0) {
        const shown = problems.slice(0, 3).join("；");
        message.warning(
          `${parts.join("，")}；当前数据未受影响，但这份备份「不完整」：` +
            (shown || "附件存在缺失或校验不一致") +
            (problems.length > 3 ? `（共 ${problems.length} 条）` : ""),
        );
      } else {
        message.success(`${parts.join("，")}；当前数据未受影响`);
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
      await activateDataset(dataset.id);
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
    includeApiKeys,
    setIncludeApiKeys,
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
