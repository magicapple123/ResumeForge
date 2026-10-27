// SPDX-License-Identifier: Apache-2.0
/** 日历提醒（R-12）：待办列表、新建、完成、忽略与删除。
 *
 * 提醒列表按 ``remind_at`` 升序展示"接下来要做什么"；pending 的提醒可一键标记完成或忽略，
 * 删除走软删除（进回收站）。可绑定漏斗 / 岗位 / 简历，三个都是选填。
 */
import { CheckOutlined, CheckSquareOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  Listy,
  Pagination,
  Segmented,
  Select,
  Space,
  Tag,
} from "antd";
import FormModal from "./common/FormModal";
import LoadingBlock from "./common/LoadingBlock";
import { useClientPagination } from "../hooks/useClientPagination";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { createReminder, deleteReminder, listReminders, updateReminder } from "../api/reminders";
import {
  useJobSearchSelect,
  useResumeSearchSelect,
  useTrackSearchSelect,
} from "../hooks/remoteSearchOptions";
import { REMINDER_KINDS, REMINDER_KIND_LABELS, REMINDER_STATUS_LABELS } from "../types";
import type { Reminder, ReminderKind, ReminderStatus } from "../types";
import { formatDateTime } from "../utils/format";
import { RecordDetailDrawer } from "./common/RecordDetail";
import { LISTY_ITEM_PADDING_DEFAULT } from "./common/listyPadding";
import type { RowActionItem } from "./common/RowActions";
import BatchActionBar from "./common/BatchActionBar";
import { useBatchSelection } from "../hooks/useBatchSelection";
import CalendarView from "./tracker/CalendarView";
import ReminderListItem from "./tracker/ReminderListItem";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

interface ReminderForm {
  title: string;
  remind_at: Dayjs;
  kind: ReminderKind;
  note?: string;
  track_id?: number;
  job_id?: number;
  resume_id?: number;
}

