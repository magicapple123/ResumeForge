/**
 * 投递队列：逐条确认准入、编辑招呼语与简历，然后显式开始投递。
 *
 * 准入提示直接读后端返回的 `admission` / `requires_confirm`（不在这里重判一次）：
 * - `block`（真实缺口）显示为「不投」并说明原因；
 * - `needs_confirm`（证据不足 / 待确认）提示需要用户确认；
 * - 未分析的岗位以「未分析」呈现。
 */
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  App,
  Alert,
  Button,
  Empty,
  Space,
  Tag,
  Tooltip,
  Typography,
  Popconfirm,
  Select,
} from "antd";
import PageSkeleton from "../common/PageSkeleton";
import { useEffect, useMemo, useState } from "react";
import { createApplyTask, getBrowserStatus, listQueue, removeQueueItem } from "../../api/apply";
import { useApi } from "../../hooks/useApi";
import {
  QUEUE_STATUS_META,
  type ApplyQueueItem,
  type ApplyTask,
  type QueueStatus,
} from "../../types";
import { formatDateTime } from "../../utils/format";
import { RecordDetailDrawer } from "../common/RecordDetail";
import { useRowActionMenu } from "../common/rowActionMenu";
import { AdmissionTag } from "./queue/AdmissionTag";
import { QueueItemEditor } from "./queue/QueueItemEditor";
import { QueueTable } from "./queue/QueueTable";

interface Props {
  /** 有任务正在运行时为真：禁止重复开始。 */
  disabled: boolean;
  onStarted: (task: ApplyTask) => void;
  /** 队列内容变化（增删改）时通知页面刷新概览。 */
  onChanged?: () => void;
}

/** 状态筛选选项：直接从 QUEUE_STATUS_META 取，文案与表格里的状态标签同源。 */
const STATUS_FILTER_OPTIONS = (
  Object.entries(QUEUE_STATUS_META) as [QueueStatus, { label: string; color: string }][]
).map(([value, meta]) => ({ value, label: meta.label }));

/**
 * 准入筛选选项：与 ADMISSION_META 的标签一致；`admission === null`（未分析）在 Select 里
 * 用哨兵值承载——Select 的 value 不能是 null（会被当成"未选择"）。
 */
const UNANALYZED_FILTER = "unanalyzed";
const ADMISSION_FILTER_OPTIONS = [
  { value: "allow", label: "可投递" },
  { value: "needs_confirm", label: "需确认" },
  { value: "block", label: "不投" },
  { value: UNANALYZED_FILTER, label: "未分析" },
];
type AdmissionFilterValue = "allow" | "needs_confirm" | "block" | typeof UNANALYZED_FILTER;

