/** 日历提醒（R-12）：待办列表、新建、完成、忽略与删除。
 *
 * 提醒列表按 ``remind_at`` 升序展示"接下来要做什么"；pending 的提醒可一键标记完成或忽略，
 * 删除走软删除（进回收站）。可绑定漏斗 / 岗位 / 简历，三个都是选填。
 */
import {
  CheckOutlined,
  CheckSquareOutlined,
  EditOutlined,
  PlusOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Empty,
  Form,
  Input,
  Listy,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { createReminder, deleteReminder, listReminders, updateReminder } from "../api/reminders";
import { REMINDER_KINDS, REMINDER_KIND_LABELS, REMINDER_STATUS_LABELS } from "../types";
import type { Reminder, ReminderKind, ReminderStatus } from "../types";
import { formatDateTime } from "../utils/format";
import { RecordDetailDrawer } from "./common/RecordDetail";
import { isFromInnerControl } from "./common/recordDetailCore";
import { ListyItem, ListyMeta } from "./common/ListyItem";
import { LISTY_ITEM_PADDING_DEFAULT } from "./common/listyPadding";
import { RowActions } from "./common/RowActions";
import BatchActionBar from "./common/BatchActionBar";
import { useBatchSelection } from "../hooks/useBatchSelection";
import CalendarView from "./tracker/CalendarView";

interface Option {
  value: number;
  label: string;
}

interface Props {
  trackOptions?: Option[];
  jobOptions?: Option[];
  resumeOptions?: Option[];
}

interface ReminderForm {
  title: string;
  remind_at: Dayjs;
  kind: ReminderKind;
  note?: string;
  track_id?: number;
  job_id?: number;
  resume_id?: number;
}

export default function ReminderPanel({
  trackOptions = [],
  jobOptions = [],
  resumeOptions = [],
}: Props) {
  const { message } = App.useApp();
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<string | undefined>();
  const [view, setView] = useState<"list" | "calendar">("list");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [detail, setDetail] = useState<Reminder | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ReminderForm>();

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listReminders({ kind: kind || undefined }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取提醒失败");
    } finally {
      setLoading(false);
    }
  }, [kind, message]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
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
      message.success(editing ? "已更新提醒" : "已新增提醒");
      setModalOpen(false);
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存提醒失败");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (item: Reminder, status: "done" | "dismissed") => {
    try {
      await updateReminder(item.id, { status });
      message.success(status === "done" ? "已标记完成" : "已忽略");
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新提醒失败");
    }
  };

  const batch = useBatchSelection<number>();

  /** 批量删除：确认后逐条走同一个软删除接口，全部完成再刷新一次。 */
  const removeSelected = () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    Modal.confirm({
      title: `删除选中的 ${ids.length} 条提醒？`,
      content: "删除后可在回收站里找回。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        const results = await Promise.allSettled(
          items.filter((item) => batch.isSelected(item.id)).map((item) => deleteReminder(item.id)),
        );
        const failed = results.filter((item) => item.status === "rejected").length;
        if (failed === 0) message.success(`已删除 ${ids.length} 条提醒`);
        else message.warning(`已删除 ${ids.length - failed} 条，${failed} 条失败，请重试`);
        batch.exitSelecting();
        await loadList();
      },
    });
  };

  const remove = async (item: Reminder) => {
    try {
      await deleteReminder(item.id);
      message.success("已删除");
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Card size="small" title="日历提醒">
        <Space wrap>
          <Select
            allowClear
            placeholder="按类型筛选"
            style={{ minWidth: 150 }}
            value={kind}
            onChange={setKind}
            options={REMINDER_KINDS.map((value) => ({
              value,
              label: REMINDER_KIND_LABELS[value],
            }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增提醒
          </Button>
          {view === "list" && !batch.selecting && items.length > 0 && (
            <Button icon={<CheckSquareOutlined />} onClick={batch.enterSelecting}>
              批量选择
            </Button>
          )}
          <Segmented
            value={view}
            onChange={(value) => setView(value as "list" | "calendar")}
            options={[
              { label: "列表", value: "list" },
              { label: "月历", value: "calendar" },
            ]}
          />
        </Space>
      </Card>

      {view === "calendar" ? (
        <CalendarView reminders={items} loading={loading} />
      ) : loading ? (
        <Spin />
      ) : items.length === 0 ? (
        <Empty description="还没有提醒，把面试、测评截止这些时点记下来吧" />
      ) : (
        <>
          {batch.selecting && (
            <BatchActionBar count={batch.selectedCount} onExit={batch.exitSelecting}>
              <Button danger disabled={batch.selectedCount === 0} onClick={removeSelected}>
                删除所选
              </Button>
            </BatchActionBar>
          )}
          <Listy
            items={items}
            rowKey={(item) => item.id}
            styles={{ item: { ...LISTY_ITEM_PADDING_DEFAULT } }}
            itemRender={(item) => {
              // 多选模式：行简化为勾选框 + 点行切换，不提供单行操作。
              if (batch.selecting) {
                return (
                  <ListyItem
                    className="detail-trigger"
                    actions={[
                      <Checkbox
                        key="pick"
                        aria-label={`选择提醒 ${item.title}`}
                        checked={batch.isSelected(item.id)}
                        onChange={() => batch.toggle(item.id)}
                      />,
                    ]}
                    onClick={() => batch.toggle(item.id)}
                  >
                    <ListyMeta title={item.title} description={formatDateTime(item.remind_at)} />
                  </ListyItem>
                );
              }
              // 「详情」放在第一位：列表只放得下摘要，备注、绑定对象这些都得点进去看。
              const actions = [
                <Button key="detail" type="link" size="small" onClick={() => setDetail(item)}>
                  详情
                </Button>,
              ];
              if (item.status === "pending") {
                actions.push(
                  <Button
                    key="done"
                    type="link"
                    size="small"
                    icon={<CheckOutlined />}
                    aria-label={`完成提醒 ${item.title}`}
                    onClick={() => void setStatus(item, "done")}
                  >
                    完成
                  </Button>,
                );
                actions.push(
                  <Button
                    key="dismiss"
                    type="text"
                    size="small"
                    icon={<StopOutlined />}
                    aria-label={`忽略提醒 ${item.title}`}
                    onClick={() => void setStatus(item, "dismissed")}
                  >
                    忽略
                  </Button>,
                );
              }
              actions.push(
                // 编辑/删除收进「···」菜单：删除不再以红图标裸露在行内（全局约定）。
                <RowActions
                  key="more"
                  more={[
                    {
                      key: "edit",
                      label: "编辑",
                      onClick: () => openEdit(item),
                    },
                    {
                      key: "delete",
                      label: "删除",
                      danger: true,
                      confirm: "删除这条提醒？删除后可在回收站里找回，不会立刻彻底删除。",
                      onClick: () => void remove(item),
                    },
                  ]}
                />,
              );
              return (
                <ListyItem
                  className="detail-trigger"
                  actions={actions}
                  // 整条点开详情；行内按钮与二次确认不会被这一层抢走。
                  onClick={(event) => {
                    if (isFromInnerControl(event)) return;
                    setDetail(item);
                  }}
                >
                  <ListyMeta
                    title={
                      <Space size={6} wrap>
                        <span>{item.title}</span>
                        <Tag>{REMINDER_KIND_LABELS[item.kind as ReminderKind] ?? item.kind}</Tag>
                        <Tag
                          color={
                            item.status === "pending"
                              ? "blue"
                              : item.status === "done"
                                ? "green"
                                : "default"
                          }
                        >
                          {REMINDER_STATUS_LABELS[item.status as ReminderStatus] ?? item.status}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Typography.Text type="secondary">
                        {formatDateTime(item.remind_at)}
                        {item.note ? ` · ${item.note}` : ""}
                      </Typography.Text>
                    }
                  />
                </ListyItem>
              );
            }}
          />
        </>
      )}

      <Modal
        title={editing ? "编辑提醒" : "新增提醒"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void save()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" initialValues={{ kind: "other", remind_at: dayjs() }}>
          <Form.Item
            label="提醒内容"
            name="title"
            rules={[{ required: true, message: "请填写提醒内容" }]}
          >
            <Input maxLength={200} placeholder="例如：参加某司二面" />
          </Form.Item>
          <Form.Item
            label="提醒时间"
            name="remind_at"
            rules={[{ required: true, message: "请选择提醒时间" }]}
          >
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="类型" name="kind">
            <Select
              options={REMINDER_KINDS.map((value) => ({
                value,
                label: REMINDER_KIND_LABELS[value],
              }))}
            />
          </Form.Item>
          <Form.Item label="绑定漏斗（选填）" name="track_id">
            <Select allowClear showSearch optionFilterProp="label" options={trackOptions} />
          </Form.Item>
          <Form.Item label="绑定岗位（选填）" name="job_id">
            <Select allowClear showSearch optionFilterProp="label" options={jobOptions} />
          </Form.Item>
          <Form.Item label="绑定简历（选填）" name="resume_id">
            <Select allowClear showSearch optionFilterProp="label" options={resumeOptions} />
          </Form.Item>
          <Form.Item label="备注" name="note">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="补充说明（选填）" />
          </Form.Item>
        </Form>
      </Modal>

      <RecordDetailDrawer
        open={detail !== null}
        title={detail?.title || "提醒详情"}
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
                { label: "提醒时间", value: formatDateTime(detail.remind_at) },
                {
                  label: "绑定漏斗",
                  value:
                    trackOptions.find((option) => option.value === detail.track_id)?.label ?? "-",
                },
                {
                  label: "绑定岗位",
                  value: jobOptions.find((option) => option.value === detail.job_id)?.label ?? "-",
                },
                {
                  label: "绑定简历",
                  value:
                    resumeOptions.find((option) => option.value === detail.resume_id)?.label ?? "-",
                },
                { label: "创建时间", value: formatDateTime(detail.created_at) },
                { label: "更新时间", value: formatDateTime(detail.updated_at) },
              ]
            : []
        }
        sections={detail ? [{ title: "备注", content: detail.note || "（无）" }] : []}
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
                  标记完成
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
                编辑
              </Button>
            </Space>
          )
        }
        onClose={() => setDetail(null)}
      />
    </Space>
  );
}
