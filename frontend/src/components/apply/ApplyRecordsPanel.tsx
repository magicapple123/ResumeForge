// SPDX-License-Identifier: Apache-2.0
/**
 * 投递记录：按**投递批次**分组展示，并对失败/跳过的条目单独重投。
 *
 * 一次「开始投递」= 一个批次（一次投了好几个岗位时，这几条记录天然同属一组）。
 * 界面把每个批次折叠成一行（批次时间 + 结果统计），点击展开看组内每条记录；
 * 关键词/结果筛选作用在**记录**上——没有命中记录的批次整体不出现。
 *
 * B4 按需加载：初次分组请求传 `include_items=false`（批次只带 matched_count），
 * 展开某个批次时才分页拉取明细（`/records/batches/{id}/items`），已拉取的页缓存在
 * 本组件 state 里、折叠不丢；列表翻页/筛选/删除后缓存作废并按需重拉。
 *
 * 记录只保存展示快照（岗位、公司、简历名、招呼语），不含完整个人资料——失败条目带上
 * 后端给的中文分类说明与可操作诊断，用户可以直接把这条信息回传给我们定位站点改版。
 */
import { EyeOutlined, RedoOutlined } from "@ant-design/icons";
import { App, Button, Empty, Pagination, Space, Tag, Tooltip, Typography } from "antd";
import LoadingBlock from "../common/LoadingBlock";
import type { TableColumnsType } from "antd";
import { useCallback, useEffect, useState } from "react";
import ApplyRecordDetailDrawer from "./ApplyRecordDetailDrawer";
import ApplyRecordsToolbar from "./ApplyRecordsToolbar";
import BatchGroup from "./ApplyRecordsBatchGroup";
import {
  batchDeleteRecords,
  deleteRecord,
  deleteRecordBatch,
  listRecordBatches,
  retryRecord,
} from "../../api/apply";
import { useApi } from "../../hooks/useApi";
import { useApplyBatchItems } from "../../hooks/useApplyBatchItems";
import { RowActions } from "../common/RowActions";
import BatchActionBar from "../common/BatchActionBar";
import BatchDeleteButton from "../common/BatchDeleteButton";
import { formatDateTime } from "../../utils/format";
import {
  TASK_ITEM_STATUS_META,
  failureLabel,
  type ApplyRecord,
  type ApplyRecordBatch,
  type ApplyTask,
  type Page,
} from "../../types";
import { t } from "../../i18n";
import { TASK_ITEM_STATUS_LABEL_KEYS, failureCategoryKey } from "../../i18n/enum/apply";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  disabled: boolean;
  onRetried: (task: ApplyTask) => void;
}

const BATCH_PAGE_SIZE = 10;

