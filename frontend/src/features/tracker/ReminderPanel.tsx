// SPDX-License-Identifier: Apache-2.0
/** 日历提醒（R-12）：待办列表、新建、完成、忽略与删除。
 *
 * 提醒列表按 ``remind_at`` 升序展示"接下来要做什么"；pending 的提醒可一键标记完成或忽略，
 * 删除走软删除（进回收站）。可关联求职进度 / 岗位 / 简历，三个都是选填（T05 收进折叠区）。
 *
 * T06：列表多了一个「时间范围」筛选（全部 / 已逾期 / 今天 / 以后），逾期判定用后端下发的
 * ``days_until``——前端不按小时重算。列表是客户端分页，筛选变化时重置到第 1 页。
 *
 * 详情抽屉与表单字段分别拆在 `tracker/ReminderDetailDrawer` / `tracker/ReminderFormFields`
 * （单文件 500 行硬预算；本文件只保留数据、弹层开关与列表交互）。
 */
import { CheckSquareOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Card, Form, Listy, Pagination, Segmented, Select, Space } from "antd";
import FormModal from "../../components/common/FormModal";
import EmptyState from "../../components/common/EmptyState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { useClientPagination } from "../../hooks/useClientPagination";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import {
  createReminder,
  deleteReminder,
  listReminders,
  snoozeReminder,
  updateReminder,
} from "../../api/reminders";
import { getAgentTaskEvents } from "../../api/settings";
import { useJobSearchSelect, useTrackSearchSelect } from "../../hooks/remoteSearchOptions";
import { useResumeRefSelect } from "../../hooks/useResumeRefSelect";
import { resumeRefIds } from "../../types/resumeRef";
import {
  linkedLabelOf,
  reminderResumeHref,
  reminderResumeLabel,
  reminderResumeValue,
} from "./reminderResumeLink";
import { REMINDER_KINDS } from "../../types";
import type { Reminder, ReminderKind, ReminderPayload, ReminderSnoozePayload } from "../../types";
import { LISTY_ITEM_PADDING_DEFAULT } from "../../components/common/listyPadding";
import type { RowActionItem } from "../../components/common/RowActions";
import BatchActionBar from "../../components/common/BatchActionBar";
import { useBatchSelection } from "../../hooks/useBatchSelection";
import CalendarView from "./CalendarView";
import ReminderDetailDrawer from "./ReminderDetailDrawer";
import ReminderFormFields, { type ReminderForm } from "./ReminderFormFields";
import { defaultRemindAt } from "./reminderFormDefaults";
import ReminderListItem from "./ReminderListItem";
import { useReminderDeepLink } from "./useReminderDeepLink";
import {
  REMINDER_TIME_RANGES,
  REMINDER_TIME_RANGE_LABEL_KEYS,
  filterByTimeRange,
} from "./reminderTimeRange";
import type { ReminderTimeRange } from "./reminderTimeRange";
import { t } from "../../i18n";
import { REMINDER_KIND_LABEL_KEYS } from "../../i18n/enum/reminder";
import { useLocale } from "../../i18n/i18nContext";
import { formatDateTime } from "../../utils/format";

