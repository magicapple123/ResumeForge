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
  Empty,
  Input,
  Listy,
  Spin,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import { useState } from "react";
import { defaultExportName } from "../../utils/exportNaming";
import { RowActions } from "../common/RowActions";
import { useCollapsedList } from "../common/useCollapsedList";
import type { DatasetInfo } from "../../types";
import { formatDateTime } from "../../utils/format";
import FileDropZone from "../common/FileDropZone";
import { ListyItem, ListyMeta } from "../common/ListyItem";

/** 备份包导入后默认用的数据集名字：去掉扩展名，空文件名时给一个兜底。 */
function datasetNameFrom(file: File): string {
  return (file?.name || "").replace(/\.zip$/i, "") || "导入的数据集";
}

interface Props {
  datasets: DatasetInfo[];
  loading: boolean;
  exporting: boolean;
  importing: boolean;
  /** 导出时是否随包带走大模型 API Key（默认关，选择权在用户）。 */
  includeApiKeys: boolean;
  onIncludeApiKeysChange: (value: boolean) => void;
  switchingId: string | null;
  renamingId: string | null;
  deletingId: string | null;
  renameTarget: DatasetInfo | null;
  renameValue: string;
  /** 新建空数据集（D9）：按钮 loading 与命名弹窗状态。 */
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
  includeApiKeys,
  onIncludeApiKeysChange,
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
  // 导出前先问下载名：`"all"` 表示"全部数据集"，null 表示弹窗关着。
  const [exportTarget, setExportTarget] = useState<DatasetInfo | "all" | null>(null);
  const [exportName, setExportName] = useState("");

