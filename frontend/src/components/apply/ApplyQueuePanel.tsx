/**
 * 投递队列：调整顺序、逐条确认准入、编辑招呼语与简历，然后显式开始投递。
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
import { App, Alert, Button, Empty, Skeleton, Space, Tag, Typography, Popconfirm } from "antd";
import { useEffect, useMemo, useState } from "react";
import { createApplyTask, listQueue, removeQueueItem, reorderQueue } from "../../api/apply";
import { useApi } from "../../hooks/useApi";
import { QUEUE_STATUS_META, type ApplyQueueItem, type ApplyTask } from "../../types";
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

export default function ApplyQueuePanel({ disabled, onStarted, onChanged }: Props) {
  const { message } = App.useApp();
  const [reloadKey, setReloadKey] = useState(0);
  const { data, loading, error, reload, setData } = useApi<ApplyQueueItem[]>(
    () => listQueue(),
    [reloadKey],
  );
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editing, setEditing] = useState<ApplyQueueItem | null>(null);
  const [detail, setDetail] = useState<ApplyQueueItem | null>(null);
  const [busy, setBusy] = useState(false);
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

  const move = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const order = items.map((item) => item.id);
    [order[index], order[target]] = [order[target], order[index]];
    setBusy(true);
    try {
      const updated = await reorderQueue(order);
      setData(updated);
      onChanged?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "调整顺序失败");
    } finally {
      setBusy(false);
    }
  };

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

  if (loading && !data) return <Skeleton active paragraph={{ rows: 5 }} />;

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
          <Typography.Text type="secondary">
            共 {items.length} 个岗位；勾选后只投选中的，不勾选则整队列按顺序投递。
          </Typography.Text>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
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
          items={items}
          busy={busy}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          setDetail={setDetail}
          move={move}
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
