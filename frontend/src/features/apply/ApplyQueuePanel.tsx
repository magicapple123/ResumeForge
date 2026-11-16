// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列：逐条确认准入、编辑招呼语与简历，然后显式开始投递。
 *
 * 准入提示直接读后端返回的 `admission` / `requires_confirm`（不在这里重判一次）：
 * - `block`（真实缺口）显示为「不投」并说明原因；
 * - `needs_confirm`（证据不足 / 待确认）提示需要用户确认；
 * - 未分析的岗位以「未分析」呈现。
 *
 * #14 之后本文件只做**编排**：说明收进 `ApplyQueueGuide`、吸底条是 `ApplyQueueStartBar`、
 * 体检抽屉是 `ApplyQueuePreflightDrawer`、详情是 `ApplyQueueDetailDrawer`、批量套话术是
 * `BatchGreetingTemplateModal`。面板自己保留的只有状态、请求与"哪些条目可投"的判定。
 */
import { DeleteOutlined, EditOutlined, EyeOutlined, SearchOutlined } from "@ant-design/icons";
import { App, Alert, Button, Modal, Space, Typography } from "antd";
import PageSkeleton from "../../components/common/PageSkeleton";
import EmptyState from "../../components/common/EmptyState";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listQueue } from "../../api/apply";
import { useApi } from "../../hooks/useApi";
import type { ApplyQueueItem, ApplyQueueList, ApplyTask, QueueStatus } from "../../types";
import { type RowMenuItem } from "../../components/common/rowActionMenu";
import { ApplyQueueDetailDrawer } from "./queue/ApplyQueueDetailDrawer";
import { ApplyQueueGuide } from "./queue/ApplyQueueGuide";
import { ApplyQueuePreflightDrawer } from "./queue/ApplyQueuePreflightDrawer";
import { ApplyQueueStartBar } from "./queue/ApplyQueueStartBar";
import { BatchGreetingTemplateModal } from "./queue/BatchGreetingTemplateModal";
import { QueueFilterBar } from "./queue/QueueFilterBar";
import { UNANALYZED_FILTER, type AdmissionFilterValue } from "./queue/filterOptions";
import { QueueItemEditor } from "./queue/QueueItemEditor";
import { QueueTable } from "./queue/QueueTable";
import ApplyJobInspectCard from "./insights/ApplyJobInspectCard";
import ApplyResumeFitDrawer from "./insights/ApplyResumeFitDrawer";
import { useApplyQueueOperations } from "./useApplyQueueOperations";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  /** 有任务正在运行时为真：禁止重复开始。 */
  disabled: boolean;
  onStarted: (task: ApplyTask) => void;
  task?: ApplyTask | null;
  controlBusy?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  /** 队列内容变化（增删改）时通知页面刷新概览。 */
  onChanged?: () => void;
}