  const openExport = (target: DatasetInfo | "all") => {
    setExportTarget(target);
    setExportName(defaultExportName(target === "all" ? "全部数据集" : target.name));
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
        title="数据集"
        className="settings-card"
        extra={
          <Space wrap>
            {/* 主操作：新建是用户在这里最常做的事，用 primary 从一排同色按钮里立起来。 */}
            <Button type="primary" icon={<PlusOutlined />} disabled={busy} onClick={onOpenCreate}>
              新建空数据集
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
                    label: "导出当前数据集",
                    disabled: !active,
                  },
                  ...(datasets.length > 1
                    ? [
                        {
                          key: "all",
                          icon: <CloudDownloadOutlined />,
                          label: "导出全部数据集",
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
                导出
              </Button>
            </Dropdown>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          每份数据集就是一个完整的简历通数据库（岗位、个人资料、简历、收藏、助手会话和全部附件），
          可以随时切换，互不影响。导入备份包只会<strong>新增</strong>一份数据集，当前正在使用的
          数据不会被动到；导出的备份<strong>默认包含</strong>大模型 API Key，不需要时可取消勾选。
        </Typography.Paragraph>

        {/* 是否把大模型 API Key 一并带走：默认勾选（D-A），选择权仍交给用户。
            密钥按本机存储形态写入（Windows 上是系统加密形态、绑定当前用户与这台电脑），
            不解密成明文——备份包是用户可能长期保存或转发的东西。 */}
        <div style={{ marginBottom: 16 }}>
          <Checkbox
            checked={includeApiKeys}
            disabled={busy}
            onChange={(event) => onIncludeApiKeysChange(event.target.checked)}
          >
            备份中包含大模型 API Key
          </Checkbox>
          <Typography.Paragraph
            type="secondary"
            style={{ marginBottom: 0, marginTop: 4, fontSize: 12 }}
          >
            默认勾选。密钥按本机存储的形态写入（Windows 上为系统加密、绑定当前用户与这台电脑，
            换电脑恢复后可能需要重新填写；macOS/Linux 上密钥以明文随包）。勾选后的备份包
            更敏感，请妥善保管，不要发给不信任的人。
          </Typography.Paragraph>
        </div>

        <FileDropZone
          accept=".zip,application/zip"
          multiple={false}
          disabled={busy}
          hint="松开即可导入备份包（.zip）"
          onFiles={(files) => onImport(files[0], datasetNameFrom(files[0]))}
          className="settings-import-drop"
        >
          <Upload
            accept=".zip,application/zip"
            showUploadList={false}
            disabled={busy}
            // 设置页上有多个上传入口，这个 aria-label 让它们（以及测试）都能精确定位。
            aria-label="选择备份文件"
            beforeUpload={(file) => {
              onImport(file as File, datasetNameFrom(file as File));
              // 与仓库其它上传一致：本地读取后自行提交，不走 antd 的上传通道。
              return Upload.LIST_IGNORE;
            }}
          >
            {/* 导入是"新增一份数据集"的特殊操作（不覆盖现有数据），保持 default 样式
                并用上传图标与导出区分；附件有问题时另有二次确认（见 useSettingsDatasets）。 */}
            <Tooltip title="导入会新增一份数据集，不会改动当前正在使用的数据">
              <Button icon={<UploadOutlined />} loading={importing} disabled={busy}>
                导入备份为新数据集
              </Button>
            </Tooltip>
          </Upload>
        </FileDropZone>

        {/* List 的 loading 是内容外层的 Spin；空态单独渲染（与原 locale.emptyText 等价）。 */}
        <Spin spinning={loading}>
          {datasets.length === 0 ? (
            <div style={{ marginTop: 16 }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据集" />
            </div>
          ) : (
            <Listy
              style={{ marginTop: 16 }}
              items={visibleDatasets}
              rowKey={(dataset) => dataset.id}
              itemRender={(dataset) => (
                <ListyItem
                  actions={[
                    <Tooltip key="switch" title={dataset.is_active ? "正在使用" : "切换到这份数据"}>
                      <Button
                        type="link"
                        icon={<SwapOutlined />}
                        disabled={dataset.is_active || busy || !dataset.exists}
                        loading={switchingId === dataset.id}
                        onClick={() => onActivate(dataset)}
                      >
                        切换
                      </Button>
                    </Tooltip>,
                    // 编辑/删除收进「···」菜单：删除不再以红图标裸露在行内（全局约定）。
                    <RowActions
                      key="more"
                      disabled={busy}
                      more={[
                        {
                          key: "rename",
                          label: "重命名",
                          disabled: isProtected(dataset),
                          onClick: () => onOpenRename(dataset),
                        },
                        {
                          key: "delete",
                          label: "删除",
                          danger: true,
                          disabled: dataset.is_active || isProtected(dataset),
                          confirm: `确定删除数据集“${dataset.name}”？会移入 data/datasets/.trash/，需要时可以手动找回`,
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
                          <Tooltip title="当前正在使用的数据集">
                            <Tag color="blue" style={{ marginLeft: 8 }}>
                              当前
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
                          ? ` · ${dataset.source === "sample" ? "示例体验" : dataset.source}`
                          : ""}
                      </>
                    }
                  />
                </ListyItem>
              )}
            />
          )}
          {datasetsToggleNode}
        </Spin>
      </Card>

      <Modal
        title="重命名数据集"
        open={renameTarget !== null}
        okText="保存"
        cancelText="取消"
        confirmLoading={renamingId !== null}
        destroyOnHidden
        onOk={onConfirmRename}
        onCancel={onCancelRename}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="名称只用于在列表里区分，不影响数据内容。"
        />
        <Input
          value={renameValue}
          maxLength={64}
          onChange={(event) => onRenameValueChange(event.target.value)}
        />
      </Modal>

      <Modal
        title="新建空数据集"
        open={createOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        destroyOnHidden
        onOk={onConfirmCreate}
        onCancel={onCancelCreate}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="新建后进入数据集列表，可随时切换过去；激活后是一份空数据（岗位、简历、资料都从零开始）。"
        />
        <Input
          value={createName}
          maxLength={64}
          placeholder="数据集名称（例如：秋招专用）"
          onChange={(event) => onCreateNameChange(event.target.value)}
        />
      </Modal>

      <Modal
        title={exportTarget === "all" ? "导出全部数据集" : "导出数据集"}
        open={exportTarget !== null}
        okText="导出"
        cancelText="取消"
        confirmLoading={exporting}
        destroyOnHidden
        onOk={confirmExport}
        onCancel={() => setExportTarget(null)}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="这个名字会作为下载文件名，可含中文；扩展名会自动补 .zip。"
        />
        {/* 导出当下再确认一次：与卡片上的开关是同一份状态（默认包含，D-A）。 */}
        <Checkbox
          checked={includeApiKeys}
          disabled={busy}
          style={{ marginBottom: 16 }}
          onChange={(event) => onIncludeApiKeysChange(event.target.checked)}
        >
          导出包中包含大模型 API Key
        </Checkbox>
        <Input
          value={exportName}
          maxLength={80}
          placeholder="例如：校招线-20261019-101500"
          aria-label="导出文件名"
          onChange={(event) => setExportName(event.target.value)}
        />
      </Modal>
    </>
  );
}
