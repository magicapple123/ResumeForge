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
import { RedoOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Pagination,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import LoadingBlock from "../common/LoadingBlock";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import BatchGroup, { BATCH_ITEM_PAGE_SIZE, type BatchItemsState } from "./ApplyRecordsBatchGroup";
import {
  batchDeleteRecords,
  deleteRecord,
  deleteRecordBatch,
  listRecordBatchItems,
  listRecordBatches,
  retryRecord,
} from "../../api/apply";
import { useApi } from "../../hooks/useApi";
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

interface Props {
  disabled: boolean;
  onRetried: (task: ApplyTask) => void;
}

const RESULT_OPTIONS = [
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
  { value: "skipped", label: "已跳过" },
];

const BATCH_PAGE_SIZE = 5;

export default function ApplyRecordsPanel({ disabled, onRetried }: Props) {
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
  // B4 按需加载：明细在批次首次展开时才拉取，折叠不丢（缓存到 batchItems）。
  const [batchItems, setBatchItems] = useState<Record<number, BatchItemsState>>({});
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

  // 明细请求的代次守卫（PR-14）：数据集（列表 data）或筛选（keyword/result）一旦
  // 变化就整体作废进行中的明细请求——迟到的旧响应不再把旧筛选/旧页的数据写回
  // batchItems，用户看到的明细永远属于当前列表状态。每次发起请求取一个代次号，
  // 响应回来时只落"仍然是最新代次"的结果，不匹配的直接丢弃。
  const fetchGenerationRef = useRef(0);
  useEffect(() => {
    fetchGenerationRef.current += 1;
  }, [keyword, result, data]);

  /** 拉取某个批次的某页明细（带与列表一致的 keyword/result，与 matched_count 对得上）。 */
  const fetchBatchItems = useCallback(
    async (batchId: number, itemPage: number) => {
      const generation = ++fetchGenerationRef.current;
      setBatchItems((prev) => ({
        ...prev,
        [batchId]: {
          items: prev[batchId]?.items ?? [],
          total: prev[batchId]?.total ?? 0,
          page: itemPage,
          loading: true,
        },
      }));
      try {
        const resp = await listRecordBatchItems(batchId, {
          keyword,
          result,
          page: itemPage,
          page_size: BATCH_ITEM_PAGE_SIZE,
        });
        // 代次不匹配 = 期间换过筛选或列表已重置：这份响应属于旧世界，丢弃。
        if (generation !== fetchGenerationRef.current) return;
        setBatchItems((prev) => ({
          ...prev,
          [batchId]: { items: resp.items, total: resp.total, page: itemPage, loading: false },
        }));
      } catch (err) {
        if (generation !== fetchGenerationRef.current) return;
        message.error(err instanceof Error ? err.message : "加载批次明细失败");
        setBatchItems((prev) => ({
          ...prev,
          [batchId]: { ...(prev[batchId] as BatchItemsState), loading: false },
        }));
      }
    },
    [keyword, message, result],
  );

  // 列表数据一变（翻页/筛选/删除后 reload），旧明细就过期：清空缓存，
  // 已展开的批次由下面的补拉 effect 重新拉第一页。
  // Compiler 规范：随 data 变化的重置用渲染期守卫式调整，不用 effect。
  const [prevData, setPrevData] = useState(data);
  if (prevData !== data) {
    setPrevData(data);
    setBatchItems({});
  }

  // 每个展开中的批次都必须有一份明细（首次展开 / 缓存被清后补拉）。
  useEffect(() => {
    for (const batchId of expanded) {
      if (!batchItems[batchId]) void fetchBatchItems(batchId, 1);
    }
  }, [expanded, batchItems, fetchBatchItems]);

  const retry = async (record: ApplyRecord) => {
    setRetrying(record.id);
    try {
      const task = await retryRecord(record.id);
      message.success("已新建一个重投批次");
      onRetried(task);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "重投失败");
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
      message.success("已移入回收站");
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  /** 删整批。**只删记录、不删批次**：批次是分组键，删掉整组会消失、统计也会跳变。 */
  const removeBatch = async (batch: ApplyRecordBatch) => {
    try {
      await deleteRecordBatch(batch.id);
      setExpanded((prev) => prev.filter((id) => id !== batch.id));
      if (detail?.task_id === batch.id) setDetail(null);
      message.success("已移入回收站");
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
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
      message.success(`已删除 ${deleted} 条投递记录，可在「回收站」里恢复`);
      exitBatchSelect(batch.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "批量删除失败，请重试");
      return;
    }
    await reload();
  };

  const recordColumns: ColumnsType<ApplyRecord> = [
    {
      title: "岗位",
      dataIndex: "job_title",
      ellipsis: true,
      render: (title: string, record) => (
        <Space orientation="vertical" size={0} style={{ width: "100%" }}>
          <Typography.Text ellipsis>{title || "（岗位已删除）"}</Typography.Text>
          {record.company && (
            <Typography.Text type="secondary" ellipsis>
              {record.company}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: "结果",
      dataIndex: "status",
      width: 80,
      render: (value: ApplyRecord["status"]) => {
        const meta = TASK_ITEM_STATUS_META[value];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "失败分类",
      key: "failure",
      ellipsis: true,
      render: (_, record) =>
        record.failure_category ? (
          <Tag color="red">{failureLabel(record.failure_category, record.failure_label)}</Tag>
        ) : (
          "-"
        ),
    },
    {
      title: "简历",
      dataIndex: "resume_title",
      width: 120,
      ellipsis: true,
      render: (v: string) => v || "-",
    },
    {
      title: "招呼语",
      dataIndex: "greeting",
      ellipsis: true,
      render: (v: string) => v || "（默认）",
    },
    {
      title: "时间",
      key: "finished_at",
      width: 150,
      render: (_, record) => formatDateTime(record.finished_at || record.created_at),
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="以该条目为唯一目标重新投递（仍走去重与每日上限）">
            <Button
              size="small"
              icon={<RedoOutlined />}
              loading={retrying === record.id}
              disabled={disabled || record.job_id == null}
              onClick={() => void retry(record)}
            >
              重投
            </Button>
          </Tooltip>
          <RowActions
            more={[
              {
                key: "delete",
                label: "删除",
                danger: true,
                confirm: "删除这条投递记录？会进回收站，之后可以恢复；也会从统计与每日上限里去掉。",
                onClick: () => void removeRecord(record),
              },
            ]}
          />
        </Space>
      ),
    },
    {
      title: "详情",
      key: "detail",
      width: 80,
      render: (_, record) => (
        <Button size="small" onClick={() => setDetail(record)}>
          详情
        </Button>
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
          noun="条投递记录"
          onDelete={() => void removeBatchSelected(batch)}
        />
      </BatchActionBar>
    );
  };

  return (
    <div className="apply-records-panel">
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder="搜索岗位 / 公司"
          allowClear
          enterButton={<SearchOutlined />}
          style={{ width: 260 }}
          value={searchText}
          onChange={(event) => {
            const value = event.target.value;
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
        />
        <Select
          placeholder="结果"
          allowClear
          style={{ width: 130 }}
          options={RESULT_OPTIONS}
          value={result || undefined}
          onChange={(value) => {
            setResult(value ?? "");
            setPage(1);
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
          刷新
        </Button>
        {/* 投递记录的"下一步"在求职进度：补一个小入口，不用用户自己找。 */}
        <Link to="/tracker">
          <Button type="link" size="small" style={{ padding: 0 }}>
            去求职进度跟进
          </Button>
        </Link>
        <Typography.Text type="secondary">
          按投递批次分组：一次投出的多个岗位归在一组，点击展开看明细
        </Typography.Text>
      </Space>

      {loading && batches.length === 0 && (
        <div style={{ textAlign: "center", padding: 24 }}>
          <LoadingBlock />
        </div>
      )}
      {!loading && batches.length === 0 && <Empty description="还没有投递记录" />}

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
          showTotal={(batchTotal) => `共 ${batchTotal} 个批次`}
        />
      </div>

      <Drawer
        title="投递记录详情"
        placement="right"
        size={480}
        open={detail !== null}
        onClose={() => setDetail(null)}
        destroyOnHidden
      >
        {detail && (
          <Descriptions column={1} bordered size="small" colon>
            <Descriptions.Item label="岗位">
              {detail.job_title || "（岗位已删除）"}
              {detail.company ? ` · ${detail.company}` : ""}
            </Descriptions.Item>
            <Descriptions.Item label="简历">{detail.resume_title || "-"}</Descriptions.Item>
            <Descriptions.Item label="招呼语">
              {detail.greeting || "（默认招呼语）"}
            </Descriptions.Item>
            <Descriptions.Item label="结果">
              {TASK_ITEM_STATUS_META[detail.status].label}
            </Descriptions.Item>
            <Descriptions.Item label="失败分类">
              {detail.failure_category
                ? failureLabel(detail.failure_category, detail.failure_label)
                : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="失败信息（含页面 URL / 标题）">
              {detail.failure_detail || "-"}
            </Descriptions.Item>
            <Descriptions.Item label="时间">
              {formatDateTime(detail.finished_at || detail.created_at)}
            </Descriptions.Item>
            <Descriptions.Item label="任务 / 批次">
              {`批次 #${detail.task_id} · 第 ${detail.attempt} 次尝试`}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