export default function ReminderPanel({
  initialReminderId = null,
  onInitialReminderDone,
}: {
  /** 深链 `?reminder=N`（整改 #13）：列表加载完之后展开这一条；`null` = 没有深链。 */
  initialReminderId?: number | null;
  /** 深链那条处理完（抽屉关闭 / 查无此条）：宿主据此把 URL 参数清掉。 */
  onInitialReminderDone?: () => void;
} = {}) {
  useLocale();
  const { message, modal } = App.useApp();
  // 关联目标下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量。
  const trackSelect = useTrackSearchSelect();
  const jobSelect = useJobSearchSelect();
  // R14：关联简历改为"内部 / 外部两组"的统一选择器（值域是 `internal:12` / `external:7`）。
  const resumeSelect = useResumeRefSelect();
  const [items, setItems] = useState<Reminder[]>([]);
  const [kind, setKind] = useState<string | undefined>();
  // T06 时间范围：客户端筛选（列表本来就是客户端分页），不影响服务端的类型筛选。
  const [range, setRange] = useState<ReminderTimeRange>("all");
  const rangedItems = filterByTimeRange(items, range);
  // 提醒持续累积，一页 10 条（Listy 无内建分页，走通用客户端分页）。
  // resetKey = 类型 + 时间范围：任一筛选变化都回第 1 页，不会停在越界页码上。
  const {
    page,
    setPage,
    paged: pagedReminders,
    total: reminderTotal,
  } = useClientPagination(rangedItems, 10, `${kind ?? ""}|${range}`);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [detail, setDetail] = useState<Reminder | null>(null);
  const [saving, setSaving] = useState(false);
  // T05：时间字段下方的任务卡提示要读总开关（读不到就不提示，不阻断新建提醒）。
  const [taskCardsEnabled, setTaskCardsEnabled] = useState<boolean | null>(null);
  const [form] = Form.useForm<ReminderForm>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getAgentTaskEvents();
        if (!cancelled) setTaskCardsEnabled(saved.enabled);
      } catch {
        if (!cancelled) setTaskCardsEnabled(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchList = useCallback(async () => {
    try {
      return await listReminders({ kind: kind || undefined });
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("reminder.toast.loadFailed"));
      return null;
    }
  }, [kind, message]);

  // deps 变化的 loading 置位用渲染期守卫；应用状态放在 .then 回调。
  const [prevListKey, setPrevListKey] = useState<string | null>(null);
  const listKey = kind ?? "";
  if (prevListKey !== listKey) {
    setPrevListKey(listKey);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    void fetchList().then((nextItems) => {
      if (cancelled) return;
      if (nextItems !== null) setItems(nextItems);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchList, listKey]);

  // 事件路径（保存/删除后的整表重拉，含 loading 翻动）。
  const loadList = useCallback(async () => {
    setLoading(true);
    const nextItems = await fetchList();
    if (nextItems !== null) setItems(nextItems);
    setLoading(false);
  }, [fetchList]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    // 每次打开都重置到"未来 1 小时后"（T05：默认值本身必须合法，不能是此刻）。
    form.setFieldsValue({ kind: "other", remind_at: defaultRemindAt(), recurrence: "none" });
    // 每次打开都重置一次候选列表（P0-1）：远程搜索结果随上次输入残留。
    void trackSelect.reload();
    void jobSelect.reload();
    void resumeSelect.reload();
    setModalOpen(true);
  };

  const openEdit = (item: Reminder) => {
    setEditing(item);
    form.setFieldsValue({
      title: item.title,
      remind_at: dayjs(item.remind_at),
      kind: item.kind as ReminderKind,
      recurrence: item.recurrence ?? "none",
      recurrence_until: item.recurrence_until ? dayjs(item.recurrence_until) : null,
      note: item.note,
      track_id: item.track_id ?? undefined,
      job_id: item.job_id ?? undefined,
      // R14：复合值（`internal:12` / `external:7`），提交时才拆回两个 id 字段。
      resume_ref: reminderResumeValue(item),
    });
    // 已绑定目标的保显示（P0-1）：按 id 回查补进候选，再重置搜索列表。
    void trackSelect.ensure(item.track_id);
    void jobSelect.ensure(item.job_id);
    // 外部简历回查 404 时用后端回显的名字降级，别让编辑旧记录显示裸 `external:7`。
    void resumeSelect.ensure(reminderResumeValue(item), item.external_resume_name);
    void trackSelect.reload();
    void jobSelect.reload();
    void resumeSelect.reload();
    setModalOpen(true);
  };

  const save = async () => {
    // 关联三字段默认收起（T05）：折叠时 Form.Item 可能从未挂载，validateFields 只返回
    // 已注册字段。getFieldsValue(true) 读完整 store，保证"收起状态下保存不丢已有关联"。
    let values: ReminderForm;
    try {
      values = { ...form.getFieldsValue(true), ...(await form.validateFields()) };
    } catch {
      // 校验失败：错误已就地显示在字段下方，静默返回即可——把 rejected promise 放出去会变成
      // 一条 unhandled rejection（控制台报错，且测试汇总里多出 Errors 行）。
      return;
    }
    setSaving(true);
    // 标成 `ReminderPayload`：两个 id 字段类型上是 `number | null`，塞整条记录会编译报错。
    const payload: ReminderPayload = {
      title: values.title,
      remind_at: values.remind_at.toISOString(),
      kind: values.kind,
      recurrence: values.recurrence ?? "none",
      recurrence_until: values.recurrence_until ? values.recurrence_until.toISOString() : null,
      note: values.note ?? "",
      track_id: values.track_id ?? null,
      job_id: values.job_id ?? null,
      // R14：复合值拆成两个互斥字段，**两个键都给**——PATCH 是"显式给出才改"，只给
      // 其中一个会让库里的另一个留着，合并后变成"两个都关联"（后端 422）。
      ...resumeRefIds(values.resume_ref),
    };
    try {
      if (editing) await updateReminder(editing.id, payload);
      else await createReminder(payload);
      message.success(editing ? t("reminder.toast.updated") : t("reminder.toast.created"));
      setModalOpen(false);
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("reminder.toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (item: Reminder, status: "done" | "dismissed") => {
    try {
      const saved = await updateReminder(item.id, { status });
      if (status !== "done") {
        message.success(t("reminder.toast.ignored"));
      } else if (saved.status === "active") {
        // 重复提醒：这一次完成、下一次已排好，直接告诉用户下一次是什么时候。
        message.success(t("reminder.toast.doneNext", { time: formatDateTime(saved.remind_at) }));
      } else {
        message.success(t("reminder.toast.done"));
      }
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("reminder.toast.updateFailed"));
    }
  };

  /** 稍后（CR-28）：只推后"这一次"的到期时刻，成功后刷新列表时间列。 */
  const snooze = async (item: Reminder, payload: ReminderSnoozePayload) => {
    try {
      const saved = await snoozeReminder(item.id, payload);
      message.success(t("reminder.snooze.toast", { time: formatDateTime(saved.remind_at) }));
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("reminder.snooze.failed"));
    }
  };

  const batch = useBatchSelection<number>();

  // 详情抽屉要展示关联目标的名称（P0-1）：打开时按 id 回查补进候选，
  // 否则第 101 条之后的关联在抽屉里只能显示 "-"。
  useEffect(() => {
    if (!detail) return;
    void trackSelect.ensure(detail.track_id);
    void jobSelect.ensure(detail.job_id);
    void resumeSelect.ensure(reminderResumeValue(detail), detail.external_resume_name);
    // hook 的回调引用稳定，只跟随详情目标变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  /**
   * 深链 `?reminder=N`（整改 #13）：状态机在 `useReminderDeepLink`（等就绪 / 只消费一次 /
   * 找不到就回报），这里只接两个回调。
   */
  const openDeepLinkReminder = useCallback((item: Reminder) => setDetail(item), []);
  const reportDeepLinkMissing = useCallback(() => {
    // 已软删 / 不在当前筛选：说清原因并留在列表，不开一个空抽屉。
    message.warning(t("trackerPage.reminder.notFound"));
    onInitialReminderDone?.();
  }, [message, onInitialReminderDone]);
  useReminderDeepLink({
    initialReminderId,
    loading,
    items,
    onOpen: openDeepLinkReminder,
    onNotFound: reportDeepLinkMissing,
  });

  /**
   * 关闭详情抽屉的统一出口：深链进来的那一条一旦关闭（关闭 / 完成 / 转编辑都算走过一遍），
   * URL 里的 `reminder` 就该去掉——否则刷新会再展开一次、转发也会带着别人的提醒 id。
   */
  const closeDetail = useCallback(() => {
    const closing = detail;
    setDetail(null);
    if (closing && initialReminderId !== null && closing.id === initialReminderId) {
      onInitialReminderDone?.();
    }
  }, [detail, initialReminderId, onInitialReminderDone]);

  /** 批量删除：确认后逐条走同一个软删除接口，全部完成再刷新一次。 */
  const removeSelected = () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    modal.confirm({
      title: t("reminder.confirm.deleteTitle"),
      content: t("reminder.confirm.deleteBody", { count: ids.length }),
      okText: t("common.action.delete"),
      okButtonProps: { danger: true },
      onOk: async () => {
        const results = await Promise.allSettled(
          items.filter((item) => batch.isSelected(item.id)).map((item) => deleteReminder(item.id)),
        );
        const failed = results.filter((item) => item.status === "rejected").length;
        if (failed === 0) message.success(t("reminder.toast.deleted", { count: ids.length }));
        else
          message.warning(t("reminder.toast.deletedPartial", { ok: ids.length - failed, failed }));
        batch.exitSelecting();
        await loadList();
      },
    });
  };

  const remove = async (item: Reminder) => {
    try {
      await deleteReminder(item.id);
      message.success(t("reminder.toast.deletedOne"));
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("reminder.toast.deleteFailed"));
    }
  };

  /** 提醒条目的右键菜单：批量选择（工具栏按钮已收进这里，R8）+ 删除（二次确认）。 */
  const contextActions = (item: Reminder): RowActionItem[] => [
    {
      key: "batch_select",
      label: t("reminder.selectMode"),
      icon: <CheckSquareOutlined />,
      onClick: batch.enterSelecting,
    },
    {
      key: "delete",
      label: t("common.action.delete"),
      danger: true,
      confirm: t("reminder.confirm.deleteOneTitle"),
      confirmBody: t("reminder.confirm.deleteOneBody"),
      onClick: () => void remove(item),
    },
  ];

  /** R14：详情里的「关联简历」——外部带「外部 · 」前缀，内部用下拉回查到的名字。 */
  const detailResumeLabel = detail
    ? reminderResumeLabel(detail, resumeSelect.textOfRef(reminderResumeValue(detail)))
    : undefined;

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Card size="small" title={t("reminder.card.title")}>
        <Space wrap>
          <Select
            allowClear
            placeholder={t("reminder.filter.placeholder")}
            style={{ minWidth: 150 }}
            value={kind}
            onChange={setKind}
            options={REMINDER_KINDS.map((value) => ({
              value,
              label: t(REMINDER_KIND_LABEL_KEYS[value]),
            }))}
          />
          <Select
            aria-label={t("reminder.filter.range.placeholder")}
            style={{ minWidth: 120 }}
            value={range}
            onChange={(value) => setRange(value)}
            options={REMINDER_TIME_RANGES.map((value) => ({
              value,
              label: t(REMINDER_TIME_RANGE_LABEL_KEYS[value]),
            }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t("reminder.action.create")}
          </Button>
          {/* 批量选择入口已收进提醒条目的右键菜单（R8）。 */}
          <Segmented
            value={view}
            onChange={(value) => setView(value as "list" | "calendar")}
            options={[
              { label: t("reminder.view.list"), value: "list" },
              { label: t("reminder.view.calendar"), value: "calendar" },
            ]}
          />
        </Space>
      </Card>

      {view === "calendar" ? (
        <CalendarView reminders={rangedItems} loading={loading} />
      ) : loading ? (
        <LoadingBlock />
      ) : rangedItems.length === 0 ? (
        <EmptyState
          description={items.length === 0 ? t("reminder.empty") : t("reminder.emptyFiltered")}
        />
      ) : (
        <>
          {batch.selecting && (
            <BatchActionBar
              count={batch.selectedCount}
              onExit={batch.exitSelecting}
              pageSelectAll={{
                allSelected:
                  pagedReminders.length > 0 &&
                  pagedReminders.every((item) => batch.isSelected(item.id)),
                someSelected: pagedReminders.some((item) => batch.isSelected(item.id)),
                onToggle: (checked) =>
                  batch.selectPage(
                    pagedReminders.map((item) => item.id),
                    checked,
                  ),
              }}
            >
              <Button danger disabled={batch.selectedCount === 0} onClick={removeSelected}>
                {t("reminder.batch.delete")}
              </Button>
            </BatchActionBar>
          )}
          <Listy
            items={pagedReminders}
            rowKey={(item) => item.id}
            styles={{ item: { ...LISTY_ITEM_PADDING_DEFAULT } }}
            // 行内交互（勾选、操作按钮、右键菜单）收在 ReminderListItem，宿主只传数据与回调。
            itemRender={(item) => (
              <ReminderListItem
                item={item}
                selecting={batch.selecting}
                selected={batch.isSelected(item.id)}
                onToggle={batch.toggle}
                onDetail={(target) => setDetail(target)}
                onEdit={openEdit}
                onRemove={(target) => void remove(target)}
                onStatus={(target, status) => void setStatus(target, status)}
                onSnooze={(target, payload) => snooze(target, payload)}
                contextActions={contextActions}
              />
            )}
          />
          <div style={{ textAlign: "right", marginTop: 12 }}>
            <Pagination
              current={page}
              pageSize={10}
              total={reminderTotal}
              onChange={setPage}
              hideOnSinglePage
              showSizeChanger={false}
              showTotal={(count) => t("reminder.table.total", { count })}
            />
          </div>
        </>
      )}

      <FormModal
        title={editing ? t("reminder.modal.edit") : t("reminder.action.create")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onSubmit={() => void save()}
        submitting={saving}
        okText={t("reminder.modal.save")}
        width={520}
      >
        <ReminderFormFields
          form={form}
          editing={editing}
          taskCardsEnabled={taskCardsEnabled}
          trackSelect={trackSelect}
          jobSelect={jobSelect}
          resumeSelect={resumeSelect}
        />
      </FormModal>

      <ReminderDetailDrawer
        detail={detail}
        trackLabel={linkedLabelOf(trackSelect.options, detail?.track_id)}
        jobLabel={linkedLabelOf(jobSelect.options, detail?.job_id)}
        resumeLabel={detailResumeLabel}
        resumeHref={detail ? reminderResumeHref(detail) : undefined}
        onMarkDone={() => {
          if (!detail) return;
          void setStatus(detail, "done");
          closeDetail();
        }}
        onEdit={() => {
          if (!detail) return;
          openEdit(detail);
          closeDetail();
        }}
        onClose={closeDetail}
      />
    </Space>
  );
}
