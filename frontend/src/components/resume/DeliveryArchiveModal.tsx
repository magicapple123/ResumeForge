// SPDX-License-Identifier: Apache-2.0
import { Alert, App, Button, Input, Modal, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
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
  useLocale();
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
          ? t("delivery.archive.downloadedReplayed")
          : t("delivery.archive.downloaded"),
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("delivery.archive.downloadFailed"));
    } finally {
      setDownloading(null);
    }
  };
  return (
    <Modal
      open
      title={t("delivery.archive.modalTitle")}
      onCancel={onClose}
      footer={null}
      width={850}
    >
      <Alert
        type="info"
        showIcon
        title={t("delivery.archive.noticeTitle")}
        description={t("delivery.archive.noticeBody")}
        style={{ marginBottom: 16 }}
      />
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          aria-label={t("delivery.archive.search")}
          placeholder={t("delivery.archive.searchPlaceholder")}
          allowClear
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
          }}
        />
        <Select
          aria-label={t("delivery.archive.sourceFilter")}
          value={source}
          style={{ width: 150 }}
          onChange={(value) => {
            setSource(value);
            setPage(1);
          }}
          options={[
            { value: "", label: t("delivery.archive.source.all") },
            { value: "apply", label: t("delivery.archive.source.apply") },
            { value: "track", label: t("delivery.archive.source.track") },
            { value: "export", label: t("delivery.archive.source.export") },
          ]}
        />
        <Button onClick={() => void reload()}>{t("delivery.archive.refresh")}</Button>
      </Space>
      {error && (
        <Alert
          type="error"
          title={t("delivery.archive.modalLoadFailed")}
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
          { title: t("delivery.archive.table.resume"), dataIndex: "resume_title", ellipsis: true },
          {
            title: t("delivery.archive.table.destination"),
            render: (_, item) =>
              `${item.company || t("delivery.archive.companyUnknown")} · ${item.job_title || t("delivery.archive.jobUnknown")}`,
          },
          {
            title: t("delivery.archive.table.source"),
            render: (_, item) => (
              <Tag>
                {(
                  {
                    apply: t("delivery.archive.source.apply"),
                    track: t("delivery.archive.source.track"),
                    export: t("delivery.archive.source.export"),
                  } as Record<string, string>
                )[item.source] ?? t("delivery.archive.source.unknown")}
              </Tag>
            ),
          },
          {
            title: t("delivery.archive.table.date"),
            render: (_, item) => new Date(item.created_at).toLocaleDateString(),
          },
          {
            title: t("delivery.archive.table.actions"),
            render: (_, item) => (
              <Button
                size="small"
                loading={downloading === item.id}
                onClick={() => void download(item)}
              >
                {t("delivery.archive.download")}
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
