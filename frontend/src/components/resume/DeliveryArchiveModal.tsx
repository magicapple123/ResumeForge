// SPDX-License-Identifier: Apache-2.0
import { Alert, App, Button, Collapse, Input, Modal, Select, Space, Table, Tag } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { downloadDelivery, listDeliveryArchive } from "../../api/resumes";
import { useApi } from "../../hooks/useApi";
import type { DeliverySummary } from "../../types";
import { downloadBlob } from "../../utils/download";
import { formatServerTime } from "../../utils/serverTime";
import { createExportDeliveryApi } from "../../features/resume-delivery";
import type { ExportDeliveryApi } from "../../features/resume-delivery";
import ArchiveList from "./delivery/ArchiveList";

/** 归档原件接口（模块级单例：列表 effect 以 api 为依赖，每次渲染新建会反复拉取）。 */
const defaultArchiveApi = createExportDeliveryApi();

/**
 * 「投递去向」单元格：**只按 `source` 分派**。
 *
 * 为什么不用"两个字段是否为空"来判断：那会把"投给了一家没记录公司名的岗位"误判成
 * 导出存档。导出存档本来就只是下载到本地磁盘，没有去向；`apply` / `track` 才是有
 * 投递动作的那两种，字段缺了就是缺了，如实写"未记录"。
 */
function destinationText(item: DeliverySummary): string {
  if (item.source === "export") return t("delivery.archive.destination.exportOnly");
  return `${item.company || t("delivery.archive.companyUnknown")} · ${
    item.job_title || t("delivery.archive.jobUnknown")
  }`;
}

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
      {/* 这条只是"解释规则"，不是要立刻处理的警告：压成一行、默认收起，省掉约 90px。 */}
      <Collapse
        size="small"
        style={{ marginBottom: 12 }}
        items={[
          {
            key: "notice",
            label: (
              <Space size={8}>
                <InfoCircleOutlined />
                <span>{t("delivery.archive.noticeTitle")}</span>
              </Space>
            ),
            children: <span>{t("delivery.archive.noticeBody")}</span>,
          },
        ]}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <Input.Search
          aria-label={t("delivery.archive.search")}
          placeholder={t("delivery.archive.searchPlaceholder")}
          allowClear
          style={{ width: 280 }}
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
        {/* 刷新是次要动作：靠右，别夹在筛选器里制造一个"第四个筛选项"的错觉。 */}
        <Button style={{ marginLeft: "auto" }} onClick={() => void reload()}>
          {t("delivery.archive.refresh")}
        </Button>
      </div>
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
        scroll={data?.items?.length ? { x: 770 } : undefined}
        pagination={{
          current: page,
          pageSize: 10,
          total: data?.total ?? 0,
          showSizeChanger: false,
          // 只有一页时右下角那个分页器没有任何可做的事，只会占高度。
          hideOnSinglePage: true,
          onChange: setPage,
        }}
        columns={[
          {
            title: t("delivery.archive.table.resume"),
            dataIndex: "resume_title",
            width: 210,
            ellipsis: { showTitle: true },
          },
          {
            title: t("delivery.archive.table.destination"),
            width: 250,
            ellipsis: { showTitle: true },
            render: (_, item) => destinationText(item),
          },
          {
            title: t("delivery.archive.table.source"),
            width: 90,
            align: "center",
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
            width: 110,
            render: (_, item) => formatServerTime(item.created_at, { dateOnly: true }),
          },
          {
            title: t("delivery.archive.table.actions"),
            width: 110,
            align: "right",
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--rf-border-subtle)",
          }}
        >
          <span style={{ whiteSpace: "nowrap" }}>{t("delivery.archive.resumePicker")}</span>
          <Select
            aria-label={t("delivery.archive.resumePicker")}
            style={{ minWidth: 240 }}
            allowClear
            placeholder={t("delivery.archive.resumePickerPlaceholder")}
            value={selectedResumeId ?? undefined}
            options={resumeOptions}
            onChange={(value?: number) => setSelectedResumeId(value ?? null)}
          />
        </div>
      ) : null}
      {selectedResumeId !== null ? (
        <div style={{ marginTop: 16 }}>
          <ArchiveList api={archiveApi ?? defaultArchiveApi} resumeId={selectedResumeId} />
        </div>
      ) : null}
    </Modal>
  );
}