export default function ApplyRecordsPanel({ disabled, onRetried }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState("");
  // 搜索框受控镜像：点 × 清空时立即把筛选也清掉——之前非受控时清空后列表仍按
  // 旧关键词过滤（这里 keyword 只来自本组件，镜像仅承担受控化）。
  // Compiler 规范：镜像同步用渲染期守卫式调整。
  const [searchText, setSearchText] = useState("");
  const [prevKeyword, setPrevKeyword] = useState(keyword);
  if (prevKeyword !== keyword) {
    setPrevKeyword(keyword);
    setSearchText(keyword);
  }
  const [result, setResult] = useState("");
  const [page, setPage] = useState(1);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [detail, setDetail] = useState<ApplyRecord | null>(null);
  // 当前展开的批次 id 集合（分组展示：点击组头展开/收起）。
  const [expanded, setExpanded] = useState<number[]>([]);
  // 批内明细的多选：多选范围＝展开批次的明细表，按批次各存一份选区。
  const [selectingBatches, setSelectingBatches] = useState<number[]>([]);
  const [selectedByBatch, setSelectedByBatch] = useState<Record<number, number[]>>({});

  const { data, loading, error, reload } = useApi<Page<ApplyRecordBatch>>(
    () =>
      listRecordBatches({
        keyword,
        result,
        page,
        page_size: BATCH_PAGE_SIZE,
        include_items: false,
      }),
    [keyword, result, page],
  );

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  const onBatchError = useCallback((error: string) => void message.error(error), [message]);
  const { batchItems, fetchBatchItems } = useApplyBatchItems(
    data,
    keyword,
    result,
    expanded,
    onBatchError,
  );

  const retry = async (record: ApplyRecord) => {
    setRetrying(record.id);
    try {
      const task = await retryRecord(record.id);
      message.success(t("applyRecords.toast.retried"));
      onRetried(task);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applyRecords.error.retryFailed"));
    } finally {
      setRetrying(null);
    }
  };

  const toggleBatch = (batchId: number) => {
    setExpanded((prev) =>
      prev.includes(batchId) ? prev.filter((id) => id !== batchId) : [...prev, batchId],
    );
  };

  /** 删单条。**软删**：进回收站，可恢复；同时从统计与每日上限里去掉。 */
  const removeRecord = async (record: ApplyRecord) => {
    try {
      await deleteRecord(record.id);
      // 详情抽屉正开着这一条时一并关掉——否则会留着一份已经不存在的数据。
      if (detail?.id === record.id) setDetail(null);
      message.success(t("applyRecords.toast.movedToTrash"));
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applyRecords.error.deleteFailed"));
    }
  };

  /** 删整批。**只删记录、不删批次**：批次是分组键，删掉整组会消失、统计也会跳变。 */
  const removeBatch = async (batch: ApplyRecordBatch) => {
    try {
      await deleteRecordBatch(batch.id);
      setExpanded((prev) => prev.filter((id) => id !== batch.id));
      if (detail?.task_id === batch.id) setDetail(null);
      message.success(t("applyRecords.toast.movedToTrash"));
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applyRecords.error.deleteFailed"));
    }
  };

  const enterBatchSelect = (batchId: number) => {
    setSelectingBatches((prev) => (prev.includes(batchId) ? prev : [...prev, batchId]));
    setSelectedByBatch((prev) => ({ ...prev, [batchId]: [] }));
  };

  const exitBatchSelect = (batchId: number) => {
    setSelectingBatches((prev) => prev.filter((id) => id !== batchId));
    setSelectedByBatch((prev) => {
      const next = { ...prev };
      delete next[batchId];
      return next;
    });
  };

  /** 批量删除勾选的明细（软删）。失败时保留选择可直接重试（对齐知识库页，PR-14）；
   *  成功后 reload，明细缓存作废、展开中的批次自动重拉。 */
  const removeBatchSelected = async (batch: ApplyRecordBatch) => {
    const ids = selectedByBatch[batch.id] ?? [];
    if (ids.length === 0) return;
    try {
      const { deleted } = await batchDeleteRecords(ids);
      message.success(t("applyRecords.toast.batchDeleted", { count: deleted }));
      exitBatchSelect(batch.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applyRecords.error.batchDeleteFailed"));
      return;
    }
    await reload();
  };

  const recordColumns: TableColumnsType<ApplyRecord> = [
    {
      title: t("applyRecords.column.job"),
      dataIndex: "job_title",
      ellipsis: true,
      render: (title: string, record) => (
        <Space orientation="vertical" size={0} style={{ width: "100%" }}>
          <Typography.Text ellipsis>{title || t("applyRecords.deletedJob")}</Typography.Text>
          {record.company && (
            <Typography.Text type="secondary" ellipsis>
              {record.company}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t("applyRecords.column.result"),
      dataIndex: "status",
      width: 80,
      render: (value: ApplyRecord["status"]) => {
        const meta = TASK_ITEM_STATUS_META[value];
        return <Tag color={meta.color}>{t(TASK_ITEM_STATUS_LABEL_KEYS[value])}</Tag>;
      },
    },
    {
      title: t("applyRecords.column.failureKind"),
      key: "failure",
      ellipsis: true,
      render: (_, record) => {
        if (!record.failure_category) return "-";
        // 已知分类走语言包；后端新增、尚未登记的分类回退后端文案 / 原码（旧行为）。
        const key = failureCategoryKey(record.failure_category);
        return (
          <Tag color="red">
            {key ? t(key) : failureLabel(record.failure_category, record.failure_label)}
          </Tag>
        );
      },
    },
    {
      title: t("applyRecords.column.resume"),
      dataIndex: "resume_title",
      width: 120,
      ellipsis: true,
      render: (v: string) => v || "-",
    },
    {
      title: t("applyRecords.column.greeting"),
      dataIndex: "greeting",
      ellipsis: true,
      render: (v: string) => v || t("applyRecords.defaultGreeting"),
    },
    {
      title: t("applyRecords.column.finishedAt"),
      key: "finished_at",
      width: 150,
      render: (_, record) => formatDateTime(record.finished_at || record.created_at),
    },
    {
      title: t("applyRecords.column.actions"),
      key: "actions",
      width: 160,
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title={t("applyRecords.retryHint")}>
            <Button
              size="small"
              icon={<RedoOutlined />}
              loading={retrying === record.id}
              disabled={disabled || record.job_id == null}
              onClick={() => void retry(record)}
            >
              {t("applyRecords.action.retry")}
            </Button>
          </Tooltip>
          {/* 「查看详情」与「删除」都收进「···」菜单：整行点击本来就能看详情，
              独立的「详 情」按钮与「···」并排是重复入口（用户反馈）。 */}
          <RowActions
            more={[
              {
                key: "detail",
                label: t("applyRecords.action.viewDetail"),
                icon: <EyeOutlined />,
                onClick: () => setDetail(record),
              },
              {
                key: "delete",
                label: t("common.action.delete"),
                danger: true,
                confirm: t("applyRecords.confirm.deleteRecord"),
                onClick: () => void removeRecord(record),
              },
            ]}
          />
        </Space>
      ),
    },
  ];

  const batches = data?.items ?? [];
  const total = data?.total ?? 0;

  /** 某个批次多选模式的操作条：全选当前页明细 + 批量删除（确认文案带数量）。 */
  const batchToolbarFor = (batch: ApplyRecordBatch) => {
    const selected = selectedByBatch[batch.id] ?? [];
    const pageIds = (batchItems[batch.id]?.items ?? []).map((item) => item.id);
    return (
      <BatchActionBar
        count={selected.length}
        onExit={() => exitBatchSelect(batch.id)}
        pageSelectAll={{
          allSelected: pageIds.length > 0 && pageIds.every((id) => selected.includes(id)),
          someSelected: pageIds.some((id) => selected.includes(id)),
          onToggle: (checked) =>
            setSelectedByBatch((prev) => {
              const next = new Set(prev[batch.id] ?? []);
              for (const id of pageIds) {
                if (checked) next.add(id);
                else next.delete(id);
              }
              return { ...prev, [batch.id]: [...next] };
            }),
        }}
      >
        <BatchDeleteButton
          count={selected.length}
          noun={t("applyRecords.deleteNoun")}
          onDelete={() => void removeBatchSelected(batch)}
        />
      </BatchActionBar>
    );
  };

  return (
    <div className="apply-records-panel">
      <ApplyRecordsToolbar
        searchText={searchText}
        result={result}
        onSearchTextChange={(value) => {
          setSearchText(value);
          if (value === "" && keyword !== "") {
            setKeyword("");
            setPage(1);
          }
        }}
        onSearch={(value) => {
          setSearchText(value);
          setKeyword(value);
          setPage(1);
        }}
        onResultChange={(value) => {
          setResult(value ?? "");
          setPage(1);
        }}
        onReload={() => void reload()}
      />

      {loading && batches.length === 0 && (
        <div style={{ textAlign: "center", padding: 24 }}>
          <LoadingBlock />
        </div>
      )}
      {!loading && batches.length === 0 && <Empty description={t("applyRecords.empty")} />}

      <div className="apply-records-batches">
        {batches.map((batch) => (
          <BatchGroup
            key={batch.id}
            batch={batch}
            expanded={expanded.includes(batch.id)}
            itemsState={batchItems[batch.id]}
            onToggle={() => toggleBatch(batch.id)}
            onItemsPageChange={(itemPage) => void fetchBatchItems(batch.id, itemPage)}
            recordColumns={recordColumns}
            onOpenDetail={setDetail}
            onDeleteBatch={(batch) => void removeBatch(batch)}
            selecting={selectingBatches.includes(batch.id)}
            selectedRecordIds={selectedByBatch[batch.id] ?? []}
            onSelectionChange={(ids) =>
              setSelectedByBatch((prev) => ({ ...prev, [batch.id]: ids }))
            }
            onEnterSelecting={() => enterBatchSelect(batch.id)}
            batchToolbar={selectingBatches.includes(batch.id) ? batchToolbarFor(batch) : undefined}
          />
        ))}
      </div>

      {/* 分页器沿用原容器（右对齐）：hideOnSinglePage 与旧行为对齐——只有一页时不出现。 */}
      <div style={{ textAlign: "right", marginTop: 12 }}>
        <Pagination
          current={page}
          total={total}
          pageSize={BATCH_PAGE_SIZE}
          onChange={(next) => setPage(next)}
          hideOnSinglePage
          showSizeChanger={false}
          showTotal={(batchTotal) => t("applyRecords.pagination.total", { count: batchTotal })}
        />
      </div>

      <ApplyRecordDetailDrawer record={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