export default function ReminderPanel() {
  useLocale();
  const { message, modal } = App.useApp();
  // 绑定目标下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量。
  const trackSelect = useTrackSearchSelect();
  const jobSelect = useJobSearchSelect();
  const resumeSelect = useResumeSearchSelect();
  const [items, setItems] = useState<Reminder[]>([]);
  // 提醒持续累积，一页 10 条（Listy 无内建分页，走通用客户端分页）。
  const {
    page,
    setPage,
    paged: pagedReminders,
    total: reminderTotal,
  } = useClientPagination(items, 10);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<string | undefined>();
  const [view, setView] = useState<"list" | "calendar">("list");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [detail, setDetail] = useState<Reminder | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ReminderForm>();

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
    void fetchList().then((items) => {
      if (cancelled) return;
      if (items !== null) setItems(items);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchList, listKey]);

  // 事件路径（保存/删除后的整表重拉，含 loading 翻动）。
  const loadList = useCallback(async () => {
    setLoading(true);
    const items = await fetchList();
    if (items !== null) setItems(items);
    setLoading(false);
  }, [fetchList]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
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
      note: item.note,
      track_id: item.track_id ?? undefined,
      job_id: item.job_id ?? undefined,
      resume_id: item.resume_id ?? undefined,
    });
    // 已绑定目标的保显示（P0-1）：按 id 回查补进候选，再重置搜索列表。
    void trackSelect.ensure(item.track_id);
    void jobSelect.ensure(item.job_id);
    void resumeSelect.ensure(item.resume_id);
    void trackSelect.reload();
    void jobSelect.reload();
    void resumeSelect.reload();
    setModalOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    const payload = {
      title: values.title,
      remind_at: values.remind_at.toISOString(),
      kind: values.kind,
      note: values.note ?? "",
      track_id: values.track_id ?? null,
      job_id: values.job_id ?? null,
      resume_id: values.resume_id ?? null,
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
      await updateReminder(item.id, { status });
      message.success(status === "done" ? t("reminder.toast.done") : t("reminder.toast.ignored"));
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("reminder.toast.updateFailed"));
    }
  };

  const batch = useBatchSelection<number>();

  // 详情抽屉要展示绑定目标的名称（P0-1）：打开时按 id 回查补进候选，
  // 否则第 101 条之后的绑定在抽屉里只能显示 "-"。
  useEffect(() => {
    if (!detail) return;
    void trackSelect.ensure(detail.track_id);
    void jobSelect.ensure(detail.job_id);
    void resumeSelect.ensure(detail.resume_id);
    // hook 的回调引用稳定，只跟随详情目标变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

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
              label: REMINDER_KIND_LABELS[value],
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
        <CalendarView reminders={items} loading={loading} />
      ) : loading ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <Empty description={t("reminder.empty")} />
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
        <Form form={form} layout="vertical" initialValues={{ kind: "other", remind_at: dayjs() }}>
          <Form.Item
            label={t("reminder.field.content")}
            name="title"
            rules={[{ required: true, message: t("reminder.required.content") }]}
          >
            <Input maxLength={200} placeholder={t("reminder.placeholder.content")} />
          </Form.Item>
          <Form.Item
            label={t("reminder.field.time")}
            name="remind_at"
            rules={[{ required: true, message: t("reminder.required.time") }]}
          >
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label={t("reminder.field.kind")} name="kind">
            <Select
              options={REMINDER_KINDS.map((value) => ({
                value,
                label: REMINDER_KIND_LABELS[value],
              }))}
            />
          </Form.Item>
          <Form.Item label={t("reminder.field.track")} name="track_id">
            <Select
              allowClear
              placeholder={t("reminder.placeholder.track")}
              {...trackSelect.selectProps}
            />
          </Form.Item>
          <Form.Item label={t("reminder.field.job")} name="job_id">
            <Select
              allowClear
              placeholder={t("reminder.placeholder.job")}
              {...jobSelect.selectProps}
            />
          </Form.Item>
          <Form.Item label={t("reminder.field.resume")} name="resume_id">
            <Select
              allowClear
              placeholder={t("reminder.placeholder.resume")}
              {...resumeSelect.selectProps}
            />
          </Form.Item>
          <Form.Item label={t("reminder.field.note")} name="note">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder={t("reminder.placeholder.note")}
            />
          </Form.Item>
        </Form>
      </FormModal>

      <RecordDetailDrawer
        open={detail !== null}
        title={detail?.title || t("reminder.detail.title")}
        tags={
          detail && (
            <Space size={6} wrap>
              <Tag>{REMINDER_KIND_LABELS[detail.kind as ReminderKind] ?? detail.kind}</Tag>
              <Tag
                color={
                  detail.status === "pending"
                    ? "blue"
                    : detail.status === "done"
                      ? "green"
                      : "default"
                }
              >
                {REMINDER_STATUS_LABELS[detail.status as ReminderStatus] ?? detail.status}
              </Tag>
            </Space>
          )
        }
        fields={
          detail
            ? [
                { label: t("reminder.field.time"), value: formatDateTime(detail.remind_at) },
                {
                  label: t("reminder.detail.track"),
                  value:
                    trackSelect.options.find((option) => option.value === detail.track_id)?.label ??
                    "-",
                },
                {
                  label: t("reminder.detail.job"),
                  value:
                    jobSelect.options.find((option) => option.value === detail.job_id)?.label ??
                    "-",
                },
                {
                  label: t("reminder.detail.resume"),
                  value:
                    resumeSelect.options.find((option) => option.value === detail.resume_id)
                      ?.label ?? "-",
                },
                { label: t("reminder.detail.createdAt"), value: formatDateTime(detail.created_at) },
                { label: t("reminder.detail.updatedAt"), value: formatDateTime(detail.updated_at) },
              ]
            : []
        }
        sections={
          detail
            ? [
                {
                  title: t("reminder.field.note"),
                  content: detail.note || t("reminder.detail.none"),
                },
              ]
            : []
        }
        actions={
          detail && (
            <Space>
              {detail.status === "pending" && (
                <Button
                  icon={<CheckOutlined />}
                  onClick={() => {
                    void setStatus(detail, "done");
                    setDetail(null);
                  }}
                >
                  {t("reminder.action.markDone")}
                </Button>
              )}
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => {
                  openEdit(detail);
                  setDetail(null);
                }}
              >
                {t("reminder.action.edit")}
              </Button>
            </Space>
          )
        }
        onClose={() => setDetail(null)}
      />
    </Space>
  );
}