export default function ApplyQueuePanel({
  disabled,
  onStarted,
  task,
  controlBusy = false,
  onPause,
  onResume,
  onChanged,
}: Props) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  // 本面板用模块级 t()：必须订阅语言变化。
  useLocale();
  const [reloadKey, setReloadKey] = useState(0);
  // 列表响应是 { items, total, truncated }（P2-2）：队列封顶 500 条，total 是真实条数。
  const { data, loading, error, reload } = useApi<ApplyQueueList>(() => listQueue(), [reloadKey]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editing, setEditing] = useState<ApplyQueueItem | null>(null);
  const [detail, setDetail] = useState<ApplyQueueItem | null>(null);
  const [statusFilter, setStatusFilter] = useState<QueueStatus | undefined>(undefined);
  const [admissionFilter, setAdmissionFilter] = useState<AdmissionFilterValue | undefined>(
    undefined,
  );
  // #14B 只看收藏。
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  // #14D 批量套用话术模板。
  const [templateOpen, setTemplateOpen] = useState(false);
  // #15C 岗位体检（行内「体检」→ 小卡片）；#15D 优化指派（勾选后批量看建议）。
  // 二者都只在本面板留一个 state + 一个回调，卡片 JSX 不进本文件（500 行预算）。
  const [inspecting, setInspecting] = useState<ApplyQueueItem | null>(null);
  const [resumeFitOpen, setResumeFitOpen] = useState(false);

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const queueTotal = data?.total ?? 0;
  const queueTruncated = data?.truncated ?? false;
  const pendingItems = useMemo(
    () => items.filter((item) => item.status === "pending" && item.job_id !== null),
    [items],
  );
  // 来源不支持的待投条目：它们**无法**被自动投递，整队列投递时会被后端一次性拦下。
  // #14I 之后它们不再是首屏横幅（58px），而是工具栏上的一个 chip + 就地确认的清理入口。
  const unsupportedPending = useMemo(
    () => pendingItems.filter((item) => item.apply_supported === false),
    [pendingItems],
  );

  // 筛选只影响表格显示：准入告警、开始投递的可用性判断仍看全量 items。
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (statusFilter && item.status !== statusFilter) return false;
        if (favoriteOnly && !item.favorite) return false;
        if (admissionFilter) {
          if (admissionFilter === UNANALYZED_FILTER) return item.admission === null;
          return item.admission === admissionFilter;
        }
        return true;
      }),
    [items, statusFilter, admissionFilter, favoriteOnly],
  );
  const filterActive = statusFilter !== undefined || admissionFilter !== undefined || favoriteOnly;
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
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );

  const refresh = () => {
    setReloadKey((value) => value + 1);
    onChanged?.();
  };

  const {
    busy,
    batchRemoving,
    preflightOpen,
    setPreflightOpen,
    preflightLoading,
    preflight,
    confirmOpen,
    setConfirmOpen,
    remove,
    removeSelected,
    removeUnsupported,
    openPreflight,
    fixRemove,
    chosenJobIds,
    launch,
    start,
  } = useApplyQueueOperations({
    items,
    selectedIds,
    setSelectedIds,
    unsupportedPending,
    message,
    refresh,
    onStarted,
  });

  /**
   * 行操作的唯一清单：右键菜单与「···」下拉都从这里取，避免两处慢慢长歪。
   * 「移出队列」走 Modal.confirm——由 `useRowActionMenu` / `useRowActionRunner` 统一加二次确认，
   * 这里只声明 `confirm` + `confirmBody`，不自己调 `modal.confirm`。
   */
  const rowMenuItems = (record: ApplyQueueItem): RowMenuItem[] => [
    {
      key: "detail",
      label: t("applyQueue.action.viewDetail"),
      icon: <EyeOutlined />,
      onClick: () => setDetail(record),
    },
    {
      key: "edit",
      label: t("applyQueue.action.edit"),
      icon: <EditOutlined />,
      onClick: () => setEditing(record),
    },
    {
      // I-22：从队列直接去调研这家公司（只预填，不自动提交，避免一进来就计费）。
      key: "research",
      label: t("applyQueue.action.researchCompany"),
      icon: <SearchOutlined />,
      onClick: () =>
        navigate(
          `/research?company=${encodeURIComponent(record.company || "")}` +
            `&role=${encodeURIComponent(record.job_title || "")}`,
        ),
    },
    {
      key: "remove",
      label: t("applyQueue.action.remove"),
      danger: true,
      icon: <DeleteOutlined />,
      confirm: t("applyQueue.confirm.removeTitle"),
      // 与「删除」区别开：移出队列不动数据，正文要说清"岗位与投递记录都还在"。
      confirmBody: t("applyQueue.confirm.removeBody"),
      onClick: () => void remove(record),
    },
  ];

  if (loading && !data) return <PageSkeleton rows={5} />;

  return (
    <div className="apply-queue-panel">
      {/* 队列被封顶展示（P2-2）：如实在说，引导用筛选/开始投递消化，而不是假装队列只有 500 条。 */}
      {queueTruncated && items.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={t("applyQueue.truncated", { total: queueTotal, shown: items.length })}
          style={{ marginBottom: 12 }}
        />
      )}

      <QueueFilterBar
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        admissionFilter={admissionFilter}
        onAdmissionChange={setAdmissionFilter}
        favoriteOnly={favoriteOnly}
        onFavoriteOnlyChange={setFavoriteOnly}
        queueTotal={queueTotal}
        filteredCount={filteredItems.length}
        filterActive={filterActive}
        selectedCount={selectedIds.length}
        selectableCount={selectableIds.length}
        unsupportedCount={unsupportedPending.length}
        busy={busy}
        batchRemoving={batchRemoving}
        loading={loading}
        onSelectAll={() => setSelectedIds(selectableIds)}
        onClearSelection={() => setSelectedIds([])}
        onRemoveSelected={() => void removeSelected()}
        onRemoveUnsupported={removeUnsupported}
        onPreflight={openPreflight}
        preflightLoading={preflightLoading}
        onReload={() => void reload()}
        onBatchTemplate={() => setTemplateOpen(true)}
        onResumeFit={() => setResumeFitOpen(true)}
        guide={<ApplyQueueGuide />}
      />

      {items.length === 0 ? (
        // #14I 空态补主按钮：原来只有一句「先去岗位广场挑几个岗位」，没有可点的入口
        // （空态里的主按钮要内嵌，不能用「点右上角」这类方位词指路）。
        <EmptyState
          description={
            <Space orientation="vertical" size={4}>
              <Typography.Text>{t("applyQueue.empty.title")}</Typography.Text>
              <Typography.Text type="secondary">{t("applyQueue.empty.body")}</Typography.Text>
            </Space>
          }
        >
          <Link to="/jobs">
            <Button type="primary">{t("applyQueue.empty.action")}</Button>
          </Link>
        </EmptyState>
      ) : (
        <QueueTable
          items={filteredItems}
          busy={busy}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          setDetail={setDetail}
          rowMenuItems={rowMenuItems}
          onInspect={setInspecting}
        />
      )}

      {/* #14H 吸底操作条：`.app-content` 才是滚动容器，它必须留在这个子树里才 sticky 得住。 */}
      <ApplyQueueStartBar
        selectedCount={selectedIds.length}
        eligibleCount={selectableIds.length}
        busy={busy || controlBusy}
        startDisabled={disabled || pendingItems.length === 0}
        onStart={() => void start()}
        task={task}
        onPause={onPause}
        onResume={onResume}
      />

      <ApplyQueueDetailDrawer
        item={detail}
        queueItems={items}
        onClose={() => setDetail(null)}
        onEdit={(item) => {
          setEditing(item);
          setDetail(null);
        }}
        onRemove={(item) => {
          void remove(item);
          setDetail(null);
        }}
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

      <ApplyQueuePreflightDrawer
        open={preflightOpen}
        loading={preflightLoading}
        result={preflight}
        items={items}
        onClose={() => setPreflightOpen(false)}
        onFixRemove={(queueId) => void fixRemove(queueId)}
        onFixEdit={(item) => {
          setPreflightOpen(false);
          setEditing(item);
        }}
      />

      {/* 有 blocking 时的一次确认（不硬拦）：文案写清数量，按钮描述结果而不是「是/否」。 */}
      <Modal
        open={confirmOpen}
        title={t("applyQueue.preflight.confirmTitle")}
        onCancel={() => setConfirmOpen(false)}
        mask={{ closable: false }}
        footer={[
          <Button key="cancel" onClick={() => setConfirmOpen(false)}>
            {t("applyQueue.preflight.confirmCancel")}
          </Button>,
          <Button
            key="go"
            type="primary"
            onClick={() => {
              setConfirmOpen(false);
              void launch(chosenJobIds());
            }}
          >
            {t("applyQueue.preflight.confirmGo")}
          </Button>,
        ]}
      >
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          {t("applyQueue.preflight.confirmBody", { count: preflight?.summary.blocking ?? 0 })}
        </Typography.Paragraph>
      </Modal>

      <BatchGreetingTemplateModal
        open={templateOpen}
        items={selectedItems}
        onClose={() => setTemplateOpen(false)}
        onApplied={refresh}
      />

      {/* #15C 岗位体检：只读小卡片，接口失败只在卡片里报错，不影响队列与开始投递。 */}
      <ApplyJobInspectCard
        queueId={inspecting?.id ?? null}
        jobTitle={inspecting?.job_title}
        onClose={() => setInspecting(null)}
      />

      {/* #15D 优化指派：只对勾选的条目算建议，换用走现有的改简历接口，成功后刷新队列。 */}
      <ApplyResumeFitDrawer
        open={resumeFitOpen}
        items={selectedItems}
        onClose={() => setResumeFitOpen(false)}
        onApplied={refresh}
      />
    </div>
  );
}
