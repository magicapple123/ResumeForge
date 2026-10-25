// SPDX-License-Identifier: Apache-2.0
import { Alert, App, Button, Input, Modal, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { downloadDelivery, listDeliveryArchive } from "../../api/resumes";
import { useApi } from "../../hooks/useApi";
import type { DeliverySummary } from "../../types";
import { downloadBlob } from "../../utils/download";
import { createExportDeliveryApi } from "../../features/resume-delivery";
import type { ExportDeliveryApi } from "../../features/resume-delivery";
import ArchiveList from "./delivery/ArchiveList";

/** 归档原件接口（模块级单例：列表 effect 以 api 为依赖，每次渲染新建会反复拉取）。 */
const defaultArchiveApi = createExportDeliveryApi();

interface Props {
  onClose: () => void;
  /** 指定简历后，在历史存档下方显示"这份简历的交付原件"（W19 / D19）。 */
  resumeId?: number | null;
  /**
   * 可选的简历清单：宿主传当前列表项后，用户能在弹层里**选一份简历**查看交付原件。
   *
   * 为什么需要它：全局「交付存档」入口平时没有"当前简历"上下文，只靠 resumeId prop
   * 的话 ArchiveList 永远是死路径（真实页面没有地方传）。列表页把当前页的简历传进来，
   * 用户才能从这里看到并删除某份简历归档的原件。
   */
  resumeOptions?: { value: number; label: string }[];
  /** 测试/宿主注入用；缺省走真实接口。 */
  archiveApi?: ExportDeliveryApi;
}

export default function DeliveryArchiveModal({
  onClose,
  resumeId,
  resumeOptions,
  archiveApi,
}: Props) {
  const { message } = App.useApp();
  // 宿主给的初始简历（如深链 ?resume_id=）；用户可在弹层里改选。换 prop 时同步。
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(resumeId ?? null);
  const [prevResumeId, setPrevResumeId] = useState<number | null>(resumeId ?? null);
  if (prevResumeId !== (resumeId ?? null)) {
    setPrevResumeId(resumeId ?? null);
    setSelectedResumeId(resumeId ?? null);
  }
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState("");
  const [downloading, setDownloading] = useState<number | null>(null);
  const { data, loading, error, reload } = useApi(
    () => listDeliveryArchive({ page, page_size: 10, keyword, source }),
    [page, keyword, source],
  );
  const download = async (item: DeliverySummary) => {
    if (downloading !== null) return;
    setDownloading(item.id);
    try {
      const result = await downloadDelivery(item.id);
      downloadBlob(result.blob, result.filename);
      message.success(
        result.replayed
          ? "已按存档内容重新生成文件；并非保证字节相同的原件"
          : "已下载冻结的交付内容",
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : "下载失败");
    } finally {
      setDownloading(null);
    }
  };
  return (
    <Modal open title="交付存档" onCancel={onClose} footer={null} width={850}>
      <Alert
        type="info"
        showIcon
        title="原简历删除后仍可查找历史存档"
        description="回收站的彻底删除不清除交付快照、附件副本或已有备份。存档用于核对历史内容；重新生成不等同于取回原始文件字节。"
        style={{ marginBottom: 16 }}
      />
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          aria-label="搜索交付存档"
          placeholder="简历标题、公司或岗位"
          allowClear
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
          }}
        />
        <Select
          aria-label="交付来源"
          value={source}
          style={{ width: 150 }}
          onChange={(value) => {
            setSource(value);
            setPage(1);
          }}
          options={[
            { value: "", label: "全部来源" },
            { value: "apply", label: "投递台" },
            { value: "track", label: "进度关联" },
            { value: "export", label: "导出存档" },
          ]}
        />
        <Button onClick={() => void reload()}>刷新</Button>
      </Space>
      {error && (
        <Alert
          type="error"
          title="交付存档加载失败"
          description={error}
          style={{ marginBottom: 12 }}
        />
      )}
      <Table<DeliverySummary>
        rowKey="id"
        loading={loading}
        dataSource={data?.items ?? []}
        // 条件与 `dataSource` 同一口径：空表不启用横向滚动，否则 `.ant-table-content`
        // 会成为"可横滚、区域内没有任何可聚焦元素"的容器（axe
        // `scrollable-region-focusable`，serious）。有行时照旧按列宽固定横滚。
        scroll={data?.items?.length ? { x: 600 } : undefined}
        pagination={{
          current: page,
          pageSize: 10,
          total: data?.total ?? 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          { title: "简历", dataIndex: "resume_title", ellipsis: true },
          {
            title: "目的地",
            render: (_, item) =>
              `${item.company || "公司未记录"} · ${item.job_title || "岗位未记录"}`,
          },
          {
            title: "来源",
            render: (_, item) => (
              <Tag>
                {(
                  { apply: "投递台", track: "进度关联", export: "导出存档" } as Record<
                    string,
                    string
                  >
                )[item.source] ?? "历史记录"}
              </Tag>
            ),
          },
          { title: "日期", render: (_, item) => new Date(item.created_at).toLocaleDateString() },
          {
            title: "操作",
            render: (_, item) => (
              <Button
                size="small"
                loading={downloading === item.id}
                onClick={() => void download(item)}
              >
                下载存档
              </Button>
            ),
          },
        ]}
      />
      {resumeOptions && resumeOptions.length > 0 ? (
        <Space wrap style={{ marginTop: 16 }}>
          <span>{t("delivery.archive.resumePicker")}</span>
          <Select
            aria-label={t("delivery.archive.resumePicker")}
            style={{ minWidth: 240 }}
            allowClear
            placeholder={t("delivery.archive.resumePickerPlaceholder")}
            value={selectedResumeId ?? undefined}
            options={resumeOptions}
            onChange={(value?: number) => setSelectedResumeId(value ?? null)}
          />
        </Space>
      ) : null}
      {selectedResumeId !== null ? (
        <div style={{ marginTop: 16 }}>
          <ArchiveList api={archiveApi ?? defaultArchiveApi} resumeId={selectedResumeId} />
        </div>
      ) : null}
    </Modal>
  );
}
