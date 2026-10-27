// SPDX-License-Identifier: Apache-2.0
/** 数据集管理：导入多份备份、在它们之间切换，以及导出/重命名/删除。 */

import {
  CloudDownloadOutlined,
  DownloadOutlined,
  PlusOutlined,
  SwapOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Input,
  Listy,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import EmptyState from "../common/EmptyState";
import LoadingBlock from "../common/LoadingBlock";
import { useState } from "react";
import { defaultExportName } from "../../utils/exportNaming";
import { RowActions } from "../common/RowActions";
import { useCollapsedList } from "../common/useCollapsedList";
import type { DatasetInfo } from "../../types";
import { formatDateTime } from "../../utils/format";
import FileDropZone from "../common/FileDropZone";
import { ListyItem, ListyMeta } from "../common/ListyItem";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 备份包导入后默认用的数据集名字：去掉扩展名，空文件名时给一个兜底。 */
function datasetNameFrom(file: File): string {
  return (file?.name || "").replace(/\.zip$/i, "") || t("datasets.default.importName");
}

interface Props {
  datasets: DatasetInfo[];
  loading: boolean;
  exporting: boolean;
  importing: boolean;
  /** 导出时是否随包带走**全部全局模型配置**（默认开；密钥跟随这一项）。 */
  includeGlobalLLM: boolean;
  onIncludeGlobalLLMChange: (value: boolean) => void;
  switchingId: string | null;
  renamingId: string | null;
  deletingId: string | null;
  renameTarget: DatasetInfo | null;
  renameValue: string;
  /** {t("datasets.action.create")}（D9）：按钮 loading 与命名弹窗状态。 */
  creating: boolean;
  createOpen: boolean;
  createName: string;
  /** `filename` 是用户填的下载名；不传则由后端用默认名。 */
  onExport: (dataset: DatasetInfo, filename?: string) => void;
  /** 导出全部数据集（活动的那份 + 列表里其余每一份）。 */
  onExportAll: (filename?: string) => void;
  onImport: (file: File, name: string) => void;
  onActivate: (dataset: DatasetInfo) => void;
  onOpenRename: (dataset: DatasetInfo) => void;
  onRenameValueChange: (value: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
  onDelete: (dataset: DatasetInfo) => void;
  onOpenCreate: () => void;
  onCreateNameChange: (value: string) => void;
  onConfirmCreate: () => void;
  onCancelCreate: () => void;
}

/**
 * 删除数据集的后果段（唯一出口）。
 *
 * 刻意**不**复用 `TRASH_RECOVERY_NOTE`：数据集删除只是把文件移出列表，它不进「回收站」页，
 * 界面上也就没有恢复入口——写"可在「回收站」里恢复"是承诺一件应用做不到的事（R2）。
 */
const DATASET_DELETE_NOTE = "数据集会移出列表，界面上没有恢复入口；删除前请先「导出」备份。"; // i18n-ok: 新增的二次确认正文（R4 不许写内部路径、也不许承诺界面恢复）

function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 只有主数据不支持改名/删除，这里把规则收在一处，避免三处各写一遍。 */
function isProtected(dataset: DatasetInfo): boolean {
  return dataset.id === "main";
}

export default function DatasetsCard({
  datasets,
  loading,
  exporting,
  importing,
  includeGlobalLLM,
  onIncludeGlobalLLMChange,
  switchingId,
  renamingId,
  deletingId,
  renameTarget,
  renameValue,
  creating,
  createOpen,
  createName,
  onExport,
  onExportAll,
  onImport,
  onActivate,
  onOpenRename,
  onRenameValueChange,
  onConfirmRename,
  onCancelRename,
  onDelete,
  onOpenCreate,
  onCreateNameChange,
  onConfirmCreate,
  onCancelCreate,
}: Props) {
  useLocale();
  // 导出前先问下载名：`"all"` 表示"全部数据集"，null 表示弹窗关着。
  const [exportTarget, setExportTarget] = useState<DatasetInfo | "all" | null>(null);
  const [exportName, setExportName] = useState("");

  const openExport = (target: DatasetInfo | "all") => {
    setExportTarget(target);
    setExportName(
      defaultExportName(target === "all" ? t("datasets.default.allName") : target.name),
    );
  };

  const confirmExport = () => {
    const target = exportTarget;
    const name = exportName.trim();
    setExportTarget(null);
    if (target === "all") onExportAll(name);
    else if (target) onExport(target, name);
  };

  const busy = exporting || importing || switchingId !== null || deletingId !== null || creating;
  const active = datasets.find((item) => item.is_active);
  // 列表长了会淹没操作区：默认只展示前 5 份，其余收进「显示全部」（展示层折叠）。
  const { visibleItems: visibleDatasets, toggleNode: datasetsToggleNode } =
    useCollapsedList(datasets);

  return (
    <>
      <Card
        title={t("datasets.card.title")}
        className="settings-card"
        extra={
          <Space wrap>
            {/* 主操作：新建是用户在这里最常做的事，用 primary 从一排同色按钮里立起来。 */}
            <Button type="primary" icon={<PlusOutlined />} disabled={busy} onClick={onOpenCreate}>
              {t("datasets.action.create")}
            </Button>
            {/* 「导出当前」与「导出全部」原来是一对长得一样的描边按钮，容易按错；
                合并成一个「导出」下拉后入口唯一，两项各带说明，不会再误触。 */}
            <Dropdown
              trigger={["click"]}
              disabled={busy}
              menu={{
                items: [
                  {
                    key: "current",
                    icon: <DownloadOutlined />,
                    label: t("datasets.action.exportCurrent"),
                    disabled: !active,
                  },
                  ...(datasets.length > 1
                    ? [
                        {
                          key: "all",
                          icon: <CloudDownloadOutlined />,
                          label: t("datasets.action.exportAll"),
                        },
                      ]
                    : []),
                ],
                onClick: ({ key }) => {
                  if (key === "current" && active) openExport(active);
                  if (key === "all") openExport("all");
                },
              }}
            >
              <Button icon={<DownloadOutlined />} loading={exporting} disabled={busy || !active}>
                {t("datasets.action.export")}
              </Button>
            </Dropdown>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {t("datasets.intro")}
        </Typography.Paragraph>

        {/* 是否把大模型 API Key 一并带走：默认勾选（D-A），选择权仍交给用户。
            密钥按本机存储形态写入（Windows 上是系统加密形态、绑定当前用户与这台电脑），
            不解密成明文——备份包是用户可能长期保存或转发的东西。 */}
        <div style={{ marginBottom: 16 }}>
          <Checkbox
            checked={includeGlobalLLM}
            disabled={busy}
            onChange={(event) => onIncludeGlobalLLMChange(event.target.checked)}
          >
            {t("datasets.option.globalConfig")}
          </Checkbox>
          <Typography.Paragraph
            type="secondary"
            style={{ marginBottom: 8, marginTop: 4, fontSize: 12 }}
          >
            {t("datasets.hint.globalConfig")}
          </Typography.Paragraph>
          <Typography.Paragraph
            type="secondary"
            style={{ marginBottom: 0, marginTop: 4, fontSize: 12 }}
          >
            {t("datasets.hint.apiKey")}
          </Typography.Paragraph>
          {/* 字体属于「数据目录里但不属于任何一份数据集库」的东西：不说清楚，用户换机后
              才发现 PDF 导出用的字体没跟过来。同名字体不覆盖，避免把本机正在用的那份换掉。 */}
          <Typography.Paragraph
            type="secondary"
            style={{ marginBottom: 0, marginTop: 4, fontSize: 12 }}
          >
            {t("datasets.hint.fonts")}
          </Typography.Paragraph>
        </div>

        <FileDropZone
          accept=".zip,application/zip"
          multiple={false}
          disabled={busy}
          hint={t("datasets.dropzone.hint")}
          onFiles={(files) => onImport(files[0], datasetNameFrom(files[0]))}
          className="settings-import-drop"
        >
          <Upload
            accept=".zip,application/zip"
            showUploadList={false}
            disabled={busy}
            // 设置页上有多个上传入口，这个 aria-label 让它们（以及测试）都能精确定位。
            aria-label={t("datasets.dropzone.aria")}
            beforeUpload={(file) => {
              onImport(file as File, datasetNameFrom(file as File));
              // 与仓库其它上传一致：本地读取后自行提交，不走 antd 的上传通道。
              return Upload.LIST_IGNORE;
            }}
          >
            {/* 导入是"新增一份数据集"的特殊操作（不覆盖现有数据），保持 default 样式
                并用上传图标与导出区分；附件有问题时另有二次确认（见 useSettingsDatasets）。 */}
            <Tooltip title={t("datasets.import.tooltip")}>
              <Button icon={<UploadOutlined />} loading={importing} disabled={busy}>
                {t("datasets.action.import")}
              </Button>
            </Tooltip>
          </Upload>
        </FileDropZone>

        {/* List 的 loading 是内容外层的 Spin；空态单独渲染（与原 locale.emptyText 等价）。 */}
        <LoadingBlock spinning={loading}>
          {datasets.length === 0 ? (
            <div style={{ marginTop: 16 }}>
              <EmptyState inline description={t("datasets.empty")} />
            </div>
          ) : (
            <Listy
              style={{ marginTop: 16 }}
              items={visibleDatasets}
              rowKey={(dataset) => dataset.id}
              itemRender={(dataset) => (
                <ListyItem
                  actions={[
                    <Tooltip
                      key="switch"
                      title={
                        dataset.is_active
                          ? t("datasets.tooltip.active")
                          : t("datasets.tooltip.switch")
                      }
                    >
                      <Button
                        type="link"
                        icon={<SwapOutlined />}
                        disabled={dataset.is_active || busy || !dataset.exists}
                        loading={switchingId === dataset.id}
                        onClick={() => onActivate(dataset)}
                      >
                        {t("datasets.action.switch")}
                      </Button>
                    </Tooltip>,
                    // 编辑/删除收进「···」菜单：删除不再以红图标裸露在行内（全局约定）。
                    <RowActions
                      key="more"
                      disabled={busy}
                      more={[
                        {
                          key: "rename",
                          label: t("datasets.action.rename"),
                          disabled: isProtected(dataset),
                          onClick: () => onOpenRename(dataset),
                        },
                        {
                          key: "delete",
                          label: t("datasets.action.delete"),
                          danger: true,
                          disabled: dataset.is_active || isProtected(dataset),
                          confirm: t("datasets.confirm.delete", { name: dataset.name }),
                          // 后果与可逆性进正文，且必须说实话：数据集删除只是把文件移出列表，
                          // 界面上没有恢复入口（它不进「回收站」页），所以只能提醒先导出备份。
                          confirmBody: DATASET_DELETE_NOTE,
                          onClick: () => onDelete(dataset),
                        },
                      ]}
                    />,
                  ]}
                >
                  <ListyMeta
                    title={
                      <>
                        {dataset.name}
                        {dataset.is_active && (
                          // “当前”单独看指代不明；顺带说明它为什么不能删、不能切。
                          <Tooltip title={t("datasets.tooltip.active")}>
                            <Tag color="blue" style={{ marginLeft: 8 }}>
                              {t("datasets.badge.current")}
                            </Tag>
                          </Tooltip>
                        )}
                      </>
                    }
                    description={
                      <>
                        {formatSize(dataset.size_bytes)}
                        {dataset.created_at ? ` · ${formatDateTime(dataset.created_at)}` : ""}
                        {dataset.source
                          ? ` · ${dataset.source === "sample" ? t("datasets.source.sample") : dataset.source}`
                          : ""}
                      </>
                    }
                  />
                </ListyItem>
              )}
            />
          )}
          {datasetsToggleNode}
        </LoadingBlock>
      </Card>

      <Modal
        title={t("datasets.rename.title")}
        open={renameTarget !== null}
        okText={t("datasets.rename.save")}
        cancelText={t("common.action.cancel")}
        confirmLoading={renamingId !== null}
        destroyOnHidden
        onOk={onConfirmRename}
        onCancel={onCancelRename}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("datasets.rename.hint")}
        />
        <Input
          value={renameValue}
          maxLength={64}
          onChange={(event) => onRenameValueChange(event.target.value)}
        />
      </Modal>

      <Modal
        title={t("datasets.create.title")}
        open={createOpen}
        okText={t("datasets.create.ok")}
        cancelText={t("common.action.cancel")}
        confirmLoading={creating}
        destroyOnHidden
        onOk={onConfirmCreate}
        onCancel={onCancelCreate}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("datasets.create.hint")}
        />
        <Input
          value={createName}
          maxLength={64}
          placeholder={t("datasets.create.placeholder")}
          onChange={(event) => onCreateNameChange(event.target.value)}
        />
      </Modal>

      <Modal
        title={
          exportTarget === "all" ? t("datasets.export.titleAll") : t("datasets.export.titleOne")
        }
        open={exportTarget !== null}
        okText={t("datasets.action.export")}
        cancelText={t("common.action.cancel")}
        confirmLoading={exporting}
        destroyOnHidden
        onOk={confirmExport}
        onCancel={() => setExportTarget(null)}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("datasets.export.hint")}
        />
        {/* 导出当下再确认一次：与卡片上的开关是同一份状态（默认包含，D-A）。 */}
        <Checkbox
          checked={includeGlobalLLM}
          disabled={busy}
          style={{ marginBottom: 16 }}
          onChange={(event) => onIncludeGlobalLLMChange(event.target.checked)}
        >
          {t("datasets.export.includeConfig")}
        </Checkbox>
        <Input
          value={exportName}
          maxLength={80}
          placeholder={t("datasets.export.placeholder")}
          aria-label={t("datasets.export.aria")}
          onChange={(event) => setExportName(event.target.value)}
        />
      </Modal>
    </>
  );
}