export default function ApplyQueuePanel({ disabled, onStarted, onChanged }: Props) {
  const { message } = App.useApp();
  const [reloadKey, setReloadKey] = useState(0);
  const { data, loading, error, reload } = useApi<ApplyQueueItem[]>(() => listQueue(), [reloadKey]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editing, setEditing] = useState<ApplyQueueItem | null>(null);
  const [detail, setDetail] = useState<ApplyQueueItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<QueueStatus | undefined>(undefined);
  const [admissionFilter, setAdmissionFilter] = useState<AdmissionFilterValue | undefined>(
    undefined,
  );
  const [batchRemoving, setBatchRemoving] = useState(false);
  const buildMenu = useRowActionMenu();

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  const items = useMemo(() => data ?? [], [data]);
  const pendingItems = useMemo(
    () => items.filter((item) => item.status === "pending" && item.job_id !== null),
    [items],
  );
  // 来源不支持的待投条目：它们**无法**被自动投递，整队列投递时会被后端一次性拦下。
  // 提前在页面上说明，用户才不会在点了「开始投递」之后才被一条 409 拦住。
  const unsupportedPending = useMemo(
    () => pendingItems.filter((item) => item.apply_supported === false),
    [pendingItems],
  );

  // 筛选只影响表格显示：准入告警、开始投递的可用性判断仍看全量 items。
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (statusFilter && item.status !== statusFilter) return false;
        if (admissionFilter) {
          if (admissionFilter === UNANALYZED_FILTER) return item.admission === null;
          return item.admission === admissionFilter;
        }
        return true;
      }),
    [items, statusFilter, admissionFilter],
  );
  const filterActive = statusFilter !== undefined || admissionFilter !== undefined;
  // 「全选队列」= 勾选当前筛选结果里**全部可投**的条目（跨页生效），可选范围与表格
  // 勾选框的非禁用条件（getCheckboxProps）保持一致。
  const selectableIds = useMemo(
    () =>
      filteredItems
        .filter(
          (item) =>
            item.status === "pending" && item.job_id !== null && item.apply_supported !== false,
        )
        .map((item) => item.id),
    [filteredItems],
  );

  const refresh = () => {
    setReloadKey((value) => value + 1);
    onChanged?.();
  };

  /**
   * 右键菜单项：与「···」菜单一致（编辑 / 移出队列）。移出队列走 Modal.confirm。
   */
  /**
   * 行操作的唯一清单：右键菜单与「···」下拉都从这里取，避免两处慢慢长歪。
   * 「移出队列」走 Modal.confirm（由 buildMenu 统一加二次确认）。
   */
  const rowMenuItems = (record: ApplyQueueItem) =>
    buildMenu([
      {
        key: "detail",
        label: "查看详情",
        icon: <EyeOutlined />,
        onClick: () => setDetail(record),
      },
      {
        key: "edit",
        label: "编辑",
        icon: <EditOutlined />,
        onClick: () => setEditing(record),
      },
      {
        key: "remove",
        label: "移出队列",
        danger: true,
        icon: <DeleteOutlined />,
        confirm: "移出投递队列？",
        onClick: () => void remove(record),
      },
    ]);

  const remove = async (item: ApplyQueueItem) => {
    setBusy(true);
    try {
      await removeQueueItem(item.id);
      setSelectedIds((current) => current.filter((id) => id !== item.id));
      message.success("已移出队列");
      refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "移出队列失败");
    } finally {
      setBusy(false);
    }
  };

  /** 批量移出：后端没有批量端点，逐条 DELETE、allSettled 聚合账目——一条失败不拖垮整批。 */
  const removeSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBatchRemoving(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => removeQueueItem(id)));
      const failed = results.filter((result) => result.status === "rejected").length;
      setSelectedIds([]);
      refresh();
      if (failed > 0) {
        message.warning(`已移出 ${ids.length - failed} 个岗位，${failed} 个移出失败`);
      } else {
        message.success(`已把 ${ids.length} 个岗位移出队列`);
      }
    } finally {
      setBatchRemoving(false);
    }
  };

  const start = async () => {
    // Table 的 rowKey 是队列条目 id，而后端 /apply/tasks 的 job_ids 明确要求岗位 id。
    // 两种 id 通常不同，直接提交 selectedIds 会投错岗位，甚至在碰巧存在同号岗位时静默误投。
    const chosen =
      selectedIds.length > 0
        ? items
            .filter(
              (item): item is ApplyQueueItem & { job_id: number } =>
                selectedIds.includes(item.id) && item.status === "pending" && item.job_id !== null,
            )
            .map((item) => item.job_id)
        : undefined;
    if (selectedIds.length > 0 && chosen?.length === 0) {
      message.warning("选中的条目已经不可投递，请刷新队列后重试");
      return;
    }
    setBusy(true);
    try {
      // 投递由受控浏览器执行：浏览器没启动时后端必然失败。按钮不禁用（保留可发现性），
      // 但点击时先查一次状态并给出引导，而不是让用户去读一条后端报错。
      const browser = await getBrowserStatus();
      if (browser.state !== "running") {
        message.warning("请先启动浏览器再开始投递");
        return;
      }
      const task = await createApplyTask(
        chosen ? { job_ids: chosen, use_queue: false } : { use_queue: true },
      );
      message.success(chosen ? `已开始投递选中的 ${chosen.length} 个岗位` : "已开始投递队列");
      setSelectedIds([]);
      onStarted(task);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "开始投递失败");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <PageSkeleton rows={5} />;

  return (
    <div className="apply-queue-panel">
      {/* 用户反馈过「点进来不知道下一步干什么」：这一段是唯一的入口说明，明确"岗位从哪来、
          在这里做什么、什么时候才真的投出去"。不用弹窗，避免每次进来都要关一次。 */}
      <Alert
        className="apply-queue-flow"
        type="info"
        showIcon
        title="队列里放的是「准备投、但还没投」的岗位"
        description={
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              在<span className="apply-queue-flow-em">「岗位广场」</span>
              打开岗位详情，点<span className="apply-queue-flow-em">「加入投递台」</span>
              把它加进来（从「自动采集」导入的岗位也是同一入口）。
            </li>
            <li>
              在这里核对每个岗位的<span className="apply-queue-flow-em">准入结论</span>
              ：不确定的先回岗位广场做「匹配度分析」，判定有真实缺口的默认不投。
            </li>
            <li>
              需要时逐行点岗位名<span className="apply-queue-flow-em">查看详情或编辑</span>
              ，换一份更贴岗位的简历、改一版招呼语。
            </li>
            <li>
              勾选本轮要投的岗位（
              <span className="apply-queue-flow-em">不勾选＝按顺序投整个队列</span>
              ），再点右上角「开始投递」——在那之前不会打开任何招聘网站。
            </li>
          </ol>
        }
      />

      {/* 来源不支持的条目现在的**唯一**来源是"闸门上线前就已经在队列里"的历史数据。
          写清楚它们是什么、以及两种处理方式，用户才不会在点开始时被一条 409 拦住。 */}
      {unsupportedPending.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={`队列里有 ${unsupportedPending.length} 个岗位不能用投递台自动投递`}
          description={
            <span>
              它们的来源不在投递台支持的招聘网站内（已在「岗位」列标出
              <Tag color="red" style={{ margin: "0 4px" }}>
                来源不支持
              </Tag>
              ）。按「开始投递」投整个队列时会被拦下，请先点行末「更多操作 → 移出队列」把它们清掉；
              只想投其中几个时，勾选要投的岗位再点「开始投递」即可。
            </span>
          }
        />
      )}

      <div className="apply-queue-head">
        <Space wrap>
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 128 }}
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as QueueStatus | undefined)}
            options={STATUS_FILTER_OPTIONS}
            aria-label="按状态筛选"
          />
          <Select
            allowClear
            placeholder="按准入筛选"
            style={{ width: 128 }}
            value={admissionFilter}
            onChange={(value) => setAdmissionFilter(value as AdmissionFilterValue | undefined)}
            options={ADMISSION_FILTER_OPTIONS}
            aria-label="按准入筛选"
          />
          <Typography.Text type="secondary">
            共 {items.length} 个岗位
            {filterActive ? `，筛选出 ${filteredItems.length} 个` : ""}，已选 {selectedIds.length}{" "}
            个
          </Typography.Text>
          <Tooltip title="勾选当前列表里的全部可投岗位（跨页生效）；不勾选则整队列按顺序投递">
            <Button
              disabled={busy || selectableIds.length === 0}
              onClick={() => setSelectedIds(selectableIds)}
            >
              全选队列
            </Button>
          </Tooltip>
          <Button disabled={busy || selectedIds.length === 0} onClick={() => setSelectedIds([])}>
            清空选择
          </Button>
          <Popconfirm
            title={`确定把选中的 ${selectedIds.length} 个岗位移出队列？`}
            okText="移出"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            disabled={busy || selectedIds.length === 0 || batchRemoving}
            onConfirm={() => void removeSelected()}
          >
            <Button danger disabled={busy || selectedIds.length === 0} loading={batchRemoving}>
              移出所选
            </Button>
          </Popconfirm>
          {/* loading 直接挂 reload 的请求态：本地接口虽快，转圈一闪也是「点到了」的确认
              （此前点击毫无反馈，用户会以为没点上而连点好几次）。 */}
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void reload()}>
            刷新
          </Button>
        </Space>
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={busy}
          disabled={disabled || pendingItems.length === 0}
          onClick={() => void start()}
        >
          开始投递
        </Button>
      </div>

      {items.length === 0 ? (
        <Empty
          description={
            <Space orientation="vertical" size={4}>
              <Typography.Text>队列还是空的：先去「岗位广场」挑几个岗位。</Typography.Text>
              <Typography.Text type="secondary">
                在「岗位广场」点岗位名打开详情 → 点「加入投递台」，就能把它加到这里；
                加完之后回到本页，勾选要投的岗位再点「开始投递」。
              </Typography.Text>
            </Space>
          }
        />
      ) : (
        <QueueTable
          items={filteredItems}
          busy={busy}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          setDetail={setDetail}
          rowMenuItems={rowMenuItems}
        />
      )}

      {/* 队列条目的详情：表格里只放得下摘要，招呼语全文、准入结论与时间都在这里看。 */}
      <RecordDetailDrawer
        open={detail !== null}
        title={detail?.job_title || "（岗位已删除）"}
        subtitle={detail?.company}
        tags={detail && <AdmissionTag item={detail} />}
        fields={
          detail
            ? [
                {
                  label: "自动投递",
                  value:
                    detail.apply_supported === false ? (
                      <Tag color="red">来源不支持：请到原网站自行投递</Tag>
                    ) : (
                      "可以：来源在投递台支持的招聘网站内"
                    ),
                },
                {
                  label: "状态",
                  value: (
                    <Tag color={QUEUE_STATUS_META[detail.status].color}>
                      {QUEUE_STATUS_META[detail.status].label}
                    </Tag>
                  ),
                },
                {
                  label: "排队序号",
                  value: `第 ${items.findIndex((i) => i.id === detail.id) + 1} 位`,
                },
                { label: "使用简历", value: detail.resume_title || "按默认规则解析" },
                { label: "加入队列", value: formatDateTime(detail.created_at) },
                { label: "最近更新", value: formatDateTime(detail.updated_at) },
              ]
            : []
        }
        sections={detail ? [{ title: "招呼语", content: detail.greeting || "默认招呼语" }] : []}
        actions={
          detail && (
            <Space>
              <Button
                icon={<EditOutlined />}
                onClick={() => {
                  setEditing(detail);
                  setDetail(null);
                }}
              >
                编辑
              </Button>
              <Popconfirm
                title="移出投递队列？"
                okText="移出"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => {
                  void remove(detail);
                  setDetail(null);
                }}
              >
                <Button danger icon={<DeleteOutlined />}>
                  移出队列
                </Button>
              </Popconfirm>
            </Space>
          )
        }
        onClose={() => setDetail(null)}
      />

      {editing && (
        <QueueItemEditor
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
